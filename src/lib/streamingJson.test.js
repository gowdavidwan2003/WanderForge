import { describe, expect, it } from 'vitest';

import {
  createItineraryStreamParser,
  extractJsonObject,
  groqTextDeltas,
  readSSE,
  sseEvent,
} from '@/lib/streamingJson';

const day = (n, activities = 1) => ({
  day: n,
  theme: `Day ${n}`,
  activities: Array.from({ length: activities }, (_, i) => ({
    title: `Activity ${n}.${i}`,
    category: 'sightseeing',
    start_time: '09:00',
    end_time: '10:00',
    cost: 0,
  })),
});

const payload = (days) => JSON.stringify({
  itinerary: days,
  summary: 'A trip',
  estimated_total_cost: 0,
  currency: 'INR',
  pro_tips: ['tip'],
});

/** Feed a string through in fixed-size pieces, collecting everything emitted. */
function streamThrough(text, size) {
  const parser = createItineraryStreamParser();
  const out = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(...parser.push(text.slice(i, i + size)));
  }
  return { days: out, parser };
}

describe('createItineraryStreamParser', () => {
  it('emits a day as soon as its brace closes, not at the end', () => {
    const parser = createItineraryStreamParser();
    const text = payload([day(1), day(2)]);
    const firstClose = text.indexOf('}', text.indexOf('"activities"')) + 1;

    // Everything up to the end of day 1's activities array and its own brace.
    const upToDay1 = text.slice(0, text.indexOf('},', firstClose) + 1);
    const got = parser.push(upToDay1);

    expect(got).toHaveLength(1);
    expect(got[0].day).toBe(1);
  });

  it('emits each day exactly once, however the chunks fall', () => {
    const text = payload([day(1, 3), day(2, 5), day(3, 2)]);

    for (const size of [1, 3, 7, 64, 500, 100000]) {
      const { days } = streamThrough(text, size);
      expect(days.map((d) => d.day), `chunk size ${size}`).toEqual([1, 2, 3]);
    }
  });

  it('is not fooled by braces inside strings', () => {
    // A brace in a title would otherwise close a day early and emit a fragment.
    const tricky = {
      day: 1,
      theme: 'Nightlife',
      activities: [{ title: 'Café {Bar} — "the best"', category: 'nightlife' }],
    };
    const { days } = streamThrough(payload([tricky, day(2)]), 5);

    expect(days).toHaveLength(2);
    expect(days[0].activities[0].title).toBe('Café {Bar} — "the best"');
  });

  it('is not fooled by an escaped backslash before a quote', () => {
    const tricky = { day: 1, activities: [{ title: 'Ends with a backslash \\\\' }] };
    const { days } = streamThrough(payload([tricky, day(2)]), 4);
    expect(days.map((d) => d.day)).toEqual([1, 2]);
  });

  it('does not mistake an activity object for a day', () => {
    // Nested objects are depth 2. Only a 1→0 transition is a day.
    const { days } = streamThrough(payload([day(1, 8)]), 11);
    expect(days).toHaveLength(1);
    expect(days[0].activities).toHaveLength(8);
  });

  it('knows when the itinerary array has closed', () => {
    const { parser } = streamThrough(payload([day(1), day(2)]), 16);
    expect(parser.done).toBe(true);
  });

  it('is not done while days are still arriving', () => {
    const parser = createItineraryStreamParser();
    parser.push('{"itinerary": [');
    parser.push(JSON.stringify(day(1)));
    expect(parser.done).toBe(false);
  });

  it('ignores everything after the itinerary closes', () => {
    const parser = createItineraryStreamParser();
    parser.push(payload([day(1)]));
    // summary / pro_tips contain objects in some responses; none are days.
    expect(parser.push('{"not":"a day"}')).toEqual([]);
  });

  it('emits nothing before the itinerary key appears', () => {
    const parser = createItineraryStreamParser();
    expect(parser.push('{"summary": "planning", ')).toEqual([]);
    expect(parser.push('"currency": "INR", "itinerary": [')).toEqual([]);
  });

  it('keeps the full text for the authoritative parse at the end', () => {
    const text = payload([day(1), day(2)]);
    const { parser } = streamThrough(text, 9);
    expect(parser.text()).toBe(text);
    expect(JSON.parse(parser.text()).currency).toBe('INR');
  });

  it('skips a day that will not parse rather than throwing', () => {
    // Preview only — the end-of-stream parse is what decides what gets saved.
    const parser = createItineraryStreamParser();
    const got = parser.push('{"itinerary": [{"day": 1, "bad": }, ' + JSON.stringify(day(2)) + ']}');
    expect(got.map((d) => d.day)).toEqual([2]);
  });

  it('tolerates empty and absent chunks', () => {
    const parser = createItineraryStreamParser();
    expect(parser.push('')).toEqual([]);
    expect(parser.push(undefined)).toEqual([]);
  });
});

/** A ReadableStream over some strings, for the two reader helpers. */
function streamOf(...parts) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
}

const collect = async (iterable) => {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
};

describe('groqTextDeltas', () => {
  const frame = (content) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

  it('yields the content out of the envelope', async () => {
    const got = await collect(groqTextDeltas(streamOf(frame('Hello '), frame('world'), 'data: [DONE]\n\n')));
    expect(got.join('')).toBe('Hello world');
  });

  it('reassembles an event split across chunks', async () => {
    const whole = frame('split me');
    const got = await collect(groqTextDeltas(streamOf(whole.slice(0, 20), whole.slice(20))));
    expect(got.join('')).toBe('split me');
  });

  it('stops at [DONE] without yielding it', async () => {
    const got = await collect(groqTextDeltas(streamOf(frame('a'), 'data: [DONE]\n\n', frame('never'))));
    expect(got).toEqual(['a']);
  });

  it('skips frames it cannot parse', async () => {
    const got = await collect(groqTextDeltas(streamOf('data: not json\n\n', frame('ok'))));
    expect(got).toEqual(['ok']);
  });

  it('stops early when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const got = await collect(groqTextDeltas(streamOf(frame('a')), { signal: controller.signal }));
    expect(got).toEqual([]);
  });
});

describe('sseEvent / readSSE', () => {
  it('round-trips an event', async () => {
    const wire = sseEvent('day', { day: 1, theme: 'Hills' });
    const got = await collect(readSSE(streamOf(wire)));
    expect(got).toEqual([{ event: 'day', data: { day: 1, theme: 'Hills' } }]);
  });

  it('reads several events, including ones split across chunks', async () => {
    const wire = sseEvent('day', { day: 1 }) + sseEvent('day', { day: 2 }) + sseEvent('done', { ok: true });
    const got = await collect(readSSE(streamOf(wire.slice(0, 15), wire.slice(15, 40), wire.slice(40))));
    expect(got.map((e) => e.event)).toEqual(['day', 'day', 'done']);
    expect(got[2].data).toEqual({ ok: true });
  });

  it('survives a payload containing a newline', async () => {
    const got = await collect(readSSE(streamOf(sseEvent('error', { message: 'line one\nline two' }))));
    expect(got[0].data.message).toBe('line one\nline two');
  });

  it('stops early when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const got = await collect(readSSE(streamOf(sseEvent('day', { day: 1 })), { signal: controller.signal }));
    expect(got).toEqual([]);
  });
});

describe('extractJsonObject', () => {
  const obj = { itinerary: [{ day: 1 }], currency: 'INR' };

  it('reads a plain JSON response', () => {
    expect(extractJsonObject(JSON.stringify(obj))).toEqual(obj);
  });

  it('strips a markdown fence', () => {
    // The streaming path cannot use Groq's JSON mode — it buffers the whole
    // completion and defeats the point — so the model is free to fence its answer.
    expect(extractJsonObject('```json\n' + JSON.stringify(obj) + '\n```')).toEqual(obj);
    expect(extractJsonObject('```\n' + JSON.stringify(obj) + '\n```')).toEqual(obj);
  });

  it('ignores a sentence before or after the object', () => {
    expect(extractJsonObject(`Here is your itinerary:\n${JSON.stringify(obj)}\nEnjoy!`)).toEqual(obj);
  });

  it('is null when the object never closed', () => {
    // The stream ended mid-write: token ceiling, or a dropped connection.
    expect(extractJsonObject('{"itinerary": [{"day": 1, "theme": "Hi')).toBeNull();
  });

  it('is null for anything that is not an object', () => {
    for (const v of ['', 'no braces here', null, undefined, 42]) {
      expect(extractJsonObject(v)).toBeNull();
    }
  });
});
