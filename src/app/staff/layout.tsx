// Staff section layout.
//
// MUST stay synchronous. The auth/role gating lives in src/proxy.ts —
// adding async + redirect() here would crash Turbopack dev tracing
// (see AGENTS.md → "Don't reintroduce async + redirect() in
// admin/dashboard/staff layouts"). All this layout does is render a
// minimal shell — the per-route page picks the right header — plus
// the persistent bottom tab strip so staff can move between Home
// (their own attendance) and Residents (the read-only directory).
import type { ReactNode } from 'react';
import StaffTabs from '@/components/staff/StaffTabs';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      {/* Reserve room at the bottom for the fixed tab strip. */}
      <div className="pb-20">{children}</div>
      <StaffTabs />
    </div>
  );
}
