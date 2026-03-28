'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Hook for real-time trip collaboration
 * Subscribes to changes on trips, trip_days, and activities
 */
export function useRealtimeTrip(tripId, onUpdate) {
  const [presenceState, setPresenceState] = useState({});
  const [channel, setChannel] = useState(null);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    if (!tripId) return;

    // Create a channel for this trip
    const tripChannel = supabase.channel(`trip:${tripId}`, {
      config: {
        presence: { key: tripId },
        broadcast: { self: false },
      },
    });

    // Listen for database changes on activities
    tripChannel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'activities',
          filter: `trip_day_id=in.(select id from trip_days where trip_id='${tripId}')`,
        },
        (payload) => {
          onUpdate?.('activities', payload.eventType, payload.new || payload.old);
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
  }, [tripId]);

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
