'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import AuthShell from '@/components/layout/AuthShell';

export default function ResetPasswordPage() {
  const router = useRouter();
  // Memoise the Supabase client so the bootstrap effect runs exactly once
  // on mount. Without this, createClient() returns a fresh object every
  // render, the `[supabase]` dep changes, and the effect re-runs — which
  // would re-attempt the one-time PKCE code exchange and fail on retry.
  const supabase = useMemo(() => createClient(), []);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  // Establishes a recovery session from whichever shape Supabase delivered
  // the email link in:
  //
  // 1. PKCE flow  (default for @supabase/ssr) — link looks like
  //    /auth/reset-password?code=<one-time-code>. We exchange the code for
  //    a session right here in the browser so it works even if the email
  //    template lost the `next=/auth/reset-password` hint and Supabase
  //    sent the user straight to the Site URL.
  //
  // 2. Implicit / hash flow — link looks like
  //    /auth/reset-password#access_token=...&refresh_token=...&type=recovery.
  //    Supabase JS used to pick this up automatically; with newer SSR setups
  //    we have to call setSession() ourselves.
  //
  // 3. Already-have-a-session — the user came through /auth/callback first,
  //    which exchanged the code server-side and set the cookie. In that
  //    case getSession() returns the recovery session straight away.
  //
  // We listen for the PASSWORD_RECOVERY auth event as a fourth fallback —
  // some browsers fire it after the SDK finishes parsing the URL itself.
  useEffect(() => {
    let active = true;

    async function bootstrap() {
      // Check for a PKCE code in the query string first.
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      const queryError = url.searchParams.get('error_description') ?? url.searchParams.get('error');

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (active) {
          // Strip the code from the URL so a refresh doesn't try to reuse it.
          url.searchParams.delete('code');
          window.history.replaceState({}, '', url.pathname + url.search);
          if (error) {
            setHasSession(false);
            setCheckingSession(false);
            return;
          }
          setHasSession(true);
          setCheckingSession(false);
          return;
        }
      }

      // Check for an implicit-flow hash fragment.
      if (window.location.hash.includes('access_token')) {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');
        const type = hash.get('type');
        if (accessToken && refreshToken && type === 'recovery') {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (active) {
            // Clean the hash so it doesn't get reused.
            window.history.replaceState({}, '', window.location.pathname);
            if (error) {
              setHasSession(false);
              setCheckingSession(false);
              return;
            }
            setHasSession(true);
            setCheckingSession(false);
            return;
          }
        }
      }

      // Fall back to whatever session is already on the cookie (the user
      // came through /auth/callback or refreshed the page after a successful
      // exchange above).
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setHasSession(Boolean(data.session));
      setCheckingSession(false);

      if (queryError && !data.session) {
        toast.error(decodeURIComponent(queryError));
      }
    }

    bootstrap();

    // Some Supabase SDK builds parse the URL fragment themselves and fire
    // PASSWORD_RECOVERY shortly after mount. Listen for it so we don't show
    // the "expired" screen prematurely.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setHasSession(true);
        setCheckingSession(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success('Password updated. Please sign in.');
    // Force a fresh login with the new password so the proxy re-reads the
    // profile and routes the user to the correct landing page.
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  if (checkingSession) {
    return (
      <AuthShell>
        <div className="w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-2xl p-8 shadow-2xl text-center">
          <p className="text-gray-600 text-sm">Verifying reset link…</p>
        </div>
      </AuthShell>
    );
  }

  if (!hasSession) {
    return (
      <AuthShell>
        <div className="w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">⚠️</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Reset link expired
          </h2>
          <p className="text-gray-600 text-sm mb-6">
            This password reset link is invalid or has expired. Please request a
            new one.
          </p>
          <Link href="/auth/forgot-password" className="block">
            <Button className="w-full">Request New Link</Button>
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-white/25 backdrop-blur-sm flex items-center justify-center text-white font-bold text-3xl mx-auto mb-4 shadow-lg border border-white/30">
            AE
          </div>
          <h1 className="text-2xl font-bold text-white drop-shadow-sm">
            Set New Password
          </h1>
        </div>

        <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Create a new password
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            Choose a password you haven&apos;t used before. Minimum 6
            characters.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Input
                label="New password"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="absolute right-3 top-8 text-gray-400 hover:text-gray-600"
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <Input
              label="Confirm password"
              type={showPwd ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
              autoComplete="new-password"
            />
            <Button type="submit" loading={loading} className="w-full">
              Update Password
            </Button>
          </form>
        </div>
      </div>
    </AuthShell>
  );
}
