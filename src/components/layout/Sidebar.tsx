'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Megaphone, Calendar, Bookmark, Images, Radio, User, Home, Settings, Newspaper, LogOut, Shield } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';

const navItems = [
  { href: '/dashboard', icon: Home, label: 'Home' },
  { href: '/dashboard/announcements', icon: Megaphone, label: 'Announcements' },
  { href: '/dashboard/events', icon: Calendar, label: 'Events' },
  { href: '/dashboard/bookings', icon: Bookmark, label: 'Bookings' },
  { href: '/dashboard/gallery', icon: Images, label: 'Gallery' },
  { href: '/dashboard/broadcasts', icon: Radio, label: 'Broadcasts' },
  { href: '/dashboard/profile', icon: User, label: 'Profile' },
];

const adminItems = [
  { href: '/admin', icon: Shield, label: 'Admin Dashboard' },
  { href: '/admin/users', icon: Settings, label: 'Manage Users' },
  { href: '/admin/updates', icon: Newspaper, label: 'Updates' },
  { href: '/admin/gallery', icon: Images, label: 'Gallery' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { profile, isAdmin } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  return (
    <aside className="hidden md:flex flex-col w-64 bg-[#1B5E20] text-white min-h-screen fixed left-0 top-0 z-40">
      {/* Logo */}
      <div className="p-6 border-b border-white/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center font-bold text-lg">AE</div>
          <div>
            <div className="font-bold text-base leading-tight">Aaditri</div>
            <div className="text-xs text-white/70">Emerland Community</div>
          </div>
        </div>
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-white/20 bg-white/10">
        <p className="text-sm font-semibold truncate" suppressHydrationWarning>{profile?.full_name}</p>
        <p className="text-xs text-white/70 truncate" suppressHydrationWarning>{profile?.flat_number ? `Flat ${profile.flat_number}` : profile?.email}</p>
        {isAdmin && <span className="mt-1 inline-block text-[10px] font-bold bg-yellow-400 text-[#1B5E20] px-2 py-0.5 rounded-full">ADMIN</span>}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-1">
          {navItems.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link key={href} href={href} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${active ? 'bg-white text-[#1B5E20]' : 'text-white/80 hover:bg-white/15 hover:text-white'}`}>
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </div>

        {isAdmin && (
          <div className="mt-4 pt-4 border-t border-white/20">
            <p className="text-xs text-white/50 uppercase font-semibold px-3 mb-2">Admin</p>
            <div className="space-y-1">
              {adminItems.map(({ href, icon: Icon, label }) => {
                const active = pathname === href || (href !== '/admin' && pathname.startsWith(href));
                return (
                  <Link key={href} href={href} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${active ? 'bg-white text-[#1B5E20]' : 'text-white/80 hover:bg-white/15 hover:text-white'}`}>
                    <Icon size={18} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Sign out */}
      <div className="p-3 border-t border-white/20">
        <button onClick={handleSignOut} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white transition-all">
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
