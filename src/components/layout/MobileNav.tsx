'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Megaphone, Calendar, Bookmark, Radio, User, Images, MessageSquare, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

const navItems = [
  { href: '/dashboard', icon: Home, label: 'Home' },
  { href: '/dashboard/announcements', icon: Megaphone, label: 'News' },
  { href: '/dashboard/messages', icon: MessageSquare, label: 'Inbox' },
  { href: '/dashboard/community', icon: Users, label: 'Community' },
  { href: '/dashboard/events', icon: Calendar, label: 'Events' },
  { href: '/dashboard/bookings', icon: Bookmark, label: 'Book' },
  { href: '/dashboard/gallery', icon: Images, label: 'Gallery' },
  { href: '/dashboard/broadcasts', icon: Radio, label: 'Alerts' },
  { href: '/dashboard/profile', icon: User, label: 'Me' },
];

export default function MobileNav() {
  const pathname = usePathname();
  const { profile } = useAuth();
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

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-bottom">
      <div className="flex overflow-x-auto scrollbar-hide">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          const showBadge = href === '/dashboard/messages' && unreadMessages > 0;
          return (
            <Link key={href} href={href} className={`relative flex flex-col items-center gap-0.5 px-3 py-2 min-w-[60px] flex-1 transition-colors ${active ? 'text-[#1B5E20]' : 'text-gray-500'}`}>
              <span className="relative">
                <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                {showBadge && (
                  <span
                    suppressHydrationWarning
                    className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center"
                  >
                    {unreadMessages > 9 ? '9+' : unreadMessages}
                  </span>
                )}
              </span>
              <span className="text-[9px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
