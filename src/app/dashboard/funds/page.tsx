'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Wallet, Plus, BarChart3, Loader2, AlertTriangle, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, formatINRCompact } from '@/lib/money';
import type { FundSummary, CategoryTotals } from '@/types/funds';

interface OverallBalance {
  total_ever_collected: number;
  total_ever_spent: number;
  net_current_balance: number;
  active_collecting: number;
  active_spending: number;
  completed_funds: number;
}

type Tab = 'all' | 'active' | 'closed';

export default function FundsPage() {
  const { isAdmin, mounted } = useAuth();
  const [funds, setFunds] = useState<FundSummary[]>([]);
  const [overall, setOverall] = useState<OverallBalance | null>(null);
  const [categories, setCategories] = useState<CategoryTotals[]>([]);
  const [tab, setTab] = useState<Tab>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [fundsRes, balanceRes] = await Promise.all([
          fetch('/api/funds'),
          fetch('/api/funds/balance-sheet'),
        ]);
        if (cancelled) return;
        if (!fundsRes.ok || !balanceRes.ok) {
          // Almost always means the funds migration hasn't been applied yet.
          const j = await (fundsRes.ok ? balanceRes : fundsRes).json().catch(() => ({}));
          throw new Error(j.error ?? 'Funds API unavailable');
        }
        const fundsJson = await fundsRes.json();
        const balanceJson = await balanceRes.json();
        setFunds(fundsJson.funds ?? []);
        setOverall(balanceJson.overall ?? null);
        setCategories(balanceJson.categories ?? []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mounted]);

  const visible = funds.filter((f) => {
    if (tab === 'all') return true;
    if (tab === 'active') return f.status === 'collecting' || f.status === 'spending';
    return f.status === 'closed' || f.status === 'cancelled';
  });

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Wallet className="text-[#1B5E20]" /> Community Funds
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Transparent ledger of voluntary collections — every rupee accounted for.
            </p>
          </div>
          {isAdmin && (
            <Link
              href="/admin/funds/new"
              className="hidden md:inline-flex items-center gap-1.5 bg-[#1B5E20] hover:bg-[#2E7D32] text-white px-4 py-2 rounded-xl text-sm font-semibold"
            >
              <Plus size={16} /> New Fund
            </Link>
          )}
        </div>
      </header>

      {/* What I owe quick link */}
      <Link
        href="/dashboard/funds/my-dues"
        className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-3 hover:shadow-md transition-shadow"
      >
        <span className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
          <AlertCircle size={20} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-900">What I owe</p>
          <p className="text-xs text-amber-700">Your dues across every active fund.</p>
        </div>
        <span className="text-amber-700 text-sm">→</span>
      </Link>

      {/* Overall balance card */}
      <Link
        href="/dashboard/funds/balance-sheet"
        className="block bg-gradient-to-br from-[#1B5E20] to-[#2E7D32] text-white rounded-2xl p-5 mb-5 shadow-lg hover:shadow-xl transition-shadow"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-white/80">Overall balance</p>
            <p className="text-3xl font-bold mt-0.5" suppressHydrationWarning>
              {overall ? formatINRCompact(overall.net_current_balance) : '—'}
            </p>
            <div className="flex gap-4 mt-2 text-xs text-white/85">
              <span>↑ Collected {overall ? formatINRCompact(overall.total_ever_collected) : '—'}</span>
              <span>↓ Spent {overall ? formatINRCompact(overall.total_ever_spent) : '—'}</span>
            </div>
          </div>
          <BarChart3 className="opacity-80" />
        </div>
        <p className="text-xs text-white/70 mt-3">
          {overall ? `${overall.active_collecting + overall.active_spending} active • ${overall.completed_funds} closed` : ''}
          <span className="ml-2 underline">Open balance sheet →</span>
        </p>
      </Link>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-full max-w-md">
        {(['active', 'all', 'closed'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              tab === t ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-500'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Funds list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="animate-spin mr-2" /> Loading funds...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm">
          <p className="font-semibold text-red-800 flex items-center gap-1.5">
            <AlertTriangle size={16} /> Funds aren&apos;t set up yet
          </p>
          <p className="text-red-700 mt-1">{error}</p>
          {isAdmin && (
            <p className="text-red-700 mt-2">
              Apply the migration{' '}
              <code className="bg-red-100 px-1 rounded">supabase/migrations/20260424_community_funds.sql</code>
              {' '}with <code className="bg-red-100 px-1 rounded">npx supabase db push</code> (or paste it into the
              Supabase SQL editor) and refresh this page.
            </p>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-2xl border border-dashed border-gray-200">
          <Wallet className="mx-auto opacity-40 mb-3" size={32} />
          <p className="text-sm">No funds in this view yet.</p>
          {isAdmin && (
            <Link href="/admin/funds/new" className="text-[#1B5E20] underline text-sm font-medium mt-2 inline-block">
              Create the first fund
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((f) => (
            <FundCard key={f.id} fund={f} />
          ))}
        </div>
      )}

      {/* Category breakdown */}
      {categories.filter((c) => c.fund_count > 0).length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-bold text-gray-900 mb-3">By category</h2>
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {categories
              .filter((c) => c.fund_count > 0)
              .map((c) => (
                <div key={c.category_id} className="flex items-center gap-3 p-3">
                  <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
                    style={{ background: `${c.color}1A`, color: c.color ?? undefined }}
                  >
                    {c.icon ?? '📦'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.category_name}</p>
                    <p className="text-xs text-gray-500">
                      {c.fund_count} fund{c.fund_count !== 1 ? 's' : ''} • Spent {formatINRCompact(c.total_spent)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-gray-900">{formatINRCompact(c.current_balance)}</p>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Mobile: floating CTA for admins */}
      {isAdmin && (
        <Link
          href="/admin/funds/new"
          className="md:hidden fixed bottom-20 right-4 bg-[#1B5E20] text-white p-4 rounded-full shadow-xl z-40"
          aria-label="Create new fund"
        >
          <Plus size={22} />
        </Link>
      )}
    </div>
  );
}

function FundCard({ fund }: { fund: FundSummary }) {
  const pct = fund.collection_progress_pct ?? null;
  const statusColor =
    fund.status === 'collecting' ? 'bg-blue-100 text-blue-700'
    : fund.status === 'spending' ? 'bg-amber-100 text-amber-700'
    : fund.status === 'closed' ? 'bg-emerald-100 text-emerald-700'
    : 'bg-gray-100 text-gray-700';

  return (
    <Link
      href={`/dashboard/funds/${fund.id}`}
      className="block bg-white rounded-2xl border border-gray-200 p-4 hover:border-[#1B5E20] hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-3">
        <span
          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{
            background: `${fund.category_color ?? '#1B5E20'}1A`,
            color: fund.category_color ?? '#1B5E20',
          }}
        >
          {fund.category_icon ?? '📦'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-bold text-gray-900 truncate">{fund.name}</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${statusColor}`}>
              {fund.status}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{fund.category_name}</p>

          {fund.target_amount ? (
            <div className="mt-2.5">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-gray-700">
                  {formatINR(fund.total_collected)}{' '}
                  <span className="text-gray-400 font-normal">/ {formatINR(fund.target_amount)}</span>
                </span>
                <span className="text-gray-500">{pct !== null ? `${pct}%` : ''}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#1B5E20] transition-all"
                  style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm font-semibold text-gray-900 mt-2">
              {formatINR(fund.total_collected)} collected
            </p>
          )}
          {(fund.total_in_kind_value ?? 0) > 0 && (
            <p className="text-[11px] text-purple-700 font-medium mt-1">
              + {formatINR(fund.total_in_kind_value)} in-kind
            </p>
          )}

          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span>👥 {fund.contributor_count} contributor{fund.contributor_count !== 1 ? 's' : ''}</span>
            <span>Bal {formatINRCompact(fund.current_balance)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
