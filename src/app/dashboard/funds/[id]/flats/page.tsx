'use client';
import { use as usePromise } from 'react';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatINR } from '@/lib/money';

interface FlatRow {
  flat_number: string;
  resident_name: string;
  contributed: number;
  contribution_count: number;
  last_contributed_on: string | null;
  flat_status: 'paid' | 'partial' | 'pending';
}

interface SummaryRow {
  total_flats: number;
  paid: number;
  partial: number;
  pending: number;
  suggested_per_flat: number;
}

interface FundShape { id: string; name: string }

export default function FundFlatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const { mounted } = useAuth();
  const [fund, setFund] = useState<FundShape | null>(null);
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [rows, setRows] = useState<FlatRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'paid' | 'partial' | 'pending'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [fJ, gJ] = await Promise.all([
        fetch(`/api/funds/${id}`).then((r) => r.json()),
        fetch(`/api/funds/${id}/flats`).then((r) => r.json()),
      ]);
      if (cancelled) return;
      setFund(fJ.fund ?? null);
      setSummary(gJ.summary ?? null);
      setRows(gJ.flats ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, mounted]);

  // Group by tower (first letter of flat_number)
  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (filter !== 'all' && r.flat_status !== filter) return false;
      if (search && !r.flat_number.toLowerCase().includes(search.toLowerCase())
          && !r.resident_name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, filter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, FlatRow[]>();
    for (const r of visible) {
      const tower = (r.flat_number.match(/^[A-Za-z]+/)?.[0] ?? '#').toUpperCase();
      const arr = map.get(tower) ?? [];
      arr.push(r);
      map.set(tower, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <Link
        href={`/dashboard/funds/${id}`}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3"
      >
        <ArrowLeft size={16} /> Back to fund
      </Link>

      <header className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Flat-wise contributions</h1>
        <p className="text-sm text-gray-600 mt-1 truncate">{fund?.name}</p>
        {summary?.suggested_per_flat ? (
          <p className="text-xs text-gray-500 mt-0.5">Suggested {formatINR(summary.suggested_per_flat)} per flat</p>
        ) : null}
      </header>

      {/* Summary chips */}
      {summary && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Chip label="✅ Paid" value={summary.paid} active={filter === 'paid'} onClick={() => setFilter(filter === 'paid' ? 'all' : 'paid')} accent="bg-emerald-50 text-emerald-700" />
          <Chip label="🟡 Partial" value={summary.partial} active={filter === 'partial'} onClick={() => setFilter(filter === 'partial' ? 'all' : 'partial')} accent="bg-amber-50 text-amber-700" />
          <Chip label="⚪ Pending" value={summary.pending} active={filter === 'pending'} onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')} accent="bg-gray-100 text-gray-700" />
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          placeholder="Search flat or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-10 text-center">Loading...</p>
      ) : grouped.length === 0 ? (
        <p className="text-gray-500 text-sm py-10 text-center">No flats match this filter.</p>
      ) : (
        <div className="space-y-5">
          {grouped.map(([tower, flats]) => (
            <section key={tower}>
              <h2 className="text-xs uppercase font-bold text-gray-400 mb-2 tracking-wider">Tower {tower}</h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {flats.map((f) => (
                  <FlatTile key={f.flat_number} row={f} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, value, active, onClick, accent }: { label: string; value: number; active: boolean; onClick: () => void; accent: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
        active ? 'border-[#1B5E20] ring-2 ring-[#1B5E20]/20' : 'border-gray-200'
      } ${accent}`}
    >
      <p className="text-base font-bold">{value}</p>
      <p className="text-[11px] mt-0.5">{label}</p>
    </button>
  );
}

function FlatTile({ row }: { row: FlatRow }) {
  const cls =
    row.flat_status === 'paid' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : row.flat_status === 'partial' ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-white text-gray-500 border-gray-200';
  const icon =
    row.flat_status === 'paid' ? '✓'
    : row.flat_status === 'partial' ? '◐'
    : '○';

  return (
    <Link
      href={`/dashboard/funds/by-flat/${encodeURIComponent(row.flat_number)}`}
      className={`flex flex-col items-center justify-center px-2 py-3 rounded-xl border text-center hover:shadow-sm transition-all ${cls}`}
    >
      <span className="text-xs font-bold leading-tight truncate max-w-full">{row.flat_number}</span>
      <span className="text-base font-bold mt-0.5">{icon}</span>
      {row.contributed > 0 && (
        <span className="text-[10px] mt-0.5 opacity-80">{formatINR(row.contributed)}</span>
      )}
    </Link>
  );
}
