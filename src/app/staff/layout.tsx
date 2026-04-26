// Staff section layout.
//
// MUST stay synchronous. The auth/role gating lives in src/proxy.ts —
// adding async + redirect() here would crash Turbopack dev tracing
// (see AGENTS.md → "Don't reintroduce async + redirect() in
// admin/dashboard/staff layouts"). All this layout does is render a
// minimal shell — the per-route page picks the right header.
import type { ReactNode } from 'react';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      {children}
    </div>
  );
}
