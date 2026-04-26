'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, Search, Users, Loader2, AlertTriangle, ChevronDown, ChevronRight, Plus, Bell } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, formatINRCompact } from '@/lib/money';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

interface FundLite {
  id: string; name: string; suggested_per_flat: number; category: string | null; icon: string | null; color: string | null;
}

interface DueLine { fund_id: string; fund_name: string; suggested: number; paid: number; pending: number }

interface FlatDues {
  flat_number: string; resident_name: string;
  total_owed: number; total_paid: number; total_suggested: number;
  dues: DueLine[];
}

interface Summary {
  total_owed_all: number;
  total_paid_all: number;
  flats_with_dues: number;
  fully_paid_flats: number;
  fund_count: number;
  suggested_total_per_flat: number;
}

export default function AdminDuesPage() {
  const { isAdmin, mounted } = useAuth();
  const [funds, setFunds] = useState<FundLite[]>([]);
  const [flats, setFlats] = useState<FlatDues[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'owes' | 'paid' | 'all'>('owes');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch('/api/admin/funds/dues');
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `Dues API failed (${r.status})`);
        }
        const j = await r.json();
        if (cancelled) return;
        setFunds(j.funds ?? []);
        setFlats(j.flats ?? []);
        setSummary(j.summary ?? null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, mounted]);

  const filtered = useMemo(() => {
    return flats.filter((f) => {
      if (filter === 'owes' && f.total_owed === 0) return false;
      if (filter === 'paid' && f.total_owed > 0) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!f.flat_number.toLowerCase().includes(q) && !f.resident_name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [flats, filter, search]);

  // ─── Send-alert flow ──────────────────────────────────────────────
  // Two-step: Open modal → fetch preview (recipient count + total) →
  // admin confirms → POST without preview flag → fan-out runs.
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertPreview, setAlertPreview] = useState<{
    flats_with_dues: number;
    recipients_count: number;
    total_pending_paise: number;
  } | null>(null);
  const [alertLoading, setAlertLoading] = useState(false);
  const [alertSending, setAlertSending] = useState(false);

  async function openAlertModal() {
    setAlertOpen(true);
    setAlertLoading(true);
    setAlertPreview(null);
    try {
      const r = await fetch('/api/admin/funds/dues/alert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'global', preview: true }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error ?? 'Could not preview dues alert');
        setAlertOpen(false);
        return;
      }
      setAlertPreview({
        flats_with_dues: j.flats_with_dues,
        recipients_count: j.recipients_count,
        total_pending_paise: j.total_pending_paise,
      });
    } catch (e) {
      toast.error((e as Error).message);
      setAlertOpen(false);
    } finally {
      setAlertLoading(false);
    }
  }

  async function sendAlert() {
    setAlertSending(true);
    try {
      const r = await fetch('/api/admin/funds/dues/alert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'global' }),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(j.error ?? 'Failed to send dues alert');
        return;
      }
      toast.success(
        `Dues alert queued for ${j.recipients_count} resident${j.recipients_count === 1 ? '' : 's'} across ${j.flats_with_dues} flat${j.flats_with_dues === 1 ? '' : 's'}.`,
      );
      setAlertOpen(false);
    } finally {
      setAlertSending(false);
    }
  }

  function toggle(flat: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(flat)) next.delete(flat); else next.add(flat);
      return next;
    });
  }

  if (mounted && !isAdmin) {
    return <div className="max-w-3xl mx-auto p-6 text-sm text-gray-500">Admin access required.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <Link href="/admin/funds" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft size={16} /> Back to manage funds
      </Link>

      <header className="mb-5 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <AlertCircle className="text-amber-700" /> Pending dues per flat
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Across every active collecting fund with a per-flat suggestion. Dues = suggested − verified paid.
          </p>
        </div>
        {summary && summary.flats_with_dues > 0 ? (
          <button
            onClick={openAlertModal}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 bg-amber-600 text-white text-xs font-semibold rounded-xl hover:bg-amber-700 transition-colors"
            title="Send a Telegram + push reminder to every flat with outstanding dues"
          >
            <Bell size={14} /> Send dues alert
          </button>
        ) : null}
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-12 justify-center">
          <Loader2 className="animate-spin" /> Crunching dues...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm">
          <p className="font-semibold text-red-800 flex items-center gap-1.5"><AlertTriangle size={16} /> Couldn&apos;t compute dues</p>
          <p className="text-red-700 mt-1">{error}</p>
        </div>
      ) : summary && summary.fund_count === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
          <p className="font-semibold">No active dues to track right now.</p>
          <p className="mt-1">Dues are calculated from active collecting funds that have a <span className="font-semibold">suggested per flat</span> set.
            Either there are no active collecting funds, or none of them have a per-flat amount.
            Create one or set a per-flat suggestion on an existing fund to populate this page.
          </p>
        </div>
      ) : summary ? (
        <>
          {/* Summary bar */}
          <section className="bg-white rounded-2xl border border-gray-200 p-4 mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-red-50 rounded-xl p-3">
              <p className="text-[11px] uppercase font-semibold text-gray-600 tracking-wide">Total pending</p>
              <p className="text-xl font-bold text-red-800 mt-1">{formatINRCompact(summary.total_owed_all)}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{summary.flats_with_dues} flat{summary.flats_with_dues === 1 ? '' : 's'} owe money</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-3">
              <p className="text-[11px] uppercase font-semibold text-gray-600 tracking-wide">Total received</p>
              <p className="text-xl font-bold text-emerald-800 mt-1">{formatINRCompact(summary.total_paid_all)}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{summary.fully_paid_flats} flat{summary.fully_paid_flats === 1 ? '' : 's'} fully paid</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-[11px] uppercase font-semibold text-gray-600 tracking-wide">Active funds</p>
              <p className="text-xl font-bold text-blue-800 mt-1">{summary.fund_count}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">with per-flat suggestion</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[11px] uppercase font-semibold text-gray-600 tracking-wide">Suggested / flat</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{formatINRCompact(summary.suggested_total_per_flat)}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">if every flat paid in full</p>
            </div>
          </section>

          {/* Filter bar */}
          <div className="bg-white rounded-2xl border border-gray-200 p-3 mb-3 flex flex-wrap items-center gap-2">
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {(['owes', 'paid', 'all'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold ${filter === k ? 'bg-white shadow text-[#1B5E20]' : 'text-gray-600'}`}
                >
                  {k === 'owes' ? 'Owes money' : k === 'paid' ? 'Fully paid' : 'All flats'}
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-[180px] flex items-center gap-1.5 px-2 bg-gray-50 border border-gray-200 rounded-lg">
              <Search size={14} className="text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by flat or resident name..."
                className="flex-1 bg-transparent py-1.5 text-sm focus:outline-none"
              />
            </div>
            <p className="text-xs text-gray-500 ml-auto"><Users size={12} className="inline -mt-0.5 mr-1" />{filtered.length} flat{filtered.length === 1 ? '' : 's'}</p>
          </div>

          {/* Active funds chip row */}
          <div className="bg-white rounded-2xl border border-gray-200 p-3 mb-3 flex flex-wrap gap-2">
            <p className="text-xs text-gray-500 self-center">Tracking:</p>
            {funds.map((f) => (
              <Link
                key={f.id}
                href={`/admin/funds/${f.id}`}
                className="inline-flex items-center gap-1.5 px-2 py-1 bg-gray-50 hover:bg-gray-100 rounded-full text-xs"
              >
                <span style={{ color: f.color ?? '#1B5E20' }}>{f.icon ?? '📦'}</span>
                <span className="font-medium text-gray-800">{f.name}</span>
                <span className="text-gray-500">·</span>
                <span className="text-gray-500">{formatINR(f.suggested_per_flat)}/flat</span>
              </Link>
            ))}
          </div>

          {/* Flat rows */}
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-500 py-12 text-center">No flats match this filter.</p>
            ) : (
              filtered.map((f) => {
                const isOpen = expanded.has(f.flat_number);
                const owesNothing = f.total_owed === 0 && f.total_paid > 0;
                return (
                  <div key={f.flat_number}>
                    <button
                      onClick={() => toggle(f.flat_number)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 text-left"
                    >
                      {isOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900">Flat {f.flat_number}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {f.resident_name || '(no resident name)'} · paid {formatINR(f.total_paid)} of {formatINR(f.total_suggested)}
                        </p>
                      </div>
                      {f.total_owed > 0 ? (
                        <span className="text-sm font-bold text-red-700">−{formatINRCompact(f.total_owed)}</span>
                      ) : owesNothing ? (
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">PAID</span>
                      ) : (
                        <span className="text-xs text-gray-400">no payments</span>
                      )}
                    </button>
                    {isOpen ? (
                      <div className="bg-gray-50 px-4 py-2 space-y-1 border-t border-gray-100">
                        {f.dues.map((d) => {
                          // Build a deep-link to the fund admin page that
                          // auto-opens the quick-add modal pre-filled with
                          // this flat's pending amount. One click → confirm
                          // → save (the fastest possible "I have the cash
                          // in hand, log it for them" flow).
                          const recordHref = d.pending > 0
                            ? `/admin/funds/${d.fund_id}?record=1&flat=${encodeURIComponent(f.flat_number)}&amount=${Math.round(d.pending / 100)}${f.resident_name ? `&name=${encodeURIComponent(f.resident_name)}` : ''}`
                            : null;
                          return (
                            <div key={d.fund_id} className="flex items-center gap-3 py-1.5 text-xs">
                              <span className="flex-1 text-gray-700 truncate">{d.fund_name}</span>
                              <span className="text-gray-500">{formatINR(d.paid)} / {formatINR(d.suggested)}</span>
                              <span className={`font-bold w-20 text-right ${d.pending > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                                {d.pending > 0 ? `−${formatINR(d.pending)}` : 'PAID'}
                              </span>
                              {recordHref ? (
                                <Link
                                  href={recordHref}
                                  className="inline-flex items-center gap-1 px-2 py-1 bg-[#1B5E20] text-white text-[11px] font-semibold rounded-md hover:bg-emerald-800 shrink-0"
                                  title={`Record payment for Flat ${f.flat_number}`}
                                >
                                  <Plus size={10} /> Record
                                </Link>
                              ) : (
                                <span className="w-[68px] shrink-0" aria-hidden />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : null}

      {/* Dues alert confirm modal */}
      <Modal open={alertOpen} onClose={() => !alertSending && setAlertOpen(false)} title="Send pending-dues alert?">
        {alertLoading ? (
          <div className="py-6 flex items-center justify-center gap-2 text-gray-500 text-sm">
            <Loader2 className="animate-spin" size={16} /> Counting recipients…
          </div>
        ) : alertPreview ? (
          <div className="space-y-3">
            {alertPreview.recipients_count === 0 ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800">
                No flats currently owe money. Nothing to send.
              </div>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 space-y-1.5">
                  <p>
                    This will DM <strong>{alertPreview.recipients_count} resident{alertPreview.recipients_count === 1 ? '' : 's'}</strong> across{' '}
                    <strong>{alertPreview.flats_with_dues} flat{alertPreview.flats_with_dues === 1 ? '' : 's'}</strong> via Telegram (where linked) and push (where subscribed).
                  </p>
                  <p>
                    Total outstanding: <strong>{formatINR(alertPreview.total_pending_paise)}</strong>.
                  </p>
                  <p className="text-amber-700">
                    Each resident sees only their own flat&apos;s amount. Residents who have already paid in full are skipped.
                  </p>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button type="button" variant="secondary" onClick={() => setAlertOpen(false)} className="flex-1" disabled={alertSending}>
                    Cancel
                  </Button>
                  <Button type="button" variant="primary" onClick={sendAlert} loading={alertSending} className="flex-1">
                    Send alert
                  </Button>
                </div>
              </>
            )}
            {alertPreview.recipients_count === 0 ? (
              <Button type="button" variant="secondary" onClick={() => setAlertOpen(false)} className="w-full">
                Close
              </Button>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
