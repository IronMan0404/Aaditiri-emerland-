'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, CheckCircle2, Clock, Loader2, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, formatINRCompact } from '@/lib/money';

interface Due {
  fund_id: string;
  fund_name: string;
  category: string | null;
  icon: string | null;
  color: string | null;
  deadline: string | null;
  suggested: number;
  paid: number;
  pending: number;
  status: 'paid' | 'partial' | 'pending';
}

interface Summary { total_owed: number; total_paid: number; fund_count: number; open_dues_count: number }

export default function MyDuesPage() {
  const { mounted, profile } = useAuth();
  const [dues, setDues] = useState<Due[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await fetch('/api/funds/my-dues');
      const j = await r.json();
      if (cancelled) return;
      setDues(j.dues ?? []);
      setSummary(j.summary ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [mounted]);

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <Link href="/dashboard/funds" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft size={16} /> Back to funds
      </Link>

      <header className="mb-5">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Wallet className="text-[#1B5E20]" /> What I owe
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {profile?.flat_number ? `Flat ${profile.flat_number} — ` : ''}
          your dues across every active community fund.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-12 justify-center">
          <Loader2 className="animate-spin" /> Loading...
        </div>
      ) : !profile?.flat_number ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
          Your profile doesn&apos;t have a flat number yet, so we can&apos;t calculate dues. Ask an admin to set it on your profile.
        </div>
      ) : !summary || summary.fund_count === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <CheckCircle2 className="mx-auto text-emerald-500 mb-2" size={32} />
          <p className="text-sm text-gray-700 font-semibold">No active dues right now.</p>
          <p className="text-xs text-gray-500 mt-1">There aren&apos;t any active funds with a per-flat suggestion at the moment.</p>
        </div>
      ) : (
        <>
          {/* Summary hero */}
          <section className={`rounded-2xl p-5 mb-5 border ${summary.total_owed > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className="text-xs uppercase font-semibold tracking-wide text-gray-600">You owe</p>
            <p className={`text-3xl md:text-4xl font-bold mt-1 ${summary.total_owed > 0 ? 'text-red-800' : 'text-emerald-800'}`}>
              {formatINRCompact(summary.total_owed)}
            </p>
            <p className="text-xs text-gray-600 mt-2">
              {summary.open_dues_count > 0
                ? `Across ${summary.open_dues_count} of ${summary.fund_count} active fund${summary.fund_count === 1 ? '' : 's'}. You've paid ${formatINR(summary.total_paid)} so far.`
                : `You're all caught up across ${summary.fund_count} active fund${summary.fund_count === 1 ? '' : 's'}. You've paid ${formatINR(summary.total_paid)}.`}
            </p>
          </section>

          {/* Per-fund rows */}
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {dues.map((d) => (
              <Link
                key={d.fund_id}
                href={d.pending > 0 ? `/dashboard/funds/${d.fund_id}/contribute` : `/dashboard/funds/${d.fund_id}`}
                className="flex items-center gap-3 p-3 hover:bg-gray-50"
              >
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{
                    background: `${d.color ?? '#1B5E20'}1A`,
                    color: d.color ?? '#1B5E20',
                  }}
                >
                  {d.icon ?? '📦'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{d.fund_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>{formatINR(d.paid)} of {formatINR(d.suggested)}</span>
                    {d.deadline ? (
                      <>
                        <span className="text-gray-300">·</span>
                        <span className="inline-flex items-center gap-0.5">
                          <Clock size={11} />
                          due {new Date(d.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                {d.status === 'paid' ? (
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full inline-flex items-center gap-1">
                    <CheckCircle2 size={12} /> PAID
                  </span>
                ) : d.status === 'partial' ? (
                  <span className="text-right">
                    <span className="block text-xs font-bold text-amber-700">−{formatINR(d.pending)}</span>
                    <span className="text-[10px] text-gray-500">remaining</span>
                  </span>
                ) : (
                  <span className="text-right">
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700"><AlertCircle size={11} />−{formatINR(d.pending)}</span>
                    <span className="block text-[10px] text-gray-500">unpaid</span>
                  </span>
                )}
              </Link>
            ))}
          </div>

          <p className="text-xs text-gray-400 text-center mt-4">
            Tap an unpaid fund to record your payment.
          </p>
        </>
      )}
    </div>
  );
}
