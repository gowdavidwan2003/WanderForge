'use client';

import { useState, useEffect, use } from 'react';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

export default function ProfilePage({ params }) {
  const { id } = use(params);
  const [profile, setProfile] = useState(null);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ display_name: '', bio: '' });
  const [apiKeyForm, setApiKeyForm] = useState({ groq: '' });
  const [showApiSection, setShowApiSection] = useState(false);

  const { user } = useAuth();
  const toast = useToast();
  const supabase = getSupabaseBrowserClient();
  const isOwnProfile = user?.id === id;

  useEffect(() => {
    fetchProfile();
  }, [id]);

  const fetchProfile = async () => {
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single();

      setProfile(profileData);
      setForm({ display_name: profileData?.display_name || '', bio: profileData?.bio || '' });

      const { data: tripsData } = await supabase
        .from('trips')
        .select('*')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(10);

      setTrips(tripsData || []);

      // Fetch saved API keys
      if (isOwnProfile) {
        const { data: keys } = await supabase
          .from('user_api_keys')
          .select('provider')
          .eq('user_id', id);
        
        if (keys?.length > 0) {
          const keyMap = {};
          keys.forEach(k => { keyMap[k.provider] = '••••••••'; });
          setApiKeyForm(prev => ({ ...prev, ...keyMap }));
        }
      }
    } catch {
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: form.display_name, bio: form.bio })
        .eq('id', id);

      if (error) throw error;
      setEditing(false);
      toast.success('Profile updated');
      fetchProfile();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSaveApiKey = async (provider, key) => {
    if (!key || key === '••••••••') return;
    try {
      const { error } = await supabase
        .from('user_api_keys')
        .upsert({
          user_id: user.id,
          provider,
          encrypted_key: key, // In production, encrypt before storing
        }, { onConflict: 'user_id,provider' });

      if (error) throw error;
      toast.success(`${provider} API key saved`);
      setApiKeyForm(prev => ({ ...prev, [provider]: '••••••••' }));
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <LoadingSpinner size={48} />
      </div>
    );
  }

  if (!profile) return <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}><h2>Profile not found</h2></div>;

  return (
    <>
      <div className="profile-page">
        <div className="container">
          {/* Profile Header */}
          <div className="profile-header glass animate-fade-in-up">
            <div className="profile-header__avatar">
              {profile.display_name?.[0]?.toUpperCase() || 'W'}
            </div>
            <div className="profile-header__info">
              {editing ? (
                <div className="profile-header__edit">
                  <Input label="Display Name" value={form.display_name} onChange={(e) => setForm(p => ({ ...p, display_name: e.target.value }))} />
                  <Input label="Bio" value={form.bio} onChange={(e) => setForm(p => ({ ...p, bio: e.target.value }))} placeholder="Tell us about yourself..." />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button variant="primary" size="sm" onClick={handleSaveProfile}>Save</Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="profile-header__name">{profile.display_name}</h1>
                  <p className="profile-header__email">{profile.email}</p>
                  {profile.bio && <p className="profile-header__bio">{profile.bio}</p>}
                  {isOwnProfile && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit Profile</Button>
                  )}
                </>
              )}
            </div>
            <div className="profile-header__stats">
              <div className="profile-stat">
                <span className="profile-stat__value">{trips.length}</span>
                <span className="profile-stat__label">Trips</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat__value">{new Set(trips.map(t => t.destination)).size}</span>
                <span className="profile-stat__label">Destinations</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat__value">{trips.filter(t => t.status === 'completed').length}</span>
                <span className="profile-stat__label">Completed</span>
              </div>
            </div>
          </div>

          {/* API Keys Section (BYOK) */}
          {isOwnProfile && (
            <div className="profile-section animate-fade-in-up" style={{ animationDelay: '100ms' }}>
              <button className="section-toggle" onClick={() => setShowApiSection(!showApiSection)}>
                <h2 className="section-toggle__title">🔑 API Keys (BYOK)</h2>
                <span className="section-toggle__arrow">{showApiSection ? '▲' : '▼'}</span>
              </button>
              {showApiSection && (
                <div className="api-keys-section">
                  <p className="api-keys-desc">
                    Bring Your Own Key for AI generation. Your keys are stored securely and never shared.
                  </p>
                  <div className="api-key-row">
                    <div className="api-key-row__info">
                      <strong>Groq</strong>
                      <span className="api-key-row__hint">Free tier available at console.groq.com</span>
                    </div>
                    <div className="api-key-row__input">
                      <Input
                        type="password"
                        placeholder="gsk_..."
                        value={apiKeyForm.groq}
                        onChange={(e) => setApiKeyForm(p => ({ ...p, groq: e.target.value }))}
                      />
                      <Button variant="primary" size="sm" onClick={() => handleSaveApiKey('groq', apiKeyForm.groq)}>Save</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recent Trips */}
          <div className="profile-section animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            <h2 className="profile-section__title">Recent Trips</h2>
            {trips.length === 0 ? (
              <p style={{ color: 'var(--color-text-tertiary)' }}>No trips yet</p>
            ) : (
              <div className="profile-trips">
                {trips.map((trip) => (
                  <a href={`/trip/${trip.id}`} key={trip.id} className="profile-trip-card">
                    <span className="profile-trip-card__icon">
                      {trip.transport_mode === 'flight' ? '✈️' : '🌍'}
                    </span>
                    <div>
                      <h3 className="profile-trip-card__title">{trip.title}</h3>
                      <p className="profile-trip-card__dest">📍 {trip.destination}</p>
                    </div>
                    <span className="profile-trip-card__status" style={{ color: trip.status === 'completed' ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                      {trip.status}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .profile-page { min-height: calc(100vh - var(--navbar-height)); padding: var(--space-8) 0 var(--space-16); }

        .profile-header {
          display: flex;
          align-items: center;
          gap: var(--space-8);
          padding: var(--space-8) var(--space-10);
          border-radius: var(--radius-2xl);
          margin-bottom: var(--space-6);
        }

        .profile-header__avatar {
          width: 80px;
          height: 80px;
          border-radius: var(--radius-full);
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: var(--text-3xl);
          font-weight: 800;
          flex-shrink: 0;
        }

        .profile-header__info { flex: 1; }
        .profile-header__name { font-size: var(--text-2xl); }
        .profile-header__email { font-size: var(--text-sm); color: var(--color-text-tertiary); }
        .profile-header__bio { font-size: var(--text-sm); color: var(--color-text-secondary); margin-top: var(--space-1); }
        .profile-header__edit { display: flex; flex-direction: column; gap: var(--space-3); }

        .profile-header__stats {
          display: flex;
          gap: var(--space-8);
          flex-shrink: 0;
        }

        .profile-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .profile-stat__value {
          font-family: var(--font-heading);
          font-size: var(--text-2xl);
          font-weight: 700;
        }

        .profile-stat__label {
          font-size: var(--text-xs);
          color: var(--color-text-tertiary);
        }

        .profile-section {
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: var(--radius-xl);
          padding: var(--space-6);
          margin-bottom: var(--space-4);
        }

        .profile-section__title { font-size: var(--text-lg); margin-bottom: var(--space-4); }

        .section-toggle {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: none;
          border: none;
          cursor: pointer;
          font-family: var(--font-body);
          padding: 0;
        }

        .section-toggle__title { font-size: var(--text-lg); color: var(--color-text); }
        .section-toggle__arrow { color: var(--color-text-tertiary); }

        .api-keys-section { margin-top: var(--space-4); }
        .api-keys-desc { font-size: var(--text-sm); color: var(--color-text-tertiary); margin-bottom: var(--space-4); }

        .api-key-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-4);
          padding: var(--space-3) 0;
          border-top: 1px solid var(--color-border-light);
        }

        .api-key-row__hint { display: block; font-size: var(--text-xs); color: var(--color-text-tertiary); }
        .api-key-row__input { display: flex; gap: var(--space-2); align-items: flex-start; }

        .profile-trips { display: flex; flex-direction: column; gap: var(--space-2); }

        .profile-trip-card {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-md);
          text-decoration: none;
          transition: all var(--transition-fast);
        }

        .profile-trip-card:hover { background: var(--color-bg-secondary); }
        .profile-trip-card__icon { font-size: 24px; }
        .profile-trip-card__title { font-size: var(--text-sm); font-weight: 600; color: var(--color-text); }
        .profile-trip-card__dest { font-size: var(--text-xs); color: var(--color-text-tertiary); }
        .profile-trip-card__status { font-size: var(--text-xs); font-weight: 500; text-transform: capitalize; margin-left: auto; }

        @media (max-width: 768px) {
          .profile-header { flex-direction: column; text-align: center; }
          .profile-header__stats { justify-content: center; }
          .api-key-row { flex-direction: column; align-items: flex-start; }
        }
      `}</style>
    </>
  );
}
