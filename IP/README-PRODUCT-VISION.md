# WanderForge — Product Vision

> **Vision.** A world where no one arrives at a place they were told they had time to reach, and
> finds they never did.

> **Mission.** Make every generated travel plan accountable to physical reality — measured, not
> asserted — and make that verification cheap enough to give away.

---

## 1. Why this exists

Travel planning was handed to language models in 2023, and something broke that nobody named.

The old failure mode of trip planning was *effort* — it took hours to research and sequence a trip.
Generative AI solved that in eighteen months. The new failure mode is **unfalsifiable confidence**:
a plan produced in four seconds, written in the register of an expert, that has never been checked
against a map or a clock.

This is worse than the problem it replaced, for one reason:

> **A wrong itinerary is indistinguishable from a right one until you are standing in it.**

Effort is paid at a desk. Confidence is paid on the road — a missed booking, a closed gate, a day
spent driving instead of arriving. The cost moved from *before* the trip to *during* it, where it
is highest and least recoverable.

WanderForge exists because the industry optimised the wrong variable. Everyone raced to make
generation faster. Nobody made it **accountable**.

---

## 2. What we believe

These are the beliefs the product is built on. Each is falsifiable — if one turns out to be wrong,
the strategy changes.

**1. Generation and verification are different jobs and must not share an author.**
A model asked to check its own arithmetic produces more confident output, not more correct output.
Self-critique is not verification; it is more generation. Verification has to be external and
deterministic or it is theatre.

**2. A plan that admits its limits is worth more than one that hides them.**
The industry default is to smooth over uncertainty because uncertainty looks like weakness. We
believe the opposite: a plan labelled *"this leg was estimated, not measured"* is more useful than
one that is silently wrong, and users can tell the difference the moment it matters.

**3. Accuracy must be free, or it does not change anything.**
If verification is a premium tier, the people most harmed by bad plans — first-time visitors,
people in unfamiliar terrain — are exactly the people who will not pay for it. Verification behind
a paywall is a feature. Verification for everyone is a standard.

**4. Physical reality is shared, so the cost of knowing it should be shared too.**
The distance between two points is not private. Neither is a road, nor a place's coordinates. Every
user who plans a route makes that route cheaper to verify for everyone after them. This is not an
optimisation; it is the economic foundation that makes belief 3 possible.

**5. A warning nobody trusts is worse than no warning.**
A checker that fires on everything trains users to dismiss everything, which destroys the product
silently and permanently. Precision is worth more than recall here. We would rather miss a marginal
conflict than spend the user's trust on a ten-minute discrepancy.

---

## 3. Who we serve

We do not serve "travellers". We start where the error is largest.

| Horizon | Segment | Why them, why then |
|---|---|---|
| **Now** | **Self-drive road-trippers** in hill, coastal and rural terrain | The naive estimate fails worst exactly here — 1.6× optimistic on the route this was built around. Highest error, highest stakes, least served. This is the beachhead. |
| **Next** | **Group trip organisers** | They already feel the pain of a plan that keeps changing. Collaboration, the itinerary lock and expense settlement exist for them. Verification is what stops the group re-litigating whether the plan works. |
| **Later** | **First-time international visitors** | No local intuition to catch an impossible hop, so they are least able to self-correct — but they need a trust signal before they will rely on a tool, which is why they come after the first two. |
| **Not yet** | Business travel, tour operators, agencies | Different job entirely: procurement, compliance, margin. Adjacent, and a distraction until the consumer wedge is proven. |

### The job to be done

> *"Give me a plan for these days that I can actually execute — and tell me, before I leave, if any
> part of it doesn't work."*

Note what is **not** in that sentence: inspiration, discovery, booking, social. Those are other
products' jobs. Ours begins once you know roughly where you are going and ends when you have a plan
you can trust.

---

## 4. Where this goes

Three horizons. Each unlocks the next; none of them is a feature list.

### Horizon 1 — Be right about the plan *(where we are)*
Verification exists and works. Every consecutive journey is measured against real road data before
anything is saved; unresolved conflicts are stored and shown rather than smoothed over.

**Done when:** a user can generate a trip and know, with justified confidence, whether it is
achievable — and can see which parts were measured versus estimated.

### Horizon 2 — Be right about the day
A plan is verified once, at a desk. A trip is lived over days, in weather, in traffic, with delays.
The same verification engine that checks a plan can check *today's remaining plan* against
conditions now.

**The shift:** from a planning tool you leave behind to something you open on the road. This is also
the only credible answer to retention — today nothing brings a user back after the plan is made.

**Done when:** a delay at 11:00 produces a recalculated, still-achievable afternoon by 11:01.

### Horizon 3 — Be the layer everyone else checks against
If verification is genuinely valuable, its natural end state is not a destination app — it is
infrastructure. Any planner, agency or model could submit an itinerary and receive a verdict with
evidence.

**The shift:** from competing with generators to being the thing generators are measured by. The
shared caches make this economically sensible: the more traffic, the cheaper each verification.

**Done when:** "verified achievable" is a claim other products want to make, and they come to us to
make it.

---

## 5. What we will not do

Naming the non-goals is what keeps a vision from becoming a wish list.

| We will not | Because |
|---|---|
| **Become a booking platform** | Booking economics pull toward recommending what pays, which directly corrupts the one thing we are for. The moment revenue depends on which hotel we suggest, our verdict is no longer trustworthy. |
| **Optimise for engagement** | Success is a user who plans a good trip and *leaves*. Time-in-app is an anti-metric here; a user stuck in the planner is a user we are failing. |
| **Add social feeds, gamification or streaks** | They serve retention, not the job. If we need a streak to bring users back, Horizon 2 has failed and we should fix that instead. |
| **Claim knowledge we do not have** | We cannot know real opening hours, closures, or whether a place still exists. Category-inferred warnings are labelled as advisory and always will be. Inventing certainty is the exact failure we were built to correct. |
| **Make verification a paid tier** | See belief 3. It would invert the mission. |
| **Chase every destination** | Ten usable itineraries beat thirty stubs. Breadth without depth is the same broken promise in a different shape. |

---

## 6. What success looks like

### The north star
**Trips that reach their destination date without being abandoned.**

Chosen carefully. Not *itineraries generated* — that number goes **up** when output is bad and users
regenerate in frustration. Not *time in app* — see the non-goals. The north star has to capture
"the plan was good enough to actually travel on", because that is the only outcome we are claiming.

### Leading indicators

| Metric | What it tells us |
|---|---|
| Share of generated trips with zero hard conflicts on first pass | Whether the upstream prompt is improving |
| Repair success rate | Whether the one-retry stage earns its cost |
| Measured-leg coverage (routed vs estimated) | Quality of the verification itself |

### Guardrails — the numbers that must **not** move

| Guardrail | Why it protects the vision |
|---|---|
| **Cost per completed trip** | Belief 3 dies if accuracy scales the bill linearly |
| **False-positive conflict rate** | Belief 5. The failure mode that would kill this product quietly |
| **Time to first day on screen** | Currently 1.9 s. A "quality" change that destroys perceived speed is not a quality change |

### Five-year statement

> Someone plans a trip through terrain they have never driven, in a country they have never
> visited, and never once wonders whether the plan is possible — because a system checked, and
> would have told them.

---

## 7. Strategic risks

Honest risks, with what we would do about each.

| Risk | Severity | Response |
|---|---|---|
| **An incumbent ships verification** | High | Likely, and they will do routing better. The defensible part is not the road data but the *stance* — treating an unachievable plan as a failure worth surfacing. Incumbents optimising for engagement are structurally reluctant to tell a user their plan is broken. Move to Horizon 3 before that stance stops being unusual. |
| **Models get good enough to self-verify** | Medium | Would invalidate belief 1, which is the whole thesis. Watch for it explicitly. Note the fallback: even a perfect model needs *current* road data, which is a lookup, not a capability. |
| **Routing costs rise or licensing tightens** | Medium | Both caches already assume a 30-day expiry as a licence term. Provider abstraction exists; a second routing source is already wired as fallback. |
| **The wedge is too narrow to be a business** | Medium | Hill and rural self-drive is a real but bounded market. It is a beachhead, not the destination — proof of the thesis, not the size of the prize. |
| **Verification is valued but not enough to switch** | High | The most likely quiet failure. This is what Horizon 2 tests: if being right about *today* does not create a reason to return, the thesis is interesting but not a product. |

---

## 8. Where the vision is ahead of the product

Stated plainly, because a vision document that hides its own gap is marketing.

- **No analytics.** We cannot currently measure the north star or a single leading indicator. Every
  metric above is a definition, not a reading. This is the first gap to close.
- **Horizon 2 does not exist.** Nothing brings a user back after the plan is made. The retention
  thesis is untested.
- **Verification is validated against one route**, not a corpus. It is an anchor, not a proof.
- **Not load-tested.** Row-level security is evaluated per row and the performance work there is
  unbenchmarked.
- **A stated promise is unkept.** Collaboration invitations are stored but never sent, while the UI
  implies otherwise. Belief 2 is about honesty; this is a place the product is not yet honest.

> The gap between this document and the repository is roughly one quarter of instrumentation work
> and one unbuilt horizon. Not features — evidence.
