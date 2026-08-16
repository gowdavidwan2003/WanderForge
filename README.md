<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.2-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase" alt="Supabase" />
  <img src="https://img.shields.io/badge/AI-Groq_Llama_3.3-F55036?style=for-the-badge&logo=meta" alt="Groq AI" />
  <img src="https://img.shields.io/badge/Maps-Leaflet_+_Google_Routes-199900?style=for-the-badge&logo=leaflet" alt="Maps" />
</p>

# 🧭 WanderForge — Forge Your Perfect Journey

An AI travel planner that only suggests things you can **actually do**. It plans day by day, checks the drive times against real roads, keeps the group in sync, and splits the bill at the end.

Priority order, enforced in the AI prompt itself: **Achievable → Experience → Money.**

<p align="center">
  <img src="https://img.shields.io/badge/Status-Prototype-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/Production_Ready-4%2F10-red?style=flat-square" />
  <img src="https://img.shields.io/badge/Pages-8-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/API_Routes-10-purple?style=flat-square" />
  <img src="https://img.shields.io/badge/Migrations-6-informational?style=flat-square" />
</p>

> ⚠️ **Not production-ready.** Works well end-to-end, but several hard blockers remain.
> See [Production Readiness](#-production-readiness) before deploying. Read it first.

---

## ✨ Features

### 🤖 AI planning that respects reality

The generation prompt is built around one rule: **a plan that looks full but can't be executed is worthless.**

- **Full-day itineraries** — 08:00 to ~21:00, contiguous, with all three meals at named venues
- **Realistic travel time** — explicit speed models by terrain. Hill/ghat roads are 25–30 km/h, so a 40 km mountain road is 1.5 hours, not 30 minutes. Parking, walk-in and ticket queues are added on top
- **Journeys are visible** — any hop over 45 minutes becomes its own `transport` entry, including the return leg
- **Honest durations** — a peak trek is 3–5 hours *on the mountain* plus travel each way, and consumes the day it needs
- **Fewer, achievable entries beat more, impossible ones** — the model is told to drop activities rather than compress travel

### 🔄 Replanning at three scopes

Adding one activity can't produce a coherent day, so replanning is explicit and shared by every entry point:

| Scope | Trigger | What it does |
|---|---|---|
| **Day** | 🔄 Replan Day, or from the nearby picker | Rebuilds one day around everything on it |
| **Day (auto)** | AI chat → Apply | Weaves requested places into the day |
| **Whole trip** | Conflict checker *(currently disabled)* | Redistributes across days when a clash can't be fixed within one |

**Nothing is ever silently lost.** Every replan validates that each place survives, and refuses to write if not:

- Dropped places → confirmation listing exactly which
- Two places merged into one entry → treated as a drop
- Activities placed on a non-existent day → refused before any delete
- One automatic repair pass re-prompts naming what went missing

### 🗺️ Maps and routing

- **Leaflet + CARTO Voyager** basemap, custom category-coloured numbered pins, route polylines
- **Google Routes API** for real drive times, traffic-aware, with OpenRouteService fallback
- **Google Places** for geocoding — finds venues OpenStreetMap can't ("The Planters Court"), with destination bias so results land in the right town
- **Locate on Map** backfills coordinates for activities that lack them

### 🧭 Nearby places picker

Searches from the last mapped stop of the selected day. Seven categories, adjustable radius, Overpass primary with Google filling gaps. Added places carry their exact coordinates — no geocoding round-trip, no drifting pins.

### 👥 Collaboration

- **Invite → accept flow.** Invitations are pending until accepted; a pending invitee gets no access
- **Shared trips appear on both dashboards** with a "Shared" badge
- **Realtime sync** and presence via Supabase channels
- **🔒 Itinerary lock** — the owner can freeze the plan. Enforced in RLS, not just the UI, with an owner-only database trigger so collaborators can't unlock themselves. **Bill splitting keeps working while locked**

### 💰 Money

- **Dynamic currency** — inferred from destination, confirmed by the AI, formatted properly (₹1,500 not USD 1500)
- **Bill splitting** — equal, by exact amount, or by percentage, across any number of collaborators
- **Simplify balances** — nets debts into the fewest transfers. A owes B 1000, B owes C 2000, C owes A 1000 collapses to **B pays C 1000**
- **Bookings** — stays and transport, feeding the budget total, the PDF and the calendar export

### 📤 Export

PDF itinerary (with a bookings section), `.ics` calendar including stays as all-day events and transport as timed events, and a share link.

---

## 🛠️ Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack) · React 19 |
| Database | Supabase Postgres — 12 tables, RLS on every one |
| Auth | Supabase Auth + SSR cookies, middleware-gated routes |
| AI | Groq `llama-3.3-70b-versatile`, JSON-mode, 3-key rotation |
| Maps | Leaflet + CARTO tiles · Google Routes + Places · OpenRouteService fallback |
| Places | Overpass (OSM) with Google Places fallback |
| Weather | Open-Meteo |
| Export | jsPDF · hand-built iCalendar |

### Notable internals

| File | Why it exists |
|---|---|
| [`lib/itineraryPrompt.js`](src/lib/itineraryPrompt.js) | One realism ruleset shared by generate + replan, so they can't drift |
| [`lib/groq.js`](src/lib/groq.js) | Key rotation. Rotates on rate limits only — a 400 fails fast rather than burning every key |
| [`lib/settlement.js`](src/lib/settlement.js) | Balance netting + greedy min-transfer settlement |
| [`lib/conflictChecker.js`](src/lib/conflictChecker.js) | Deterministic itinerary validation, no AI |
| [`lib/replanTrip.js`](src/lib/replanTrip.js) | Whole-trip rebuild with the no-drop guarantees |
| [`lib/withTimeout.js`](src/lib/withTimeout.js) | supabase-js queues behind token refresh; without a deadline a stalled refresh hangs the UI forever |

---

## 🚀 Setup

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
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Groq — tried in order, rotates on rate limit
GROQ_API_KEY=<key 1>
GROQ_API_KEY_2=<key 2>   # optional
GROQ_API_KEY_3=<key 3>   # optional

# Google Maps — server-side only, never NEXT_PUBLIC_
GOOGLE_MAPS_API_KEY=<key>   # needs Routes API + Places API (New)

# OpenRouteService — routing fallback
OPENROUTESERVICE_API_KEY=<key>

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> 🔐 `GOOGLE_MAPS_API_KEY` and all Groq keys are **secret** and must stay server-side.
> Restrict the Maps key to the Routes and Places APIs, by IP.

### 3. Migrations

Run in order in the Supabase SQL editor:

| # | File | Adds |
|---|---|---|
| 001 | `001_initial_schema.sql` | Tables, RLS, storage |
| 002 | `002_enable_realtime.sql` | Realtime, destination coords |
| 003 | `003_fix_rls_recursion.sql` | `SECURITY DEFINER` helpers fixing policy recursion |
| 004 | `004_collaboration_invites.sql` | Invite → accept, `get_my_invitations()` |
| 005 | `005_expenses_and_currency.sql` | Expenses, equal/exact/percent splits, trip members |
| 006 | `006_itinerary_lock.sql` | Itinerary lock + owner-only guard trigger |

### 4. Run

```bash
npm run dev
```

---

## 🗺️ Roadmap

- Re-enable the **itinerary conflict checker** (built, currently behind a "coming soon" panel)
- Auth + rate limiting on all API routes
- Resend SMTP for real invitations and verification
- Offline mode (`idb` is installed, unused)
- Drag-and-drop reordering (`@dnd-kit` installed, unused)
- Budget analytics charts (`chart.js` installed, unused)
- Photo uploads (`activity_photos` table and storage bucket exist, unused)
- Post-trip journal and ratings (columns exist, unused)

---

## 📄 License

MIT
