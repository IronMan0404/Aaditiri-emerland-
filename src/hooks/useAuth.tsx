'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase';
import type { Profile } from '@/types';
import type { Session } from '@supabase/supabase-js';

// Shared auth state. Previously every component that imported `useAuth()`
// was creating its OWN supabase client, calling getSession(), fetching
// the profile from the DB, and registering an auth-state-change listener.
// On the dashboard the layout alone has 5-7 useAuth consumers (Sidebar,
// MobileNav, MoreSheet, TopBar, PushSubscriber, InstallPrompt, plus the
// page itself), so each navigation was firing 5-7 redundant Supabase
// requests. We now lift that work into a single AuthProvider mounted at
// the dashboard layout and broadcast state to consumers via context.

interface AuthValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  mounted: boolean;
  refetchProfile: () => void;
  // Unread inbox-message count, refreshed every 60s. Lives here so the
  // Sidebar / MobileNav / MoreSheet badges all share one query instead
  // of each running their own setInterval.
  unreadMessages: number;
  refreshUnread: () => void;
}

const defaultValue: AuthValue = {
  session: null,
  profile: null,
  loading: true,
  isAdmin: false,
  mounted: false,
  refetchProfile: () => {},
  unreadMessages: 0,
  refreshUnread: () => {},
};

const AuthContext = createContext<AuthValue>(defaultValue);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const supabase = useMemo(() => createClient(), []);

  const fetchProfile = useCallback(
    async (userId: string) => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      setProfile(data);
      setLoading(false);
    },
    [supabase]
  );

  useEffect(() => {
    setMounted(true);
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) fetchProfile(nextSession.user.id);
      else { setProfile(null); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, supabase]);

  const refetchProfile = useCallback(() => {
    if (session) fetchProfile(session.user.id);
  }, [session, fetchProfile]);

  // Unread messages: one shared poll instead of one per badge consumer.
  // 60s cadence is plenty — admins don't expect realtime delivery on
  // free-tier hosting and the count is recomputed on route change too.
  // We include `profile` (not `profile?.id`) in the deps so React
  // Compiler can preserve memoization correctly; in practice profile
  // changes only on sign-in / sign-out / refetch, so this is fine.
  const refreshUnread = useCallback(async () => {
    if (!profile) { setUnreadMessages(0); return; }
    const { count } = await supabase
      .from('bot_message_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .is('read_at', null);
    setUnreadMessages(count ?? 0);
  }, [profile, supabase]);

  useEffect(() => {
    if (!profile) return;
    refreshUnread();
    const id = setInterval(refreshUnread, 60_000);
    return () => clearInterval(id);
  }, [profile, refreshUnread]);

  const value = useMemo<AuthValue>(() => ({
    session,
    profile,
    loading,
    isAdmin: mounted && profile?.role === 'admin',
    mounted,
    refetchProfile,
    unreadMessages,
    refreshUnread,
  }), [session, profile, loading, mounted, refetchProfile, unreadMessages, refreshUnread]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook signature is unchanged so existing consumers keep working without
// edits. If a consumer is rendered outside an AuthProvider it'll receive
// the default (logged-out, mounted=false) value rather than crashing —
// matches the old behaviour during SSR.
export function useAuth(): AuthValue {
  return useContext(AuthContext);
}
