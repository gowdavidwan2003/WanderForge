/**
 * Which Groq model each workload uses.
 *
 * `llama-3.3-70b-versatile` was hardcoded at five call sites. Groq retired it, and
 * because the string was duplicated rather than named, one deprecation took out
 * every AI feature at once — generation, both replan paths and the chat assistant
 * — each reporting "The model does not exist or you do not have access to it".
 * Naming it here means the next retirement is a one-line change, and the env
 * overrides mean it can be done without a deploy.
 *
 * Both models below were checked against the live account for the two
 * capabilities this app actually depends on:
 *
 *   response_format: json_object   generation and replanning parse the reply
 *   tools / tool_choice            the chat assistant proposes itinerary edits
 *
 * gpt-oss-120b does both and returned valid JSON in ~2.0s; gpt-oss-20b does both
 * in ~0.9s. qwen3.6-27b supports tools but failed to produce JSON, so it is not a
 * candidate for the planning routes.
 *
 * Note for whoever changes these: Groq rejects `response_format: json_object`
 * unless the messages mention JSON somewhere. The planning prompts do.
 */

/**
 * Itinerary generation and replanning.
 *
 * The larger model, because these prompts carry the realism constraints — travel
 * time between stops, opening hours, a day that has to be achievable — and that
 * is where reasoning quality shows.
 */
export const PLANNING_MODEL = process.env.GROQ_PLANNING_MODEL || 'openai/gpt-oss-120b';

/**
 * The chat assistant.
 *
 * Roughly twice as fast, and conversation plus a single tool call does not need
 * the larger model. Chat is the most latency-sensitive surface in the app.
 */
export const CHAT_MODEL = process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-20b';

/**
 * These are reasoning models, and that changes what a request has to specify.
 *
 * Swapping the model name alone was not enough. gpt-oss emits reasoning tokens
 * that count against the completion budget, and on the default budget they ate
 * almost all of it: a two-day itinerary came back with finish_reason "length"
 * after 3072 completion tokens, 2815 of them reasoning. Day two had one activity
 * instead of eight and the currency field never arrived.
 *
 * reasoning_effort 'low' cut reasoning from 2815 tokens to 35 on the same prompt,
 * and the itinerary completed. These prompts do not need deliberation — the
 * realism rules are stated in the system prompt rather than something the model
 * has to reason its way to.
 */
/**
 * Planning runs at 'low', because medium's cost is not predictable enough to
 * budget for against an 8,000 tokens-per-minute ceiling.
 *
 * Medium was tried repeatedly. It works on short trips and fails on longer ones,
 * and the deciding factor is that its reasoning spend varies by roughly 2x between
 * runs of the same prompt:
 *
 *   effort   trip    reasoning   outcome
 *   medium   3-day       2,878    complete
 *   medium   5-day       2,473    complete
 *   medium   5-day       4,898    truncated — 3 days of 5, currency missing
 *   low      3-day         458    complete
 *   low      5-day          32    complete
 *
 * Reasoning comes out of the same budget as the itinerary, so a run that thinks
 * twice as hard as the last one silently loses the tail — the final days, the
 * currency, the tips. Sizing for the worst case would leave too little content
 * budget to be worth it. Low is not measurably worse here: the realism rules are
 * stated in the prompt rather than something to be reasoned toward.
 *
 * GROQ_PLANNING_EFFORT=medium is worth revisiting on a paid tier, where the wider
 * TPM allowance absorbs the variance.
 */
export const PLANNING_REASONING_EFFORT = process.env.GROQ_PLANNING_EFFORT || 'low';

/** Chat stays low: a reply plus one tool call needs no deliberation, and this is
 *  the most latency-sensitive surface in the app. */
export const CHAT_REASONING_EFFORT = process.env.GROQ_CHAT_EFFORT || 'low';

/**
 * Completion budget for a planning request.
 *
 * An explicit ceiling is required, because the default truncates. But Groq
 * reserves the whole value against the per-minute token limit up front, so
 * reserving too much fails the request outright with a 413 rather than a 429 —
 * which is why the original code left max_tokens off altogether. Scaling with the
 * trip length keeps short trips cheap to reserve and long ones inside the cap.
 *
 * The hard constraint is the account's tokens-per-minute allowance, and Groq
 * counts prompt + max_completion_tokens against it before running anything:
 *
 *   413 Request too large ... on tokens per minute (TPM):
 *       Limit 8000, Requested 8251
 *
 * The system prompt is around 1,550 tokens, so the completion budget cannot
 * exceed roughly 6,400 whatever the trip length. Measured against gpt-oss-120b:
 *
 *   effort   5-day reasoning   5-day content   total
 *   low                   35            3082    3117
 *   medium              2502            3538    6040
 *
 * The budget is derived from the prompt rather than fixed, because the limit
 * applies to their sum. replan-trip's prompt carries every place on the trip plus
 * the conflict list, so it can be several times the size of generate's — a single
 * constant either wastes budget on short prompts or exceeds the limit on long
 * ones, and exceeding it fails the request outright with a 413.
 *
 * Pass the prompt text so the ceiling is computed from what is actually being
 * sent. The 4-chars-per-token estimate is deliberately rough and the margin
 * covers it being wrong.
 */
const TPM_LIMIT = 8000;
const TPM_MARGIN = 500;        // absorbs the token estimate being off
const MODEL_CAP = 8192;        // hard per-request ceiling on gpt-oss-120b
const REASONING_HEADROOM = 900; // 'low' measured between 32 and 458 tokens

export function planningMaxTokens(days, promptText = '') {
  const n = Number(days) || 1;

  const promptTokens = Math.ceil(String(promptText).length / 4);
  const affordable = TPM_LIMIT - promptTokens - TPM_MARGIN;

  // ~1,100 tokens per day: a full day comes back as 8-12 entries once meals and
  // both legs of every long transfer are included, at roughly 100-120 tokens each.
  // The earlier 700 estimate was taken from days of 7-8 entries and undershot.
  const wanted = 1100 * n + 800 + REASONING_HEADROOM;

  // Floor of 1,500: below that even one day cannot complete, and it is better to
  // attempt it and report truncation than to send a request guaranteed to fail.
  return Math.max(1500, Math.min(wanted, affordable, MODEL_CAP));
}

/** Chat replies are short; the ceiling exists so reasoning cannot truncate one. */
export const CHAT_MAX_TOKENS = 2500;
