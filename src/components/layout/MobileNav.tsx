'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Calendar, Bookmark, Radio, Wallet, MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import MoreSheet from './MoreSheet';

// Per customer feedback (Apr 2026): pruned the bottom bar from 9 noisy tabs
// down to 5 high-traffic ones. Secondary destinations (News, Inbox, Community,
// Profile, Admin, Sign-out) live behind the "More" tab in a bottom sheet.
//
// Apr 2026 follow-up: swapped Gallery → Funds. Gallery is passive browsing
// (still reachable via More), whereas Funds is transactional (residents check
// their contributions, admins verify pending ones — both happen weekly).
const navItems = [
  { href: '/dashboard', icon: Home, label: 'Home' },
  { href: '/dashboard/events', icon: Calendar, label: 'Events' },
  { href: '/dashboard/bookings', icon: Bookmark, label: 'Book' },
  { href: '/dashboard/funds', icon: Wallet, label: 'Funds' },
  { href: '/dashboard/broadcasts', icon: Radio, label: 'Alerts' },
];

// Routes that are reachable only through the More sheet — when one of these
// is active we want the More tab to highlight as well so the user knows where
// they are in the IA.
const moreRoutes = [
  '/dashboard/assistant',
  '/dashboard/announcements',
  '/dashboard/messages',
  '/dashboard/community',
  '/dashboard/phonebook',
  '/dashboard/clubhouse',
  '/dashboard/gallery',
  '/dashboard/issues',
  '/dashboard/profile',
];

export default function MobileNav() {
  const pathname = usePathname();
  const { unreadMessages, refreshUnread } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  // Refresh the unread badge on route changes so it doesn't lag the
  // 60s background poll. The hook itself debounces via state so the
  // network call isn't actually fired every keystroke / hover.
  useEffect(() => { refreshUnread(); }, [pathname, refreshUnread]);

  // Close the sheet whenever the route actually changes (e.g. user tapped a
  // link inside the sheet). The sheet's own onClose handles the tap, but this
  // is a safety net for back-button navigation.
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  // Highlight the More tab when the user is on any "secondary" route — both
  // the resident-side ones (announcements, profile, etc.) AND every admin
  // route, because the entire admin section is now nested inside the More
  // sheet on mobile.
  const moreActive =
    moreRoutes.some((r) => pathname === r || pathname.startsWith(r + '/')) ||
    pathname.startsWith('/admin');

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-bottom">
        <div className="flex">
          {navItems.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex flex-col items-center gap-0.5 px-2 py-2 flex-1 transition-colors ${active ? 'text-[#1B5E20]' : 'text-gray-500'}`}
              >
                <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-label="Open more menu"
            aria-expanded={moreOpen}
            className={`relative flex flex-col items-center gap-0.5 px-2 py-2 flex-1 transition-colors ${moreActive || moreOpen ? 'text-[#1B5E20]' : 'text-gray-500'}`}
          >
            <span className="relative">
              <MoreHorizontal size={22} strokeWidth={moreActive || moreOpen ? 2.5 : 1.8} />
              {unreadMessages > 0 && (
                <span
                  suppressHydrationWarning
                  className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center"
                >
                  {unreadMessages > 9 ? '9+' : unreadMessages}
                </span>
              )}
            </span>
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
