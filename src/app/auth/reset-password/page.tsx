'use client';
import { useEffect, useState } from 'react';
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
  const supabase = createClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  // The user only reaches this page from the recovery email link, which
  // routes through /auth/callback first to exchange the PKCE code for a
  // session cookie. If they hit this URL directly with no session, send
  // them back to the request-reset page.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setHasSession(Boolean(data.session));
      setCheckingSession(false);
    });
    return () => {
      active = false;
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
          <p className="text-gray-600 text-sm">Loading…</p>
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
