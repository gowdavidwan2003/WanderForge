'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Footer from '@/components/layout/Footer';

const DESTINATIONS = [
  'Paris', 'Tokyo', 'Bali', 'New York', 'Rome', 'Dubai', 'London',
  'Barcelona', 'Sydney', 'Iceland', 'Santorini', 'Maldives', 'Kyoto',
  'Marrakech', 'Cape Town', 'Rio de Janeiro', 'Bangkok', 'Prague',
];

const FEATURES = [
  {
    icon: '🤖',
    title: 'AI-Powered Planning',
    desc: 'Our AI crafts the optimal itinerary — maximizing experiences, minimizing transit time, and respecting your budget.',
    gradient: 'linear-gradient(135deg, #E8B87D, #C85A3A)',
  },
  {
    icon: '🗺️',
    title: 'Interactive Maps',
    desc: 'Visualize your entire trip on beautiful maps. See routes, distances, and discover hidden gems nearby.',
    gradient: 'linear-gradient(135deg, #4A8C2A, #2D5016)',
  },
  {
    icon: '👥',
    title: 'Real-time Collaboration',
    desc: 'Plan together in real-time. Invite friends, see live edits, and build the perfect group trip.',
    gradient: 'linear-gradient(135deg, #42A5F5, #1565C0)',
  },
  {
    icon: '🌤️',
    title: 'Weather Intelligence',
    desc: 'Weather forecasts built into your itinerary. AI suggests indoor alternatives on rainy days.',
    gradient: 'linear-gradient(135deg, #FFA726, #E65100)',
  },
  {
    icon: '💰',
    title: 'Smart Budget Tracking',
    desc: 'Multi-currency budget tracking with AI suggestions to save money without sacrificing experiences.',
    gradient: 'linear-gradient(135deg, #66BB6A, #2E7D32)',
  },
  {
    icon: '📤',
    title: 'Export Anywhere',
    desc: 'Download as PDF, sync to Google Calendar, or share a beautiful read-only link with anyone.',
    gradient: 'linear-gradient(135deg, #AB47BC, #7B1FA2)',
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Tell Us Your Dream',
    desc: 'Enter your destination, dates, interests, and how you want to travel. Our AI listens.',
    icon: '✨',
  },
  {
    num: '02',
    title: 'AI Forges Your Plan',
    desc: 'Our AI optimizes your itinerary for the best experience, smart timing, and budget-friendly routes.',
    icon: '🔥',
  },
  {
    num: '03',
    title: 'Customize & Collaborate',
    desc: 'Drag and drop activities, invite friends to edit in real-time, and fine-tune every detail.',
    icon: '🎨',
  },
  {
    num: '04',
    title: 'Go Explore!',
    desc: "Access your itinerary offline, get weather alerts, and track your budget as you travel.",
    icon: '🚀',
  },
];

const STATS = [
  { num: '50K+', label: 'Trips Planned' },
  { num: '120+', label: 'Countries' },
  { num: '4.9★', label: 'User Rating' },
  { num: '100%', label: 'Free' },
];

export default function LandingPage() {
  const [destIndex, setDestIndex] = useState(0);
  const [visibleSections, setVisibleSections] = useState(new Set());
  const observerRef = useRef(null);

  // Cycle through destinations
  useEffect(() => {
    const interval = setInterval(() => {
      setDestIndex((prev) => (prev + 1) % DESTINATIONS.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  // Intersection observer for scroll animations
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisibleSections((prev) => new Set([...prev, entry.target.id]));
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -50px 0px' }
    );

    document.querySelectorAll('[data-animate]').forEach((el) => {
      observerRef.current.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, []);

  const isVisible = (id) => visibleSections.has(id);

  return (
    <>
      {/* ===== HERO SECTION ===== */}
      <section className="hero">
        <div className="hero__bg">
          <div className="hero__grid-pattern" />
          <div className="hero__gradient-orb hero__gradient-orb--1" />
          <div className="hero__gradient-orb hero__gradient-orb--2" />
          <div className="hero__gradient-orb hero__gradient-orb--3" />
        </div>

        <div className="hero__content container">
          <div className="hero__badge animate-fade-in-down">
            <span className="hero__badge-dot" />
            AI-Powered Travel Planning
          </div>

          <h1 className="hero__title animate-fade-in-up">
            Forge Your Perfect
            <br />
            <span className="hero__title-destination">
              <span className="hero__title-word" key={destIndex}>
                {DESTINATIONS[destIndex]}
              </span>
            </span>
            <br />
            Journey
          </h1>

          <p className="hero__subtitle animate-fade-in-up stagger-2">
            WanderForge uses AI to craft optimized travel itineraries that
            prioritize unforgettable experiences, save your time, and respect
            your budget. Plan solo or collaborate in real-time.
          </p>

          <div className="hero__actions animate-fade-in-up stagger-3">
            <Link href="/auth/signup">
              <Button size="lg" variant="primary">
                Start Planning — It&apos;s Free
              </Button>
            </Link>
            <Link href="/explore">
              <Button size="lg" variant="secondary">
                Explore Templates
              </Button>
            </Link>
          </div>

          <div className="hero__stats animate-fade-in-up stagger-4">
            {STATS.map((stat) => (
              <div key={stat.label} className="hero__stat">
                <span className="hero__stat-num">{stat.num}</span>
                <span className="hero__stat-label">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="hero__scroll-indicator">
          <div className="hero__scroll-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
        </div>
      </section>

      {/* ===== FEATURES SECTION ===== */}
      <section className="features" id="features" data-animate>
        <div className="container">
          <div className={`section-header ${isVisible('features') ? 'animate-fade-in-up' : 'pre-animate'}`}>
            <span className="section-label text-accent">Why WanderForge?</span>
            <h2 className="section-title">
              Everything You Need to
              <span className="gradient-text"> Plan Perfectly</span>
            </h2>
            <p className="section-desc">
              Powered by AI, designed for travelers. Every feature optimized to make your trip unforgettable.
            </p>
          </div>

          <div className="features__grid">
            {FEATURES.map((feature, i) => (
              <div
                key={feature.title}
                className={`feature-card ${isVisible('features') ? 'animate-fade-in-up' : 'pre-animate'}`}
                style={{ animationDelay: `${(i + 1) * 100}ms` }}
              >
                <div className="feature-card__icon-wrap" style={{ background: feature.gradient }}>
                  <span className="feature-card__icon">{feature.icon}</span>
                </div>
                <h3 className="feature-card__title">{feature.title}</h3>
                <p className="feature-card__desc">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section className="how-it-works" id="how-it-works" data-animate>
        <div className="container">
          <div className={`section-header ${isVisible('how-it-works') ? 'animate-fade-in-up' : 'pre-animate'}`}>
            <span className="section-label text-accent">Simple & Powerful</span>
            <h2 className="section-title">
              How
              <span className="gradient-text"> WanderForge </span>
              Works
            </h2>
          </div>

          <div className="steps">
            {STEPS.map((step, i) => (
              <div
                key={step.num}
                className={`step ${isVisible('how-it-works') ? 'animate-fade-in-up' : 'pre-animate'}`}
                style={{ animationDelay: `${(i + 1) * 150}ms` }}
              >
                <div className="step__number">{step.num}</div>
                <div className="step__connector" />
                <div className="step__icon-wrap">
                  <span className="step__icon">{step.icon}</span>
                </div>
                <h3 className="step__title">{step.title}</h3>
                <p className="step__desc">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA SECTION ===== */}
      <section className="cta" id="cta" data-animate>
        <div className="container">
          <div className={`cta__card glass ${isVisible('cta') ? 'animate-scale-in' : 'pre-animate'}`}>
            <div className="cta__content">
              <span className="cta__emoji">🌍</span>
              <h2 className="cta__title">Ready to Forge Your Next Adventure?</h2>
              <p className="cta__desc">
                Join thousands of travelers who plan smarter with AI.
                Free forever. No credit card required.
              </p>
              <div className="cta__actions">
                <Link href="/auth/signup">
                  <Button size="lg" variant="primary">
                    Get Started Free →
                  </Button>
                </Link>
              </div>
            </div>
            <div className="cta__decorations">
              <span className="cta__deco cta__deco--1">✈️</span>
              <span className="cta__deco cta__deco--2">🏔️</span>
              <span className="cta__deco cta__deco--3">🌊</span>
              <span className="cta__deco cta__deco--4">🗼</span>
            </div>
          </div>
        </div>
      </section>

      <Footer />

      <style jsx>{`
        /* ===== HERO ===== */
        .hero {
          position: relative;
          min-height: calc(100vh - var(--navbar-height));
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          padding: var(--space-8) 0;
        }

        .hero__bg {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }

        .hero__grid-pattern {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(var(--color-primary-rgb), 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(var(--color-primary-rgb), 0.03) 1px, transparent 1px);
          background-size: 60px 60px;
          mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
        }

        .hero__gradient-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.4;
        }

        .hero__gradient-orb--1 {
          width: 600px;
          height: 600px;
          background: var(--color-primary);
          top: -200px;
          right: -100px;
          opacity: 0.15;
          animation: float 8s ease-in-out infinite;
        }

        .hero__gradient-orb--2 {
          width: 400px;
          height: 400px;
          background: var(--color-accent);
          bottom: -100px;
          left: -100px;
          opacity: 0.12;
          animation: float 10s ease-in-out infinite reverse;
        }

        .hero__gradient-orb--3 {
          width: 300px;
          height: 300px;
          background: var(--color-secondary);
          top: 50%;
          left: 50%;
          opacity: 0.08;
          animation: float 6s ease-in-out infinite;
        }

        .hero__content {
          position: relative;
          text-align: center;
          z-index: 1;
        }

        .hero__badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 20px;
          border-radius: var(--radius-full);
          background: rgba(var(--color-primary-rgb), 0.1);
          border: 1px solid rgba(var(--color-primary-rgb), 0.2);
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--color-primary);
          margin-bottom: var(--space-8);
        }

        .hero__badge-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--color-primary);
          animation: pulse-glow 2s ease-in-out infinite;
        }

        .hero__title {
          font-size: clamp(2.5rem, 6vw, 5rem);
          font-weight: 800;
          line-height: 1.1;
          margin-bottom: var(--space-6);
          letter-spacing: -0.02em;
        }

        .hero__title-destination {
          display: inline-block;
          position: relative;
          overflow: hidden;
          min-width: 200px;
        }

        .hero__title-word {
          display: inline-block;
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: wordFadeIn 0.6s ease-out;
        }

        @keyframes wordFadeIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .hero__subtitle {
          font-size: var(--text-lg);
          max-width: 640px;
          margin: 0 auto var(--space-10);
          color: var(--color-text-secondary);
          line-height: 1.7;
        }

        .hero__actions {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-4);
          margin-bottom: var(--space-16);
          flex-wrap: wrap;
        }

        .hero__stats {
          display: flex;
          justify-content: center;
          gap: var(--space-12);
          flex-wrap: wrap;
        }

        .hero__stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .hero__stat-num {
          font-family: var(--font-heading);
          font-size: var(--text-3xl);
          font-weight: 800;
          color: var(--color-text);
        }

        .hero__stat-label {
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
          font-weight: 500;
        }

        .hero__scroll-indicator {
          position: absolute;
          bottom: 32px;
          left: 50%;
          transform: translateX(-50%);
          animation: float 2s ease-in-out infinite;
        }

        .hero__scroll-icon {
          color: var(--color-text-tertiary);
          opacity: 0.5;
        }

        /* ===== SECTION HEADER ===== */
        .section-header {
          text-align: center;
          margin-bottom: var(--space-16);
        }

        .section-label {
          display: block;
          font-size: var(--text-xl);
          color: var(--color-primary);
          margin-bottom: var(--space-3);
        }

        .section-title {
          font-size: clamp(1.75rem, 4vw, var(--text-4xl));
          margin-bottom: var(--space-4);
        }

        .section-desc {
          font-size: var(--text-lg);
          max-width: 560px;
          margin: 0 auto;
          color: var(--color-text-secondary);
        }

        .pre-animate {
          opacity: 0;
          transform: translateY(30px);
        }

        /* ===== FEATURES ===== */
        .features {
          padding: var(--space-24) 0;
        }

        .features__grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-6);
        }

        .feature-card {
          padding: var(--space-8);
          border-radius: var(--radius-xl);
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          transition: all var(--transition-base);
          position: relative;
          overflow: hidden;
        }

        .feature-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: var(--color-primary);
          transform: scaleX(0);
          transform-origin: left;
          transition: transform var(--transition-slow);
        }

        .feature-card:hover {
          border-color: var(--color-primary-light);
          box-shadow: var(--shadow-lg);
          transform: translateY(-4px);
        }

        .feature-card:hover::before {
          transform: scaleX(1);
        }

        .feature-card__icon-wrap {
          width: 56px;
          height: 56px;
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: var(--space-5);
        }

        .feature-card__icon {
          font-size: 28px;
        }

        .feature-card__title {
          font-size: var(--text-xl);
          font-family: var(--font-heading);
          margin-bottom: var(--space-3);
        }

        .feature-card__desc {
          font-size: var(--text-sm);
          line-height: 1.6;
          color: var(--color-text-secondary);
        }

        /* ===== HOW IT WORKS ===== */
        .how-it-works {
          padding: var(--space-24) 0;
          background: var(--color-bg-secondary);
        }

        .steps {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: var(--space-6);
          position: relative;
        }

        .step {
          text-align: center;
          position: relative;
          padding: var(--space-6);
        }

        .step__number {
          font-family: var(--font-heading);
          font-size: var(--text-6xl);
          font-weight: 800;
          opacity: 0.06;
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          line-height: 1;
        }

        .step__icon-wrap {
          width: 72px;
          height: 72px;
          border-radius: var(--radius-full);
          background: var(--color-surface);
          border: 2px solid var(--color-border);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto var(--space-5);
          position: relative;
          z-index: 1;
          transition: all var(--transition-base);
        }

        .step:hover .step__icon-wrap {
          border-color: var(--color-primary);
          box-shadow: var(--shadow-glow);
          transform: scale(1.1);
        }

        .step__icon {
          font-size: 32px;
        }

        .step__connector {
          display: none;
        }

        .step__title {
          font-size: var(--text-lg);
          font-family: var(--font-heading);
          margin-bottom: var(--space-2);
        }

        .step__desc {
          font-size: var(--text-sm);
          color: var(--color-text-secondary);
          line-height: 1.5;
        }

        /* ===== CTA ===== */
        .cta {
          padding: var(--space-24) 0;
        }

        .cta__card {
          border-radius: var(--radius-2xl);
          padding: var(--space-16) var(--space-8);
          text-align: center;
          position: relative;
          overflow: hidden;
          background: linear-gradient(135deg,
            rgba(var(--color-primary-rgb), 0.08),
            rgba(var(--color-primary-rgb), 0.02));
          border: 1px solid rgba(var(--color-primary-rgb), 0.15);
        }

        .cta__content {
          position: relative;
          z-index: 1;
        }

        .cta__emoji {
          font-size: 64px;
          display: block;
          margin-bottom: var(--space-6);
          animation: float 3s ease-in-out infinite;
        }

        .cta__title {
          font-size: clamp(1.5rem, 3vw, var(--text-4xl));
          margin-bottom: var(--space-4);
        }

        .cta__desc {
          font-size: var(--text-lg);
          color: var(--color-text-secondary);
          max-width: 480px;
          margin: 0 auto var(--space-8);
        }

        .cta__decorations {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .cta__deco {
          position: absolute;
          font-size: 40px;
          opacity: 0.15;
        }

        .cta__deco--1 {
          top: 10%;
          left: 8%;
          animation: float 4s ease-in-out infinite;
        }

        .cta__deco--2 {
          top: 15%;
          right: 10%;
          animation: float 5s ease-in-out infinite reverse;
        }

        .cta__deco--3 {
          bottom: 12%;
          left: 12%;
          animation: float 3.5s ease-in-out infinite;
        }

        .cta__deco--4 {
          bottom: 20%;
          right: 8%;
          animation: float 4.5s ease-in-out infinite reverse;
        }

        /* ===== RESPONSIVE ===== */
        @media (max-width: 1024px) {
          .features__grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .steps {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 768px) {
          .hero__stats {
            gap: var(--space-8);
          }

          .features__grid {
            grid-template-columns: 1fr;
          }

          .steps {
            grid-template-columns: 1fr;
            max-width: 400px;
            margin: 0 auto;
          }

          .hero__scroll-indicator {
            display: none;
          }
        }

        @media (max-width: 480px) {
          .hero__actions {
            flex-direction: column;
            width: 100%;
          }

          .hero__stats {
            gap: var(--space-6);
          }
        }
      `}</style>
    </>
  );
}
