# WanderForge — Product Concept Document

| | |
|---|---|
| **Product** | WanderForge — an AI trip planner that verifies its own output |
| **Author** | Vidwan Gowda |
| **Status** | Built and working end to end; not instrumented, not load-tested |
| **One-liner** | Every AI trip planner writes itineraries that cannot be walked. This one measures them first. |
| **Related** | [Elevator Pitch](README-ELEVATOR-PITCH.md) · [Product Vision](README-PRODUCT-VISION.md) |

---

## 1. Problem

### 1.1 The problem statement

> A language model generating an itinerary is performing plausible-text generation, not planning. It
> has no spatial model and no clock. It produces a schedule that is **internally** consistent — times
> increase, categories vary, prose is confident — and **externally** impossible.

### 1.2 Why this is worse than an ordinary accuracy problem

Two properties make it uniquely damaging:

1. **The failure is invisible at planning time.** A wrong itinerary is visually identical to a right
   one. Detection happens in a car park at 09:25, when the cost is highest and recovery is least
   possible.
2. **Prompting does not fix it.** A model asked to check its own arithmetic produces more confident
   output, not more correct output. The fix must be external and deterministic.

### 1.3 Evidence

The route the product was built around — Chikmagaluru town to Mullayanagiri, Karnataka:

| Method | Predicted | Error |
|---|---|---|
| Great-circle distance × 1.3 at flat speed | 35 min | **1.6× optimistic** |
| Sinuosity model, road distance only | 71 min | 1.27× pessimistic |
| **Google Routes, measured** | **56 min** | — (21.6 km road, 44 min driving) |

Straight-line distance: **10.1 km**. A planner reasoning from that distance under-allocates by more
than an hour on a single leg. Stack three such legs in a day and the day is fiction.

### 1.4 Who has this problem, ranked by severity

| Segment | Severity | Why |
|---|---|---|
| Self-drive road-trippers in hill/rural terrain | **Highest** | Sinuous roads are exactly where naive estimation fails worst; they bear the full error personally |
| First-time visitors to a region | High | No local intuition to catch an impossible hop; least able to self-correct |
| Group organisers | Medium-high | Error is social as well as logistical — a broken plan costs the group's time and the organiser's credibility |
| Frequent business travellers | Low | Short, repeated, familiar routes; usually single-destination |

---

## 2. Users and jobs

### 2.1 Primary persona — the road-tripper

> **"Plan a route I can actually drive in the days I have."**

Plans in the evenings across a week. Comfortable with AI tools and has already been burned by one.
Cares about the drive as much as the destination. **Success:** leaves with a plan they do not
second-guess. **Failure:** discovers at 16:00 that the last two stops were never reachable.

### 2.2 Secondary persona — the group organiser

> **"Agree a plan with five people and stop re-litigating it."**

Default project manager of the friend group. **Success:** a plan the group stops arguing about,
frozen, with costs settled fairly. **Failure:** endless revisions because nobody trusts the plan is
sound.

### 2.3 Jobs to be done

| Job | Current alternative | Why it fails |
|---|---|---|
| Produce a day-by-day plan quickly | ChatGPT / an AI planner | Fast, confident, unverifiable |
| Know whether the plan is possible | Manually check each leg in Maps | Works, but 30+ lookups per trip; nobody does it |
| Agree a plan with a group | Shared doc + group chat | No source of truth; endless re-litigation |
| Settle shared costs | Splitwise + spreadsheet | Disconnected from the plan that created the costs |

**The wedge is row 2.** Everyone does row 1. Nobody does row 2, because doing it manually costs more
than the plan is worth.

---

## 3. Solution

### 3.1 The core concept

Separate the two jobs the industry conflates. **Let the model choose. Verify somewhere else, with
arithmetic.**

### 3.2 The pipeline

Six stages between a request and a saved trip. Only stage 1 is non-deterministic.

| # | Stage | What happens | Failure it prevents |
|---|---|---|---|
| 1 | **Plan** | Prompt carries realism rules — road speeds by terrain, parking/queue overheads, any hop over 45 min as its own entry. Shapes what the model *chooses*. | Wildly implausible drafts |
| 2 | **Validate** | Schema coerces what it can (`"9am"` → `09:00`, `"Rs.1,200"` → `1200`) and rejects what it cannot. All-or-nothing. | A half-written trip |
| 3 | **Resolve** | Every location geocoded server-side against a shared 30-day cache. | Paying twice for the same place |
| 4 | **Measure** | Each day walked pair by pair — overlaps, inverted durations, journeys that do not fit the gap. | The silent impossible plan |
| 5 | **Repair** | Conflicts quoted back verbatim with a compact digest. Result kept **only if measurably more achievable**. | A "fix" that is worse |
| 6 | **Record** | Survivors stored on the trip and surfaced in the editor. | Passing off a broken plan as fine |

### 3.3 The verification model

```
distance = measured_road_km  ?? (great_circle_km × 1.3)
```

When measured road distance is available it is used directly, along with the provider's own
duration. When it is not, great-circle distance is scaled by a **1.3 detour index** — and where the
road-to-straight-line ratio exceeds ~2, the road is switchbacking and no flat-road average speed
applies, so speed is reduced accordingly.

**Design stance:** the best model is the one that asks. The sinuosity model exists as a *fallback*,
and the UI reports how many legs were **measured** versus **estimated**, so the difference is never
hidden.

### 3.4 Deliberate suppressions

A checker that fires on everything trains users to dismiss everything. Three suppressions protect
precision:

| Rule | Reason |
|---|---|
| Discrepancies under **10 minutes** are ignored | Below the noise floor; well inside anything that would derail a day |
| **transport** entries are exempt, both directions | The entry *is* the journey. Measuring the gap before it and demanding it cover the drive flagged correct plans as broken |
| **accommodation** is exempt **on arrival only** | Arriving late at a bed has no consequence — nothing closes, nothing is missed. Leaving late still makes you late for what follows, so departures are still checked |

Note the precision of the third rule: the exemption is scoped to exactly the claim being made. A
category-wide suppression would also have hidden a genuinely broken plan that happened to end at a
hotel.

---

## 4. Scope

### 4.1 In scope — built and working

| Capability | Detail |
|---|---|
| AI itinerary generation | Streaming; first day on screen at ~1.9 s |
| Verification | Overlaps, inverted durations, travel-time shortfalls, long hops, over-budget days, category-inferred odd hours |
| Real road measurement | Routing provider with a second source as fallback; results cached and shared |
| Curated starting points | 10 complete itineraries — 44 days, 206 stops, each with time, category, cost, coordinates |
| Collaboration | Invite by role; live edits; owner-only itinerary freeze enforced by database policy |
| Expenses | Equal and unequal splits; settlement in fewest transfers, integer cents so balances reconcile exactly |
| Trip editing | Atomic date changes with day reconciliation and cascade |
| Export | PDF and `.ics` |
| Public browsing | Full itineraries readable with no account |

### 4.2 Explicitly out of scope

| Not doing | Reason |
|---|---|
| Booking or payments | Booking economics corrupt the verdict — the core asset is trustworthiness |
| Real-time opening hours / closures | No reliable source; inventing certainty is the exact failure being corrected |
| Social feed, following, gamification | Serves retention, not the job |
| Flight search | Solved, competitive, adjacent |
| Offline mode | Dependency installed, never built. Should be removed or built, not left implying it exists |

### 4.3 Known gaps

| Gap | Impact |
|---|---|
| **No analytics** | Cannot measure any metric in §6. The most important gap |
| **No error monitoring / CI on `main`** | A user hitting a failure is invisible; both exist on an unmerged branch |
| **Invitations never sent** | Stored, and the UI implies an email went out. **A broken promise, not a missing feature** |
| RLS performance unbenchmarked | Most likely first bottleneck under load |
| Error and absence conflated | A failed template fetch renders as "not found", so an outage looks like a missing record |
| Unused dependencies | Charting, drag-and-drop, offline storage — scoped, never built |
| Legal text unreviewed | Accurate about behaviour; not reviewed by a lawyer, and says so |

---

## 5. Key decisions and trade-offs

### 5.1 Ten complete templates over thirty stubs

Thirty destinations existed with no itineraries — "Use template" produced an empty calendar. Cut to
**ten with full day-by-day plans**.

> Thirty stubs that say nothing are worth less than ten plans somebody can follow. The catalogue was
> optimising a vanity number; the plans optimise activation.

### 5.2 Show the full plan to logged-out visitors

**Tension:** gating protects signups; showing gives value away.
**Decision:** show everything; require an account only to save an editable copy.

> A plan nobody can see until they sign up cannot persuade anybody to sign up.

The gate moved from *seeing* value to *owning* it — which is also the moment a database row
genuinely needs an owner. Ships an SEO-indexable surface as a side effect.

### 5.3 Streaming over guaranteed-parseable output

| Mode | First byte | Day one on screen | Guarantee |
|---|---|---|---|
| JSON mode on | 6.4 s | ~6.4 s | Always valid JSON |
| **JSON mode off** | **116 ms** | **1.9 s** | Must recover object from raw text |

**Decision:** both paths exist. Streaming drops the guarantee and uses a tolerant incremental parser
tested from one-byte chunks upward; the non-streaming path keeps it. The risk introduced by the
decision is mitigated rather than accepted.

### 5.4 A hard 30-day cap on trip length

Cost control, enforced **server-side** because the day count arrives from the client and cannot be
trusted. Uncapped, one model call per day plus geocoding per activity means a mistyped end year is a
five-figure bill.

> A product decision disguised as a constant.

---

## 6. Success metrics

### North star
**Trips that reach their destination date without being abandoned.**

Not *itineraries generated* — that number rises when output is bad and users regenerate in
frustration. The north star must capture "good enough to actually travel on".

### Leading indicators

| Metric | Signal |
|---|---|
| Trips with zero hard conflicts on first pass | Whether the upstream prompt is improving |
| Repair success rate | Whether stage 5 earns its cost |
| Measured-leg coverage | Quality of verification itself |
| Template → first edit conversion | Whether curated starting points actually activate |

### Guardrails

| Guardrail | Protects against |
|---|---|
| Cost per completed trip | Accuracy scaling the bill linearly |
| **False-positive conflict rate** | The quiet death — a checker nobody trusts |
| Time to first day on screen (1.9 s) | A "quality" change that destroys perceived speed |

> **All of the above are definitions, not readings.** Nothing is instrumented yet.

---

## 7. Unit economics

| Cost centre | Scales with | Control | Amortises? |
|---|---|---|---|
| Model generation | Days per trip | 30-day cap, enforced server-side | **No** — per-trip |
| Geocoding | Activities per trip | Shared 30-day cache | **Yes** |
| Route measurement | Legs per trip (~35 on a 5-day plan) | Shared 30-day cache | **Yes** |

**The structural insight:** two of three cost centres are *public geography* — a road between two
points does not differ per user. Every user who plans a popular route makes it cheaper for everyone
after them. Only the model call is truly marginal.

This is what makes verification viable as a free feature. Without shared caching, accuracy would
have to be a premium tier — which would put it out of reach of the users who need it most.

**Security note:** cache writes are service-role only. A user able to write travel times that
everyone else's itinerary is validated against could make an impossible day look achievable. A
shared cache is a shared trust boundary.

---

## 8. Competitive landscape

| Player | Approach | Gap we exploit |
|---|---|---|
| ChatGPT / Gemini direct | Raw generation | No verification, no persistence, no collaboration |
| AI trip planner startups | Generation + polished UI | Competing on speed and aesthetics, not achievability |
| Google Maps / Travel | Excellent routing, weak planning | Routing is a lookup, not a plan; no itinerary verification loop |
| TripIt and similar | Organise existing bookings | Post-booking; does not help you decide |
| Human travel agents | Genuine expertise | Expensive, slow, does not scale |

**Positioning.**
> Every competitor is racing to generate itineraries faster. We are the only one that will tell you
> when the itinerary is wrong.

**Is it defensible?** Not the road data — anyone can buy that. What is defensible is the *stance*:
treating an unachievable plan as a failure worth surfacing rather than a detail to smooth over.
Incumbents optimising for engagement are structurally reluctant to tell a user their plan is broken.
That reluctance is the moat, and it is a cultural one.

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Models improve enough to self-verify | Medium | **Existential** | Would invalidate the core thesis. Watch explicitly. Fallback: even a perfect model needs *current* road data — a lookup, not a capability |
| Incumbent ships verification | Medium-high | High | Move to the infrastructure horizon before the stance stops being unusual |
| Users value accuracy but not enough to switch | **High** | High | The most likely quiet failure. Untested until analytics exist |
| Routing costs rise / licensing tightens | Medium | Medium | Caches assume a 30-day licence limit; second provider already wired |
| False positives erode trust | Medium | High | Tolerance and category exemptions already ship for this; needs instrumentation to confirm |
| Wedge too narrow to be a business | Medium | Medium | Beachhead, not destination — proves the thesis, does not size the prize |

---

## 10. Open questions

Questions the product cannot currently answer, in priority order.

1. **Do users notice the verification?** It is the entire differentiator and it currently lives in a
   panel. If nobody opens it, the value is invisible and the positioning is wrong.
2. **Does a flagged conflict change behaviour** — do users fix the day, regenerate, or ignore it?
   Determines whether we are informing or merely annoying.
3. **What is the real false-positive rate?** The single number most likely to be silently killing
   trust.
4. **Do template-started trips retain better than wizard-started ones?** Determines whether curation
   is worth the authoring cost.
5. **Is there any reason to return after the plan is made?** Today, no. The retention thesis is
   entirely untested.

---

## 11. What would come next

Sequenced by what unblocks the most, not by effort.

| Priority | Work | Unblocks |
|---|---|---|
| **P0** | Analytics | Every question in §10. Nothing else can be evaluated without it |
| **P0** | Merge error monitoring and CI | Failures are currently invisible |
| **P1** | Surface measured-vs-estimated prominently | Makes the differentiator visible instead of buried |
| **P1** | Send invitations, or stop implying they were sent | Closes a broken promise |
| **P1** | Distinguish query failure from absence | Stops outages presenting as missing records |
| **P2** | Day-of recalculation | The retention thesis — the first real test of it |
| **P2** | Rate-limit the AI routes | A public link plus per-call billing is an open tab |
| **P3** | Remove unused dependencies | Stops implying features that do not exist |

> **The honest summary:** the product thesis is built and works. What is missing is not features —
> it is the evidence to know whether the thesis is right.
