import Link from 'next/link';
import Footer from '@/components/layout/Footer';
import { MAX_TRIP_DAYS } from '@/lib/tripLimits';
import { ACTIVITY_CATEGORIES } from '@/lib/itineraryPrompt';
import { TEMPLATE_COUNT } from '@/lib/templates';

/**
 * The landing page.
 *
 * Rewritten, and the rewrite is mostly subtraction. What was here: a rotating
 * destination word, three floating gradient orbs, a pulsing badge dot, a bouncing
 * scroll indicator, six more floating elements, an IntersectionObserver driving
 * scroll-reveal animations, and a client bundle for all of it — on a page whose
 * job is to say what the product does and offer a sign-up link.
 *
 * This version is a server component. No 'use client', no state, no observer, no
 * effects. The text is in the HTML, it renders before any JavaScript arrives,
 * and there is nothing to hydrate. That is the accessibility fix and the
 * performance fix at once: the ~15 infinite animations that made this page
 * unusable for anyone motion-sensitive are gone rather than merely suppressed
 * under a media query.
 *
 * The claims are the ones established when this page was made honest: every
 * feature named is one the code implements, and each entry says where.
 */

export const metadata = {
  title: 'WanderForge — Trip plans that check their own work',
  description:
    'An AI travel planner that measures every journey against real road distances and driving times before it saves your itinerary. Plan together in real time, split the bills, export to PDF or your calendar.',
};

const FEATURES = [
  {
    icon: '🔍',
    title: 'It checks its own work',
    // src/lib/conflictChecker.js, wired into generation and the editor.
    desc: 'Before a plan is saved, every journey is measured against real road distances and driving times — and a 22 km road of hairpins is not 22 km of motorway. A day that cannot be walked says so, on the day, next to the problem, with a one-click fix.',
    accent: 'var(--color-primary)',
  },
  {
    icon: '🤖',
    title: 'Planned around real travel time',
    // src/lib/itineraryPrompt.js — the realism rules are the actual prompt.
    desc: 'Hill roads at 25 km/h, parking and ticket queues counted, one geographic cluster per day, and the journey home treated as part of the day.',
    accent: 'var(--color-secondary)',
  },
  {
    icon: '👥',
    title: 'Plan it together',
    // src/hooks/useRealtimeTrip.js + trip_collaborators.
    desc: 'Invite people and watch edits appear as they happen. When everyone agrees, the owner can freeze the itinerary so nobody changes it by accident.',
    accent: 'var(--color-accent)',
  },
  {
    icon: '🗺️',
    title: 'See it on a map',
    // src/components/maps/TripMap.jsx + NearbyPlacesPanel.
    desc: 'The whole trip laid out geographically, and a search for what is near any stop when a gap opens up.',
    accent: 'var(--color-info)',
  },
  {
    icon: '💰',
    title: 'Budgets, then the reckoning',
    // src/lib/settlement.js — integer-cent settlement, and currency.js.
    desc: 'Track spend in the local currency while you plan, then split what you shared and settle up in the fewest transfers.',
    accent: 'var(--color-success)',
  },
  {
    icon: '📤',
    title: 'Take it with you',
    // src/lib/exportUtils.js — jsPDF and ical-generator.
    desc: 'Export as a PDF, or as a calendar file that imports anywhere. Daily weather sits beside each day while you plan.',
    accent: 'var(--color-warning)',
  },
];

const STEPS = [
  {
    num: '1',
    title: 'Say where and when',
    desc: 'Destination, dates, what you are interested in, and how you get around.',
  },
  {
    num: '2',
    title: 'Watch it plan',
    desc: 'Days appear one at a time, usually the first within a couple of seconds. Stop it whenever you like.',
  },
  {
    num: '3',
    title: 'See what will not work',
    desc: 'Before anything is saved, every journey is checked. Anything impossible is flagged where it is.',
  },
  {
    num: '4',
    title: 'Make it yours',
    desc: 'Reorder, rebuild a day around what is on it, invite the others, and go.',
  },
];

/**
 * Facts, not metrics.
 *
 * These were 50K+ trips planned, 120+ countries and a 4.9 star rating — none
 * measured, none measurable, two of them referring to systems the app does not
 * have. Everything here is a constant imported from the codebase, so the page
 * cannot drift from what is true.
 */
const FACTS = [
  { num: TEMPLATE_COUNT, label: 'destinations ready to plan' },
  { num: MAX_TRIP_DAYS, label: 'days in a single trip' },
  { num: ACTIVITY_CATEGORIES.length, label: 'kinds of activity' },
  { num: '£0', label: 'and no card needed' },
];

export default function LandingPage() {
  return (
    <>
      <div className="lp">
        {/* ===== HERO ===== */}
        <section className="lp-hero">
          <div className="container lp-hero__inner">
            <p className="lp-hero__eyebrow">AI trip planning</p>

            <h1 className="lp-hero__title">
              Most AI itineraries
              <br />
              <span className="lp-hero__strike">cannot actually be walked.</span>
              <br />
              This one checks.
            </h1>

            <p className="lp-hero__sub">
              A model will happily put you on a mountain at 09:10 and in a
              restaurant across the valley at 09:30. WanderForge works out how
              long every journey really takes — real road distances, real driving
              times, and the parking and walk-in nobody counts — before your
              itinerary is saved, and tells you which ones will not work.
            </p>

            <div className="lp-hero__actions">
              <Link href="/auth/signup" className="lp-btn lp-btn--primary">
                Plan a trip — it&apos;s free
              </Link>
              <Link href="/explore" className="lp-btn lp-btn--ghost">
                Browse destinations
              </Link>
            </div>

            {/* Verbatim from the product, not an illustration of it. The first
                version of this block quoted the *real* road figures for this
                route — 22 km of hairpins, 1h20 — which the checker does not
                currently use, so the example on the landing page was one the
                shipped app would have stayed silent about. If this example ever
                stops matching what the editor prints, the example is wrong. */}
            <div className="lp-proof">
              <p className="lp-proof__label">What that looks like</p>
              <div className="lp-proof__row">
                <span className="lp-proof__time">08:00 – 09:00</span>
                <span className="lp-proof__what">Breakfast in Chikmagaluru town</span>
              </div>
              <div className="lp-proof__row lp-proof__row--bad">
                <span className="lp-proof__time">09:15</span>
                <span className="lp-proof__what">Mullayanagiri Peak</span>
              </div>
              <p className="lp-proof__verdict">
                <span aria-hidden="true">⛔</span> Only 15m between them, but the
                road is 21.6 km, which routing puts at 44m of driving — 56m door
                to door once you have parked and walked in. Short by 41m.
              </p>
            </div>
          </div>
        </section>

        {/* ===== FACTS ===== */}
        <section className="lp-facts">
          <div className="container lp-facts__inner">
            {FACTS.map((f) => (
              <div key={f.label} className="lp-fact">
                <span className="lp-fact__num">{f.num}</span>
                <span className="lp-fact__label">{f.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ===== FEATURES ===== */}
        <section className="lp-section" id="features">
          <div className="container">
            <h2 className="lp-section__title">What it does</h2>
            <p className="lp-section__sub">
              Every one of these is something the app does today.
            </p>

            <ul className="lp-grid">
              {FEATURES.map((f) => (
                <li key={f.title} className="lp-card">
                  <span
                    className="lp-card__icon"
                    style={{ background: f.accent }}
                    aria-hidden="true"
                  >
                    {f.icon}
                  </span>
                  <h3 className="lp-card__title">{f.title}</h3>
                  <p className="lp-card__desc">{f.desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ===== HOW IT WORKS ===== */}
        <section className="lp-section lp-section--alt" id="how-it-works">
          <div className="container">
            <h2 className="lp-section__title">How it goes</h2>

            <ol className="lp-steps">
              {STEPS.map((s) => (
                <li key={s.num} className="lp-step">
                  <span className="lp-step__num" aria-hidden="true">{s.num}</span>
                  <div>
                    <h3 className="lp-step__title">{s.title}</h3>
                    <p className="lp-step__desc">{s.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ===== CLOSE ===== */}
        <section className="lp-cta">
          <div className="container lp-cta__inner">
            <h2 className="lp-cta__title">Plan something</h2>
            <p className="lp-cta__sub">
              Free, no card, and your trips stay private unless you invite someone.
            </p>
            <Link href="/auth/signup" className="lp-btn lp-btn--primary lp-btn--lg">
              Get started
            </Link>
          </div>
        </section>
      </div>

      <Footer />
    </>
  );
}
