'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import AuthShell from '@/components/layout/AuthShell';
import VehiclesEditor, { type VehicleDraft } from '@/components/ui/VehiclesEditor';

export default function RegisterPage() {
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', flatNumber: '',
    residentType: '' as '' | 'owner' | 'tenant',
    password: '', confirmPassword: '',
  });
  const [vehicles, setVehicles] = useState<VehicleDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  function update(key: string, value: string) { setForm((f) => ({ ...f, [key]: value })); }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName || !form.email || !form.password || !form.flatNumber) {
      toast.error('Please fill in all required fields'); return;
    }
    if (!form.residentType) {
      toast.error('Please select Owner or Tenant'); return;
    }
    if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: {
          full_name: form.fullName,
          flat_number: form.flatNumber,
          resident_type: form.residentType,
        },
      },
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email: form.email.trim(),
        full_name: form.fullName,
        phone: form.phone,
        flat_number: form.flatNumber,
        resident_type: form.residentType,
        role: 'user',
        is_approved: false,
      });
      // Persist any vehicles the user added in the form. Failures here are
      // non-fatal — the account exists and the resident can add vehicles
      // later from their profile page.
      if (vehicles.length > 0) {
        const rows = vehicles.map((v) => ({ user_id: data.user!.id, number: v.number, type: v.type }));
        const { error: vehiclesError } = await supabase.from('vehicles').insert(rows);
        if (vehiclesError) {
          toast.error(`Account created, but couldn't save vehicles: ${vehiclesError.message}`);
        }
      }
      setSubmitted(true);
    }
    setLoading(false);
  }

  if (submitted) {
    return (
      <AuthShell>
        <div className="w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">⏳</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Registration Submitted!</h2>
          <p className="text-gray-600 text-sm mb-2">
            Check your email to verify your address.
          </p>
          <p className="text-gray-500 text-sm mb-6">
            Your account is <strong>pending admin approval</strong>. You&apos;ll be able to sign in once an admin reviews your registration.
          </p>
          <Button onClick={() => router.push('/auth/login')} className="w-full">Go to Login</Button>
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
          <h2 className="text-xl font-bold text-gray-900 mb-5">Create Account</h2>
          <form onSubmit={handleRegister} className="space-y-3">
            <Input label="Full Name *" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} placeholder="John Smith" />
            <Input label="Flat Number *" value={form.flatNumber} onChange={(e) => update('flatNumber', e.target.value)} placeholder="A-101" />

            {/* Resident Type */}
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

            <Input label="Email *" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="you@example.com" />
            <Input label="Phone Number" type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} placeholder="+91 98765 43210" />

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Vehicles (optional)</label>
              <VehiclesEditor vehicles={vehicles} onChange={setVehicles} />
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
