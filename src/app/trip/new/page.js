'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

const TRANSPORT_OPTIONS = [
  { id: 'flight', icon: '✈️', label: 'Flight', desc: 'Flying to destination' },
  { id: 'car', icon: '🚗', label: 'Car', desc: 'Drive or rental car' },
  { id: 'public_transit', icon: '🚆', label: 'Public Transit', desc: 'Trains, buses, metro' },
  { id: 'bike', icon: '🚲', label: 'Bike', desc: 'Cycling around' },
  { id: 'walking', icon: '🚶', label: 'Walking', desc: 'On foot exploration' },
  { id: 'mixed', icon: '🔄', label: 'Mixed', desc: 'Combination of modes' },
];

const INTERESTS = [
  { id: 'sightseeing', icon: '🏛️', label: 'Sightseeing' },
  { id: 'food', icon: '🍜', label: 'Food & Cuisine' },
  { id: 'adventure', icon: '⛰️', label: 'Adventure' },
  { id: 'culture', icon: '🎭', label: 'Culture & Arts' },
  { id: 'nature', icon: '🌿', label: 'Nature' },
  { id: 'nightlife', icon: '🌃', label: 'Nightlife' },
  { id: 'shopping', icon: '🛍️', label: 'Shopping' },
  { id: 'relaxation', icon: '🧘', label: 'Relaxation' },
  { id: 'history', icon: '📜', label: 'History' },
  { id: 'photography', icon: '📸', label: 'Photography' },
];

const BUDGET_LEVELS = [
  { id: 'budget', icon: '💰', label: 'Budget', desc: 'Keep it affordable' },
  { id: 'moderate', icon: '💰💰', label: 'Moderate', desc: 'Balance of cost & comfort' },
  { id: 'luxury', icon: '💰💰💰', label: 'Luxury', desc: 'Spare no expense' },
];

export default function NewTripPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    destination: '',
    startDate: '',
    endDate: '',
    title: '',
    transportMode: 'mixed',
    interests: [],
    budgetLevel: 'moderate',
    totalBudget: '',
    currency: 'USD',
    travelStyle: '',
    notes: '',
  });

  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const totalSteps = 4;

  const updateForm = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const toggleInterest = (id) => {
    setFormData((prev) => ({
      ...prev,
      interests: prev.interests.includes(id)
        ? prev.interests.filter((i) => i !== id)
        : [...prev.interests, id],
    }));
  };

  const canProceed = () => {
    switch (step) {
      case 1: return formData.destination.trim().length > 0;
      case 2: return formData.startDate && formData.endDate;
      case 3: return formData.transportMode;
      case 4: return true;
      default: return false;
    }
  };

  const getDayCount = () => {
    if (!formData.startDate || !formData.endDate) return 0;
    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);
  };

  const handleCreate = async () => {
    if (!user) {
      toast.error('You must be logged in to create a trip', 'Not Authenticated');
      router.push('/auth/login');
      return;
    }
    if (!formData.destination.trim()) {
      toast.error('Please enter a destination');
      return;
    }
    if (!formData.startDate || !formData.endDate) {
      toast.error('Please select travel dates');
      return;
    }

    setLoading(true);
    console.log('[WanderForge] Creating trip...', formData);

    try {
      const title = formData.title || `Trip to ${formData.destination}`;
      const dayCount = getDayCount();

      // Create the trip
      const { data: trip, error: tripError } = await supabase
        .from('trips')
        .insert({
          user_id: user.id,
          title,
          destination: formData.destination,
          start_date: formData.startDate,
          end_date: formData.endDate,
          transport_mode: formData.transportMode,
          total_budget: formData.totalBudget ? parseFloat(formData.totalBudget) : null,
          currency: formData.currency,
          status: 'planned',
          ai_preferences: {
            interests: formData.interests,
            budget_level: formData.budgetLevel,
            travel_style: formData.travelStyle,
            notes: formData.notes,
          },
        })
        .select()
        .single();

      if (tripError) throw tripError;
      console.log('[WanderForge] Trip created:', trip.id);

      // Create trip days
      const days = Array.from({ length: dayCount }, (_, i) => {
        const date = new Date(formData.startDate);
        date.setDate(date.getDate() + i);
        return {
          trip_id: trip.id,
          day_number: i + 1,
          date: date.toISOString().split('T')[0],
        };
      });

      const { error: daysError } = await supabase.from('trip_days').insert(days);
      if (daysError) throw daysError;
      console.log('[WanderForge] Created', dayCount, 'days');

      toast.success('Your trip has been created!', 'Trip Created 🎉');
      router.push(`/trip/${trip.id}`);
    } catch (err) {
      console.error('[WanderForge] Create trip error:', err);
      toast.error(err.message || 'Failed to create trip', 'Error');
      setLoading(false);
    }
  };

  return (
    <>
      <div className="wizard">
        <div className="wizard__bg">
          <div className="wizard__orb wizard__orb--1" />
          <div className="wizard__orb wizard__orb--2" />
        </div>

        <div className="container">
          {/* Progress */}
          <div className="wizard__progress animate-fade-in-down">
            <div className="progress-bar">
              <div className="progress-bar__fill" style={{ width: `${(step / totalSteps) * 100}%` }} />
            </div>
            <span className="progress-bar__label">Step {step} of {totalSteps}</span>
          </div>

          {/* Step 1: Destination */}
          {step === 1 && (
            <div className="wizard__step animate-fade-in-up">
              <div className="wizard__header">
                <span className="wizard__emoji">🌍</span>
                <h1 className="wizard__title">Where are you going?</h1>
                <p className="wizard__subtitle">Tell us your dream destination</p>
              </div>
              <div className="wizard__form">
                <Input
                  label="Destination"
                  placeholder="Paris, Tokyo, Bali..."
                  value={formData.destination}
                  onChange={(e) => updateForm('destination', e.target.value)}
                  icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}
                />
                <Input
                  label="Trip Name (optional)"
                  placeholder="My Amazing Adventure"
                  value={formData.title}
                  onChange={(e) => updateForm('title', e.target.value)}
                  icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>}
                />
              </div>
            </div>
          )}

          {/* Step 2: Dates */}
          {step === 2 && (
            <div className="wizard__step animate-fade-in-up">
              <div className="wizard__header">
                <span className="wizard__emoji">📅</span>
                <h1 className="wizard__title">When are you traveling?</h1>
                <p className="wizard__subtitle">
                  {getDayCount() > 0 && `${getDayCount()} day${getDayCount() > 1 ? 's' : ''} of adventure`}
                </p>
              </div>
              <div className="wizard__form wizard__form--row">
                <Input
                  label="Start Date"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => updateForm('startDate', e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
                <Input
                  label="End Date"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => updateForm('endDate', e.target.value)}
                  min={formData.startDate || new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>
          )}

          {/* Step 3: Transport */}
          {step === 3 && (
            <div className="wizard__step animate-fade-in-up">
              <div className="wizard__header">
                <span className="wizard__emoji">🚀</span>
                <h1 className="wizard__title">How will you get around?</h1>
                <p className="wizard__subtitle">This helps us plan activity distances and timing</p>
              </div>
              <div className="wizard__options">
                {TRANSPORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    className={`option-card ${formData.transportMode === opt.id ? 'option-card--selected' : ''}`}
                    onClick={() => updateForm('transportMode', opt.id)}
                  >
                    <span className="option-card__icon">{opt.icon}</span>
                    <span className="option-card__label">{opt.label}</span>
                    <span className="option-card__desc">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Interests & Budget */}
          {step === 4 && (
            <div className="wizard__step animate-fade-in-up">
              <div className="wizard__header">
                <span className="wizard__emoji">✨</span>
                <h1 className="wizard__title">Final touches</h1>
                <p className="wizard__subtitle">Help our AI craft the perfect itinerary for you</p>
              </div>

              <div className="wizard__section">
                <h3 className="wizard__section-title">What interests you?</h3>
                <div className="wizard__tags">
                  {INTERESTS.map((interest) => (
                    <button
                      key={interest.id}
                      className={`tag ${formData.interests.includes(interest.id) ? 'tag--selected' : ''}`}
                      onClick={() => toggleInterest(interest.id)}
                    >
                      <span>{interest.icon}</span>
                      {interest.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wizard__section">
                <h3 className="wizard__section-title">Budget Level</h3>
                <div className="wizard__options wizard__options--small">
                  {BUDGET_LEVELS.map((level) => (
                    <button
                      key={level.id}
                      className={`option-card option-card--compact ${formData.budgetLevel === level.id ? 'option-card--selected' : ''}`}
                      onClick={() => updateForm('budgetLevel', level.id)}
                    >
                      <span className="option-card__label">{level.label}</span>
                      <span className="option-card__desc">{level.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="wizard__form wizard__form--row">
                <Input
                  label="Budget Amount (optional)"
                  type="number"
                  placeholder="1000"
                  value={formData.totalBudget}
                  onChange={(e) => updateForm('totalBudget', e.target.value)}
                />
                <div style={{ maxWidth: 120 }}>
                  <label className="currency-label">Currency</label>
                  <select
                    className="currency-select"
                    value={formData.currency}
                    onChange={(e) => updateForm('currency', e.target.value)}
                  >
                    <option value="USD">USD $</option>
                    <option value="EUR">EUR €</option>
                    <option value="GBP">GBP £</option>
                    <option value="INR">INR ₹</option>
                    <option value="JPY">JPY ¥</option>
                    <option value="AUD">AUD $</option>
                    <option value="CAD">CAD $</option>
                  </select>
                </div>
              </div>

              <Input
                label="Anything else the AI should know?"
                placeholder="I love street food, hate crowds, traveling with kids..."
                value={formData.notes}
                onChange={(e) => updateForm('notes', e.target.value)}
              />
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="wizard__nav">
            {step > 1 && (
              <Button variant="ghost" size="lg" onClick={() => setStep(step - 1)}>
                ← Back
              </Button>
            )}
            <div style={{ flex: 1 }} />
            {step < totalSteps ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => setStep(step + 1)}
                disabled={!canProceed()}
              >
                Continue →
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={handleCreate}
                loading={loading}
                disabled={!canProceed()}
              >
                🔥 Create Trip
              </Button>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .wizard {
          min-height: calc(100vh - var(--navbar-height));
          padding: var(--space-8) 0 var(--space-16);
          position: relative;
          overflow: hidden;
        }

        .wizard__bg { position: absolute; inset: 0; pointer-events: none; z-index: 0; }

        .wizard > .container { position: relative; z-index: 1; }

        .wizard__orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
        }

        .wizard__orb--1 {
          width: 500px; height: 500px;
          background: var(--color-primary);
          opacity: 0.07;
          top: -10%; right: -5%;
          animation: float 8s ease-in-out infinite;
        }

        .wizard__orb--2 {
          width: 400px; height: 400px;
          background: var(--color-accent);
          opacity: 0.05;
          bottom: -10%; left: -5%;
          animation: float 10s ease-in-out infinite reverse;
        }

        .wizard__progress {
          max-width: 600px;
          margin: 0 auto var(--space-10);
          text-align: center;
        }

        .progress-bar {
          width: 100%;
          height: 6px;
          background: var(--color-bg-tertiary);
          border-radius: var(--radius-full);
          overflow: hidden;
          margin-bottom: var(--space-2);
        }

        .progress-bar__fill {
          height: 100%;
          background: linear-gradient(90deg, var(--color-primary), var(--color-accent));
          border-radius: var(--radius-full);
          transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .progress-bar__label {
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
        }

        .wizard__step {
          max-width: 680px;
          margin: 0 auto;
        }

        .wizard__header {
          text-align: center;
          margin-bottom: var(--space-10);
        }

        .wizard__emoji {
          font-size: 56px;
          display: block;
          margin-bottom: var(--space-4);
        }

        .wizard__title {
          font-size: var(--text-3xl);
          margin-bottom: var(--space-2);
        }

        .wizard__subtitle {
          color: var(--color-text-secondary);
          font-size: var(--text-lg);
        }

        .wizard__form {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .wizard__form--row {
          flex-direction: row;
          gap: var(--space-4);
        }

        .wizard__form--row > * {
          flex: 1;
        }

        .wizard__section {
          margin-bottom: var(--space-8);
        }

        .wizard__section-title {
          font-size: var(--text-lg);
          font-family: var(--font-heading);
          margin-bottom: var(--space-4);
        }

        .wizard__options {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-3);
        }

        .wizard__options--small {
          grid-template-columns: repeat(3, 1fr);
        }

        .option-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: var(--space-5) var(--space-3);
          background: var(--color-surface);
          border: 2px solid var(--color-border-light);
          border-radius: var(--radius-xl);
          cursor: pointer;
          transition: all var(--transition-base);
          font-family: var(--font-body);
          text-align: center;
        }

        .option-card:hover {
          border-color: var(--color-primary-light);
          box-shadow: var(--shadow-sm);
          transform: translateY(-2px);
        }

        .option-card--selected {
          border-color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.06);
          box-shadow: 0 0 0 1px var(--color-primary);
        }

        .option-card--compact {
          padding: var(--space-4) var(--space-3);
        }

        .option-card__icon {
          font-size: 32px;
        }

        .option-card__label {
          font-weight: 600;
          font-size: var(--text-sm);
          color: var(--color-text);
        }

        .option-card__desc {
          font-size: var(--text-xs);
          color: var(--color-text-tertiary);
        }

        .wizard__tags {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        .tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: var(--radius-full);
          border: 1.5px solid var(--color-border);
          background: var(--color-surface);
          font-size: var(--text-sm);
          font-weight: 500;
          font-family: var(--font-body);
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .tag:hover {
          border-color: var(--color-primary-light);
          color: var(--color-text);
        }

        .tag--selected {
          border-color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.1);
          color: var(--color-primary);
        }

        .currency-label {
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--color-text);
          display: block;
          margin-bottom: 6px;
        }

        .currency-select {
          width: 100%;
          padding: 12px 16px;
          font-family: var(--font-body);
          font-size: var(--text-base);
          color: var(--color-text);
          background: var(--color-surface);
          border: 1.5px solid var(--color-border);
          border-radius: var(--radius-md);
          outline: none;
          cursor: pointer;
          transition: border-color var(--transition-base);
        }

        .currency-select:focus {
          border-color: var(--color-primary);
        }

        .wizard__nav {
          max-width: 680px;
          margin: var(--space-10) auto 0;
          display: flex;
          align-items: center;
          gap: var(--space-4);
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }

        @media (max-width: 768px) {
          .wizard__options {
            grid-template-columns: repeat(2, 1fr);
          }
          .wizard__form--row {
            flex-direction: column;
          }
        }

        @media (max-width: 480px) {
          .wizard__options {
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>
    </>
  );
}
