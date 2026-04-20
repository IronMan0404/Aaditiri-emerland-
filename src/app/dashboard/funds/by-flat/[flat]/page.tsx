'use client';
import { use as usePromise } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, formatINRCompact } from '@/lib/money';
import type { FundContribution } from '@/types/funds';

interface JoinedContribution extends FundContribution {
  community_funds?: {
    id: string;
    name: string;
    status: string;
    fund_categories?: { icon: string | null; color: string | null; name: string | null };
  };
}

interface Resp {
  flat_number: string;
  total_contributed: number;
  contribution_count: number;
  contributions: JoinedContribution[];
}

export default function ByFlatPage({ params }: { params: Promise<{ flat: string }> }) {
  const { flat } = usePromise(params);
  const decodedFlat = decodeURIComponent(flat);
  const { mounted } = useAuth();
  const [data, setData] = useState<Resp | null>(null);

  useEffect(() => {
    if (!mounted) return;
    fetch(`/api/funds/by-flat/${encodeURIComponent(decodedFlat)}`)
      .then((r) => r.json())
      .then((j) => setData(j as Resp));
  }, [decodedFlat, mounted]);

  if (!data) {
    return <div className="max-w-3xl mx-auto p-6 text-gray-400 text-sm">Loading...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <Link href="/dashboard/funds" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft size={16} /> Back to funds
      </Link>

      <header className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Flat {data.flat_number}</h1>
        <p className="text-sm text-gray-600">Contribution history across all community funds</p>
      </header>

      <div className="bg-gradient-to-br from-[#1B5E20] to-[#2E7D32] text-white rounded-2xl p-5 mb-5">
        <p className="text-sm text-white/80">Total contributed</p>
        <p className="text-3xl font-bold">{formatINRCompact(data.total_contributed)}</p>
        <p className="text-xs text-white/70 mt-1">{data.contribution_count} contributions</p>
      </div>

      {data.contributions.length === 0 ? (
        <div className="text-center py-10 text-gray-500 bg-white rounded-2xl border border-dashed border-gray-200">
          <Wallet className="mx-auto opacity-40 mb-2" size={28} />
          <p className="text-sm">No contributions recorded for this flat yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
          {data.contributions.map((c) => (
            <Link
              key={c.id}
              href={c.community_funds ? `/dashboard/funds/${c.community_funds.id}` : '#'}
              className="flex items-start gap-3 p-3 hover:bg-gray-50"
            >
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
                style={{
                  background: `${c.community_funds?.fund_categories?.color ?? '#1B5E20'}1A`,
                  color: c.community_funds?.fund_categories?.color ?? '#1B5E20',
                }}
              >
                {c.community_funds?.fund_categories?.icon ?? '📦'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {c.community_funds?.name ?? 'Fund'}
                  </p>
                  <p className="text-sm font-bold text-emerald-700 flex-shrink-0">
                    {c.is_in_kind ? 'In-kind' : formatINR(c.amount)}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  <span>{new Date(c.contribution_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span className="uppercase">· {c.method}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
