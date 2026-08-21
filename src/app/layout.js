import './globals.css';
import { AuthProvider } from '@/context/AuthProvider';
import { ThemeProvider } from '@/context/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import Navbar from '@/components/layout/Navbar';

export const metadata = {
  title: 'WanderForge — Trip plans that check their own work',
  description:
    'An AI travel planner that measures every journey against real road distances before it saves your itinerary, so a day it gives you is a day you can actually walk. Plan together in real time, split the bills, export to PDF or your calendar.',
  keywords:
    'travel planner, AI itinerary, trip planning, collaborative travel, travel time checker, budget travel',
  openGraph: {
    title: 'WanderForge — Trip plans that check their own work',
    description:
      'Every itinerary is checked against real road distances before it is saved. Plan together, split the bills, take it with you.',
    type: 'website',
    siteName: 'WanderForge',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FDF6EC' },
    { media: '(prefers-color-scheme: dark)', color: '#0F0F1A' },
  ],
};

/**
 * Resolve the theme before the first paint.
 *
 * The alternative — what this replaces — was rendering the entire app inside
 * `visibility: hidden` until React had mounted, so every route was blank until
 * the bundle downloaded, parsed and hydrated. The server-rendered HTML was
 * already correct and we were covering it up to avoid a flash.
 *
 * A blocking script in <head> runs before the body paints, so the attribute is
 * right the first time and there is nothing to flash and nothing to hide. It is
 * deliberately tiny and wrapped in try/catch: localStorage throws outright in
 * some privacy modes, and a theme preference is not worth a blank page.
 *
 * `dark` is the fallback and matches both the server-rendered attribute and
 * ThemeProvider's initial state, so hydration has nothing to reconcile.
 */
const THEME_SCRIPT = `(function(){try{
var t=localStorage.getItem('wf-theme');
if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}
document.documentElement.setAttribute('data-theme',t);
}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              {/* Keyboard users reach this before the navigation on every page.
                  Without it, getting to the itinerary means tabbing through the
                  whole header each time. */}
              <a href="#main" className="wf-skip-link">Skip to content</a>
              <Navbar />
              <main id="main" style={{ paddingTop: 'var(--navbar-height)' }}>
                {children}
              </main>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
