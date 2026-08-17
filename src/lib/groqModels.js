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
 * Planning runs at 'low', because 'medium' does not fit this account's budget.
 *
 * Medium is the more attractive setting on paper — these prompts carry the realism
 * constraints, and deliberation is exactly what they reward. It was tried and
 * measured, and it truncates:
 *
 *   effort   trip    reasoning   outcome
 *   medium   3-day        2,771   finish_reason "length", currency field missing
 *   medium   5-day        2,502   truncated at 6,800, needed ~11,000
 *   low      5-day           35   complete
 *
 * The reason is the tokens-per-minute ceiling below, not the model: reasoning
 * tokens come out of the same completion budget as the itinerary, so at medium
 * roughly half the available budget is spent before any JSON is written, and the
 * tail — currency, pro_tips, the last day — is what gets cut.
 *
 * Set GROQ_PLANNING_EFFORT=medium to revisit this on a paid tier, where a larger
 * TPM allowance makes the reservation affordable.
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
 * Sized for 'low', the shipped effort: nearly the whole budget goes to the
 * itinerary. Reserving less than the cap where possible also matters, because the
 * reservation is charged against TPM whether or not it is used — a short trip that
 * asks for 6,200 tokens blocks the next request for no reason.
 */
const CAP = 6200;              // keeps prompt + budget under the 8,000 TPM limit
const REASONING_HEADROOM = 600; // 'low' measured at ~35 tokens; this is slack

export function planningMaxTokens(days) {
  const n = Number(days) || 1;
  const content = 700 * n + 800;
  return Math.min(Math.max(2500, Math.round(content + REASONING_HEADROOM)), CAP);
}

/** Chat replies are short; the ceiling exists so reasoning cannot truncate one. */
export const CHAT_MAX_TOKENS = 2500;
