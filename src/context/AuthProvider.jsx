'use client';

import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/withTimeout';
import { getAuthCallbackUrl } from '@/lib/siteUrl';

const AuthContext = createContext(undefined);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseBrowserClient();

  // Which user we've already loaded a profile for, so a token refresh for the
  // same user doesn't trigger a redundant profile fetch.
  const userIdRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const getSession = async () => {
      try {
        // Without a deadline a stalled token refresh leaves `user` null forever,
        // and every page gated on it spins with no way to recover.
        const { data } = await withTimeout(
          supabase.auth.getUser(),
          'Loading your session'
        );
        if (cancelled) return;

        setUser(data?.user ?? null);
        userIdRef.current = data?.user?.id ?? null;
        if (data?.user) await fetchProfile(data.user.id);
      } catch (err) {
        // A stalled or rejected session resolves as signed-out rather than
        // leaving the app in a permanent loading state.
        console.error('[WanderForge] Session load failed:', err);
        if (!cancelled) {
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (cancelled) return;

        // A failed refresh is terminal for this session — drop it so the user is
        // sent to login instead of being left with a client that can never query.
        if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        const nextUser = session?.user ?? null;

        // Supabase emits TOKEN_REFRESHED on every refresh with a fresh user
        // object. Replacing state each time changed the object identity, which
        // invalidated every consumer's useCallback/useEffect and made the whole
        // app refetch on the refresh cycle — right when queries are queued behind
        // that refresh, so they stalled. Only update when the identity changes.
        setUser((prev) => (prev?.id === nextUser?.id ? prev : nextUser));

        if (nextUser) {
          if (userIdRef.current !== nextUser.id) await fetchProfile(nextUser.id);
        } else {
          setProfile(null);
        }
        userIdRef.current = nextUser?.id ?? null;
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (userId) => {
    // Explicit columns, not '*': migration 007 revokes SELECT on profiles.email
    // from client roles, and Postgres rejects SELECT * unless the role can read
    // every column. The signed-in user's own address is on `user.email` anyway.
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, bio, countries_visited, trips_count, badges, theme_preference, created_at, updated_at')
      .eq('id', userId)
      .single();
    setProfile(data);
  };

  const signUp = async (email, password, displayName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: getAuthCallbackUrl(),
      },
    });

    // Supabase never reveals that an email is taken, so signing up with an
    // already-confirmed address succeeds silently and sends no email. It signals
    // this by returning a user with an empty identities array. Without this check
    // the UI advances to the OTP screen and waits for a code that was never sent.
    if (!error && data?.user && data.user.identities?.length === 0) {
      return {
        data: null,
        error: {
          code: 'user_already_exists',
          message: 'An account with this email already exists. Try logging in instead.',
        },
      };
    }

    return { data, error };
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  const value = {
    user,
    profile,
    loading,
    signUp,
    signIn,
    signOut,
    refreshProfile: () => user && fetchProfile(user.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  // Return safe defaults during SSR/static generation
  if (context === undefined) {
    return {
      user: null,
      profile: null,
      loading: true,
      signUp: async () => ({ data: null, error: null }),
      signIn: async () => ({ data: null, error: null }),
      signOut: async () => {},
      refreshProfile: () => {},
    };
  }
  return context;
}
