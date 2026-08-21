import Link from 'next/link';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * FOR WHOEVER DEPLOYS THIS — READ BEFORE LAUNCH
 *
 * Every factual claim below was checked against the code: the processors named
 * are the seven endpoints the app actually calls, the data listed is what the
 * schema actually stores, and the deletion route described is one that actually
 * works today.
 *
 * That makes it accurate. It does not make it sufficient. This has not been
 * reviewed by a lawyer, and what a privacy policy must SAY depends on where you
 * and your users are — GDPR, India's DPDP Act, CCPA and others each require
 * disclosures this document does not attempt to make (a named controller with a
 * real postal address, a stated lawful basis per purpose, retention periods, a
 * supervisory-authority complaint route, and for GDPR the transfer mechanism
 * covering the US-hosted processors below).
 *
 * Fill in the CONTACT constant and have this reviewed before you accept a user
 * who is not you.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// TODO(deploy): a real monitored address, and the legal entity or person acting
// as data controller.
const CONTACT = 'the project maintainer via the GitHub repository';

export const metadata = {
  title: 'Privacy Policy — WanderForge',
  description:
    'What WanderForge stores, which third parties process it, and how to get it deleted.',
};

const LAST_UPDATED = '21 August 2026';

/** The seven external services the app actually calls, and what reaches each. */
const PROCESSORS = [
  {
    name: 'Supabase',
    role: 'Database, authentication and file storage',
    sent: 'Everything in the list above. This is where your account and your trips live.',
    where: 'The region chosen when the project was created.',
  },
  {
    name: 'Groq',
    role: 'The AI that writes and re-plans itineraries',
    sent:
      'Your destination, trip length, chosen interests, budget level, transport mode, any notes you wrote for the planner, and — when re-planning — the titles and locations of activities already on the day. Your name, email and account identifier are never included.',
    where: 'United States.',
  },
  {
    name: 'Google Maps Platform',
    role: 'Turning place names into map coordinates, and measuring driving times',
    sent:
      'Place names from your itinerary and the coordinates of your destination, used to bias the search to the right town. Nothing identifies you.',
    where: 'United States.',
  },
  {
    name: 'Open-Meteo',
    role: 'Weather forecasts',
    sent: 'The coordinates of your destination and the dates of your trip.',
    where: 'Germany.',
  },
  {
    name: 'OpenStreetMap Nominatim',
    role: 'Fallback geocoding when Google is unavailable',
    sent: 'A place name.',
    where: 'European Union.',
  },
  {
    name: 'OpenRouteService',
    role: 'Fallback driving distances when Google is unavailable',
    sent: 'Coordinates of consecutive stops on a day.',
    where: 'Germany.',
  },
  {
    name: 'Overpass (OpenStreetMap)',
    role: 'Finding places near a stop, when you use "Find Nearby"',
    sent: 'The coordinates you are searching around.',
    where: 'European Union.',
  },
];

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className="legal__meta">Last updated {LAST_UPDATED}</p>

      <p className="legal__lead">
        WanderForge is a trip planner. It stores what it needs to plan your trips
        and nothing else. There is no advertising, no analytics, no tracking
        pixels, and nothing here is sold or shared for marketing.
      </p>

      <h2>What is stored</h2>
      <ul>
        <li>
          <strong>Your account</strong> — email address, a display name, and a
          password that is hashed by Supabase Auth. The password itself is never
          visible to this application.
        </li>
        <li>
          <strong>Your profile</strong> — display name, and optionally an avatar
          image, a short bio, a list of countries visited, and your light or dark
          theme preference.
        </li>
        <li>
          <strong>Your trips</strong> — destinations, dates, budgets, the days and
          activities in each itinerary, notes you write, accommodation and
          transport bookings you record, and expenses you add for splitting.
        </li>
        <li>
          <strong>Collaboration</strong> — who you invited to a trip and whether
          they accepted.
        </li>
        <li>
          <strong>An API key, if you add one</strong> — encrypted with AES-256-GCM
          before it is stored, decrypted only on the server to make AI requests on
          your behalf, and never sent back to your browser. You can remove it at
          any time from your profile.
        </li>
      </ul>

      <h2>What is not stored</h2>
      <ul>
        <li>No payment details. WanderForge does not take payments.</li>
        <li>No location tracking. The app never asks for your device location.</li>
        <li>No advertising or analytics identifiers, and no third-party cookies.</li>
        <li>
          The only browser storage used is your theme preference, a cached weather
          forecast, and the session cookie that keeps you signed in.
        </li>
      </ul>

      <h2>Who else processes it</h2>
      <p>
        Planning a trip means asking other services questions on your behalf. Each
        one below receives only what it needs to answer.
      </p>

      <div className="legal__table-wrap">
        <table className="legal__table">
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col">What it does</th>
              <th scope="col">What reaches it</th>
              <th scope="col">Where</th>
            </tr>
          </thead>
          <tbody>
            {PROCESSORS.map((p) => (
              <tr key={p.name}>
                <th scope="row">{p.name}</th>
                <td>{p.role}</td>
                <td>{p.sent}</td>
                <td>{p.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        Place names resolved from itineraries are cached for up to 30 days and
        shared across all users, so the same place is not looked up twice. That
        cache holds a place name and its coordinates. It records nothing about who
        searched for it.
      </p>

      <h2>Who can see your trips</h2>
      <p>
        A trip is private to you unless you do something about it. People you
        invite as collaborators can see and edit the trip you invited them to, and
        nothing else. Marking a trip public makes it readable by anyone with the
        link. These rules are enforced by the database itself, not only by the
        interface.
      </p>

      <h2>Deleting your data</h2>
      <p>You can do both of these yourself, and neither needs anyone&apos;s help:</p>
      <ul>
        <li>
          <strong>One trip</strong> — open it, choose Trip Settings, and delete it.
          Everything belonging to that trip goes with it in the same operation:
          days, activities, bookings, expenses and collaborator invitations.
        </li>
        <li>
          <strong>Your whole account</strong> — email {CONTACT} from the address on
          the account. Deleting the account removes your profile, every trip you
          own and everything inside those trips.
        </li>
      </ul>
      <p>
        Two honest caveats. A trip you were invited to belongs to whoever created
        it and is not yours to delete — leaving it removes your access, not the
        trip. And database backups are kept for a short period by Supabase, so
        deleted rows can persist in those backups until they age out.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that affects what is collected or who
        receives it, the date at the top changes with it.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about any of this, or a request to delete your account: {CONTACT}.
      </p>

      <p className="legal__nav">
        <Link href="/legal/terms">Terms of Service</Link> · <Link href="/">Home</Link>
      </p>
    </article>
  );
}
