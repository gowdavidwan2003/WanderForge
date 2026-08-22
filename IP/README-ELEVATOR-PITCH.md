# WanderForge — Elevator Pitch

> **The one line.** Every AI trip planner writes itineraries that read beautifully and cannot
> physically be walked. WanderForge is the one that checks — and tells you when it is wrong.

This document holds the pitch at four lengths and for five audiences. Pick by the time you have
and who is listening. The **hook** and the **proof** never change; only the ending does.

---

## The two halves that never change

**The hook — a problem the listener has personally experienced.**

> A language model will happily put you on a mountain at 09:10 and in a restaurant across the
> valley at 09:30. It has no idea how long the road takes, and it will never tell you it guessed.

**The proof — one route, three numbers.**

| | |
|---|---|
| Chikmagaluru town → Mullayanagiri | **10.1 km** straight line, **21.6 km** by road, **44 min** driving |
| What a naive planner predicts | **35 min** |
| What it actually takes | **56 min** — the estimate is **1.6× optimistic** |

That is the whole argument. It converts *"AI itineraries feel unrealistic"* from an opinion into
arithmetic, and it is the reason the product exists.

---

## 30 seconds — the cold open

Use when someone asks *"what do you work on?"* at a career fair, in a lift, on a call intro.

> AI trip planners produce itineraries that look great and can't actually be done — they'll put you
> on a mountain at 9:10 and across the valley at 9:30, because the model has no idea how long the
> road takes.
>
> I built WanderForge, which measures every journey in a generated plan against real road distance
> before it saves anything. Journeys that don't fit the time allowed get flagged, the model gets one
> chance to fix them, and what survives is either achievable or explicitly marked as not.
>
> On the road I built it around, the naive estimate was 1.6× optimistic. That gap is the product.

**Word count: ~95. Aim for 30–35 seconds. Stop talking. Let them ask.**

---

## 60 seconds — the standard answer

Use for *"tell me about a project"* in any interview. This is the version to memorise.

> Ask any language model for a five-day itinerary and it gives you something that reads beautifully
> and cannot physically be done. It'll put you on a mountain at 09:10 and in a restaurant across the
> valley at 09:30, because it has no spatial model and no clock — and it will never tell you it
> guessed.
>
> The insight is that generation and verification are different jobs. Prompting harder doesn't fix
> it; a model asked to check its own arithmetic produces more *confident* output, not more *correct*
> output. So WanderForge lets the model choose, then verifies it somewhere else, deterministically.
>
> Before anything is saved, every consecutive pair of activities is measured against real road
> distance and driving time. Journeys that don't fit the gap are named, the model gets exactly one
> chance to repair them, and the repair is kept only if it's *measurably* more achievable than what
> it replaced. What survives is either achievable or flagged as not.
>
> The interesting engineering is that verification isn't free — routing is billed per leg. So the
> checking sits behind two shared caches and a hard cap on trip length. That's what makes an
> accuracy feature affordable enough to give away.

**Why it works:** names a felt problem, states a *testable* differentiator, ends on a constraint —
which invites exactly the follow-up you're best prepared for.

---

## 2 minutes — when they lean in

Add these three beats to the 60-second version, in this order.

**1. The scope of what it became.**
> It's not just the planner. Trips are collaborative — invite people, edits appear live, and the
> owner can freeze the itinerary once the group agrees. That freeze is enforced by database policy,
> not a disabled button. Shared costs split and settle in the fewest transfers, in integer cents so
> the balances reconcile exactly.

**2. One concrete engineering trade-off.**
> The model provider's JSON mode guarantees parseable output and buffers the entire completion.
> Measured: first byte at 6.4 seconds with it, 116 milliseconds without — and day one on screen at
> 1.9 seconds. So the streaming path drops the guarantee and recovers the object from raw text with
> a parser tested from one-byte chunks upward. The non-streaming path keeps the guarantee. Both
> exist because they're answering different questions.

**3. What it is not.**
> It can't know real opening hours, closures, or whether a place still exists. Warnings about
> opening hours are inferred from category and are worth confirming, not obeying. Anything marked
> *impossible* is arithmetic — the journey does not fit the gap. I'd rather it be narrow and trusted
> than broad and ignored.

---

## By audience

### To an investor
Lead with the wedge and the unit economics, not the algorithm.

> Every competitor is racing to generate itineraries *faster*. Nobody is competing on whether the
> itinerary is *possible*. That's the wedge, and it's defensible because it isn't a prompt — it's a
> verification pipeline with real road data behind it.
>
> The beachhead is self-drive road trips in terrain where the naive estimate is most wrong. That's
> where the error is largest and where every competitor is worst.
>
> On cost: two of my three cost centres amortise across users, because road distances and place
> coordinates are public geography that gets cached and shared. Only the model call is truly
> per-trip. So the accuracy feature gets *cheaper* as the user base concentrates on popular routes —
> the opposite of the usual AI cost curve.

**Expect:** *"how many users?"* — **Answer honestly: none yet, and there's no analytics.** Then
pivot to what you *can* prove: it works end to end, and here is the cost model.

### To a recruiter or hiring manager (non-technical)
Drop every implementation word. Keep the story.

> You know how AI trip planners give you a plan that looks perfect until you realise you'd need to
> teleport between stops? I built one that checks the driving time first and tells you when the plan
> won't work. Most of the hard part wasn't the AI — it was making the checking cheap enough to give
> away for free.

### To an engineer
Skip the problem statement; they get it in one line. Go straight to the interesting part.

> It's a six-stage pipeline where only one stage is non-deterministic. The model plans, a schema
> coerces or rejects the output all-or-nothing, places are geocoded against a shared cache, and then
> the arithmetic runs — great-circle distance scaled for road sinuosity, or a real measured route
> when we have one.
>
> The bit I'd want to talk about: multi-step writes had to move into the database. PostgREST wraps
> each request in its own transaction, so two requests are two transactions no matter how carefully
> the client sequences them. Replanning a day used to delete it and re-insert row by row — a model
> timeout in between destroyed the day with nothing to put back. It's one Postgres function now, and
> it refuses an empty replacement.

### To a potential user
No architecture. One promise.

> Tell it where you're going and it plans your days. The difference is it checks whether you can
> actually get from one place to the next in the time it allowed — so you find out at your desk, not
> in a car park at 09:25.

### To a designer or a PM peer
Lead with the judgment call, not the feature.

> The interesting product decision was where to put the signup gate. We show the entire itinerary to
> logged-out visitors and only ask for an account when you want to save an editable copy. A plan
> nobody can see until they sign up can't persuade anybody to sign up — so the gate moved from
> *seeing* value to *owning* it, which happens to be the same moment a database row genuinely needs
> an owner.

---

## What **not** to say

| Don't say | Why | Say instead |
|---|---|---|
| "It's an AI-powered travel app." | Says nothing. Every travel app claims this. | "It's the one that checks whether the plan is physically possible." |
| "It uses GPT / Groq / LLMs." | The model is one of six stages and the only replaceable one. | "The model chooses; the verification is ordinary deterministic engineering." |
| "It generates better itineraries." | Unfalsifiable claim. | "It measures each journey and tells you when one doesn't fit." |
| "It's fully working and production-ready." | It isn't — no analytics, no CI on `main`, not load-tested. | "It works end to end. It hasn't been load-tested, and I can tell you where I'd expect it to break first." |
| "I built the whole thing myself." | True, but invites "so who reviewed it?" | "I built it solo, which is also why I'm explicit about what hasn't been reviewed." |

---

## Anticipated follow-ups

**"Isn't this just a wrapper around an LLM?"**
> The model is one of six stages and the only non-deterministic one. The schema contract, the
> geocoding, the arithmetic, the repair-acceptance rule and the storage of unresolved conflicts are
> all ordinary engineering. Remove the model and you still have a verifier. Remove the verifier and
> you have what everyone else already ships.

**"Why wouldn't Google just do this?"**
> They might, and they'd do the routing better than I can. What's defensible isn't the road data —
> it's the decision to treat an unachievable plan as a *failure worth surfacing* rather than a
> detail to smooth over. That's a product stance, and incumbents optimising for engagement are
> structurally reluctant to tell a user their plan is broken.

**"How do you know the verification is right?"**
> Three layers, and the third is a limitation. The arithmetic is unit-tested against a real route
> with known ground truth. Where routing is unavailable the fallback is *knowingly* imperfect, and
> the UI reports how many legs were measured versus estimated rather than hiding it. What I have not
> done is validate against a corpus of real trips at scale — one route is an anchor, not a proof.

**"What's the hardest thing you got wrong?"**
> I once "reproduced" a bug and was about to fix it. The page wouldn't scroll, so I had my culprit.
> Before fixing it I ran the same test on an unrelated plain page as a control — and *that* wouldn't
> scroll either. The failure was in my test environment, not the app. The real bug turned out to be
> completely different. Two minutes of controlling prevented shipping a fix for a bug that didn't
> exist.

---

## Delivery notes

- **Time yourself.** The 60-second version should land at 55–65 seconds. Over 75 and you have lost them.
- **Stop at the end of the hook** on a first meeting. If they ask a question, the pitch worked.
- **Never open with the stack.** Nobody has ever been persuaded by a list of technologies.
- **Have the three numbers ready** — 10.1 / 21.6 / 44. Specificity is what makes it sound true, because it is.
- **Volunteer one limitation, unprompted.** It is the fastest way to be believed about everything else.
