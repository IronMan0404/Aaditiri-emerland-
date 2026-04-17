'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Megaphone, Calendar, Bookmark, Images, Radio, User, Home, Settings, Newspaper, LogOut, Shield, MessageSquare, Bot } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const navItems = [
  { href: '/dashboard', icon: Home, label: 'Home' },
  { href: '/dashboard/announcements', icon: Megaphone, label: 'Announcements' },
  { href: '/dashboard/messages', icon: MessageSquare, label: 'Messages' },
  { href: '/dashboard/events', icon: Calendar, label: 'Events' },
  { href: '/dashboard/bookings', icon: Bookmark, label: 'Bookings' },
  { href: '/dashboard/gallery', icon: Images, label: 'Gallery' },
  { href: '/dashboard/broadcasts', icon: Radio, label: 'Broadcasts' },
  { href: '/dashboard/profile', icon: User, label: 'Profile' },
];

const adminItems = [
  { href: '/admin', icon: Shield, label: 'Admin Dashboard' },
  { href: '/admin/users', icon: Settings, label: 'Manage Users' },
  { href: '/admin/messages', icon: Bot, label: 'Bot Messages' },
  { href: '/admin/updates', icon: Newspaper, label: 'Updates' },
  { href: '/admin/gallery', icon: Images, label: 'Gallery' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { profile, isAdmin } = useAuth();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    async function refresh() {
      const { count } = await supabase
        .from('bot_message_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile!.id)
        .is('read_at', null);
      if (!cancelled) setUnreadMessages(count ?? 0);
    }
    refresh();
    const id = setInterval(refresh, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [profile?.id, supabase, pathname]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  return (
    // h-screen (NOT min-h-screen) locks the sidebar to the viewport so the
    // inner <nav> actually scrolls when there are too many items to fit.
    // The flex column splits the height into: header (auto) + nav (1fr, scrolls)
    // + sign-out (auto, always pinned to the bottom and visible).
    <aside className="hidden md:flex flex-col w-64 bg-[#1B5E20] text-white h-screen fixed left-0 top-0 z-40">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-white/20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center font-bold text-lg">AE</div>
          <div>
            <div className="font-bold text-base leading-tight">Aaditri</div>
            <div className="text-xs text-white/70">Emerland Community</div>
          </div>
        </div>
      </div>

      {/* User info */}
      <div className="px-4 py-2.5 border-b border-white/20 bg-white/10 flex-shrink-0">
        <p className="text-sm font-semibold truncate" suppressHydrationWarning>{profile?.full_name}</p>
        <p className="text-xs text-white/70 truncate" suppressHydrationWarning>{profile?.flat_number ? `Flat ${profile.flat_number}` : profile?.email}</p>
        {isAdmin && <span className="mt-1 inline-block text-[10px] font-bold bg-yellow-400 text-[#1B5E20] px-2 py-0.5 rounded-full">ADMIN</span>}
      </div>

      {/* Navigation — scrolls if items don't fit. min-h-0 is required on the
          flex child so overflow-y-auto actually engages inside a flex column. */}
      <nav className="flex-1 min-h-0 px-3 py-3 overflow-y-auto">
        <div className="space-y-0.5">
          {navItems.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            const badge = href === '/dashboard/messages' && unreadMessages > 0 ? unreadMessages : 0;
            return (
              <Link key={href} href={href} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-white text-[#1B5E20]' : 'text-white/80 hover:bg-white/15 hover:text-white'}`}>
                <Icon size={18} />
                <span className="flex-1">{label}</span>
                {badge > 0 && (
                  <span
                    suppressHydrationWarning
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${active ? 'bg-[#1B5E20] text-white' : 'bg-yellow-400 text-[#1B5E20]'}`}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {isAdmin && (
          <div className="mt-3 pt-3 border-t border-white/20">
            <p className="text-[10px] text-white/50 uppercase font-semibold px-3 mb-1.5 tracking-wider">Admin</p>
            <div className="space-y-0.5">
              {adminItems.map(({ href, icon: Icon, label }) => {
                const active = pathname === href || (href !== '/admin' && pathname.startsWith(href));
                return (
                  <Link key={href} href={href} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-white text-[#1B5E20]' : 'text-white/80 hover:bg-white/15 hover:text-white'}`}>
                    <Icon size={18} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Sign out — always pinned to the bottom of the viewport. */}
      <div className="p-3 border-t border-white/20 flex-shrink-0">
        <button onClick={handleSignOut} className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-white/80 hover:bg-white/15 hover:text-white transition-all">
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
