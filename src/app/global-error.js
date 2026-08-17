'use client'; // Error boundaries must be Client Components.

/**
 * Last resort: a failure in the root layout itself, which replaces that layout
 * when active. It must therefore render its own <html> and <body>, and cannot
 * rely on globals.css design tokens or any provider — the layout that supplies
 * them is exactly what failed — so the styles here are deliberately literal and
 * self-contained rather than token-driven.
 */
export default function GlobalError({ error, unstable_retry }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#0b1220',
          color: '#e8ecf4',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: '440px', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', lineHeight: 1 }} aria-hidden="true">🧭</div>
          <h1 style={{ fontSize: '24px', margin: '12px 0 8px' }}>WanderForge could not start</h1>
          <p style={{ margin: '0 0 8px', lineHeight: 1.6, color: '#aab6cc' }}>
            The app failed to load. Reloading usually fixes it, and none of your trip
            data is affected.
          </p>
          {error?.digest && (
            <p style={{ margin: '0 0 20px', fontSize: '12px', color: '#7c8aa5', fontFamily: 'ui-monospace, monospace' }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              padding: '10px 20px',
              fontSize: '15px',
              fontWeight: 600,
              color: '#0b1220',
              background: '#7dd3fc',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            Reload WanderForge
          </button>
        </div>
      </body>
    </html>
  );
}
