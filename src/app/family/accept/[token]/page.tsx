'use client';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import AuthShell from '@/components/layout/AuthShell';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface InviteInfo {
  invitee_email: string;
  invitee_name: string;
  relation: string;
  flat_number: string;
  inviter_name: string;
}

// Public page: no auth needed. The token in the URL IS the
// authorization. We hand it back to /api/family/accept first to
// fetch the invite metadata, then again with the chosen password to
// finalise the account.
export default function FamilyAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch('/api/family/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const j = await r.json();
      if (cancelled) return;
      if (!r.ok) { setLookupErr(j.error ?? 'Invalid invite'); return; }
      setInfo(j.invitation as InviteInfo);
      setName(j.invitation?.invitee_name ?? '');
    })();
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }

    setSubmitting(true);
    const r = await fetch('/api/family/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        password,
        full_name: name.trim() || undefined,
        phone: phone.trim() || undefined,
      }),
    });
    const j = await r.json();
    if (!r.ok) { setSubmitting(false); toast.error(j.error ?? 'Could not create account'); return; }

    // Sign the new user in immediately so they land on the dashboard
    // without a second password prompt. The auth user is already
    // pre-confirmed (the accept route used email_confirm: true), so
    // signInWithPassword should succeed without further verification.
    const supabase = createClient();
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: info?.invitee_email ?? '',
      password,
    });
    if (signErr) {
      toast.success('Account created! Please sign in.');
      router.push('/auth/login');
      return;
    }
    toast.success(`Welcome, ${name}!`);
    router.push('/dashboard');
  };

  if (lookupErr) {
    return (
      <AuthShell>
        <div className="w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-2xl p-8 shadow-2xl text-center">
          <AlertCircle className="mx-auto text-red-600 mb-3" size={40} />
          <h1 className="text-xl font-bold text-gray-900">Invitation problem</h1>
          <p className="text-sm text-gray-600 mt-2">{lookupErr}</p>
          <Link href="/auth/login" className="mt-4 inline-block text-[#1B5E20] font-semibold text-sm">Go to sign in</Link>
        </div>
      </AuthShell>
    );
  }

  if (!info) {
    return (
      <AuthShell>
        <div className="w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-2xl p-8 shadow-2xl text-center text-gray-500">
          <Loader2 className="animate-spin mx-auto mb-2" />
          Looking up your invitation...
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-2xl p-6 sm:p-8 shadow-2xl">
      <div className="text-center mb-5">
        <CheckCircle2 className="mx-auto text-[#1B5E20] mb-2" size={36} />
        <h1 className="text-xl font-bold text-gray-900">You&apos;re invited</h1>
        <p className="text-sm text-gray-600 mt-1">
          <strong>{info.inviter_name}</strong> from <strong>Flat {info.flat_number}</strong> invited you as their {info.relation.replace('_', ' ')}.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Set a password below — your account will be ready instantly.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Email</label>
          <input
            type="email" value={info.invitee_email} disabled
            aria-label="Email"
            placeholder="Email"
            className="w-full border rounded-xl px-3 py-2 text-sm bg-gray-100 text-gray-700"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Your name</label>
          <Input
            type="text" required value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Priya Sharma"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Phone <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <Input
            type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 ..."
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Password</label>
          <div className="relative">
            <Input
              type={showPwd ? 'text' : 'password'}
              required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
            <button
              type="button" onClick={() => setShowPwd((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              aria-label={showPwd ? 'Hide password' : 'Show password'}
            >
              {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Confirm password</label>
          <Input
            type={showPwd ? 'text' : 'password'}
            required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat password"
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Creating account...' : 'Create account & sign in'}
        </Button>
      </form>

      <p className="text-xs text-gray-500 text-center mt-4">
        Already have an account? <Link href="/auth/login" className="text-[#1B5E20] font-semibold">Sign in</Link>
      </p>
      </div>
    </AuthShell>
  );
}
