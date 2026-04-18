'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import AuthShell from '@/components/layout/AuthShell';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) { toast.error('Please fill in all fields'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    router.push('/dashboard');
  }

  return (
    <AuthShell>
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
            <Input label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            <div className="relative">
              <Input label="Password" type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
              <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-8 text-gray-400 hover:text-gray-600">
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <div className="text-right -mt-2">
              <Link href="/auth/forgot-password" className="text-xs text-[#1B5E20] font-semibold hover:underline">
                Forgot password?
              </Link>
            </div>
            <Button type="submit" loading={loading} className="w-full">Sign In</Button>
          </form>

          <div className="mt-4 text-center space-y-2">
            <p className="text-sm text-gray-600">Don't have an account?{' '}
              <Link href="/auth/register" className="text-[#1B5E20] font-semibold hover:underline">Register</Link>
            </p>
            <Link href="/auth/admin-login" className="text-xs text-gray-400 hover:text-gray-600 underline">Admin Login</Link>
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
