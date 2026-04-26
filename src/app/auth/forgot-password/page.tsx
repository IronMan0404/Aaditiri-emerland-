'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import AuthShell from '@/components/layout/AuthShell';
import { Mail, Send, ShieldCheck, KeyRound, Eye, EyeOff } from 'lucide-react';
import { normalizePhoneE164 } from '@/lib/phone';

// =============================================================
// Forgot-password flow (email or Telegram OTP).
//
// State machine (kept in `step`):
//   identify  -> user types email/phone -> POST /lookup
//                returns { lookup_id, has_email, has_telegram, ... }
//   pick      -> user chooses channel -> POST /send -> 'await-otp'
//                  - email channel takes them straight to a "check
//                    your inbox" terminal screen ('email-sent')
//                  - telegram channel mints + DMs a 6-digit OTP
//   await-otp -> user types the 6-digit OTP -> POST /verify
//                returns { verify_token } -> 'choose-password'
//   choose-password -> user picks new password -> POST /reset
//                returns { ok: true } -> 'done'
//   done       -> success terminal screen, link back to /auth/login
//   email-sent -> terminal screen for the email channel
//
// Design intent: each transition is gated on a server response so a
// hostile script can't skip steps. The lookup_id is the only piece
// of state we keep across requests, and it's a signed envelope, so
// nobody can fabricate one.
// =============================================================

type Step =
  | 'identify'
  | 'pick'
  | 'await-otp'
  | 'choose-password'
  | 'email-sent'
  | 'done';

interface ChannelInfo {
  has_email: boolean;
  has_telegram: boolean;
  masked_email: string | null;
  masked_telegram: string | null;
}

function classifyInput(input: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'Enter your email or phone number' };
  if (trimmed.includes('@')) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { ok: true };
    return { ok: false, reason: 'That email address looks incomplete' };
  }
  if (normalizePhoneE164(trimmed)) return { ok: true };
  const digits = trimmed.replace(/[^0-9+]/g, '').replace('+', '');
  if (digits.length < 10) {
    return { ok: false, reason: `Phone number is too short (${digits.length} digits)` };
  }
  return { ok: false, reason: 'Phone number format not recognised' };
}

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('identify');
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);

  const [lookupId, setLookupId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelInfo>({
    has_email: false,
    has_telegram: false,
    masked_email: null,
    masked_telegram: null,
  });
  const [chosenChannel, setChosenChannel] = useState<'email' | 'telegram' | null>(null);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);

  const [otp, setOtp] = useState('');
  const [verifyToken, setVerifyToken] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  // Live countdown for the OTP TTL — small UX touch so the resident
  // knows when their code is going to lapse.
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  useEffect(() => {
    if (!otpExpiresAt) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => {
      const ms = Math.max(0, otpExpiresAt - Date.now());
      setSecondsLeft(Math.ceil(ms / 1000));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [otpExpiresAt]);

  // ---------- Step transitions ----------

  async function handleIdentify(e: React.FormEvent) {
    e.preventDefault();
    const check = classifyInput(identifier);
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/forgot-password/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ChannelInfo> & {
        lookup_id?: string | null;
        error?: string;
        notice?: string;
      };
      if (!res.ok) {
        toast.error(data.error || 'Could not check that account.');
        return;
      }
      // No lookup_id => either no such account, or both channels
      // missing. Show the same friendly screen either way to keep
      // the response shape from leaking enumeration info.
      if (!data.lookup_id) {
        toast.success(
          "If an account exists, we've prepared the next step. Try the channels we have on file.",
          { duration: 5000 },
        );
        setStep('pick');
        setLookupId(null);
        setChannels({
          has_email: false,
          has_telegram: false,
          masked_email: null,
          masked_telegram: null,
        });
        return;
      }
      setLookupId(data.lookup_id);
      setChannels({
        has_email: Boolean(data.has_email),
        has_telegram: Boolean(data.has_telegram),
        masked_email: data.masked_email ?? null,
        masked_telegram: data.masked_telegram ?? null,
      });
      setStep('pick');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(channel: 'email' | 'telegram') {
    if (!lookupId) {
      toast.error('Session expired. Start again.');
      setStep('identify');
      return;
    }
    setBusy(true);
    setChosenChannel(channel);
    try {
      const res = await fetch('/api/auth/forgot-password/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookup_id: lookupId, channel }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        channel?: 'email' | 'telegram';
        expires_in_sec?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error || 'Could not send the code.');
        return;
      }
      if (data.channel === 'telegram') {
        const ttl = data.expires_in_sec ?? 600;
        setOtpExpiresAt(Date.now() + ttl * 1000);
        toast.success('Code sent to your Telegram DM.');
        setStep('await-otp');
      } else {
        setStep('email-sent');
      }
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!lookupId) {
      toast.error('Session expired. Start again.');
      setStep('identify');
      return;
    }
    const cleaned = otp.replace(/\D/g, '');
    if (cleaned.length !== 6) {
      toast.error('Enter the 6-digit code from Telegram');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/forgot-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookup_id: lookupId, otp: cleaned }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        verify_token?: string;
        error?: string;
        locked?: boolean;
      };
      if (!res.ok || !data.ok || !data.verify_token) {
        toast.error(data.error || 'Could not verify that code.');
        if (data.locked) {
          // Force them back to the channel picker to request a new code.
          setStep('pick');
        }
        return;
      }
      setVerifyToken(data.verify_token);
      setStep('choose-password');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!lookupId || !verifyToken) {
      toast.error('Session expired. Start again.');
      setStep('identify');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lookup_id: lookupId,
          verify_token: verifyToken,
          new_password: newPassword,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error || 'Could not reset password.');
        return;
      }
      setStep('done');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ---------- Render helpers ----------

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-white/25 backdrop-blur-sm flex items-center justify-center text-white font-bold text-2xl mx-auto mb-3 shadow-lg border border-white/30">
            <KeyRound className="text-white" size={26} />
          </div>
          <h1 className="text-xl font-bold text-white drop-shadow-sm">Reset your password</h1>
          <p className="text-white/85 text-xs mt-1 drop-shadow-sm">
            Get a one-time code by Telegram or email
          </p>
        </div>

        <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl">
          {step === 'identify' && (
            <form onSubmit={handleIdentify} className="space-y-4">
              <p className="text-sm text-gray-600">
                Enter the email or phone number you registered with. We&apos;ll show you which
                channels are available for delivery.
              </p>
              <Input
                label="Email or phone number"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@example.com  or  +91 98765 43210"
                autoComplete="username"
                autoFocus
              />
              <Button type="submit" loading={busy} className="w-full">
                Continue
              </Button>
              <BackLink />
            </form>
          )}

          {step === 'pick' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Choose where we should send your one-time code:
              </p>

              <ChannelButton
                icon={<Send size={18} />}
                title="Telegram"
                subtitle={
                  channels.has_telegram
                    ? `We'll DM ${channels.masked_telegram ?? 'your linked Telegram'}`
                    : 'Not linked to this account'
                }
                disabled={!channels.has_telegram || busy}
                loading={busy && chosenChannel === 'telegram'}
                onClick={() => handleSend('telegram')}
              />
              <ChannelButton
                icon={<Mail size={18} />}
                title="Email"
                subtitle={
                  channels.has_email
                    ? `We'll send a reset link to ${channels.masked_email ?? 'your email'}`
                    : 'No real email is on file'
                }
                disabled={!channels.has_email || busy}
                loading={busy && chosenChannel === 'email'}
                onClick={() => handleSend('email')}
              />

              {!channels.has_email && !channels.has_telegram && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <strong>No reset channels are configured for this account.</strong>{' '}
                  Please contact an admin to recover access.
                </div>
              )}

              <BackLink onClick={() => setStep('identify')} />
            </div>
          )}

          {step === 'await-otp' && (
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-800">
                <strong>Code sent to Telegram.</strong> It arrives in your private DM with the
                bot.{' '}
                {secondsLeft > 0 && (
                  <span className="text-emerald-700">
                    Expires in {Math.floor(secondsLeft / 60)}:
                    {String(secondsLeft % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
              <Input
                label="6-digit code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                autoFocus
              />
              <Button type="submit" loading={busy} className="w-full">
                Verify code
              </Button>
              <button
                type="button"
                onClick={() => setStep('pick')}
                disabled={busy}
                className="text-xs text-gray-500 hover:text-gray-700 underline w-full text-center"
              >
                Didn&apos;t get the code? Try a different channel
              </button>
            </form>
          )}

          {step === 'choose-password' && (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2">
                <ShieldCheck size={16} />
                <span>Code verified. Set a new password to finish.</span>
              </div>
              <div className="relative">
                <Input
                  label="New password"
                  type={showPwd ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  autoFocus
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
                label="Confirm new password"
                type={showPwd ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type the password"
                autoComplete="new-password"
              />
              <Button type="submit" loading={busy} className="w-full">
                Set new password
              </Button>
            </form>
          )}

          {step === 'email-sent' && (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <Mail className="text-emerald-700" size={26} />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Check your email</h2>
              <p className="text-sm text-gray-600">
                We&apos;ve sent a reset link to <strong>{channels.masked_email}</strong>. The link is
                valid for a limited time.
              </p>
              <Link href="/auth/login" className="block">
                <Button variant="secondary" className="w-full">
                  Back to Sign In
                </Button>
              </Link>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                <ShieldCheck className="text-emerald-700" size={28} />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Password updated</h2>
              <p className="text-sm text-gray-600">
                You can now sign in with your new password.
              </p>
              <Link href="/auth/login" className="block">
                <Button className="w-full">Go to Sign In</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

function ChannelButton(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled || props.loading}
      className={`w-full flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left transition
        ${props.disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'bg-white hover:border-[#1B5E20] hover:shadow-sm'}
      `}
    >
      <span
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
          ${props.disabled ? 'bg-gray-100 text-gray-400' : 'bg-[#1B5E20]/10 text-[#1B5E20]'}
        `}
      >
        {props.icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-gray-900">
          {props.title}
          {props.loading ? ' …' : ''}
        </span>
        <span className="block text-xs text-gray-500 truncate">{props.subtitle}</span>
      </span>
    </button>
  );
}

function BackLink(props: { onClick?: () => void }) {
  if (props.onClick) {
    return (
      <button
        type="button"
        onClick={props.onClick}
        className="block w-full text-center text-sm text-[#1B5E20] font-semibold hover:underline mt-2"
      >
        Back
      </button>
    );
  }
  return (
    <Link
      href="/auth/login"
      className="block text-center text-sm text-[#1B5E20] font-semibold hover:underline mt-2"
    >
      Back to Sign In
    </Link>
  );
}
