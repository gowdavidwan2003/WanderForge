'use client';

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

const ThemeContext = createContext(undefined);

/**
 * The DOM is the store.
 *
 * data-theme on <html> is set before first paint by the script in layout.js, so
 * it is already correct when React arrives — there is nothing to synchronise,
 * only something to read. useSyncExternalStore is the primitive for exactly
 * that: it takes a server snapshot and a client snapshot and reconciles them
 * without an effect, so no setState fires during mount and no extra render
 * cascades out of it.
 */
const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

// Must match both the attribute rendered on <html> and the inline script's
// fallback, or hydration has a mismatch to complain about.
function getServerSnapshot() {
  return 'dark';
}

/**
 * The theme, without hiding the app to get it.
 *
 * This used to render `<div style={{visibility:'hidden'}}>{children}</div>`
 * until React had mounted. That is the whole page — every route — blank until
 * the JS bundle downloads, parses and hydrates. On a slow connection it is
 * seconds of white; with JS disabled or failed it is white forever. The server
 * had already sent perfectly good HTML and we were covering it up.
 *
 * The reason it existed is real: the server cannot know which theme this visitor
 * chose, so the first paint may be the wrong one and React complains about the
 * mismatch. The fix is to resolve the theme *before* first paint rather than to
 * hide the page until after it — see the inline script in layout.js, which sets
 * data-theme on <html> from localStorage in a blocking <head> script. By the
 * time the body paints, the attribute is already right.
 *
 * So this component no longer gates anything. It reads back what the script
 * decided, and owns changes from there.
 */
export function ThemeProvider({ children }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const apply = useCallback((next) => {
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('wf-theme', next);
    } catch {
      // Private mode, or storage disabled. The theme still applies for this
      // visit; it just will not be remembered.
    }
    for (const listener of listeners) listener();
  }, []);

  const value = {
    theme,
    setTheme: apply,
    toggleTheme: () => apply(theme === 'light' ? 'dark' : 'light'),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  // Defaults rather than a throw, so a component rendered outside the provider
  // during static generation still renders instead of failing the build.
  if (context === undefined) {
    return { theme: 'dark', setTheme: () => {}, toggleTheme: () => {} };
  }
  return context;
}
