'use client';

// Bottom-of-screen tab strip for the staff app.
//
// Why bottom? Staff are typically holding a phone in one hand
// at a gate or mid-shift; thumb-reachable nav matches the
// resident app's mobile pattern. We keep it deliberately
// minimal: only Home and Residents — no profile, no settings.
// Anything more lives behind admin (and is gated to admins).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users } from 'lucide-react';

interface TabDef {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
  // Pages that should highlight this tab. The first entry is
  // the canonical href; additional matchers cover sub-routes
  // (e.g. /staff/security and /staff/housekeeping both light
  // up the Home tab).
  matchers: string[];
}

const TABS: TabDef[] = [
  {
    href: '/staff',
    label: 'Home',
    Icon: LayoutDashboard,
    matchers: ['/staff', '/staff/security', '/staff/housekeeping'],
  },
  {
    href: '/staff/residents',
    label: 'Residents',
    Icon: Users,
    matchers: ['/staff/residents'],
  },
];

export default function StaffTabs() {
  const pathname = usePathname() ?? '';

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-[0_-2px_10px_rgba(0,0,0,0.04)]"
      aria-label="Staff navigation"
    >
      <div className="max-w-md mx-auto grid grid-cols-2">
        {TABS.map((t) => {
          const active = t.matchers.some(
            (m) => pathname === m || pathname.startsWith(`${m}/`),
          );
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center justify-center py-2.5 text-[11px] font-semibold transition-colors ${
                active
                  ? 'text-[#1B5E20]'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <t.Icon size={20} className="mb-0.5" />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
