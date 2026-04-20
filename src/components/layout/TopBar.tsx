'use client';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

export default function TopBar({ title }: { title?: string }) {
  const { profile } = useAuth();

  return (
    <header className="md:hidden sticky top-0 z-30 bg-[#1B5E20] text-white px-4 py-3 flex items-center justify-between gap-2 safe-top">
      {/* `min-w-0` lets the inner span actually `truncate` instead of forcing
          the header to grow past the viewport on long titles. */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-sm shrink-0">AE</div>
        <span className="font-semibold text-sm truncate">{title || 'Aaditri Emerland'}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link href="/dashboard/profile" className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold" suppressHydrationWarning>
          {(profile?.full_name || 'U').substring(0, 2).toUpperCase()}
        </Link>
      </div>
    </header>
  );
}
