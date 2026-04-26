'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import AuthShell from '@/components/layout/AuthShell';
import VehiclesEditor, { type VehicleDraft } from '@/components/ui/VehiclesEditor';
import FamilyEditor, { type FamilyMemberDraft } from '@/components/ui/FamilyEditor';
import PetsEditor, { type PetDraft } from '@/components/ui/PetsEditor';
import { normalizePhoneE164 } from '@/lib/phone';
import { createClient } from '@/lib/supabase';

export default function RegisterPage() {
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', flatNumber: '',
    residentType: '' as '' | 'owner' | 'tenant',
    password: '', confirmPassword: '',
  });
  const [vehicles, setVehicles] = useState<VehicleDraft[]>([]);
  const [family, setFamily] = useState<FamilyMemberDraft[]>([]);
  const [pets, setPets] = useState<PetDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [emailDelivered, setEmailDelivered] = useState(true);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const router = useRouter();

  function update(key: string, value: string) { setForm((f) => ({ ...f, [key]: value })); }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();

    const email = form.email.trim();
    const phoneRaw = form.phone.trim();
    const phoneNormalized = phoneRaw ? normalizePhoneE164(phoneRaw) : null;

    if (!form.fullName || !form.flatNumber) {
      toast.error('Please fill in your name and flat number'); return;
    }
    if (!email && !phoneRaw) {
      toast.error('Please provide either an email or a phone number'); return;
    }
    if (phoneRaw && !phoneNormalized) {
      toast.error('Enter a valid phone number'); return;
    }
    if (!form.residentType) {
      toast.error('Please select Owner or Tenant'); return;
    }
    if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }

    setLoading(true);

    let res: Response;
    try {
      res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email || undefined,
          phone: phoneNormalized || undefined,
          password: form.password,
          full_name: form.fullName,
          flat_number: form.flatNumber,
          resident_type: form.residentType,
          vehicles: vehicles.map((v) => ({ number: v.number, type: v.type })),
          family: family.map((m) => ({
            full_name: m.full_name,
            relation: m.relation,
            gender: m.gender ?? null,
            age: m.age ?? null,
            phone: m.phone ?? null,
          })),
          pets: pets.map((p) => ({
            name: p.name,
            species: p.species,
            vaccinated: p.vaccinated,
          })),
        }),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
      setLoading(false);
      return;
    }

    const payload = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      warnings?: string[];
      email_status?: 'sent' | 'skipped' | 'failed';
    };

    if (!res.ok || !payload.ok) {
      toast.error(payload.error || `Registration failed (${res.status})`);
      setLoading(false);
      return;
    }

    if (payload.warnings && payload.warnings.length > 0) {
      toast(`Account created. Some details didn't save: ${payload.warnings.join(', ')}`, {
        icon: '⚠️',
      });
    }

    // Email status only matters when the user actually provided an email.
    setEmailDelivered(email ? payload.email_status === 'sent' : true);
    setSubmittedEmail(email);
    setSubmitted(true);
    setLoading(false);

    // Auto-sign-in the freshly registered (unapproved) user so they can
    // pair Telegram from /auth/pending while waiting for admin approval.
    // Best-effort: if it fails (e.g. transient network blip, or the
    // resolver fallback doesn't find the phone), we just leave the
    // user on the success screen with the "Go to Login" CTA. The
    // pairing-while-waiting flow is a nice-to-have, not the critical
    // path.
    try {
      const supabase = createClient();
      let signInEmail = email;
      // Phone-only signup: hit the email resolver to get the
      // synthetic email Supabase stores against this phone number.
      if (!signInEmail && phoneNormalized) {
        const r = await fetch('/api/auth/resolve-identifier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: phoneNormalized }),
        });
        if (r.ok) {
          const j = (await r.json().catch(() => ({}))) as { email?: string };
          if (j.email) signInEmail = j.email;
        }
      }
      if (signInEmail) {
        await supabase.auth.signInWithPassword({
          email: signInEmail,
          password: form.password,
        });
      }
    } catch {
      // Silent — we already showed the user the success screen,
      // and they can sign in manually from /auth/login.
    }
  }

  if (submitted) {
    return (
      <AuthShell>
        <div className="w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-2xl p-7 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">⏳</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Registration Submitted!</h2>
          <p className="text-gray-500 text-sm mb-2">
            Your account is <strong>pending admin approval</strong>. You&apos;ll be
            able to sign in once an admin reviews your registration.
          </p>
          {submittedEmail ? (
            emailDelivered ? (
              <p className="text-gray-500 text-xs mb-4">
                We&apos;ve sent a confirmation email to <strong>{submittedEmail}</strong>.
                Don&apos;t see it? Check your spam folder.
              </p>
            ) : (
              <p className="text-amber-600 text-xs mb-4">
                We couldn&apos;t send a confirmation email this time, but your
                account was still created. Please reach out to an admin if you
                need help.
              </p>
            )
          ) : (
            <p className="text-gray-500 text-xs mb-4">
              We&apos;ll let you know via the contact details you registered with
              once an admin approves your account.
            </p>
          )}
          {/*
           * Bridge to the pending page so the resident can pair Telegram
           * while the admin is reviewing them. We auto-signed-them-in
           * after the registration POST, so this routes straight into
           * the pending shell with the TelegramConnect widget. If the
           * auto-sign-in failed (e.g. they registered phone-only and
           * the resolver call hit a network blip), they'll just be
           * bounced back to /auth/login by the proxy — same as the
           * old "Go to Login" outcome.
           */}
          <div className="bg-[#F5F8FF] border border-[#26A5E4]/30 rounded-xl p-3 mb-4 text-left">
            <p className="text-xs font-semibold text-[#26A5E4] uppercase tracking-wider mb-1">
              Tip · Optional
            </p>
            <p className="text-xs text-gray-600 leading-snug">
              Connect Telegram next so you get the approval push the second an
              admin clicks Approve, and password resets work instantly.
            </p>
          </div>
          <Button onClick={() => router.push('/auth/pending')} className="w-full mb-2">
            Continue
          </Button>
          <button
            type="button"
            onClick={() => router.push('/auth/login')}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Skip — go to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-white/25 backdrop-blur-sm flex items-center justify-center text-white font-bold text-2xl mx-auto mb-3 border border-white/30 shadow-lg">AE</div>
          <h1 className="text-xl font-bold text-white drop-shadow-sm">Join Aaditri Emerland</h1>
        </div>
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Create Account</h2>
          <p className="text-xs text-gray-500 mb-5 leading-relaxed">
            Provide either an email or a phone number — you can add the other later from your profile.
          </p>
          <form onSubmit={handleRegister} className="space-y-3">
            <Input label="Full Name *" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} placeholder="John Smith" />
            <Input label="Flat Number *" value={form.flatNumber} onChange={(e) => update('flatNumber', e.target.value)} placeholder="A-101" />

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">Resident Type *</label>
              <div className="grid grid-cols-2 gap-2">
                {(['owner', 'tenant'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => update('residentType', type)}
                    className={`py-2.5 rounded-xl text-sm font-semibold border transition-all capitalize ${form.residentType === type ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20]'}`}
                  >
                    {type === 'owner' ? '🏠 Owner' : '🔑 Tenant'}
                  </button>
                ))}
              </div>
              {!form.residentType && (
                <p className="text-[11px] text-gray-400 mt-1">Select one to continue</p>
              )}
            </div>

            <Input label="Email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="you@example.com" />
            <Input label="Phone Number" type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="+91 98765 43210" />
            <p className="text-[11px] text-gray-500 -mt-1.5 leading-relaxed">
              At least one of email or phone is required. Indian numbers are auto-prefixed +91.
            </p>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Vehicles (optional)</label>
              <VehiclesEditor vehicles={vehicles} onChange={setVehicles} />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Family Members (optional)</label>
              <FamilyEditor members={family} onChange={setFamily} />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Pets (optional)</label>
              <PetsEditor pets={pets} onChange={setPets} />
            </div>

            <Input label="Password *" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} placeholder="Min. 6 characters" />
            <Input label="Confirm Password *" type="password" value={form.confirmPassword} onChange={(e) => update('confirmPassword', e.target.value)} placeholder="Repeat password" />
            <Button type="submit" loading={loading} className="w-full">Create Account</Button>
          </form>
          <p className="text-sm text-gray-600 text-center mt-4">Already have an account?{' '}
            <Link href="/auth/login" className="text-[#1B5E20] font-semibold hover:underline">Sign In</Link>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}
