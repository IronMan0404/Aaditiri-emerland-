'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import AuthShell from '@/components/layout/AuthShell';
import { Eye, EyeOff } from 'lucide-react';
import { normalizePhoneE164 } from '@/lib/phone';

// Pulls ?error= / ?error_description= off the URL and shows a toast. Lives
// in its own component so we can wrap it in <Suspense> — Next.js 16 requires
// any useSearchParams() consumer to be inside a Suspense boundary or the
// build fails ("useSearchParams() should be wrapped in a suspense boundary").
function LoginErrorToast() {
  const searchParams = useSearchParams();
  useEffect(() => {
    const error = searchParams.get('error_description') ?? searchParams.get('error');
    if (!error) return;
    const message =
      error === 'missing_code'
        ? 'That reset link is missing its verification code. Please request a new one.'
        : decodeURIComponent(error);
    toast.error(message, { duration: 6000 });
  }, [searchParams]);
  return null;
}

/**
 * Lightweight client-side validation: does the input look like an email or
 * a phone number? We don't try to definitively classify here — the server's
 * /api/auth/resolve-identifier endpoint is the authoritative source. This
 * just catches obviously-empty / obviously-malformed input before we even
 * make a network call.
 *
 * Returns a friendly hint when invalid so the user knows WHY it was rejected
 * — the previous generic "Enter a valid email or phone number" toast was
 * unhelpful for someone typing a 9-digit number or forgetting the country
 * code.
 */
function classifyInput(input: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'Enter your email or phone number' };
  if (trimmed.includes('@')) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { ok: true };
    return { ok: false, reason: 'That email address looks incomplete' };
  }
  if (normalizePhoneE164(trimmed)) return { ok: true };
  // Phone-shaped but not parseable. Try to give a helpful hint.
  const digits = trimmed.replace(/[^0-9+]/g, '');
  const digitCount = digits.replace('+', '').length;
  if (digitCount === 0) {
    return { ok: false, reason: 'Enter a valid email or phone number' };
  }
  if (digitCount < 10) {
    return { ok: false, reason: `Phone number is too short (${digitCount} digits) — Indian numbers need 10 digits` };
  }
  if (digitCount > 15) {
    return { ok: false, reason: 'Phone number is too long' };
  }
  return { ok: false, reason: 'Phone number format not recognised — try +91 followed by 10 digits' };
}

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier || !password) {
      toast.error('Please fill in all fields');
      return;
    }
    const check = classifyInput(identifier);
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }

    setLoading(true);

    // Resolve the identifier server-side. For email it just echoes back; for
    // a phone number it looks up the matching profiles row and returns the
    // email on file. We always sign in with email + password so the
    // Supabase Phone provider does NOT need to be enabled.
    let resolvedEmail: string;
    try {
      const res = await fetch('/api/auth/resolve-identifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data: { email?: string; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !data.email) {
        // Generic message so we don't leak whether the identifier exists.
        toast.error(data.error || 'Invalid login credentials');
        setLoading(false);
        return;
      }
      resolvedEmail = data.email;
    } catch {
      toast.error('Network error. Please try again.');
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: resolvedEmail,
      password,
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    router.push('/dashboard');
  }

  return (
    <AuthShell>
      <Suspense fallback={null}>
        <LoginErrorToast />
      </Suspense>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-white/25 backdrop-blur-sm flex items-center justify-center text-white font-bold text-3xl mx-auto mb-4 shadow-lg border border-white/30">AE</div>
          <h1 className="text-2xl font-bold text-white drop-shadow-sm">Aaditri Emerland</h1>
          <p className="text-white/85 text-sm mt-1 drop-shadow-sm">Community App</p>
        </div>

        <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl">
          <h2 className="text-xl font-bold text-gray-900 mb-5">Welcome back</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              label="Email or phone number"
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@example.com  or  +91 98765 43210"
              autoComplete="username"
            />
            <div className="relative">
              <Input label="Password" type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
              <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-8 text-gray-400 hover:text-gray-600">
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="flex items-center justify-between -mt-2 gap-3">
              <span className="text-[11px] text-gray-500 leading-tight">
                Tip: pair Telegram in your profile to get reset codes instantly.
              </span>
              <Link
                href="/auth/forgot-password"
                className="text-xs text-[#1B5E20] font-semibold hover:underline whitespace-nowrap"
              >
                Forgot password?
              </Link>
            </div>
            <Button type="submit" loading={loading} className="w-full">Sign In</Button>
          </form>

          <div className="mt-4 text-center space-y-2">
            <p className="text-sm text-gray-600">Don&apos;t have an account?{' '}
              <Link href="/auth/register" className="text-[#1B5E20] font-semibold hover:underline">Register</Link>
            </p>
            <Link href="/auth/admin-login" className="text-xs text-gray-400 hover:text-gray-600 underline">Admin Login</Link>
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
