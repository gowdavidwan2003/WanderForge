'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthProvider';
import ThemeToggle from '@/components/ui/ThemeToggle';
import Button from '@/components/ui/Button';

export default function Navbar() {
  const { user, signOut, loading } = useAuth();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isLanding = pathname === '/';

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <nav className={`navbar ${scrolled ? 'navbar--scrolled' : ''} ${isLanding && !scrolled ? 'navbar--transparent' : ''}`}>
        <div className="navbar__inner container">
          <Link href="/" className="navbar__logo">
            <span className="navbar__logo-icon">🌍</span>
            <span className="navbar__logo-text">
              Wander<span className="navbar__logo-accent">Forge</span>
            </span>
          </Link>

          <div className={`navbar__menu ${mobileOpen ? 'navbar__menu--open' : ''}`}>
            {user ? (
              <>
                <Link href="/dashboard" className={`navbar__link ${pathname === '/dashboard' ? 'navbar__link--active' : ''}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                  Dashboard
                </Link>
                <Link href="/explore" className={`navbar__link ${pathname === '/explore' ? 'navbar__link--active' : ''}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
                  Explore
                </Link>
                <Link href="/trip/new" className="navbar__link navbar__link--cta">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Trip
                </Link>
              </>
            ) : (
              <>
                <a href="#features" className="navbar__link">Features</a>
                <a href="#how-it-works" className="navbar__link">How It Works</a>
                <a href="#templates" className="navbar__link">Templates</a>
              </>
            )}
          </div>

          <div className="navbar__actions">
            <ThemeToggle />
            {!loading && (
              <>
                {user ? (
                  <div className="navbar__user">
                    <Link href={`/profile/${user.id}`} className="navbar__avatar">
                      {user.user_metadata?.display_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || 'W'}
                    </Link>
                    <button onClick={signOut} className="navbar__signout" title="Sign Out">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="navbar__auth">
                    <Link href="/auth/login">
                      <Button variant="ghost" size="sm">Log In</Button>
                    </Link>
                    <Link href="/auth/signup">
                      <Button variant="primary" size="sm">Sign Up Free</Button>
                    </Link>
                  </div>
                )}
              </>
            )}

            <button
              className={`navbar__hamburger ${mobileOpen ? 'navbar__hamburger--open' : ''}`}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              <span /><span /><span />
            </button>
          </div>
        </div>
      </nav>

      {mobileOpen && <div className="navbar__mobile-overlay" onClick={() => setMobileOpen(false)} />}

      <style jsx>{`
        .navbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: var(--navbar-height);
          z-index: var(--z-navbar);
          transition: all var(--transition-base);
          border-bottom: 1px solid transparent;
        }

        .navbar--scrolled,
        .navbar:not(.navbar--transparent) {
          background: var(--glass-bg);
          backdrop-filter: blur(var(--glass-blur));
          -webkit-backdrop-filter: blur(var(--glass-blur));
          border-bottom-color: var(--color-border-light);
          box-shadow: var(--shadow-sm);
        }

        .navbar--transparent {
          background: transparent;
        }

        .navbar__inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 100%;
          gap: var(--space-6);
        }

        .navbar__logo {
          display: flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
          flex-shrink: 0;
        }

        .navbar__logo-icon {
          font-size: 28px;
          animation: float 4s ease-in-out infinite;
        }

        .navbar__logo-text {
          font-family: var(--font-heading);
          font-size: var(--text-xl);
          font-weight: 700;
          color: var(--color-text);
        }

        .navbar__logo-accent {
          color: var(--color-primary);
        }

        .navbar__menu {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .navbar__link {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--color-text-secondary);
          text-decoration: none;
          border-radius: var(--radius-md);
          transition: all var(--transition-fast);
        }

        .navbar__link:hover {
          color: var(--color-text);
          background: var(--color-bg-secondary);
        }

        .navbar__link--active {
          color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.1);
        }

        .navbar__link--cta {
          color: var(--color-text-on-primary);
          background: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark));
          font-weight: 600;
        }

        .navbar__link--cta:hover {
          color: var(--color-text-on-primary);
          box-shadow: var(--shadow-glow);
          transform: translateY(-1px);
        }

        .navbar__actions {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          flex-shrink: 0;
        }

        .navbar__auth {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .navbar__user {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .navbar__avatar {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: var(--text-sm);
          text-decoration: none;
          transition: transform var(--transition-fast), box-shadow var(--transition-fast);
        }

        .navbar__avatar:hover {
          transform: scale(1.1);
          box-shadow: var(--shadow-glow);
        }

        .navbar__signout {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border: none;
          background: none;
          color: var(--color-text-tertiary);
          cursor: pointer;
          border-radius: var(--radius-full);
          transition: all var(--transition-fast);
        }

        .navbar__signout:hover {
          color: var(--color-error);
          background: var(--color-error-bg);
        }

        .navbar__hamburger {
          display: none;
          flex-direction: column;
          gap: 5px;
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
        }

        .navbar__hamburger span {
          display: block;
          width: 22px;
          height: 2px;
          background: var(--color-text);
          border-radius: 2px;
          transition: all var(--transition-base);
        }

        .navbar__hamburger--open span:nth-child(1) {
          transform: rotate(45deg) translate(5px, 5px);
        }

        .navbar__hamburger--open span:nth-child(2) {
          opacity: 0;
        }

        .navbar__hamburger--open span:nth-child(3) {
          transform: rotate(-45deg) translate(5px, -5px);
        }

        .navbar__mobile-overlay {
          display: none;
        }

        @media (max-width: 768px) {
          .navbar__menu {
            position: fixed;
            top: var(--navbar-height);
            left: 0;
            right: 0;
            background: var(--color-surface);
            border-bottom: 1px solid var(--color-border);
            flex-direction: column;
            padding: var(--space-4);
            gap: var(--space-2);
            transform: translateY(-120%);
            opacity: 0;
            transition: all var(--transition-base);
            box-shadow: var(--shadow-lg);
          }

          .navbar__menu--open {
            transform: translateY(0);
            opacity: 1;
          }

          .navbar__hamburger {
            display: flex;
          }

          .navbar__auth {
            display: none;
          }

          .navbar__mobile-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: var(--color-overlay);
            z-index: calc(var(--z-navbar) - 1);
          }

          .navbar__menu--open + .navbar__mobile-overlay {
            display: block;
          }
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
      `}</style>
    </>
  );
}
