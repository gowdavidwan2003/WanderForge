'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Hook for real-time trip collaboration
 * Subscribes to changes on trips, trip_days, and activities
 */
export function useRealtimeTrip(tripId, onUpdate, dayIds = []) {
  const [presenceState, setPresenceState] = useState({});
  const [channel, setChannel] = useState(null);
  const supabase = getSupabaseBrowserClient();

  // Stable id for this browser tab, so each client gets its own presence key.
  // Generated inside the effect below — randomness during render is impure.
  const presenceKeyRef = useRef(null);

  // Join by value so the effect re-subscribes when the trip's days finish loading.
  const dayIdKey = dayIds.join(',');

  useEffect(() => {
    if (!tripId) return;

    if (!presenceKeyRef.current) {
      presenceKeyRef.current =
        globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    }

    const currentDayIds = dayIdKey ? dayIdKey.split(',') : [];

    const tripChannel = supabase.channel(`trip:${tripId}`, {
      config: {
        // Presence must be keyed per user. Keying by tripId put every client under
        // the same key, so each join/leave overwrote everyone else's entry.
        presence: { key: `${tripId}:${presenceKeyRef.current}` },
        broadcast: { self: false },
      },
    });

    // Realtime filters only support comparisons against literal values — the old
    // `in.(select ...)` subquery was never valid, so activity changes never arrived.
    // Subscribe unfiltered (RLS still limits what we receive) and match locally.
    tripChannel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activities' },
        (payload) => {
          const row = payload.new || payload.old;
          if (!row) return;
          if (currentDayIds.length && !currentDayIds.includes(row.trip_day_id)) return;
          onUpdate?.('activities', payload.eventType, row);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trip_days',
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          onUpdate?.('trip_days', payload.eventType, payload.new || payload.old);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trips',
          filter: `id=eq.${tripId}`,
        },
        (payload) => {
          onUpdate?.('trips', 'UPDATE', payload.new);
        }
      )
      // Presence tracking
      .on('presence', { event: 'sync' }, () => {
        const state = tripChannel.presenceState();
        setPresenceState(state);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        setPresenceState((prev) => ({ ...prev, [key]: newPresences }));
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        setPresenceState((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      })
      // Broadcast for cursor/selection
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        // Handle cursor position broadcasts from other users
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track presence
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await tripChannel.track({
              user_id: user.id,
              display_name: user.user_metadata?.display_name || user.email?.split('@')[0],
              email: user.email,
              online_at: new Date().toISOString(),
            });
          }
        }
      });

    setChannel(tripChannel);

    return () => {
      supabase.removeChannel(tripChannel);
    };
  }, [tripId, dayIdKey]);

  const broadcastCursor = useCallback(
    (data) => {
      channel?.send({
        type: 'broadcast',
        event: 'cursor',
        payload: data,
      });
    },
    [channel]
  );

  // Get unique online users
  const onlineUsers = Object.values(presenceState)
    .flat()
    .reduce((acc, presence) => {
      if (!acc.find((u) => u.user_id === presence.user_id)) {
        acc.push(presence);
      }
      return acc;
    }, []);

  return {
    onlineUsers,
    broadcastCursor,
    channel,
  };
}
