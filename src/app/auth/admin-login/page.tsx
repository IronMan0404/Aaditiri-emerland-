'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import AuthShell from '@/components/layout/AuthShell';
import { Shield } from 'lucide-react';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) { toast.error('Please fill in all fields'); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { toast.error(error.message); setLoading(false); return; }
    if (data.user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
      if (profile?.role !== 'admin') {
        await supabase.auth.signOut();
        toast.error('Access denied. Admin privileges required.');
        setLoading(false);
        return;
      }
      router.push('/admin');
    }
    setLoading(false);
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-white/25 backdrop-blur-sm flex items-center justify-center mx-auto mb-4 border border-white/30 shadow-lg">
            <Shield size={40} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white drop-shadow-sm">Admin Portal</h1>
          <p className="text-white/85 text-sm mt-1 drop-shadow-sm">Aaditri Emerland Management</p>
        </div>

        <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl">
          <h2 className="text-xl font-bold text-gray-900 mb-5">Admin Sign In</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <Input label="Admin Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
            <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            <Button type="submit" loading={loading} className="w-full bg-[#0A3D02] hover:bg-[#1B5E20]">Admin Sign In</Button>
          </form>
          <Link href="/auth/login" className="block text-center text-sm text-gray-500 hover:text-gray-700 mt-4 underline">Back to User Login</Link>
        </div>
      </div>
    </AuthShell>
  );
}
