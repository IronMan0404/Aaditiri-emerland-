'use client';
import { Menu, Bell } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function TopBar({ title }: { title?: string }) {
  const { profile } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  return (
    <header className="md:hidden sticky top-0 z-30 bg-[#1B5E20] text-white px-4 py-3 flex items-center justify-between safe-top">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-sm">AE</div>
        <span className="font-semibold text-sm">{title || 'Aaditri Emerland'}</span>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/dashboard/profile" className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold" suppressHydrationWarning>
          {(profile?.full_name || 'U').substring(0, 2).toUpperCase()}
        </Link>
      </div>
    </header>
  );
}
