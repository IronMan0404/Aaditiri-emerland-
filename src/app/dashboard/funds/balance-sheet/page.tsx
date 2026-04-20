'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, Trophy } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, formatINRCompact } from '@/lib/money';
import type { CategoryTotals, FundSummary, CommunityBalanceOverall } from '@/types/funds';

interface TopContributor { flat_number: string; name: string; total: number }

interface BalancePayload {
  overall: CommunityBalanceOverall;
  categories: CategoryTotals[];
  closed_funds: FundSummary[];
  top_contributors: TopContributor[];
}

export default function BalanceSheetPage() {
  const { mounted } = useAuth();
  const [data, setData] = useState<BalancePayload | null>(null);

  useEffect(() => {
    if (!mounted) return;
    fetch('/api/funds/balance-sheet').then((r) => r.json()).then(setData);
  }, [mounted]);

  if (!data) {
    return <div className="max-w-4xl mx-auto p-6 text-gray-400 text-sm">Loading...</div>;
  }

  const { overall, categories, closed_funds, top_contributors } = data;
  const activeCats = categories.filter((c) => c.fund_count > 0);
  const totalCollected = overall.total_ever_collected;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <Link href="/dashboard/funds" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft size={16} /> Back to funds
      </Link>

      <header className="mb-5">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Community Balance Sheet</h1>
        <p className="text-sm text-gray-500 mt-1">As of {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </header>

      {/* Headline numbers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <BigStat
          label="Total collected"
          value={formatINR(overall.total_ever_collected)}
          icon={<TrendingUp className="text-emerald-600" />}
          accent="bg-emerald-50"
        />
        <BigStat
          label="Total spent"
          value={formatINR(overall.total_ever_spent)}
          icon={<TrendingDown className="text-red-600" />}
          accent="bg-red-50"
        />
        <BigStat
          label="Net balance"
          value={formatINR(overall.net_current_balance)}
          icon={<Trophy className="text-[#1B5E20]" />}
          accent="bg-emerald-50 border-2 border-[#1B5E20]/30"
        />
      </div>

      <p className="text-xs text-gray-500 mb-5">
        {overall.active_collecting + overall.active_spending} active funds · {overall.completed_funds} completed
        {overall.total_ever_refunded > 0 && ` · ${formatINRCompact(overall.total_ever_refunded)} refunded`}
        {(overall.total_ever_in_kind_value ?? 0) > 0 && (
          <> · <span className="text-purple-700 font-semibold">{formatINRCompact(overall.total_ever_in_kind_value)} in-kind value</span> (items / services, tracked separately)</>
        )}
      </p>

      {/* Category breakdown with bar viz */}
      <section className="bg-white rounded-2xl border border-gray-200 p-4 mb-5">
        <h2 className="text-base font-bold text-gray-900 mb-3">By category</h2>
        {activeCats.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">No category data yet.</p>
        ) : (
          <div className="space-y-3">
            {activeCats.map((c) => {
              const sharePct = totalCollected > 0 ? (c.total_collected / totalCollected) * 100 : 0;
              return (
                <div key={c.category_id}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base">{c.icon}</span>
                    <span className="text-sm font-semibold text-gray-800 flex-1 truncate">{c.category_name}</span>
                    <span className="text-xs text-gray-500">in</span>
                    <span className="text-xs font-semibold text-emerald-700">{formatINRCompact(c.total_collected)}</span>
                    <span className="text-xs text-gray-500">·</span>
                    <span className="text-xs font-semibold text-red-600">−{formatINRCompact(c.total_spent)}</span>
                    <span className="text-xs text-gray-500">·</span>
                    <span className="text-xs font-bold text-gray-900">{formatINRCompact(c.current_balance)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{ width: `${sharePct}%`, background: c.color ?? '#1B5E20' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Closed/completed funds */}
      {closed_funds.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-200 p-4 mb-5">
          <h2 className="text-base font-bold text-gray-900 mb-3">Recent closed & spending funds</h2>
          <div className="divide-y divide-gray-100">
            {closed_funds.slice(0, 15).map((f) => (
              <Link
                key={f.id}
                href={`/dashboard/funds/${f.id}`}
                className="flex items-center gap-3 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg"
              >
                <span className="text-base">{f.category_icon ?? '📦'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {f.status === 'closed' ? '✅' : '🛒'} {f.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatINRCompact(f.total_collected)} → {formatINRCompact(f.total_spent)}
                  </p>
                </div>
                <p className="text-sm font-bold text-gray-900">{formatINRCompact(f.current_balance)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Top contributors leaderboard */}
      {top_contributors.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-200 p-4">
          <h2 className="text-base font-bold text-gray-900 mb-3">🏆 Top contributors</h2>
          <div className="divide-y divide-gray-100">
            {top_contributors.map((c, i) => (
              <Link
                key={c.flat_number}
                href={`/dashboard/funds/by-flat/${encodeURIComponent(c.flat_number)}`}
                className="flex items-center gap-3 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg"
              >
                <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{c.flat_number} · {c.name}</p>
                </div>
                <p className="text-sm font-bold text-emerald-700">{formatINR(c.total)}</p>
              </Link>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Anonymous contributions are excluded from this leaderboard.
          </p>
        </section>
      )}
    </div>
  );
}

function BigStat({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className={`rounded-2xl p-4 ${accent}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-700 font-medium">{label}</p>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
