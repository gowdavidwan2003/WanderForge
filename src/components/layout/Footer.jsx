'use client';

import Link from 'next/link';

export default function Footer() {
  return (
    <>
      <footer className="footer">
        <div className="footer__wave">
          <svg viewBox="0 0 1440 120" preserveAspectRatio="none">
            <path d="M0,40 C360,100 720,0 1080,60 C1260,90 1380,50 1440,40 L1440,120 L0,120 Z" fill="var(--color-bg-secondary)" />
          </svg>
        </div>

        <div className="footer__content">
          <div className="container">
            <div className="footer__grid">
              <div className="footer__brand">
                <div className="footer__logo">
                  <span className="footer__logo-icon">🌍</span>
                  <span className="footer__logo-text">
                    Wander<span className="footer__logo-accent">Forge</span>
                  </span>
                </div>
                <p className="footer__tagline text-accent">Forge your perfect journey</p>
                <p className="footer__desc">
                  AI trip planning that checks its own work: every journey is
                  measured against real road distances before the itinerary is
                  saved.
                </p>
              </div>

              <div className="footer__links">
                <h4 className="footer__heading">Product</h4>
                <Link href="/explore">Explore Destinations</Link>
                <Link href="/trip/new">Plan a Trip</Link>
                <Link href="/dashboard">My Trips</Link>
              </div>

              {/* These three used to point at "/" — links that looked like
                  documents and were the homepage. They were removed rather than
                  faked, and are back now that each one resolves to something
                  real. */}
              <div className="footer__links">
                <h4 className="footer__heading">Legal</h4>
                <Link href="/legal/privacy">Privacy Policy</Link>
                <Link href="/legal/terms">Terms of Service</Link>
                <a
                  href="https://github.com/gowdavidwan2003/WanderForge/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  MIT License
                </a>
              </div>

              <div className="footer__links">
                <h4 className="footer__heading">Connect</h4>
                {/* Was twitter.com and github.com — the sites themselves, not
                    this project on them. */}
                <a
                  href="https://github.com/gowdavidwan2003/WanderForge"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Source on GitHub
                </a>
                <a
                  href="https://github.com/gowdavidwan2003/WanderForge/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Report a Problem
                </a>
                <a
                  href="https://www.linkedin.com/in/gowdavidwan2003/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Vidwan on LinkedIn
                </a>
              </div>
            </div>

            <div className="footer__bottom">
              <p className="footer__copyright">
                © {new Date().getFullYear()} WanderForge. Crafted by{' '}
                <a
                  className="footer__author"
                  href="https://www.linkedin.com/in/gowdavidwan2003/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Vidwan Gowda
                </a>
                .
              </p>
              <div className="footer__badges">
                <span className="footer__badge">🔒 Secure</span>
                <span className="footer__badge">🌱 Free</span>
                <span className="footer__badge">🤖 AI-Powered</span>
              </div>
            </div>
          </div>
        </div>
      </footer>

      <style jsx>{`
        .footer {
          position: relative;
          margin-top: var(--space-24);
        }

        .footer__wave {
          position: relative;
          margin-bottom: -2px;
        }

        .footer__wave svg {
          display: block;
          width: 100%;
          height: 80px;
        }

        .footer__content {
          background: var(--color-bg-secondary);
          padding: var(--space-16) 0 var(--space-8);
        }

        .footer__grid {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: var(--space-12);
        }

        .footer__brand {
          max-width: 320px;
        }

        .footer__logo {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: var(--space-2);
        }

        .footer__logo-icon { font-size: 28px; }

        .footer__logo-text {
          font-family: var(--font-heading);
          font-size: var(--text-xl);
          font-weight: 700;
          color: var(--color-text);
        }

        .footer__logo-accent { color: var(--color-primary); }

        .footer__tagline {
          font-size: var(--text-lg);
          color: var(--color-primary);
          margin-bottom: var(--space-3);
        }

        .footer__desc {
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
          line-height: 1.6;
        }

        .footer__links {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .footer__heading {
          font-family: var(--font-body);
          font-size: var(--text-sm);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--color-text);
          margin-bottom: var(--space-1);
        }

        .footer__links a {
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
          text-decoration: none;
          transition: color var(--transition-fast);
        }

        .footer__links a:hover {
          color: var(--color-primary);
        }

        .footer__bottom {
          margin-top: var(--space-12);
          padding-top: var(--space-6);
          border-top: 1px solid var(--color-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--space-4);
        }

        .footer__copyright {
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
        }

        /* Sits outside .footer__links, so it does not inherit those link
           styles and needs its own. Underlined rather than merely coloured:
           it is the one link in this row, and nothing around it hints that
           the name is clickable. */
        .footer__author {
          color: var(--color-primary);
          font-weight: 600;
          text-decoration: underline;
          text-underline-offset: 2px;
          transition: color var(--transition-fast);
        }

        .footer__author:hover {
          color: var(--color-primary-dark);
        }

        .footer__badges {
          display: flex;
          gap: var(--space-3);
        }

        .footer__badge {
          font-size: var(--text-xs);
          padding: 4px 10px;
          border-radius: var(--radius-full);
          background: var(--color-bg-tertiary);
          color: var(--color-text-secondary);
        }

        @media (max-width: 768px) {
          .footer__grid {
            grid-template-columns: 1fr 1fr;
            gap: var(--space-8);
          }

          .footer__brand {
            grid-column: 1 / -1;
            max-width: none;
          }

          .footer__bottom {
            flex-direction: column;
            text-align: center;
          }
        }

        @media (max-width: 480px) {
          .footer__grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
