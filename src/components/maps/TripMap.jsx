'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const CATEGORY_COLORS = {
  sightseeing: '#6366F1',
  food: '#F59E0B',
  transport: '#64748B',
  accommodation: '#8B5CF6',
  adventure: '#10B981',
  shopping: '#EC4899',
  nightlife: '#7C3AED',
  culture: '#3B82F6',
  nature: '#22C55E',
  relaxation: '#06B6D4',
  other: '#94A3B8',
};

const CATEGORY_ICONS = {
  sightseeing: '🏛️',
  food: '🍜',
  transport: '🚌',
  accommodation: '🏨',
  adventure: '⛰️',
  shopping: '🛍️',
  nightlife: '🌃',
  culture: '🎭',
  nature: '🌿',
  relaxation: '🧘',
  other: '📌',
};

function createCustomIcon(category, index) {
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
  const emoji = CATEGORY_ICONS[category] || '📌';
  
  return L.divIcon({
    html: `
      <div style="
        width: 36px; height: 36px;
        background: ${color};
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
      ">
        <span style="
          transform: rotate(45deg);
          font-size: 16px;
          line-height: 1;
        ">${emoji}</span>
      </div>
      <div style="
        position: absolute;
        top: -6px; left: -6px;
        width: 20px; height: 20px;
        background: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 700;
        color: ${color};
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      ">${index + 1}</div>
    `,
    className: 'wf-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36],
  });
}

export default function TripMap({
  activities = [],
  center = [48.8566, 2.3522], // Default: Paris
  zoom = 13,
  height = '400px',
  showRoute = true,
  onActivityClick,
  selectedActivityId,
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const routeRef = useRef(null);
  const [routeLoading, setRouteLoading] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView(center, zoom);

    // Add zoom control to bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Beautiful dark-style tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    const validActivities = activities.filter(a => a.latitude && a.longitude);

    if (validActivities.length === 0) return;

    // Add markers
    validActivities.forEach((activity, idx) => {
      const icon = createCustomIcon(activity.category, idx);
      const marker = L.marker([activity.latitude, activity.longitude], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="min-width: 180px; font-family: system-ui;">
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px;">${activity.title}</div>
            ${activity.location_name ? `<div style="font-size: 12px; color: #666; margin-bottom: 4px;">📍 ${activity.location_name}</div>` : ''}
            ${activity.start_time ? `<div style="font-size: 12px; color: #666;">🕐 ${activity.start_time.slice(0, 5)}${activity.end_time ? ` – ${activity.end_time.slice(0, 5)}` : ''}</div>` : ''}
            ${parseFloat(activity.cost) > 0 ? `<div style="font-size: 12px; color: #666;">💰 ${parseFloat(activity.cost).toFixed(0)}</div>` : ''}
          </div>
        `);

      if (onActivityClick) {
        marker.on('click', () => onActivityClick(activity));
      }

      if (selectedActivityId === activity.id) {
        marker.openPopup();
      }

      markersRef.current.push(marker);
    });

    // Fit bounds
    if (validActivities.length > 0) {
      const bounds = L.latLngBounds(validActivities.map(a => [a.latitude, a.longitude]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [activities, selectedActivityId]);

  // Draw route
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !showRoute) return;

    // Clear old route
    if (routeRef.current) {
      map.removeLayer(routeRef.current);
      routeRef.current = null;
    }

    const validActivities = activities.filter(a => a.latitude && a.longitude);
    if (validActivities.length < 2) return;

    const fetchRoute = async () => {
      setRouteLoading(true);
      try {
        const coords = validActivities.map(a => [a.longitude, a.latitude]);
        const orsKey = process.env.NEXT_PUBLIC_ORS_API_KEY;

        if (orsKey) {
          // Use OpenRouteService for real routing
          const response = await fetch(
            'https://api.openrouteservice.org/v2/directions/foot-walking/geojson',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: orsKey,
              },
              body: JSON.stringify({ coordinates: coords }),
            }
          );

          if (response.ok) {
            const data = await response.json();
            if (data.features?.[0]) {
              routeRef.current = L.geoJSON(data.features[0], {
                style: {
                  color: '#E8B87D',
                  weight: 4,
                  opacity: 0.8,
                  dashArray: '8, 8',
                },
              }).addTo(map);
              setRouteLoading(false);
              return;
            }
          }
        }

        // Fallback: draw simple polyline
        const latlngs = validActivities.map(a => [a.latitude, a.longitude]);
        routeRef.current = L.polyline(latlngs, {
          color: '#E8B87D',
          weight: 3,
          opacity: 0.7,
          dashArray: '10, 10',
        }).addTo(map);
      } catch (err) {
        // Fallback to simple line
        const latlngs = validActivities.map(a => [a.latitude, a.longitude]);
        routeRef.current = L.polyline(latlngs, {
          color: '#E8B87D',
          weight: 3,
          opacity: 0.7,
          dashArray: '10, 10',
        }).addTo(map);
      } finally {
        setRouteLoading(false);
      }
    };

    fetchRoute();
  }, [activities, showRoute]);

  return (
    <>
      <div className="trip-map-container" style={{ height }}>
        <div ref={mapRef} className="trip-map" />
        {routeLoading && (
          <div className="trip-map__loading">
            <span>🗺️ Calculating route...</span>
          </div>
        )}
        {activities.filter(a => a.latitude && a.longitude).length === 0 && (
          <div className="trip-map__empty">
            <span className="trip-map__empty-icon">📍</span>
            <p>No locations added yet</p>
            <p className="trip-map__empty-hint">Activities with coordinates will appear here</p>
          </div>
        )}
      </div>

      <style jsx>{`
        .trip-map-container {
          position: relative;
          border-radius: var(--radius-xl);
          overflow: hidden;
          border: 1px solid var(--color-border-light);
        }

        .trip-map {
          width: 100%;
          height: 100%;
          z-index: 1;
        }

        .trip-map__loading {
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--color-surface);
          padding: 6px 16px;
          border-radius: var(--radius-full);
          font-size: var(--text-sm);
          box-shadow: var(--shadow-md);
          z-index: 2;
          color: var(--color-text-secondary);
        }

        .trip-map__empty {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: var(--color-bg-secondary);
          z-index: 2;
        }

        .trip-map__empty-icon {
          font-size: 48px;
          margin-bottom: 8px;
          opacity: 0.5;
        }

        .trip-map__empty p {
          font-size: var(--text-sm);
          color: var(--color-text-tertiary);
        }

        .trip-map__empty-hint {
          font-size: var(--text-xs) !important;
          margin-top: 4px;
        }
      `}</style>

      <style jsx global>{`
        .wf-marker {
          background: none !important;
          border: none !important;
        }

        .leaflet-popup-content-wrapper {
          border-radius: 12px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important;
        }

        .leaflet-popup-tip {
          box-shadow: 0 4px 20px rgba(0,0,0,0.1) !important;
        }
      `}</style>
    </>
  );
}
