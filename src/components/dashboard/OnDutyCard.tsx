'use client';

import { useEffect, useState } from 'react';
import { Shield, Sparkles } from 'lucide-react';

// Tiny resident-facing widget: "X security and Y housekeeping
// staff are on duty right now". Reads from /api/staff/on-duty
// which calls the staff_on_duty_now() Postgres function — that
// function masks surnames and excludes phone/address, so this
// card is safe even if a screenshot ends up in a public WhatsApp
// group.
//
// Renders nothing if no one is on duty (avoids a confusing empty
// card on weekend mornings before the day shift arrives).

interface OnDutyEntry {
  id: string;
  staff_role: 'security' | 'housekeeping';
  display_name: string;
  photo_url: string | null;
  on_duty_since: string;
}

export default function OnDutyCard() {
  const [entries, setEntries] = useState<OnDutyEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/staff/on-duty', { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setEntries([]);
          return;
        }
        const j = (await res.json()) as { on_duty: OnDutyEntry[] };
        if (!cancelled) setEntries(j.on_duty ?? []);
      } catch {
        if (!cancelled) setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Don't reserve space while loading — keeps the dashboard
  // layout stable for the most common case (no staff on duty).
  if (entries === null || entries.length === 0) return null;

  const security = entries.filter((e) => e.staff_role === 'security');
  const housekeeping = entries.filter((e) => e.staff_role === 'housekeeping');

  return (
    <section className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
        <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
          On duty now
        </h2>
        <span className="ml-auto text-[10px] text-gray-400 font-semibold">
          {entries.length} active
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {security.length > 0 && (
          <RoleColumn role="security" entries={security} />
        )}
        {housekeeping.length > 0 && (
          <RoleColumn role="housekeeping" entries={housekeeping} />
        )}
      </div>
    </section>
  );
}

function RoleColumn({
  role,
  entries,
}: {
  role: 'security' | 'housekeeping';
  entries: OnDutyEntry[];
}) {
  const config =
    role === 'security'
      ? {
          label: 'Security',
          tint: 'bg-emerald-50 border-emerald-100',
          iconColor: 'text-emerald-700',
          Icon: Shield,
        }
      : {
          label: 'Housekeeping',
          tint: 'bg-sky-50 border-sky-100',
          iconColor: 'text-sky-700',
          Icon: Sparkles,
        };

  return (
    <div className={`rounded-xl border p-2.5 ${config.tint}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <config.Icon size={11} className={config.iconColor} />
        <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">
          {config.label}
        </p>
      </div>
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-1.5 min-w-0">
            <div className="w-5 h-5 rounded-full bg-white/80 shrink-0 overflow-hidden flex items-center justify-center">
              {e.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={e.photo_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <config.Icon size={9} className={config.iconColor} />
              )}
            </div>
            <span className="text-xs text-gray-700 truncate font-medium">
              {e.display_name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
