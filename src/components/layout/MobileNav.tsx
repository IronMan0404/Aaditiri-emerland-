'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Megaphone, Calendar, Bookmark, Radio, User, Images } from 'lucide-react';

const navItems = [
  { href: '/dashboard', icon: Home, label: 'Home' },
  { href: '/dashboard/announcements', icon: Megaphone, label: 'News' },
  { href: '/dashboard/events', icon: Calendar, label: 'Events' },
  { href: '/dashboard/bookings', icon: Bookmark, label: 'Book' },
  { href: '/dashboard/gallery', icon: Images, label: 'Gallery' },
  { href: '/dashboard/broadcasts', icon: Radio, label: 'Alerts' },
  { href: '/dashboard/profile', icon: User, label: 'Me' },
];

export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-bottom">
      <div className="flex overflow-x-auto scrollbar-hide">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 px-3 py-2 min-w-[60px] flex-1 transition-colors ${active ? 'text-[#1B5E20]' : 'text-gray-500'}`}>
              <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
              <span className="text-[9px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
