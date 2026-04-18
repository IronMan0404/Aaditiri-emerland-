'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { Megaphone, MessageSquare, Users, User, LogOut, Shield, X, Newspaper } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
}

// Bottom-sheet "More" menu shown on mobile when the user taps the 5th nav slot.
// Houses the secondary navigation items that didn't make the cut for the
// primary 5-tab bottom bar (News, Inbox, Community, Profile, etc.) plus
// admin and sign-out shortcuts.
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

  const items = [
    { href: '/dashboard/news', icon: Newspaper, label: 'News', desc: 'Hyderabad weather, traffic & daily updates' },
    { href: '/dashboard/announcements', icon: Megaphone, label: 'Announcements', desc: 'Society notices from admin' },
    { href: '/dashboard/messages', icon: MessageSquare, label: 'Inbox', desc: 'Direct messages from admin', badge: unreadMessages },
    { href: '/dashboard/community', icon: Users, label: 'Community', desc: 'Residents directory' },
    { href: '/dashboard/profile', icon: User, label: 'Profile', desc: 'Your account & family' },
  ];

  async function handleSignOut() {
    onClose();
    await supabase.auth.signOut();
    router.push('/auth/login');
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

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More menu"
        className={`absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl safe-bottom transition-transform duration-200 ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
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

        <div className="px-3 pb-3">
          <div className="divide-y divide-gray-100">
            {items.map(({ href, icon: Icon, label, desc, badge }) => {
              const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
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
                  <span className="flex-1">
                    <span className={`block text-sm font-semibold ${active ? 'text-[#1B5E20]' : 'text-gray-900'}`}>{label}</span>
                    <span className="block text-xs text-gray-500">{desc}</span>
                  </span>
                  {!!badge && badge > 0 && (
                    <span
                      suppressHydrationWarning
                      className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
                    >
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </Link>
              );
            })}

            {isAdmin && (
              <Link
                href="/admin"
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-gray-50"
              >
                <span className="w-9 h-9 rounded-xl bg-yellow-100 text-yellow-700 flex items-center justify-center">
                  <Shield size={18} />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-gray-900">Admin Dashboard</span>
                  <span className="block text-xs text-gray-500">Manage users, content & settings</span>
                </span>
              </Link>
            )}

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
