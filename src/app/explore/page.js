'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Footer from '@/components/layout/Footer';

const TEMPLATE_DATA = [
  { destination: 'Paris, France', duration: 5, icon: '🗼', cover: '#E8B87D', tags: ['culture', 'food', 'romance'], desc: 'The City of Lights — iconic landmarks, world-class cuisine, and unforgettable strolls along the Seine.' },
  { destination: 'Tokyo, Japan', duration: 7, icon: '🏯', cover: '#C85A3A', tags: ['culture', 'food', 'technology'], desc: 'A mesmerizing blend of ancient temples, futuristic tech, and the best street food on Earth.' },
  { destination: 'Bali, Indonesia', duration: 6, icon: '🌴', cover: '#4A8C2A', tags: ['nature', 'relaxation', 'adventure'], desc: 'Lush rice terraces, sacred temples, stunning beaches, and spiritual healing experiences.' },
  { destination: 'New York, USA', duration: 5, icon: '🗽', cover: '#42A5F5', tags: ['sightseeing', 'food', 'nightlife'], desc: 'The city that never sleeps — Broadway, Central Park, world-class museums, and pizza.' },
  { destination: 'Rome, Italy', duration: 4, icon: '🏛️', cover: '#B88A4D', tags: ['history', 'food', 'culture'], desc: 'Ancient ruins, Renaissance art, gelato on every corner, and la dolce vita.' },
  { destination: 'Dubai, UAE', duration: 4, icon: '🏙️', cover: '#DAA520', tags: ['luxury', 'shopping', 'adventure'], desc: 'Futuristic skyline, desert safaris, world-class shopping, and over-the-top luxury.' },
  { destination: 'London, UK', duration: 5, icon: '🎡', cover: '#8B4513', tags: ['history', 'culture', 'nightlife'], desc: 'Royal palaces, West End theatres, classic pubs, and iconic double-decker buses.' },
  { destination: 'Barcelona, Spain', duration: 5, icon: '⛪', cover: '#E57C23', tags: ['culture', 'food', 'nightlife'], desc: 'Gaudí masterpieces, tapas bars, Mediterranean beaches, and infectious energy.' },
  { destination: 'Sydney, Australia', duration: 6, icon: '🏖️', cover: '#0077B6', tags: ['nature', 'adventure', 'food'], desc: 'The Opera House, Bondi Beach, Blue Mountains, and the best coffee culture.' },
  { destination: 'Reykjavik, Iceland', duration: 4, icon: '🌋', cover: '#2D5016', tags: ['nature', 'adventure', 'photography'], desc: 'Northern Lights, geysers, blue lagoons, and otherworldly volcanic landscape.' },
  { destination: 'Santorini, Greece', duration: 4, icon: '🏝️', cover: '#2196F3', tags: ['romance', 'relaxation', 'food'], desc: 'White-washed villages, breathtaking sunsets, Mediterranean cuisine, and crystal waters.' },
  { destination: 'Marrakech, Morocco', duration: 4, icon: '🕌', cover: '#D2691E', tags: ['culture', 'food', 'shopping'], desc: 'Vibrant souks, stunning palaces, aromatic tagines, and desert excursions.' },
  { destination: 'Cape Town, South Africa', duration: 5, icon: '⛰️', cover: '#228B22', tags: ['nature', 'adventure', 'food'], desc: 'Table Mountain, wine country, stunning coastline, and incredible biodiversity.' },
  { destination: 'Bangkok, Thailand', duration: 5, icon: '🛕', cover: '#FF8C00', tags: ['food', 'culture', 'nightlife'], desc: 'Ornate temples, floating markets, legendary street food, and vibrant nightlife.' },
  { destination: 'Prague, Czech Republic', duration: 3, icon: '🏰', cover: '#8B0000', tags: ['history', 'culture', 'nightlife'], desc: 'Fairy-tale architecture, affordable beer, charming old town, and magical bridges.' },
  { destination: 'Maldives', duration: 5, icon: '🐠', cover: '#00CED1', tags: ['relaxation', 'nature', 'romance'], desc: 'Crystal-clear waters, overwater bungalows, world-class diving, and total serenity.' },
  { destination: 'Kyoto, Japan', duration: 4, icon: '⛩️', cover: '#DC143C', tags: ['culture', 'nature', 'history'], desc: 'Traditional geisha districts, bamboo forests, zen gardens, and 2000+ temples.' },
  { destination: 'Rio de Janeiro, Brazil', duration: 5, icon: '🎉', cover: '#32CD32', tags: ['adventure', 'nightlife', 'nature'], desc: 'Christ the Redeemer, Copacabana, samba rhythms, and the Amazon rainforest.' },
  { destination: 'Istanbul, Turkey', duration: 4, icon: '🌙', cover: '#4169E1', tags: ['history', 'food', 'culture'], desc: 'Where East meets West — bazaars, mosques, hamams, and incredible kebabs.' },
  { destination: 'Amsterdam, Netherlands', duration: 3, icon: '🌷', cover: '#FF6347', tags: ['culture', 'nightlife', 'photography'], desc: 'Canal cruises, world-class museums, cycling culture, and vibrant neighborhoods.' },
  { destination: 'Cusco, Peru', duration: 5, icon: '🦙', cover: '#8B4513', tags: ['history', 'adventure', 'nature'], desc: 'Gateway to Machu Picchu, Inca heritage, stunning Andes, and coca tea.' },
  { destination: 'Vienna, Austria', duration: 3, icon: '🎻', cover: '#9370DB', tags: ['culture', 'history', 'food'], desc: 'Imperial palaces, classical music, Sachertorte, and coffee house tradition.' },
  { destination: 'Singapore', duration: 3, icon: '🦁', cover: '#FF4500', tags: ['food', 'sightseeing', 'shopping'], desc: 'Marina Bay, hawker centres, Gardens by the Bay, and futuristic architecture.' },
  { destination: 'Lisbon, Portugal', duration: 4, icon: '⚓', cover: '#F4A460', tags: ['food', 'culture', 'nightlife'], desc: 'Colorful tiles, pastel de nata, fado music, and stunning coastal views.' },
  { destination: 'Jaipur, India', duration: 4, icon: '🐘', cover: '#E75480', tags: ['history', 'culture', 'shopping'], desc: 'The Pink City — majestic forts, vibrant bazaars, spicy curries, and royal heritage.' },
  { destination: 'Seoul, South Korea', duration: 5, icon: '🎎', cover: '#663399', tags: ['food', 'culture', 'technology'], desc: 'K-pop, kimchi, ancient palaces, neon streets, and the best skincare shopping.' },
  { destination: 'Cairo, Egypt', duration: 4, icon: '🐫', cover: '#CD853F', tags: ['history', 'adventure', 'culture'], desc: 'The Pyramids, the Sphinx, the Nile, and 5000 years of fascinating history.' },
  { destination: 'Queenstown, New Zealand', duration: 4, icon: '🏔️', cover: '#2E8B57', tags: ['adventure', 'nature', 'photography'], desc: 'Adventure capital — bungee jumping, skiing, Lord of the Rings landscapes.' },
  { destination: 'Havana, Cuba', duration: 4, icon: '🚗', cover: '#B22222', tags: ['culture', 'nightlife', 'history'], desc: 'Vintage cars, salsa music, colonial architecture, and mojitos on the Malecón.' },
  { destination: 'Dubai → Abu Dhabi, UAE', duration: 5, icon: '🌆', cover: '#B8860B', tags: ['luxury', 'adventure', 'culture'], desc: 'Desert safaris, world records, Grand Mosque, and the ultimate luxury experience.' },
];

const ALL_TAGS = [...new Set(TEMPLATE_DATA.flatMap(t => t.tags))].sort();

export default function ExplorePage() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const supabase = getSupabaseBrowserClient();

  const filtered = TEMPLATE_DATA.filter((t) => {
    const matchesFilter = filter === 'all' || t.tags.includes(filter);
    const matchesSearch = !search || t.destination.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleUseTemplate = async (template) => {
    if (!user) {
      toast.info('Please sign up to use templates', 'Account Required');
      router.push('/auth/signup');
      return;
    }

    // Create a trip from template
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 14); // 2 weeks from now
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + template.duration - 1);

    try {
      const { data: trip, error } = await supabase
        .from('trips')
        .insert({
          user_id: user.id,
          title: `Trip to ${template.destination}`,
          destination: template.destination,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          status: 'planned',
          ai_preferences: { tags: template.tags, from_template: true },
        })
        .select()
        .single();

      if (error) throw error;

      // Create days
      const days = Array.from({ length: template.duration }, (_, i) => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
        return { trip_id: trip.id, day_number: i + 1, date: d.toISOString().split('T')[0] };
      });

      await supabase.from('trip_days').insert(days);

      toast.success(`Trip created! Now let AI fill in your itinerary.`, 'Template Applied 🎉');
      router.push(`/trip/${trip.id}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="explore">
        <div className="explore__hero">
          <div className="container">
            <span className="explore__emoji">🗺️</span>
            <h1 className="explore__title">Explore Destinations</h1>
            <p className="explore__subtitle">
              {TEMPLATE_DATA.length}{' '}curated templates for the world&apos;s most visited destinations
            </p>

            <div className="explore__search">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search destinations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="explore__search-input"
              />
            </div>

            <div className="explore__filters">
              <button
                className={`filter-btn ${filter === 'all' ? 'filter-btn--active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              {ALL_TAGS.map((tag) => (
                <button
                  key={tag}
                  className={`filter-btn ${filter === tag ? 'filter-btn--active' : ''}`}
                  onClick={() => setFilter(tag)}
                >
                  {tag.charAt(0).toUpperCase() + tag.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="explore__grid">
          <div className="container">
            <div className="templates-grid">
              {filtered.map((t, i) => (
                <div
                  key={t.destination}
                  className="template-card animate-fade-in-up"
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <div className="template-card__cover" style={{ background: t.cover }}>
                    <span className="template-card__icon">{t.icon}</span>
                    <span className="template-card__duration">{t.duration} Days</span>
                  </div>
                  <div className="template-card__body">
                    <h3 className="template-card__title">{t.destination}</h3>
                    <p className="template-card__desc">{t.desc}</p>
                    <div className="template-card__tags">
                      {t.tags.map((tag) => (
                        <span key={tag} className="template-card__tag">{tag}</span>
                      ))}
                    </div>
                    <Button variant="primary" size="sm" fullWidth onClick={() => handleUseTemplate(t)}>
                      Use Template →
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="explore__empty">
                <span>🔍</span>
                <h3>No destinations found</h3>
                <p>Try a different search or filter</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Footer />

      <style jsx>{`
        .explore__hero {
          text-align: center;
          padding: var(--space-12) 0 var(--space-8);
          background: var(--color-bg-secondary);
        }

        .explore__emoji { font-size: 56px; display: block; margin-bottom: var(--space-4); }
        .explore__title { font-size: var(--text-4xl); margin-bottom: var(--space-2); }
        .explore__subtitle { color: var(--color-text-secondary); font-size: var(--text-lg); margin-bottom: var(--space-8); }

        .explore__search {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          max-width: 480px;
          margin: 0 auto var(--space-6);
          padding: var(--space-3) var(--space-5);
          background: var(--color-surface);
          border: 1.5px solid var(--color-border);
          border-radius: var(--radius-full);
          color: var(--color-text-tertiary);
        }

        .explore__search:focus-within {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.1);
        }

        .explore__search-input {
          flex: 1;
          border: none;
          background: none;
          font-family: var(--font-body);
          font-size: var(--text-base);
          color: var(--color-text);
          outline: none;
        }

        .explore__search-input::placeholder {
          color: var(--color-text-tertiary);
        }

        .explore__filters {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: var(--space-2);
        }

        .filter-btn {
          padding: 6px 16px;
          border-radius: var(--radius-full);
          border: 1.5px solid var(--color-border);
          background: var(--color-surface);
          font-family: var(--font-body);
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .filter-btn:hover {
          border-color: var(--color-primary-light);
          color: var(--color-text);
        }

        .filter-btn--active {
          border-color: var(--color-primary);
          background: rgba(var(--color-primary-rgb), 0.1);
          color: var(--color-primary);
        }

        .explore__grid { padding: var(--space-10) 0; }

        .templates-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: var(--space-6);
        }

        .template-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border-light);
          border-radius: var(--radius-xl);
          overflow: hidden;
          transition: all var(--transition-base);
        }

        .template-card:hover {
          border-color: var(--color-primary-light);
          box-shadow: var(--shadow-lg);
          transform: translateY(-4px);
        }

        .template-card__cover {
          height: 160px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        .template-card__icon {
          font-size: 56px;
          opacity: 0.8;
        }

        .template-card__duration {
          position: absolute;
          top: 12px;
          right: 12px;
          padding: 4px 12px;
          background: rgba(0, 0, 0, 0.5);
          color: white;
          border-radius: var(--radius-full);
          font-size: var(--text-xs);
          font-weight: 600;
          backdrop-filter: blur(4px);
        }

        .template-card__body {
          padding: var(--space-5);
        }

        .template-card__title {
          font-size: var(--text-lg);
          font-family: var(--font-heading);
          margin-bottom: var(--space-2);
        }

        .template-card__desc {
          font-size: var(--text-sm);
          color: var(--color-text-secondary);
          line-height: 1.5;
          margin-bottom: var(--space-3);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .template-card__tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: var(--space-4);
        }

        .template-card__tag {
          padding: 2px 10px;
          border-radius: var(--radius-full);
          background: var(--color-bg-secondary);
          color: var(--color-text-tertiary);
          font-size: var(--text-xs);
          font-weight: 500;
          text-transform: capitalize;
        }

        .explore__empty {
          text-align: center;
          padding: var(--space-16) var(--space-8);
          color: var(--color-text-tertiary);
        }

        .explore__empty span { font-size: 56px; display: block; margin-bottom: var(--space-4); }
        .explore__empty h3 { font-size: var(--text-xl); color: var(--color-text); margin-bottom: var(--space-2); }

        @media (max-width: 768px) {
          .templates-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
