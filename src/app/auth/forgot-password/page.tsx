'use client';
import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import AuthShell from '@/components/layout/AuthShell';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Please enter your email');
      return;
    }

    // The recovery email link must come back through /auth/callback so the
    // PKCE code is exchanged for a session cookie before we land on the
    // reset-password page. The target origin must also be listed under
    // Authentication -> URL Configuration -> Redirect URLs in Supabase.
    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback?next=/auth/reset-password`
        : undefined;

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell>
        <div className="w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✉️</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Check your email</h2>
          <p className="text-gray-600 text-sm mb-2">
            If an account exists for <strong>{email}</strong>, we&apos;ve sent a
            password reset link to it.
          </p>
          <p className="text-gray-500 text-xs mb-6">
            The link is valid for a limited time. Don&apos;t see it? Check your
            spam folder.
          </p>
          <Link href="/auth/login" className="block">
            <Button variant="secondary" className="w-full">
              Back to Sign In
            </Button>
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
            Forgot Password
          </h1>
          <p className="text-white/85 text-sm mt-1 drop-shadow-sm">
            We&apos;ll email you a reset link
          </p>
        </div>

        <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Reset your password
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            Enter the email address you used to register and we&apos;ll send you
            a link to set a new password.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
            <Button type="submit" loading={loading} className="w-full">
              Send Reset Link
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link
              href="/auth/login"
              className="text-sm text-[#1B5E20] font-semibold hover:underline"
            >
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
