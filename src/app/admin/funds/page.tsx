'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Wallet, Loader2, Settings, AlertCircle, AlertTriangle, Receipt, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, formatINRCompact } from '@/lib/money';
import type { CommunityFund, FundCategory } from '@/types/funds';

type Row = Omit<CommunityFund, 'fund_categories'> & {
  fund_categories?: Pick<FundCategory, 'icon' | 'color' | 'name' | 'code'>;
};

export default function AdminFundsPage() {
  const { isAdmin, mounted } = useAuth();
  const [funds, setFunds] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/funds');
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `Funds API failed (${res.status})`);
        }
        const j = await res.json();
        if (cancelled) return;
        setFunds(j.funds ?? []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, mounted]);

  if (mounted && !isAdmin) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-gray-500 text-sm">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Wallet className="text-[#1B5E20]" /> Manage Funds
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Create funds, verify contributions, record spends, close out completed pots.
          </p>
        </div>
        <Link
          href="/admin/funds/new"
          className="bg-[#1B5E20] hover:bg-[#2E7D32] text-white px-4 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5"
        >
          <Plus size={16} /> New Fund
        </Link>
      </header>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Link href="/admin/funds/verify" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
            <AlertCircle size={16} /> Verify queue
          </div>
          <p className="text-xs text-amber-700 mt-1">Approve reported contributions.</p>
        </Link>
        <Link href="/admin/funds/spends" className="bg-rose-50 border border-rose-200 rounded-2xl p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 text-rose-800 font-semibold text-sm">
            <Receipt size={16} /> Spending overview
          </div>
          <p className="text-xs text-rose-700 mt-1">In vs out, by category, last 12 months.</p>
        </Link>
        <Link href="/admin/funds/dues" className="bg-orange-50 border border-orange-200 rounded-2xl p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 text-orange-800 font-semibold text-sm">
            <Users size={16} /> Pending dues per flat
          </div>
          <p className="text-xs text-orange-700 mt-1">Who&apos;s paid, who hasn&apos;t, fund-by-fund.</p>
        </Link>
        <Link href="/dashboard/funds/balance-sheet" className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
            <Wallet size={16} /> Balance sheet
          </div>
          <p className="text-xs text-emerald-700 mt-1">Public view all residents see.</p>
        </Link>
        <Link href="/dashboard/funds" className="bg-gray-50 border border-gray-200 rounded-2xl p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 text-gray-800 font-semibold text-sm">
            <Settings size={16} /> Resident view
          </div>
          <p className="text-xs text-gray-600 mt-1">See it from a resident&apos;s perspective.</p>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-12 justify-center">
          <Loader2 className="animate-spin" /> Loading funds...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm">
          <p className="font-semibold text-red-800 flex items-center gap-1.5">
            <AlertTriangle size={16} /> Funds tables aren&apos;t set up
          </p>
          <p className="text-red-700 mt-1">{error}</p>
          <p className="text-red-700 mt-2">
            Apply the migration{' '}
            <code className="bg-red-100 px-1 rounded">supabase/migrations/20260424_community_funds.sql</code>{' '}
            with <code className="bg-red-100 px-1 rounded">npx supabase db push</code> (or paste it into the Supabase
            SQL editor) and refresh this page.
          </p>
        </div>
      ) : funds.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-gray-200">
          <Wallet className="mx-auto opacity-40 mb-3" size={32} />
          <p className="text-sm text-gray-500 mb-3">No funds yet.</p>
          <Link
            href="/admin/funds/new"
            className="bg-[#1B5E20] hover:bg-[#2E7D32] text-white px-4 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5"
          >
            <Plus size={16} /> Create the first fund
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
          {funds.map((f) => {
            const balance = f.total_collected - f.total_spent - f.total_refunded;
            return (
              <Link
                key={f.id}
                href={`/admin/funds/${f.id}`}
                className="flex items-center gap-3 p-3 hover:bg-gray-50"
              >
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{
                    background: `${f.fund_categories?.color ?? '#1B5E20'}1A`,
                    color: f.fund_categories?.color ?? '#1B5E20',
                  }}
                >
                  {f.fund_categories?.icon ?? '📦'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-gray-900 truncate">{f.name}</p>
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                      {f.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {f.fund_categories?.name} · {formatINR(f.total_collected)} in / {formatINR(f.total_spent)} out
                  </p>
                </div>
                <p className="text-sm font-bold text-gray-900 hidden sm:block">{formatINRCompact(balance)}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
