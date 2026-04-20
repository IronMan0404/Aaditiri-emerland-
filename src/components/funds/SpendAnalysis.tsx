'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp, AlertTriangle, Receipt, Users, Tag, CreditCard,
  Loader2, Trophy, HandCoins, AlertCircle, FileWarning, Banknote,
} from 'lucide-react';
import { formatINR, formatINRCompact } from '@/lib/money';

type Range = '1m' | '3m' | '1y' | 'all';

interface Summary { total_spent: number; spend_count: number; avg_per_spend: number; weekly_velocity: number; range: Range; since: string | null }
interface TopSpend { id: string; fund_id: string; fund_name: string; amount: number; description: string; vendor_name: string | null; spend_date: string; payment_method: string }
interface VendorRow { vendor: string; total: number; count: number; last_spend_date: string }
interface MethodRow { method: string; total: number; count: number }
interface CategoryRow { category_id: string; name: string; icon: string | null; color: string | null; total: number; count: number }
interface ReimbRow { person: string; pending_total: number; pending_count: number; oldest_date: string }
interface FundRow { id: string; name: string; collected: number; spent: number; refunded: number; balance: number; pct_spent: number | null }
interface AnomalyRow { id: string; fund_id: string; fund_name: string; amount: number; spend_date: string; description: string; vendor_name: string | null; flags: string[] }

interface Payload {
  scope: 'overall' | 'fund';
  fund_id: string | null;
  summary: Summary;
  top_spends: TopSpend[];
  top_vendors: VendorRow[];
  by_method: MethodRow[];
  by_category: CategoryRow[];
  pending_reimbursements: ReimbRow[];
  fund_efficiency: FundRow[];
  anomalies: AnomalyRow[];
}

interface Props {
  // Optional: scope analysis to a single fund. Omit for society-wide.
  fundId?: string;
  // When true, render the section title; otherwise the parent provides it.
  showTitle?: boolean;
  // Compact mode hides some blocks that don't make sense per-fund.
  compact?: boolean;
}

export default function SpendAnalysis({ fundId, showTitle = true, compact = false }: Props) {
  const [range, setRange] = useState<Range>('3m');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (fundId) params.set('fund_id', fundId);
        params.set('range', range);
        const r = await fetch(`/api/admin/funds/spend-analysis?${params.toString()}`);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `Analysis API failed (${r.status})`);
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
  }, [fundId, range]);

  const isFund = !!fundId;

  return (
    <div>
      {showTitle && (
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp className="text-[#1B5E20]" size={18} /> Spend analysis
          </h2>
          <RangeTabs value={range} onChange={setRange} />
        </div>
      )}
      {!showTitle && (
        <div className="flex justify-end mb-3">
          <RangeTabs value={range} onChange={setRange} />
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
          <Loader2 className="animate-spin" size={16} /> Computing...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs">
          <p className="font-semibold text-red-800 flex items-center gap-1.5"><AlertTriangle size={14} /> Couldn&apos;t load analysis</p>
          <p className="text-red-700 mt-1">{error}</p>
        </div>
      ) : !data || data.summary.spend_count === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">
          No spends in the selected window.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Tile icon={<Receipt size={14} />} label="Total spent" value={formatINRCompact(data.summary.total_spent)} tone="red" sub={`${data.summary.spend_count} spend${data.summary.spend_count === 1 ? '' : 's'}`} />
            <Tile icon={<Banknote size={14} />} label="Avg / spend" value={formatINRCompact(data.summary.avg_per_spend)} tone="gray" />
            <Tile icon={<TrendingUp size={14} />} label="Weekly burn" value={formatINRCompact(data.summary.weekly_velocity)} tone="amber" sub="₹ / week" />
            <Tile icon={<HandCoins size={14} />} label="Reimbursements pending" value={formatINRCompact(data.pending_reimbursements.reduce((s, r) => s + r.pending_total, 0))} tone={data.pending_reimbursements.length > 0 ? 'orange' : 'gray'} sub={`${data.pending_reimbursements.length} person${data.pending_reimbursements.length === 1 ? '' : 's'}`} />
          </div>

          {/* Top spends + Top vendors side-by-side on desktop */}
          <div className="grid md:grid-cols-2 gap-3">
            <Card title="Top spends" icon={<Trophy size={14} className="text-amber-600" />}>
              {data.top_spends.length === 0 ? <Empty msg="No spends." /> : (
                <ul className="space-y-1.5 text-xs">
                  {data.top_spends.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <Link href={`/admin/funds/${s.fund_id}`} className="flex-1 min-w-0 hover:underline">
                        <p className="truncate text-gray-900 font-medium">{s.description}</p>
                        <p className="text-[10px] text-gray-500 truncate">
                          {!isFund ? `${s.fund_name} · ` : ''}{s.vendor_name ?? '(no vendor)'} · {new Date(s.spend_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </p>
                      </Link>
                      <span className="text-red-700 font-bold whitespace-nowrap">−{formatINR(s.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Top vendors" icon={<Users size={14} className="text-blue-600" />}>
              {data.top_vendors.length === 0 ? <Empty msg="No vendor data." /> : (
                <ul className="space-y-1.5 text-xs">
                  {data.top_vendors.map((v) => (
                    <li key={v.vendor} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-gray-900 font-medium">{v.vendor}</p>
                        <p className="text-[10px] text-gray-500">
                          {v.count} spend{v.count === 1 ? '' : 's'} · last on {new Date(v.last_spend_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      <span className="text-gray-900 font-bold whitespace-nowrap">{formatINR(v.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* By method + By category side-by-side */}
          <div className={`grid ${isFund ? 'md:grid-cols-1' : 'md:grid-cols-2'} gap-3`}>
            <Card title="By payment method" icon={<CreditCard size={14} className="text-purple-600" />}>
              {data.by_method.length === 0 ? <Empty msg="No data." /> : (
                <ul className="space-y-2 text-xs">
                  {data.by_method.map((m) => {
                    const pct = (m.total / data.summary.total_spent) * 100;
                    return (
                      <li key={m.method}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-medium text-gray-800 capitalize">{m.method.replace('_', ' ')}</span>
                          <span className="text-gray-700">{formatINR(m.total)} <span className="text-gray-400">· {m.count}</span></span>
                        </div>
                        <Bar pct={pct} tone="purple" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {!isFund && (
              <Card title="By category" icon={<Tag size={14} className="text-emerald-600" />}>
                {data.by_category.length === 0 ? <Empty msg="No data." /> : (
                  <ul className="space-y-2 text-xs">
                    {data.by_category.map((c) => {
                      const pct = (c.total / data.summary.total_spent) * 100;
                      return (
                        <li key={c.category_id}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="font-medium text-gray-800 inline-flex items-center gap-1">
                              <span style={{ color: c.color ?? '#1B5E20' }}>{c.icon ?? '📦'}</span> {c.name}
                            </span>
                            <span className="text-gray-700">{formatINR(c.total)} <span className="text-gray-400">· {c.count}</span></span>
                          </div>
                          <Bar pct={pct} tone="emerald" />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            )}
          </div>

          {/* Reimbursements pending */}
          {data.pending_reimbursements.length > 0 && (
            <Card title="Pending reimbursements" icon={<HandCoins size={14} className="text-orange-600" />}>
              <ul className="space-y-1.5 text-xs">
                {data.pending_reimbursements.map((r) => (
                  <li key={r.person} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-gray-900 font-medium">{r.person}</p>
                      <p className="text-[10px] text-gray-500">
                        {r.pending_count} unreimbursed spend{r.pending_count === 1 ? '' : 's'} · oldest {new Date(r.oldest_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <span className="text-orange-700 font-bold whitespace-nowrap">{formatINR(r.pending_total)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Fund efficiency — overall mode shows all funds; per-fund mode shows just one (already obvious in fund header so we hide unless not compact) */}
          {!isFund && data.fund_efficiency.length > 0 && (
            <Card title="Per-fund efficiency" icon={<Trophy size={14} className="text-blue-600" />} subtitle="Funds with spends in this window. % shown is spent / collected.">
              <div className="space-y-2 text-xs">
                {data.fund_efficiency.map((f) => {
                  const pct = f.pct_spent ?? 0;
                  const isOverBudget = f.collected > 0 && f.spent > f.collected;
                  return (
                    <div key={f.id} className="space-y-0.5">
                      <div className="flex items-center justify-between">
                        <Link href={`/admin/funds/${f.id}`} className="font-semibold text-gray-900 hover:underline truncate">{f.name}</Link>
                        <span className={`font-bold whitespace-nowrap ${isOverBudget ? 'text-red-700' : f.balance < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                          {formatINRCompact(f.spent)} / {formatINRCompact(f.collected)}
                          {f.pct_spent !== null ? <span className="text-gray-500 font-normal"> · {pct}%</span> : null}
                        </span>
                      </div>
                      <Bar pct={Math.min(100, pct)} tone={isOverBudget ? 'red' : pct > 80 ? 'amber' : 'emerald'} />
                      {isOverBudget && (
                        <p className="text-[10px] text-red-700 font-semibold">Over budget by {formatINR(f.spent - f.collected)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Anomalies */}
          {data.anomalies.length > 0 && (
            <Card title={`Anomalies (${data.anomalies.length})`} icon={<AlertCircle size={14} className="text-red-600" />} tone="red">
              <ul className="space-y-2 text-xs">
                {data.anomalies.slice(0, 12).map((a) => (
                  <li key={a.id} className="bg-white rounded-lg border border-red-100 p-2">
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/funds/${a.fund_id}`} className="flex-1 min-w-0 hover:underline">
                        <p className="truncate text-gray-900 font-medium">{a.description}</p>
                        <p className="text-[10px] text-gray-500 truncate">
                          {!isFund ? `${a.fund_name} · ` : ''}{a.vendor_name ?? '(no vendor)'} · {new Date(a.spend_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </p>
                      </Link>
                      <span className="text-red-700 font-bold whitespace-nowrap">−{formatINR(a.amount)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {a.flags.includes('over_budget') && <Badge icon={<AlertCircle size={10} />} text="Over budget" tone="red" />}
                      {a.flags.includes('very_large') && <Badge icon={<TrendingUp size={10} />} text="Unusually large" tone="amber" />}
                      {a.flags.includes('missing_receipt') && <Badge icon={<FileWarning size={10} />} text="Missing receipt" tone="orange" />}
                    </div>
                  </li>
                ))}
                {data.anomalies.length > 12 && (
                  <li className="text-[11px] text-gray-500 text-center pt-1">
                    + {data.anomalies.length - 12} more
                  </li>
                )}
              </ul>
            </Card>
          )}
        </div>
      )}

      {compact && null}
    </div>
  );
}

function RangeTabs({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const opts: { id: Range; label: string }[] = [
    { id: '1m', label: '1M' },
    { id: '3m', label: '3M' },
    { id: '1y', label: '1Y' },
    { id: 'all', label: 'All' },
  ];
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 rounded-md font-semibold ${value === o.id ? 'bg-white shadow text-[#1B5E20]' : 'text-gray-600'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({ icon, label, value, tone, sub }: { icon: React.ReactNode; label: string; value: string; tone: 'red' | 'amber' | 'gray' | 'orange'; sub?: string }) {
  const bg = { red: 'bg-red-50', amber: 'bg-amber-50', gray: 'bg-gray-50', orange: 'bg-orange-50' }[tone];
  const text = { red: 'text-red-800', amber: 'text-amber-800', gray: 'text-gray-900', orange: 'text-orange-800' }[tone];
  return (
    <div className={`${bg} rounded-xl p-2.5`}>
      <div className="flex items-center gap-1 text-[10px] uppercase font-semibold text-gray-600 tracking-wide">
        {icon} {label}
      </div>
      <p className={`text-base font-bold ${text} mt-0.5`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500">{sub}</p>}
    </div>
  );
}

function Card({ title, icon, subtitle, children, tone }: { title: string; icon?: React.ReactNode; subtitle?: string; children: React.ReactNode; tone?: 'red' }) {
  const bg = tone === 'red' ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200';
  return (
    <section className={`${bg} border rounded-xl p-3`}>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h3 className="text-xs uppercase font-semibold text-gray-700 tracking-wide">{title}</h3>
      </div>
      {subtitle && <p className="text-[11px] text-gray-500 -mt-1 mb-2">{subtitle}</p>}
      {children}
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-xs text-gray-400 italic py-2">{msg}</p>;
}

function Bar({ pct, tone }: { pct: number; tone: 'red' | 'amber' | 'emerald' | 'purple' }) {
  // Width is dynamic — has to be inline. Same pattern as the rest of the codebase.
  const colour = { red: 'bg-red-500', amber: 'bg-amber-500', emerald: 'bg-emerald-500', purple: 'bg-purple-500' }[tone];
  const width = `${Math.max(2, Math.min(100, pct))}%`;
  return (
    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`${colour} h-full rounded-full`} style={{ width }} />
    </div>
  );
}

function Badge({ icon, text, tone }: { icon: React.ReactNode; text: string; tone: 'red' | 'amber' | 'orange' }) {
  const cls = {
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    orange: 'bg-orange-100 text-orange-800',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      {icon} {text}
    </span>
  );
}
