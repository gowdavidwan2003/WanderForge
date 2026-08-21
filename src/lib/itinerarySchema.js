/**
 * The output contract for AI-generated itineraries.
 *
 * `JSON.parse` used to be the whole contract: whatever the model emitted went
 * straight into `activities`. That is fine until a model writes `"9am"` into a
 * Postgres `TIME` column, or `"restaurant"` into a `CHECK`-constrained
 * `category`. Those rows are rejected one at a time by the database, so days 1-3
 * land, day 4 half-lands, and the trip is left partially populated with nothing
 * to roll back to.
 *
 * So the model's output is coerced and validated here, before anything is
 * written. Values that can be repaired are repaired ("9am" -> "09:00",
 * "Rs 1,200" -> 1200, "restaurant" -> "food"); values that cannot are rejected
 * with a message specific enough to hand back to the model on a retry.
 *
 * Everything in this file is pure — no network, no database — so the contract
 * can be tested against real model misbehaviour without a Groq key.
 */

import { z } from 'zod';
import { ACTIVITY_CATEGORIES, normalizeCategory } from '@/lib/itineraryPrompt';

const pad = (n) => String(n).padStart(2, '0');

/** Strings that mean "no cost", as opposed to "cost unknown". */
const ZERO_COST_WORDS = new Set([
  'free', 'none', 'no cost', 'nil', 'n/a', 'na', 'included', 'complimentary',
]);

/**
 * Build "HH:MM" from parts, rejecting anything out of range.
 *
 * @param meridiem 'a' or 'p' when the source carried one, else null
 */
function buildTime(hour, minute, meridiem) {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute < 0 || minute > 59) return null;

  let h = hour;
  if (meridiem) {
    // A meridiem only makes sense on a 12-hour clock, so "13pm" is a mistake
    // rather than something to guess at.
    if (h < 1 || h > 12) return null;
    if (meridiem === 'p' && h !== 12) h += 12;
    if (meridiem === 'a' && h === 12) h = 0;
  }

  if (h < 0 || h > 23) return null;
  return `${pad(h)}:${pad(minute)}`;
}

/**
 * Coerce whatever the model wrote into "HH:MM", or null when it cannot be.
 *
 * Handles the shapes seen in practice: "9am", "9:30 p.m.", "21:00:00" (what
 * Postgres itself returns), "0930", "9.30", "noon". Deliberately does NOT guess
 * at "morning", "TBD" or "after lunch" — inventing a clock time for those would
 * produce a schedule the traveler never agreed to, and a rejection the model can
 * fix is better than a plausible fiction nobody can see.
 */
export function coerceTime(value) {
  if (value == null) return null;

  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  if (raw === 'noon' || raw === 'midday' || raw === 'mid-day') return '12:00';
  if (raw === 'midnight') return '00:00';

  // "0930" / "930" — a bare run of 3-4 digits is HHMM, never a lone hour.
  const bare = raw.match(/^(\d{3,4})$/);
  if (bare) {
    return buildTime(Number(bare[1].slice(0, -2)), Number(bare[1].slice(-2)), null);
  }

  // Minutes must be two digits: "9.5" is too ambiguous to repair, and reading it
  // as 09:05 would be silently wrong about half the time.
  const m = raw.match(/^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return null;

  return buildTime(Number(m[1]), m[2] == null ? 0 : Number(m[2]), m[3] ? m[3][0] : null);
}

/** Minutes since midnight for an already-coerced "HH:MM". */
export function timeToMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Coerce a cost to a non-negative number, or null when it is not a cost.
 *
 * Models write costs as "Rs 1,200", "1200 INR", "Free", "approx 500". Currency
 * is carried on the trip, so anything non-numeric around the figure is noise. A
 * range ("500-800") takes the first figure: the low end is the one a traveler is
 * quoted, and over-reporting a budget is the more misleading error.
 */
export function coerceCost(value) {
  if (value == null || value === '') return 0;

  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  }

  if (typeof value !== 'string') return null;

  const raw = value.trim().toLowerCase();
  if (!raw) return 0;
  if (ZERO_COST_WORDS.has(raw)) return 0;

  // Strip thousands separators before looking for a figure, so "1,200" reads as
  // one number rather than a 1 followed by junk.
  const m = raw.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;

  const n = Number(m[0]);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Clamp a category to the eleven the database accepts.
 *
 * Delegates to normalizeCategory rather than keeping a second table. The replan
 * and manual-save paths do not go through this schema but write to the same
 * CHECK-constrained column, so two implementations would mean two answers to the
 * same question — and the one that drifted would be the one nobody was testing.
 *
 * Never returns null: an unrecognised label is a naming problem, not a reason to
 * reject an otherwise usable activity, so it falls back to 'other'.
 */
export const coerceCategory = normalizeCategory;

/** Free text: anything printable becomes a trimmed string, absent becomes ''. */
const text = z.preprocess(
  (v) => (v == null ? '' : typeof v === 'string' ? v.trim() : String(v).trim()),
  z.string()
);

/**
 * Preprocessors hand the raw value through untouched when coercion fails, so
 * Zod reports the format error and the caller can still quote what the model
 * actually wrote.
 */
const timeField = z.preprocess(
  (v) => coerceTime(v) ?? (v == null ? v : String(v)),
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24-hour clock time like "09:00"')
);

const costField = z.preprocess(
  (v) => coerceCost(v) ?? (typeof v === 'number' ? v : String(v ?? '')),
  z.number().min(0, 'must be a non-negative number of local-currency units')
);

export const activitySchema = z
  .object({
    title: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() : v),
      z.string().min(1, 'must be a non-empty activity name')
    ),
    description: text,
    location_name: text,
    category: z.preprocess(coerceCategory, z.enum(ACTIVITY_CATEGORIES)),
    start_time: timeField,
    end_time: timeField,
    cost: costField,
    notes: text,
    booking_link: text,
  })
  .superRefine((act, ctx) => {
    const start = timeToMinutes(act.start_time);
    const end = timeToMinutes(act.end_time);
    if (start == null || end == null) return;

    // Matches the conflict checker's own rule, so an activity can never be
    // accepted here and then immediately flagged as an error there. Activities
    // running past midnight are rejected rather than wrapped: a `TIME` column
    // carries no date, so 23:00 -> 00:30 is indistinguishable from a typo.
    if (end <= start) {
      ctx.addIssue({
        code: 'custom',
        path: ['end_time'],
        message: `must be later than start_time (${act.start_time}); split anything running past midnight into two activities`,
      });
    }
  });

export const dayPlanSchema = z.object({
  day: z.preprocess(
    (v) => (typeof v === 'string' ? Number(v.replace(/\D/g, '')) : v),
    z.number().int().min(1, 'must be a day number starting at 1')
  ),
  theme: text,
  activities: z.array(activitySchema).min(1, 'must contain at least one activity'),
});

export const itinerarySchema = z.object({
  itinerary: z.array(dayPlanSchema).min(1, 'must contain at least one day'),
  summary: text,
  estimated_total_cost: costField.optional().default(0),
  currency: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : ''),
    z.string()
  ),
  pro_tips: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((t) => typeof t === 'string' && t.trim()) : []),
    z.array(z.string())
  ),
});

/** Walk a Zod issue path into the raw payload so an error can quote the input. */
function valueAt(root, path) {
  let node = root;
  for (const key of path) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

/** `itinerary[0].activities[2].start_time` — a path a person can search for. */
function formatPath(path) {
  return path.reduce(
    (acc, key) =>
      typeof key === 'number' ? `${acc}[${key}]` : acc ? `${acc}.${key}` : String(key),
    ''
  );
}

/**
 * Turn Zod issues into lines a model can act on.
 *
 * Each line names the field, says what is wrong, and quotes what was written.
 * Without the value, "start_time: must be a 24-hour clock time" tells the model
 * nothing it did not already believe it had done.
 */
export function formatIssues(issues, raw) {
  const lines = [];
  const seen = new Set();

  for (const issue of issues) {
    const path = issue.path || [];
    const value = valueAt(raw, path);
    const quoted = value === undefined ? 'field missing' : `got ${JSON.stringify(value)}`;
    const line = `${formatPath(path) || 'response'}: ${issue.message} (${quoted})`;

    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }

  return lines;
}

/**
 * Structural rules Zod cannot express, because they are about the set of days
 * rather than any single one.
 */
function checkDayNumbering(itinerary, expectedDays) {
  const errors = [];
  const seen = new Set();

  for (const [i, day] of itinerary.entries()) {
    if (seen.has(day.day)) {
      errors.push(
        `itinerary[${i}].day: day ${day.day} appears more than once; number the days 1..${itinerary.length} with no repeats`
      );
    }
    seen.add(day.day);

    if (expectedDays && day.day > expectedDays) {
      errors.push(
        `itinerary[${i}].day: day ${day.day} is outside the requested trip of ${expectedDays} day(s)`
      );
    }
  }

  if (expectedDays && itinerary.length !== expectedDays) {
    errors.push(
      `itinerary: ${itinerary.length} day(s) returned but ${expectedDays} were requested`
    );
  }

  return errors;
}

/**
 * Validate and repair one model response.
 *
 * All-or-nothing on purpose. Dropping the activities that failed and writing the
 * rest is exactly the partially-populated trip this exists to prevent — the
 * traveler cannot tell a deliberately light day from a day the validator ate.
 *
 * @param raw  parsed JSON from the model
 * @param days how many days were asked for; the count check is skipped when absent
 * @returns {{ok: true, data: object} | {ok: false, errors: string[]}}
 */
export function validateItinerary(raw, { days } = {}) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['response: must be a JSON object with an "itinerary" array'] };
  }

  const parsed = itinerarySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: formatIssues(parsed.error.issues, raw) };
  }

  const numbering = checkDayNumbering(parsed.data.itinerary, days);
  if (numbering.length) return { ok: false, errors: numbering };

  // Activities arrive in whatever order the model wrote them, but everything
  // downstream — order_index, the conflict checker's pairwise travel checks —
  // assumes chronological order within a day.
  const data = {
    ...parsed.data,
    itinerary: parsed.data.itinerary
      .map((day) => ({
        ...day,
        activities: [...day.activities].sort(
          (a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
        ),
      }))
      .sort((a, b) => a.day - b.day),
  };

  return { ok: true, data };
}

/** The block appended to a retry prompt after a rejected response. */
export function validationRetryPrompt(errors) {
  return [
    'Your previous response was rejected because it did not match the required format.',
    'Fix exactly these problems and resend the COMPLETE itinerary as JSON:',
    ...errors.map((e) => `- ${e}`),
    '',
    'Reminders:',
    '- start_time and end_time must be 24-hour "HH:MM" strings, never "9am", "TBD" or a range.',
    '- end_time must be strictly later than start_time on the same day.',
    `- category must be exactly one of: ${ACTIVITY_CATEGORIES.join(', ')}.`,
    '- cost must be a plain number in local currency units, with no symbols, commas or words.',
  ].join('\n');
}
