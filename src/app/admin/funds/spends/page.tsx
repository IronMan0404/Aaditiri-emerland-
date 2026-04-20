'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowDownRight, ArrowUpRight, Wallet, Loader2, AlertTriangle, Receipt, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, formatINRCompact } from '@/lib/money';
import SpendAnalysis from '@/components/funds/SpendAnalysis';

interface OverallRow {
  total_ever_collected: number;
  total_ever_spent: number;
  total_ever_refunded: number;
  net_current_balance: number;
  active_collecting: number;
  active_spending: number;
  completed_funds: number;
  total_ever_in_kind_value?: number;
}

interface CategoryRow {
  category_id: string;
  category_code: string;
  category_name: string;
  icon: string | null;
  color: string | null;
  fund_count: number;
  total_collected: number;
  total_spent: number;
  current_balance: number;
  total_in_kind_value?: number;
}

interface MonthRow { month: string; collected: number; spent: number; net: number }

interface RecentSpend {
  id: string;
  fund_id: string;
  amount: number;
  spend_date: string;
  description: string;
  vendor_name: string | null;
  payment_method: string;
  is_reimbursement: boolean;
  reimbursed_at: string | null;
  paid_by_name: string | null;
  community_funds: { name: string; fund_categories: { icon: string | null; color: string | null; name: string } | null } | null;
}

interface Payload {
  overall: OverallRow;
  by_category: CategoryRow[];
  by_month: MonthRow[];
  recent_spends: RecentSpend[];
}

export default function AdminSpendsPage() {
  const { isAdmin, mounted } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch('/api/admin/funds/spend-overview');
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `Spend overview failed (${r.status})`);
        }
        const j = (await r.json()) as Payload;
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, mounted]);

  if (mounted && !isAdmin) {
    return <div className="max-w-3xl mx-auto p-6 text-sm text-gray-500">Admin access required.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <Link href="/admin/funds" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft size={16} /> Back to manage funds
      </Link>

      <header className="mb-5">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Receipt className="text-[#1B5E20]" /> Spending overview
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Money in vs money out across every fund. Treasurer dashboard.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-12 justify-center">
          <Loader2 className="animate-spin" /> Loading numbers...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm">
          <p className="font-semibold text-red-800 flex items-center gap-1.5">
            <AlertTriangle size={16} /> Couldn&apos;t load the overview
          </p>
          <p className="text-red-700 mt-1">{error}</p>
          <p className="text-red-700 mt-2">Most likely the funds migration hasn&apos;t been applied. Run <code className="bg-red-100 px-1 rounded">npx supabase db push</code>.</p>
        </div>
      ) : data ? (
        <>
          {/* Overall hero */}
          <section className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
            <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-3">Overall position</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat
                icon={<ArrowDownRight className="text-emerald-700" size={18} />}
                label="Total collected"
                value={formatINRCompact(data.overall.total_ever_collected)}
                tone="emerald"
              />
              <Stat
                icon={<ArrowUpRight className="text-red-700" size={18} />}
                label="Total spent"
                value={formatINRCompact(data.overall.total_ever_spent)}
                tone="red"
              />
              <Stat
                icon={<Wallet className="text-blue-700" size={18} />}
                label="Net balance"
                value={formatINRCompact(data.overall.net_current_balance)}
                tone={data.overall.net_current_balance >= 0 ? 'blue' : 'red'}
              />
              <Stat
                icon={<TrendingUp className="text-amber-700" size={18} />}
                label="Active funds"
                value={`${data.overall.active_collecting + data.overall.active_spending}`}
                tone="amber"
                sub={`${data.overall.active_collecting} collecting · ${data.overall.completed_funds} closed`}
              />
            </div>
            {data.overall.total_ever_in_kind_value && data.overall.total_ever_in_kind_value > 0 ? (
              <p className="text-xs text-gray-500 mt-3">
                + <span className="font-semibold text-purple-700">{formatINR(data.overall.total_ever_in_kind_value)}</span> in-kind value (not counted in cash totals).
              </p>
            ) : null}
            {data.overall.total_ever_refunded > 0 ? (
              <p className="text-xs text-gray-500 mt-1">
                {formatINR(data.overall.total_ever_refunded)} refunded over the lifetime of all funds.
              </p>
            ) : null}
          </section>

          {/* Category breakdown */}
          <section className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
            <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-3">By category — money in / money out / balance</p>
            {data.by_category.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No categories with funds yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {data.by_category.map((c) => {
                  const balance = c.current_balance;
                  const balanceTone = balance > 0 ? 'text-emerald-700' : balance < 0 ? 'text-red-700' : 'text-gray-700';
                  return (
                    <div key={c.category_id} className="flex items-center gap-3 py-3">
                      <span
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                        style={{
                          background: `${c.color ?? '#1B5E20'}1A`,
                          color: c.color ?? '#1B5E20',
                        }}
                      >
                        {c.icon ?? '📦'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{c.category_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {c.fund_count} fund{c.fund_count === 1 ? '' : 's'} ·{' '}
                          <span className="text-emerald-700 font-semibold">+{formatINR(c.total_collected)}</span>{' '}/{' '}
                          <span className="text-red-700 font-semibold">−{formatINR(c.total_spent)}</span>
                        </p>
                      </div>
                      <div className={`text-right ${balanceTone}`}>
                        <p className="text-sm font-bold">{formatINRCompact(balance)}</p>
                        <p className="text-[10px] text-gray-500">balance</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Monthly trend */}
          <section className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
            <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-3">Last 12 months — monthly net</p>
            <MonthlyChart rows={data.by_month} />
          </section>

          {/* Deep spend analysis (own date range) */}
          <section className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
            <SpendAnalysis />
          </section>

          {/* Recent spends */}
          <section className="bg-white rounded-2xl border border-gray-200 p-5 mb-5">
            <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-3">Recent spends (latest 20)</p>
            {data.recent_spends.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No spends recorded yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {data.recent_spends.map((s) => (
                  <Link
                    key={s.id}
                    href={`/admin/funds/${s.fund_id}`}
                    className="flex items-start gap-3 py-3 hover:bg-gray-50 -mx-2 px-2 rounded-lg"
                  >
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 mt-0.5"
                      style={{
                        background: `${s.community_funds?.fund_categories?.color ?? '#374151'}1A`,
                        color: s.community_funds?.fund_categories?.color ?? '#374151',
                      }}
                    >
                      {s.community_funds?.fund_categories?.icon ?? '🧾'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{s.description}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {s.community_funds?.name ?? 'Unknown fund'}
                        {s.vendor_name ? ` · ${s.vendor_name}` : ''}
                        {' · '}
                        {new Date(s.spend_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        {s.is_reimbursement ? (s.reimbursed_at ? ' · reimbursed' : ' · awaiting reimbursement') : ''}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-red-700">−{formatINR(s.amount)}</p>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Stat({ icon, label, value, tone, sub }: { icon: React.ReactNode; label: string; value: string; tone: 'emerald' | 'red' | 'blue' | 'amber'; sub?: string }) {
  const bg = {
    emerald: 'bg-emerald-50',
    red: 'bg-red-50',
    blue: 'bg-blue-50',
    amber: 'bg-amber-50',
  }[tone];
  return (
    <div className={`${bg} rounded-xl p-3`}>
      <div className="flex items-center gap-1.5">{icon}<p className="text-[11px] uppercase font-semibold text-gray-600 tracking-wide">{label}</p></div>
      <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
      {sub ? <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p> : null}
    </div>
  );
}

// Lightweight bar chart so we don't pull a charting library. Each month
// renders a paired bar (collected = green, spent = red) scaled to the
// max value across the window. Net delta shown as text below.
function MonthlyChart({ rows }: { rows: MonthRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-gray-500 py-4 text-center">No movement in the last 12 months.</p>;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.collected, r.spent)));

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <div className="flex items-end gap-2 min-w-full" style={{ height: '160px' }}>
        {rows.map((r) => {
          const cH = Math.round((r.collected / max) * 120);
          const sH = Math.round((r.spent / max) * 120);
          const [year, month] = r.month.split('-');
          const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-IN', { month: 'short' });
          return (
            <div key={r.month} className="flex-1 min-w-[36px] flex flex-col items-center justify-end gap-0.5">
              <div className="flex items-end gap-0.5 h-[120px]">
                <div className="w-3 bg-emerald-500 rounded-t" style={{ height: `${cH}px` }} title={`Collected: ${formatINR(r.collected)}`} />
                <div className="w-3 bg-red-400 rounded-t" style={{ height: `${sH}px` }} title={`Spent: ${formatINR(r.spent)}`} />
              </div>
              <p className="text-[10px] text-gray-500 mt-1">{label}</p>
              <p className={`text-[10px] font-semibold ${r.net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {r.net >= 0 ? '+' : '−'}{formatINRCompact(Math.abs(r.net))}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-3 text-xs text-gray-600 justify-center">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-emerald-500 rounded" /> Collected</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-red-400 rounded" /> Spent</span>
        <span className="flex items-center gap-1.5"><TrendingDown size={12} className="text-gray-500" /> Net per month</span>
      </div>
    </div>
  );
}
