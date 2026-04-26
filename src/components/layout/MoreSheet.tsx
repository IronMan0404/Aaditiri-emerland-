'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import {
  Megaphone,
  MessageSquare,
  Users,
  User,
  LogOut,
  Shield,
  X,
  Newspaper,
  AlertCircle,
  KeyRound,
  ScanLine,
  Bot,
  Settings,
  Images,
  Wallet,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
}

interface SheetItem {
  href: string;
  // Lucide icon component. Typed as a generic functional component so we
  // don't pull in lucide-react's internal type, which has been unstable
  // across versions.
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  desc: string;
  badge?: number;
}

// Bottom-sheet "More" menu shown on mobile when the user taps the 5th nav slot.
// Houses the secondary navigation items that didn't make the cut for the
// primary 5-tab bottom bar (News, Inbox, Community, Profile, etc.) plus
// the entire admin section so admins on phones don't have to bounce through
// the Admin Dashboard landing page to reach Issues Board / Validate Pass / etc.
export default function MoreSheet({ open, onClose }: MoreSheetProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin, unreadMessages } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  // Lock background scroll while the sheet is open so the user can't accidentally
  // scroll the underlying page through the backdrop on iOS Safari.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [open]);

  // Resident-side items not already on the bottom 5-tab bar.
  const items: SheetItem[] = [
    { href: '/dashboard/news', icon: Newspaper, label: 'News', desc: 'Local weather, traffic & daily updates' },
    { href: '/dashboard/assistant', icon: Sparkles, label: 'AI Assistant', desc: 'Free local helper for bookings and reports' },
    { href: '/dashboard/announcements', icon: Megaphone, label: 'Announcements', desc: 'Society notices from admin' },
    { href: '/dashboard/messages', icon: MessageSquare, label: 'Inbox', desc: 'Direct messages from admin', badge: unreadMessages },
    { href: '/dashboard/community', icon: Users, label: 'Community', desc: 'Residents directory' },
    { href: '/dashboard/phonebook', icon: BookOpen, label: 'Phone Book', desc: 'Plumbers, maids, milk, society contacts' },
    { href: '/dashboard/clubhouse', icon: KeyRound, label: 'Clubhouse', desc: 'Subscription, facilities & passes' },
    { href: '/dashboard/gallery', icon: Images, label: 'Gallery', desc: 'Community photos & event albums' },
    { href: '/dashboard/issues', icon: AlertCircle, label: 'Issues', desc: 'Report a problem & track tickets' },
    { href: '/dashboard/profile', icon: User, label: 'Profile', desc: 'Your account & family' },
  ];

  // Admin-side items. Mirrors the Admin block in the desktop Sidebar so
  // admins get full mobile parity. Hidden entirely for non-admins.
  const adminItems: SheetItem[] = [
    { href: '/admin', icon: Shield, label: 'Admin Dashboard', desc: 'KPIs & quick actions' },
    { href: '/admin/users', icon: Settings, label: 'Manage Users', desc: 'Approve, edit, delete residents' },
    { href: '/admin/issues', icon: AlertCircle, label: 'Issues Board', desc: 'Kanban + analytics' },
    { href: '/admin/clubhouse', icon: KeyRound, label: 'Clubhouse Admin', desc: 'Tiers, subscriptions & catalog' },
    { href: '/admin/clubhouse/validate', icon: ScanLine, label: 'Validate Pass', desc: 'Scan QR to admit guests' },
    { href: '/admin/funds', icon: Wallet, label: 'Manage Funds', desc: 'Verify contributions & record spends' },
    { href: '/admin/phonebook', icon: BookOpen, label: 'Phone Book', desc: 'Curate society contacts & moderate reports' },
    { href: '/admin/messages', icon: Bot, label: 'Bot Messages', desc: 'Broadcast as Aaditri Bot' },
    { href: '/admin/updates', icon: Newspaper, label: 'Community Updates', desc: 'Post categorised updates' },
    { href: '/admin/gallery', icon: Images, label: 'Gallery Admin', desc: 'Moderate community photos' },
  ];

  async function handleSignOut() {
    onClose();
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  function isActive(href: string) {
    if (pathname === href) return true;
    if (href === '/dashboard' || href === '/admin') return false;
    return pathname.startsWith(href + '/') || pathname.startsWith(href);
  }

  function renderItem({ href, icon: Icon, label, desc, badge }: SheetItem) {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={onClose}
        className={`flex items-center gap-3 px-3 py-3 rounded-lg ${active ? 'bg-green-50' : 'hover:bg-gray-50'}`}
      >
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${active ? 'bg-[#1B5E20] text-white' : 'bg-gray-100 text-gray-600'}`}>
          <Icon size={18} />
        </span>
        <span className="flex-1 min-w-0">
          <span className={`block text-sm font-semibold truncate ${active ? 'text-[#1B5E20]' : 'text-gray-900'}`}>{label}</span>
          <span className="block text-xs text-gray-500 truncate">{desc}</span>
        </span>
        {!!badge && badge > 0 && (
          <span
            suppressHydrationWarning
            className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0"
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <div
      className={`md:hidden fixed inset-0 z-[60] transition-opacity ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      {/* Sheet — caps at 85vh and scrolls internally so the longer admin
          section can't push Sign Out off the bottom of the viewport. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More menu"
        className={`absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl safe-bottom transition-transform duration-200 max-h-[85vh] flex flex-col ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
          <h2 className="text-base font-bold text-gray-900">More</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="px-3 pb-3 overflow-y-auto flex-1">
          <div className="divide-y divide-gray-100">
            {items.map(renderItem)}
          </div>

          {isAdmin && (
            <>
              <div className="flex items-center gap-2 px-3 pt-4 pb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Admin</span>
                <span className="flex-1 h-px bg-gray-100" />
                <span className="text-[10px] font-bold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                  ADMIN
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {adminItems.map(renderItem)}
              </div>
            </>
          )}

          <div className="pt-2 mt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-red-50 text-left"
            >
              <span className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
                <LogOut size={18} />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-red-700">Sign out</span>
                <span className="block text-xs text-gray-500">End this session</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
