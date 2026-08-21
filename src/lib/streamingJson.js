/**
 * Pulling whole days out of a JSON response that has not finished arriving.
 *
 * Generation takes 15-40 seconds and showed nothing at all until it was over. It
 * cannot be split into one request per day — Groq counts prompt plus reserved
 * completion against a single 8,000 tokens-per-minute allowance, and five
 * requests each carrying the system prompt would exceed it before the third —
 * so the fix is to stream the one completion and read days out of it as they
 * close.
 *
 * That means parsing JSON that is still being written. JSON.parse cannot help
 * until the last brace lands, so this walks the text and hands back each day
 * object at the moment its own brace closes, tracking string and escape state so
 * a brace inside `"Café {Bar}"` is not mistaken for structure.
 *
 * Pure and synchronous. Feed it chunks, take days out, and when the stream ends
 * parse the accumulated text properly — the incremental pass is for feedback,
 * never for the data that gets saved.
 */

/**
 * @returns {{
 *   push(chunk: string): object[],  complete day objects newly closed
 *   text(): string,                 everything received so far
 *   done: boolean                   the itinerary array has closed
 * }}
 */
export function createItineraryStreamParser() {
  let buffer = '';
  // Where in `buffer` the array's contents begin. -1 until "itinerary": [ is seen.
  let arrayStart = -1;
  // How far the scanner has consumed. Everything before this is already emitted.
  let cursor = 0;
  let done = false;

  /** Locate `"itinerary"` and the `[` that follows it. */
  function findArray() {
    const key = buffer.indexOf('"itinerary"');
    if (key === -1) return false;

    const open = buffer.indexOf('[', key);
    if (open === -1) return false;

    arrayStart = open + 1;
    cursor = arrayStart;
    return true;
  }

  /**
   * Scan from `cursor` for complete top-level objects.
   *
   * Only depth 1→0 transitions count: nested objects and arrays inside a day
   * (its activities) must not be mistaken for the day itself.
   */
  function extract() {
    const found = [];

    let depth = 0;
    let objectStart = -1;
    let inString = false;
    let escaped = false;

    for (let i = cursor; i < buffer.length; i++) {
      const ch = buffer[i];

      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { if (inString) escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{') {
        if (depth === 0) objectStart = i;
        depth++;
        continue;
      }

      if (ch === '}') {
        depth--;
        if (depth === 0 && objectStart !== -1) {
          const slice = buffer.slice(objectStart, i + 1);
          try {
            found.push(JSON.parse(slice));
          } catch {
            // A day that will not parse is skipped rather than throwing: this is
            // preview only, and the authoritative parse happens at the end.
          }
          // Consume up to and including this object, so the next scan starts
          // fresh rather than re-emitting everything before it.
          cursor = i + 1;
          objectStart = -1;
        }
        continue;
      }

      // The array closed at depth 0 — the itinerary is complete. Anything after
      // this (summary, currency, pro_tips) is not our business.
      if (ch === ']' && depth === 0) {
        done = true;
        cursor = i;
        break;
      }
    }

    return found;
  }

  return {
    push(chunk) {
      if (done) { buffer += chunk ?? ''; return []; }
      buffer += chunk ?? '';

      if (arrayStart === -1 && !findArray()) return [];
      return extract();
    },

    text: () => buffer,
    get done() { return done; },
  };
}

/**
 * Read a Groq streaming chat completion into text deltas.
 *
 * Server-sent events, one JSON object per `data:` line, terminated by
 * `data: [DONE]`. Yields only the content, so callers do not have to know the
 * envelope.
 *
 * @param body a ReadableStream of bytes
 */
export async function* groqTextDeltas(body, { signal } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  try {
    while (true) {
      if (signal?.aborted) return;

      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });

      // Events are separated by a blank line, but a chunk can split one in half,
      // so keep the trailing partial for the next read.
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;

        try {
          const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // A malformed frame is not worth failing a generation over.
        }
      }
    }
  } finally {
    // Releasing matters on cancel: without it the underlying connection to Groq
    // stays open and keeps being billed after the user has walked away.
    reader.releaseLock?.();
  }
}

/**
 * Recover the JSON object from a response that was not constrained to JSON.
 *
 * The streaming path cannot use Groq's `response_format: json_object`. Measured
 * against gpt-oss-120b on a 5-day itinerary:
 *
 *   with json_object     first byte 6,444ms, all 12KB delivered in the next 3ms
 *   without json_object  first byte 116ms, day 1 at 1,901ms, then roughly one
 *                        day every 1.7s, finished at 8,569ms
 *
 * JSON mode buffers the whole completion before sending any of it, which makes
 * streaming pointless — the spinner just moves to a different place. Dropping it
 * is what makes the first day appear in under two seconds, and the cost is that
 * the model may now wrap its answer in prose or a markdown fence.
 *
 * So: strip a fence if there is one, then take the outermost braces. Anything
 * else that survives is caught by validateItinerary, which has a retry.
 */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null;

  // ```json ... ``` or plain ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;

  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first === -1 || last <= first) return null;

  try {
    return JSON.parse(body.slice(first, last + 1));
  } catch {
    return null;
  }
}

/** Encode one server-sent event. */
export function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Read our own SSE stream back in the browser.
 *
 * EventSource cannot be used: it is GET-only and this is a POST with a body.
 *
 * @yields {{event: string, data: any}}
 */
export async function* readSSE(body, { signal } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  try {
    while (true) {
      if (signal?.aborted) return;

      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });

      const frames = pending.split('\n\n');
      pending = frames.pop() ?? '';

      for (const frame of frames) {
        let event = 'message';
        let data = '';

        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }

        if (!data) continue;
        try {
          yield { event, data: JSON.parse(data) };
        } catch {
          // Ignore a frame we cannot read rather than aborting the generation.
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}
