<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.2-black?style=for-the-badge&logo=next.js" alt="Next.js 16.2" />
  <img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase" alt="Supabase" />
  <img src="https://img.shields.io/badge/AI-Groq_gpt--oss-F55036?style=for-the-badge" alt="Groq" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT" />
</p>

# 🧭 WanderForge

**Most AI itineraries cannot actually be walked. This one checks.**

A language model will happily put you on a mountain at 09:10 and in a restaurant
across the valley at 09:30. It has no idea how long the road takes, and it will
never tell you it guessed.

WanderForge measures every journey in a generated plan against real road
distances *before the itinerary is saved*, flags the ones that do not fit the
time allowed, and gives the model one chance to fix them. What survives is
either achievable or explicitly marked as not.

---

## Contents

- [What it does](#what-it-does)
- [How the checking works](#how-the-checking-works)
- [Running it](#running-it)
- [Architecture](#architecture)
- [Testing](#testing)
- [Status](#status)
- [Legal](#legal)

---

## What it does

**Planning.** Describe a trip — destination, dates, interests, budget level, how
you get around — and the AI plans it day by day. Days stream in as they are
written, usually the first within two seconds, and you can stop it at any point.

**Starting points.** Ten destinations ship with a complete day-by-day itinerary —
44 days and 206 stops between them, each carrying a time, a category, a cost and
real coordinates. The whole plan is readable with no account; signing in copies
it into a trip you own and can edit.

**Checking.** Before anything reaches the database, every consecutive pair of
activities is measured. Overlaps, activities that end before they start, and
journeys that do not fit the gap are found and named. Whatever cannot be fixed is
flagged on the day it belongs to, next to the problem, with a one-click rebuild.

**Collaboration.** Invite people to a trip and edits appear as they happen. The
owner can freeze the itinerary once the group agrees; the freeze is enforced by
database policy, not a disabled button.

**Money.** Track spend against a budget in the destination's currency, then split
shared costs and settle in the fewest transfers. Settlement is done in integer
cents, so the balances reconcile exactly.

**Taking it with you.** Export as PDF or as an `.ics` calendar file. Daily
weather sits beside each day while you plan.

---

## How the checking works

This is the part worth reading, because it is the part that is unusual.

### The problem

Ask any model for a five-day itinerary and it will produce something that reads
beautifully and cannot be executed. It does not know that Chikmagaluru town to
Mullayanagiri is 10 km in a straight line, 22 km by road, and 90 minutes of
hairpins. Prompting harder does not fix it — a model asked to check its own
arithmetic produces more confident output, not more correct output.

### What we do instead

1. **The model plans.** The prompt carries realism rules — road speeds by
   terrain, parking and queue overheads, the return journey as its own entry —
   which shape what it *chooses*, not what it *verifies*.

2. **The output is validated.** A Zod schema coerces what can be repaired
   (`"9am"` → `"09:00"`, `"₹1,200"` → `1200`, `"restaurant"` → `food`) and
   rejects what cannot. Rejection is all-or-nothing, so a bad response can never
   half-write a trip. On failure the model gets one retry holding the specific
   errors.

3. **Places are resolved.** Every location is geocoded server-side against a
   shared 30-day cache, so a destination somebody has already planned costs
   nothing to look up again.

4. **The plan is measured.** `conflictChecker` walks each day pair by pair using
   great-circle distance scaled for road sinuosity — a road more than twice the
   crow-flight distance is switchbacking, and no flat-road average applies to it.

5. **The model gets one chance to fix it.** Conflicts are quoted back verbatim
   with a compact digest of the plan. The result is kept only if it is
   *measurably* more achievable than what it replaced.

6. **Survivors are recorded.** Remaining conflicts are stored with the trip and
   shown in the editor. An unachievable plan is never silently saved as a normal
   one.

### Estimates versus measurements

The difference is worth stating, because it decides how much the output is worth.
Measured against the route this was built around — Chikmagaluru town to
Mullayanagiri, 10.1 km straight line:

| Method | Result |
|---|---|
| Great-circle × 1.3 at a flat speed | 35 min |
| Sinuosity model, road distance only | 71 min |
| **Google Routes, measured** | **56 min** (21.6 km, 44 min driving) |

The flat model is 1.6× optimistic on that road and the sinuosity fallback
overshoots by 1.27×, so asking the provider is clearly best and is what happens
now. The Itinerary Check panel says how many journeys on a trip were measured
rather than estimated, and offers to measure the rest.

A transport entry is exempt from these checks. It *is* the journey — the prompt
asks the model to give every hop over 45 minutes its own entry, and measuring the
gap before that entry and demanding it cover the drive flagged correct plans as
broken.

### What it cannot do

Real opening hours, closures, weather on the day, or whether a place still
exists. Warnings about opening hours are inferred from the activity's category
and are worth confirming, not obeying. Findings under 10 minutes are suppressed
as noise. Anything marked **impossible** is arithmetic — the journey does not fit
the gap.

---

## Running it

### Requirements

- Node 20+
- A Supabase project
- A Groq API key (the free tier is enough)
- A Google Maps Platform key with **Places API (New)** and **Routes API** enabled

### 1. Install

```bash
npm install
```

### 2. Environment

Create `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
# Required for the geocode cache to be written. Without it every place lookup
# is billed, every time.
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Groq — tried in order, rotates on rate limit
GROQ_API_KEY=<key 1>
GROQ_API_KEY_2=<key 2>   # optional
GROQ_API_KEY_3=<key 3>   # optional

# Google Maps — server-side only, never NEXT_PUBLIC_
GOOGLE_MAPS_API_KEY=<key>

# OpenRouteService — routing fallback, optional
OPENROUTESERVICE_API_KEY=<key>

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> `GOOGLE_MAPS_API_KEY` and every Groq key are secrets. None of them may be
> prefixed `NEXT_PUBLIC_` — that ships them to the browser.

### 3. Migrations

Run every file in `supabase/migrations/` **in numeric order** in the Supabase SQL
editor. They are not optional and several are not backward compatible:

| Migration | Adds |
|---|---|
| `001`–`007` | Schema, RLS, collaboration, expenses, the itinerary lock |
| `008` | Conflict storage on trips |
| `009` | Shared geocode cache |
| `010` | Atomic replan and atomic trip creation. **The app cannot create or replan without this.** |
| `011` | Trip editing and delete-cascade verification. **Trip Settings cannot save without this.** |
| `012` | RLS performance and index realignment |
| `013` | Encrypted API-key storage. **Deletes any plaintext keys** — those users must re-enter and rotate |
| `014` | Shared road-leg cache. Without it every check re-bills Google Routes |
| `015` | Official templates and their itineraries, plus the function that turns one into a trip. **Without it Explore shows destination-only cards and "Use template" does nothing.** |

`010` also deletes trips that have no days — the orphans left by the old
two-step creation. Read the block before running it if you have data you care
about.

### 4. Run

```bash
npm run dev
```

---

## Architecture

Everything with real logic lives in `src/lib/` as a pure module, so it can be
tested without a browser, a database or an API key. The routes and components are
thin wrappers around it.

| Module | Responsibility |
|---|---|
| [`itineraryPrompt.js`](src/lib/itineraryPrompt.js) | The realism rules, and the one category normaliser every write path uses |
| [`itinerarySchema.js`](src/lib/itinerarySchema.js) | The output contract. Coerces what it can, rejects what it cannot |
| [`conflictChecker.js`](src/lib/conflictChecker.js) | Travel time, overlaps, odd hours, budget and distance |
| [`conflictReport.js`](src/lib/conflictReport.js) | Bridges a generated plan into the checker, and names conflicts back to the model |
| [`conflictView.js`](src/lib/conflictView.js) | Hard versus soft, grouped for the editor |
| [`streamingJson.js`](src/lib/streamingJson.js) | Pulls whole days out of JSON that is still arriving |
| [`placeLookup.js`](src/lib/placeLookup.js) | Batched, cached, deadline-bounded geocoding |
| [`geocodeCache.js`](src/lib/geocodeCache.js) | The 30-day shared place cache and its key derivation |
| [`routeLookup.js`](src/lib/routeLookup.js) | Real road distances and driving times, batched and cached |
| [`routeCache.js`](src/lib/routeCache.js) | The 30-day shared road-leg cache, keyed by rounded coordinates |
| [`serverCrypto.js`](src/lib/serverCrypto.js) | AES-256-GCM for secrets at rest |
| [`groq.js`](src/lib/groq.js) | Key rotation. Rotates on rate limits only — a 400 fails fast |
| [`groqModels.js`](src/lib/groqModels.js) | Which model each workload uses, and how the token budget is sized |
| [`aiBudget.js`](src/lib/aiBudget.js) | Divides the route's 60s ceiling across completions, geocoding and checking |
| [`realtimeState.js`](src/lib/realtimeState.js) | Merges realtime payloads into local state instead of refetching |
| [`settlement.js`](src/lib/settlement.js) | Integer-cent bill splitting |
| [`tripDates.js`](src/lib/tripDates.js) | What changing a trip's dates does to its days |

### Two constraints that shaped the design

**Groq counts prompt plus reserved completion against one 8,000 token/minute
allowance.** That is why generation is a single completion read incrementally
rather than one request per day, and why retries carry a digest of the plan
rather than the plan itself.

**`response_format: json_object` buffers the entire completion.** Measured on a
five-day itinerary: with JSON mode the first byte arrives at 6.4s and all 12KB
lands in the following 3ms. Without it, the first byte is at 116ms and day one is
on screen at 1.9s. The streaming path therefore does not use JSON mode and
recovers the object from raw text; the non-streaming path keeps it.

---

## Testing

```bash
npm test          # once
npm run test:watch
```

Vitest, Node environment, no jsdom — everything under test is pure logic. The
suite covers the output contract against real model misbehaviour, the conflict
checker's arithmetic, settlement (including a property test), the streaming
parser at chunk sizes from one byte upward, and the date maths behind trip
editing.

---

## Status

Working end to end. Not audited, not load-tested, and not run against a real user
base.

**Known gaps**

- The RLS performance work in `012` is unbenchmarked. `supabase/verify/012_rls_benchmark.sql`
  seeds volume and measures it; nobody has run it yet.
- Road measurement is best-effort. A leg with no route, no routing key or a
  provider timeout falls back to the straight-line estimate for that pair, and
  the panel says how many were measured so the difference is visible.
- Email invitations are stored but not sent — `resend` is a dependency with no
  caller.
- `chart.js`, `@dnd-kit` and `idb` are installed and unused. Budget charts,
  drag-and-drop reordering and offline mode do not exist.
- `reviews` and `activity_photos` are tables nothing reads or writes.
- No automated accessibility testing. The manual pass covered focus management,
  keyboard reordering, contrast and reduced motion.

---

## Legal

- [LICENSE](LICENSE) — MIT, covering the code.
- [Privacy Policy](src/app/legal/privacy/page.js) — what is stored, and which of
  the seven third-party services processes what. Served at `/legal/privacy`.
- [Terms of Service](src/app/legal/terms/page.js) — served at `/legal/terms`.

> Both documents are accurate about how the software behaves and **have not been
> reviewed by a lawyer**. Each carries a note at the top listing what a deployment
> must fill in — a named controller, a contact address, a governing jurisdiction —
> before accepting a user who is not you.

Deleting data: a trip is deleted from Trip Settings and takes its days,
activities, bookings, expenses and invitations with it in one transaction.
Account deletion is by request to the maintainer.
