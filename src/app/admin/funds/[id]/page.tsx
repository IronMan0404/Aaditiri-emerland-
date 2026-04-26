'use client';
import { use as usePromise } from 'react';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Plus, CheckCircle2, XCircle, Receipt, Lock, Trash2, Edit3, Ban, Upload, Wallet, AlertTriangle, Bell, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { formatINR, formatINRCompact } from '@/lib/money';
import SpendAnalysis from '@/components/funds/SpendAnalysis';
import type { CommunityFund, FundCategory, FundContribution, FundSpend, ContributionMethod, SpendMethod } from '@/types/funds';

interface FundFull extends CommunityFund { fund_categories?: FundCategory }

export default function AdminFundDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAdmin, mounted } = useAuth();

  const [fund, setFund] = useState<FundFull | null>(null);
  const [pending, setPending] = useState<FundContribution[]>([]);
  const [received, setReceived] = useState<FundContribution[]>([]);
  const [rejected, setRejected] = useState<FundContribution[]>([]);
  const [spends, setSpends] = useState<FundSpend[]>([]);
  const [loading, setLoading] = useState(true);

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  // Optional prefill for the quick-add modal (used by the dues page
  // deep-link and any other "record payment for flat X" entry point).
  const [quickAddPrefill, setQuickAddPrefill] = useState<{ flat?: string; name?: string; amount?: string } | null>(null);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showSpend, setShowSpend] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  // Force-delete modal — opened when the safe-delete returns 409 (or
  // proactively from the admin clicking "Force delete" on a fund with
  // known activity). State holds the wipe counts so the modal can
  // show the admin exactly what's about to be irreversibly destroyed.
  const [forceDeleteCounts, setForceDeleteCounts] = useState<null | {
    contributions: number; spends: number; refunds: number;
    comments: number; attachments: number; child_funds: number;
  }>(null);

  // Per-fund "Send dues alert" — see /api/admin/funds/dues/alert.
  // Same two-step preview-then-confirm flow as the global alert on
  // /admin/funds/dues, scoped to this single fund.
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
        body: JSON.stringify({ mode: 'fund', fundId: id, preview: true }),
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
        body: JSON.stringify({ mode: 'fund', fundId: id }),
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

  const refresh = useCallback(async () => {
    setLoading(true);
    const [fJ, pJ, rJ, xJ, sJ] = await Promise.all([
      fetch(`/api/funds/${id}`).then((r) => r.json()),
      fetch(`/api/admin/funds/${id}/contributions?status=reported`).then((r) => r.json()),
      fetch(`/api/admin/funds/${id}/contributions?status=received`).then((r) => r.json()),
      fetch(`/api/admin/funds/${id}/contributions?status=rejected`).then((r) => r.json()),
      fetch(`/api/funds/${id}/spends`).then((r) => r.json()),
    ]);
    setFund(fJ.fund ?? null);
    setPending(pJ.contributions ?? []);
    setReceived(rJ.contributions ?? []);
    setRejected(xJ.contributions ?? []);
    setSpends(sJ.spends ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    refresh();
  }, [isAdmin, mounted, refresh]);

  // Deep-link: when navigated from the dues page (or anywhere else)
  // with ?record=1&flat=413&amount=500&name=Foo, open the quick-add
  // modal pre-filled. We only run this once per mount; otherwise an
  // admin saving and re-opening the modal would keep getting the
  // same prefilled values.
  useEffect(() => {
    if (!mounted || !isAdmin) return;
    if (searchParams.get('record') !== '1') return;
    setQuickAddPrefill({
      flat: searchParams.get('flat') ?? undefined,
      name: searchParams.get('name') ?? undefined,
      amount: searchParams.get('amount') ?? undefined,
    });
    setShowQuickAdd(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, isAdmin]);

  if (mounted && !isAdmin) {
    return <div className="max-w-3xl mx-auto p-6 text-sm text-gray-500">Admin access required.</div>;
  }
  if (loading || !fund) {
    return <div className="max-w-3xl mx-auto p-6 text-gray-400 text-sm">Loading...</div>;
  }

  const balance = fund.total_collected - fund.total_spent - fund.total_refunded;
  // Hard delete is only allowed when there are NO contribution rows of any
  // status (received/reported/rejected — they all hold a FK to the fund),
  // no spends, and no refunds. Looking at total_collected isn't enough:
  // in-kind rows have amount > 0 but don't roll into total_collected, and
  // rejected rows don't roll into anything but still hold the FK.
  const hasAnyActivity =
    pending.length > 0 || received.length > 0 || rejected.length > 0 || spends.length > 0;
  const canHardDelete = !hasAnyActivity;
  const canCancel = fund.status !== 'closed' && fund.status !== 'cancelled' && hasAnyActivity;

  async function verify(cid: string) {
    const res = await fetch(`/api/admin/funds/contributions/${cid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify' }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed');
      return;
    }
    toast.success('Verified');
    refresh();
  }

  async function deleteFund() {
    if (!confirm('Delete this fund permanently? Only allowed if there is no activity at all.')) return;
    const res = await fetch(`/api/admin/funds/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      // 409 = activity exists. We now offer TWO escape hatches: cancel
      // (preserves the row) or force-delete (irreversible). Open the
      // force-delete modal pre-loaded with the counts the API just gave
      // us so the admin can make an informed choice.
      if (res.status === 409 && j.code === 'has_activity' && j.counts) {
        setForceDeleteCounts(j.counts);
        return;
      }
      toast.error(j.error ?? 'Failed');
      return;
    }
    toast.success('Deleted');
    router.push('/admin/funds');
  }

  // Called from the ForceDeleteModal once the admin has typed the fund
  // name + reason. Hits the API with ?force=true.
  async function forceDeleteFund(payload: { confirm_phrase: string; reason: string }) {
    const res = await fetch(`/api/admin/funds/${id}?force=true`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Force delete failed');
      return;
    }
    const j = await res.json();
    const wiped = (j.wiped ?? {}) as Record<string, number>;
    const wipedSummary = Object.entries(wiped)
      .filter(([, n]) => Number(n) > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ');
    toast.success(`Force-deleted${wipedSummary ? ` (wiped ${wipedSummary})` : ''}`, { duration: 7000 });
    router.push('/admin/funds');
  }

  async function deleteSpend(sid: string) {
    if (!confirm('Delete this spend?')) return;
    const res = await fetch(`/api/admin/funds/spends/${sid}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed');
      return;
    }
    toast.success('Deleted');
    refresh();
  }

  async function markReimbursed(sid: string) {
    const res = await fetch(`/api/admin/funds/spends/${sid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark_reimbursed: true }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed');
      return;
    }
    toast.success('Marked reimbursed');
    refresh();
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <Link href="/admin/funds" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft size={16} /> Back to admin
      </Link>

      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{fund.name}</h1>
          <p className="text-sm text-gray-500">
            {fund.fund_categories?.icon} {fund.fund_categories?.name} ·{' '}
            <span className="uppercase font-bold text-gray-700">{fund.status}</span>
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Link href={`/admin/funds/${id}/edit`} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1">
            <Edit3 size={14} /> Edit
          </Link>
          <Link href={`/dashboard/funds/${id}`} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-2 rounded-lg text-xs font-semibold">
            View as resident
          </Link>
        </div>
      </header>

      {/* Stats — collected (cash), in-kind value (separate), spent, balance */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Tile label="Cash collected" value={formatINRCompact(fund.total_collected)} />
        <Tile label="In-kind value" value={formatINRCompact(fund.total_in_kind_value ?? 0)} />
        <Tile label="Spent" value={formatINRCompact(fund.total_spent)} />
        <Tile label="Balance" value={formatINRCompact(balance)} highlight />
      </div>
      {fund.total_refunded > 0 && (
        <p className="text-xs text-gray-500 mb-5">Refunded: {formatINR(fund.total_refunded)}</p>
      )}

      {/* Hero CTA: most-used admin action on this page is "a flat owner
          paid me directly, record it for them" — make it impossible to miss. */}
      {fund.status === 'collecting' && (
        <div className="bg-gradient-to-r from-[#1B5E20] to-emerald-700 text-white rounded-2xl p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3 shadow-md">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base flex items-center gap-2"><Wallet size={18} /> Record a payment on behalf of a flat</p>
            <p className="text-xs text-emerald-50 mt-0.5">Use this when a resident paid you in cash, UPI, cheque or NEFT and you need to log it for them. Payments added here are auto-verified — no second approval needed.</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            <button
              onClick={() => { setQuickAddPrefill(null); setShowQuickAdd(true); }}
              className="bg-white text-[#1B5E20] font-semibold text-sm px-3 py-2 rounded-xl flex items-center gap-1.5 hover:bg-emerald-50"
            >
              <Plus size={14} /> Single payment
            </button>
            <button
              onClick={() => setShowBulkAdd(true)}
              className="bg-emerald-900/40 text-white font-semibold text-sm px-3 py-2 rounded-xl flex items-center gap-1.5 border border-white/30 hover:bg-emerald-900/60"
            >
              <Upload size={14} /> Bulk paste
            </button>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 mb-5">
        <Button onClick={() => { setQuickAddPrefill(null); setShowQuickAdd(true); }} size="sm">
          <Plus size={14} /> Record payment
        </Button>
        <Button onClick={() => setShowSpend(true)} size="sm" variant="outline">
          <Receipt size={14} /> Record spend
        </Button>
        {fund.status === 'collecting' && fund.suggested_per_flat && fund.suggested_per_flat > 0 ? (
          <Button onClick={openAlertModal} size="sm" variant="outline" className="!border-amber-300 !text-amber-700 hover:!bg-amber-50">
            <Bell size={14} /> Dues alert
          </Button>
        ) : null}
        {fund.status !== 'closed' && fund.status !== 'cancelled' && (
          <Button onClick={() => setShowClose(true)} size="sm" variant="secondary">
            <Lock size={14} /> Close fund
          </Button>
        )}
        {canCancel && (
          <Button onClick={() => setShowCancel(true)} size="sm" variant="outline">
            <Ban size={14} /> Cancel fund
          </Button>
        )}
        {/* Delete is always offered. Safe-delete is the API default; if the
            fund has child rows the API replies 409 + counts and we open the
            ForceDeleteModal which gates the destructive path behind a
            type-the-name confirmation + a reason captured in the audit log. */}
        <Button onClick={deleteFund} size="sm" variant="danger">
          <Trash2 size={14} /> {canHardDelete ? 'Delete' : 'Delete (has activity)'}
        </Button>
      </div>

      {/* Pending verification queue */}
      {pending.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5">
          <h2 className="text-sm font-bold text-amber-900 mb-3 flex items-center gap-2">
            🔔 {pending.length} pending verification
          </h2>
          <div className="bg-white rounded-xl divide-y divide-gray-100">
            {pending.map((c) => (
              <PendingRow
                key={c.id}
                c={c}
                onVerify={() => verify(c.id)}
                onReject={() => setRejectingId(c.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Verified contributions */}
      <section className="mb-5">
        <h2 className="text-sm font-bold text-gray-900 mb-2">Verified contributions ({received.length})</h2>
        {received.length === 0 ? (
          <p className="text-xs text-gray-500 py-4 text-center bg-white rounded-xl border border-dashed border-gray-200">None yet.</p>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {received.map((c) => (
              <div key={c.id} className="p-3 flex items-start gap-3 text-sm">
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{c.flat_number} · {c.contributor_name}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(c.contribution_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {c.method}
                    {c.reference_number && ` · …${c.reference_number.slice(-4)}`}
                  </p>
                  {c.is_in_kind && c.in_kind_description && (
                    <p className="text-xs text-gray-600 italic mt-0.5">{c.in_kind_description}</p>
                  )}
                </div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <p className={`font-bold ${c.is_in_kind ? 'text-purple-700' : 'text-emerald-700'}`}>
                    {formatINR(c.amount)}
                  </p>
                  {c.is_in_kind && (
                    <span className="text-[10px] uppercase tracking-wide font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded mt-0.5">
                      In-kind
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Spends */}
      <section className="mb-5">
        <h2 className="text-sm font-bold text-gray-900 mb-2">Spends ({spends.length})</h2>
        {spends.length === 0 ? (
          <p className="text-xs text-gray-500 py-4 text-center bg-white rounded-xl border border-dashed border-gray-200">None yet.</p>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {spends.map((s) => (
              <div key={s.id} className="p-3 flex items-center gap-3 text-sm">
                <Receipt size={16} className="text-red-600 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{s.description}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(s.spend_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {s.vendor_name && ` · ${s.vendor_name}`} · {s.payment_method.replace('_', ' ')}
                    {s.is_reimbursement && (s.reimbursed_at
                      ? <span className="ml-1 text-emerald-700 font-semibold">[Reimbursed]</span>
                      : <span className="ml-1 text-amber-700 font-semibold">[Pending reimbursement]</span>)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="font-bold text-red-600">−{formatINR(s.amount)}</p>
                  {s.is_reimbursement && !s.reimbursed_at && (
                    <button
                      onClick={() => markReimbursed(s.id)}
                      className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-semibold hover:bg-emerald-200"
                    >
                      Mark paid
                    </button>
                  )}
                  <button
                    onClick={() => deleteSpend(s.id)}
                    className="text-gray-400 hover:text-red-600"
                    aria-label="Delete spend"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Spend analysis for THIS fund (collapsed; only meaningful when there are spends) */}
      {spends.length > 0 && (
        <section className="mb-5">
          <details className="bg-white rounded-2xl border border-gray-200 p-4">
            <summary className="text-sm font-bold text-gray-900 cursor-pointer flex items-center gap-2">
              📊 Spend analysis for this fund
              <span className="text-[10px] uppercase font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                {spends.length} spend{spends.length === 1 ? '' : 's'}
              </span>
            </summary>
            <div className="mt-3">
              <SpendAnalysis fundId={id} showTitle={false} compact />
            </div>
          </details>
        </section>
      )}

      {/* Rejected (collapsed by default-style display) */}
      {rejected.length > 0 && (
        <section>
          <details className="bg-white rounded-2xl border border-gray-200 p-3">
            <summary className="text-sm font-bold text-gray-700 cursor-pointer">
              Rejected ({rejected.length})
            </summary>
            <div className="mt-2 divide-y divide-gray-100">
              {rejected.map((c) => (
                <div key={c.id} className="py-2 text-sm flex items-start gap-2">
                  <XCircle size={14} className="text-red-500 mt-1 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-700">{c.flat_number} · {c.contributor_name} · {formatINR(c.amount)}</p>
                    {c.rejection_reason && <p className="text-xs text-red-600 italic">Reason: {c.rejection_reason}</p>}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}

      <QuickAddModal
        open={showQuickAdd}
        onClose={() => { setShowQuickAdd(false); setQuickAddPrefill(null); }}
        fundId={id}
        prefill={quickAddPrefill}
        onSaved={refresh}
      />
      <BulkAddModal open={showBulkAdd} onClose={() => setShowBulkAdd(false)} fundId={id} onSaved={refresh} />
      <SpendModal open={showSpend} onClose={() => setShowSpend(false)} fundId={id} onSaved={refresh} />
      <CloseFundModal open={showClose} onClose={() => setShowClose(false)} fund={fund} onSaved={refresh} />
      <CancelFundModal
        open={showCancel}
        onClose={() => setShowCancel(false)}
        fundId={id}
        onSaved={() => router.push('/admin/funds')}
      />
      <RejectModal
        contributionId={rejectingId}
        onClose={() => setRejectingId(null)}
        onDone={refresh}
      />
      <ForceDeleteFundModal
        open={forceDeleteCounts !== null}
        onClose={() => setForceDeleteCounts(null)}
        fundName={fund.name}
        counts={forceDeleteCounts}
        onConfirm={async (payload) => {
          await forceDeleteFund(payload);
          setForceDeleteCounts(null);
        }}
      />

      {/* Per-fund dues alert confirm modal */}
      <Modal
        open={alertOpen}
        onClose={() => !alertSending && setAlertOpen(false)}
        title={`Send dues alert for "${fund.name}"?`}
      >
        {alertLoading ? (
          <div className="py-6 flex items-center justify-center gap-2 text-gray-500 text-sm">
            <Loader2 className="animate-spin" size={16} /> Counting recipients…
          </div>
        ) : alertPreview ? (
          <div className="space-y-3">
            {alertPreview.recipients_count === 0 ? (
              <>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800">
                  Every flat has paid this fund in full. Nothing to send.
                </div>
                <Button type="button" variant="secondary" onClick={() => setAlertOpen(false)} className="w-full">
                  Close
                </Button>
              </>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 space-y-1.5">
                  <p>
                    This will DM <strong>{alertPreview.recipients_count} resident{alertPreview.recipients_count === 1 ? '' : 's'}</strong> across{' '}
                    <strong>{alertPreview.flats_with_dues} flat{alertPreview.flats_with_dues === 1 ? '' : 's'}</strong> short on this fund.
                  </p>
                  <p>
                    Total outstanding: <strong>{formatINR(alertPreview.total_pending_paise)}</strong>.
                  </p>
                  <p className="text-amber-700">
                    Each resident sees their own flat&apos;s amount and a link to the fund.
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
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${highlight ? 'bg-gradient-to-br from-[#1B5E20] to-[#2E7D32] text-white' : 'bg-white border border-gray-200'}`}>
      <p className={`text-[11px] uppercase tracking-wider font-semibold ${highlight ? 'text-white/80' : 'text-gray-500'}`}>{label}</p>
      <p className={`text-xl font-bold mt-1 ${highlight ? 'text-white' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function PendingRow({ c, onVerify, onReject }: { c: FundContribution; onVerify: () => void; onReject: () => void }) {
  return (
    <div className="p-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">
          {c.flat_number} · {c.contributor_name}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {c.is_in_kind ? `In-kind: ${c.in_kind_description}` : `${formatINR(c.amount)} via ${c.method}`}
          {c.reference_number && ` · UTR ${c.reference_number}`}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          Reported {new Date(c.reported_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          {c.notes && ` · ${c.notes}`}
        </p>
        {c.screenshot_url && (
          <a href={c.screenshot_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#1B5E20] underline mt-1 inline-block">
            View screenshot
          </a>
        )}
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          onClick={onVerify}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1"
        >
          <CheckCircle2 size={12} /> Verify
        </button>
        <button
          onClick={onReject}
          className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1"
        >
          <XCircle size={12} /> Reject
        </button>
      </div>
    </div>
  );
}

function QuickAddModal({ open, onClose, fundId, prefill, onSaved }: {
  open: boolean;
  onClose: () => void;
  fundId: string;
  prefill?: { flat?: string; name?: string; amount?: string } | null;
  onSaved: () => void;
}) {
  const [flat, setFlat] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ContributionMethod>('cash');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // When opened with a prefill (e.g. from the dues page) hydrate the
  // form so the admin's first action is "confirm + save", not "type
  // the same flat number again".
  useEffect(() => {
    if (!open) return;
    if (prefill) {
      if (prefill.flat) setFlat(prefill.flat);
      if (prefill.name) setName(prefill.name);
      if (prefill.amount) setAmount(prefill.amount);
    }
  }, [open, prefill]);

  function reset() {
    setFlat(''); setName(''); setAmount(''); setMethod('cash'); setReference(''); setNotes('');
    setDate(new Date().toISOString().slice(0, 10));
  }

  async function submit() {
    if (!flat.trim()) { toast.error('Flat required'); return; }
    if (!amount || Number(amount) <= 0) { toast.error('Amount required'); return; }
    setSubmitting(true);
    const res = await fetch(`/api/admin/funds/${fundId}/contributions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flat_number: flat.trim(),
        contributor_name: name.trim() || undefined,
        amount: Number(amount),
        method,
        contribution_date: date,
        reference_number: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed'); return;
    }
    toast.success('Added');
    reset();
    onClose();
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Quick-add contribution">
      <div className="space-y-3">
        <Input label="Flat number *" value={flat} onChange={(e) => setFlat(e.target.value)} placeholder="A-101" />
        <Input label="Contributor name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-filled if not provided" />
        <Input label="Amount (₹) *" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Method *</label>
          <div className="grid grid-cols-3 gap-2">
            {(['cash', 'upi', 'cheque', 'neft', 'imps', 'other'] as ContributionMethod[]).map((m) => (
              <button key={m} type="button" onClick={() => setMethod(m)}
                className={`py-2 rounded-lg text-xs font-semibold uppercase border ${
                  method === m ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-300'
                }`}>{m}</button>
            ))}
          </div>
        </div>
        <Input label="Date *" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <Button onClick={submit} loading={submitting} className="w-full">Add as verified</Button>
      </div>
    </Modal>
  );
}

// Bulk paste-and-save modal. Accepts a free-form blob like:
//   413 500 upi
//   414 500 cash, John Doe
//   415, 300, cheque, CHQ#221
// Each non-empty line becomes one contribution. Tokens are split on
// commas first (preferred — survives names with spaces) and then on
// any whitespace (so the most common quick-paste "413 500 upi" works).
//
// Order of fields per row:
//   flat   amount   [method]   [contributor_name]   [reference]   [notes]
function BulkAddModal({ open, onClose, fundId, onSaved }: {
  open: boolean; onClose: () => void; fundId: string; onSaved: () => void;
}) {
  const [text, setText] = useState('');
  const [method, setMethod] = useState<ContributionMethod>('cash');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  const parsed = parseBulkText(text);

  async function submit() {
    if (parsed.rows.length === 0) {
      toast.error('No valid rows. Try one row per line: "413 500 upi"');
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/admin/funds/${fundId}/contributions/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: parsed.rows,
        default_method: method,
        contribution_date: date,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const detail = Array.isArray(j.errors)
        ? `\nRow ${j.errors[0].index + 1}: ${j.errors[0].message}`
        : '';
      toast.error((j.error ?? 'Failed') + detail);
      return;
    }
    const j = await res.json();
    toast.success(`Added ${j.count} contribution${j.count === 1 ? '' : 's'}`);
    setText('');
    onClose();
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Bulk record payments">
      <div className="space-y-3">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900">
          <p className="font-semibold mb-1">Paste one row per line:</p>
          <code className="block bg-white rounded p-2 text-[11px] leading-5 font-mono text-gray-700">
            413 500 upi{'\n'}
            414 500 cash{'\n'}
            415, 300, cheque, CHQ#221{'\n'}
            A-201 1500
          </code>
          <p className="mt-2">Format: <span className="font-mono">flat amount [method] [name] [ref]</span>. Method is optional — defaults to whatever you select below.</p>
        </div>

        <Textarea
          label="Rows"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="413 500 upi&#10;414 500 cash"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Default method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as ContributionMethod)}
              aria-label="Default payment method"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm bg-white"
            >
              {(['cash', 'upi', 'cheque', 'neft', 'imps', 'other'] as ContributionMethod[]).map((m) => (
                <option key={m} value={m}>{m.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {/* Live preview of what we parsed — gives the admin a chance to
            spot a typo BEFORE saving 80 rows with the wrong amount. */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Preview</p>
            <p className="text-xs text-gray-600">
              {parsed.rows.length} valid · {parsed.errors.length} skipped · total ₹{parsed.rows.reduce((a, r) => a + r.amount, 0).toLocaleString('en-IN')}
            </p>
          </div>
          {parsed.rows.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No valid rows yet.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto text-xs">
              <table className="w-full">
                <thead className="text-gray-500">
                  <tr>
                    <th className="text-left font-semibold pb-1">Flat</th>
                    <th className="text-right font-semibold pb-1">Amount</th>
                    <th className="text-left font-semibold pb-1 pl-2">Method</th>
                    <th className="text-left font-semibold pb-1 pl-2">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((r, i) => (
                    <tr key={i} className="text-gray-700">
                      <td className="py-0.5 font-mono">{r.flat_number}</td>
                      <td className="py-0.5 text-right font-semibold">₹{r.amount.toLocaleString('en-IN')}</td>
                      <td className="py-0.5 pl-2 uppercase text-[10px] text-gray-500">{r.method ?? method}</td>
                      <td className="py-0.5 pl-2 truncate text-gray-500">{r.contributor_name ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {parsed.errors.length > 0 && (
            <p className="text-[11px] text-amber-700 mt-2">
              Skipped lines: {parsed.errors.map((e) => `#${e.line}`).join(', ')}
            </p>
          )}
        </div>

        <Button onClick={submit} loading={submitting} disabled={parsed.rows.length === 0} className="w-full">
          Save {parsed.rows.length} contribution{parsed.rows.length === 1 ? '' : 's'}
        </Button>
      </div>
    </Modal>
  );
}

// Parses the bulk-paste textarea. Returns the structured rows that
// should be sent to the API plus a list of `{line, reason}` for any
// non-empty lines we couldn't make sense of (so the UI can surface
// them without the admin having to diff the textarea against the
// preview).
function parseBulkText(text: string): {
  rows: Array<{ flat_number: string; amount: number; method?: ContributionMethod; contributor_name?: string; reference_number?: string; notes?: string }>;
  errors: Array<{ line: number; reason: string }>;
} {
  const allowed: ContributionMethod[] = ['cash', 'upi', 'cheque', 'neft', 'imps', 'other'];
  const rows: ReturnType<typeof parseBulkText>['rows'] = [];
  const errors: ReturnType<typeof parseBulkText>['errors'] = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue; // allow comments

    // Prefer comma-split (handles names with spaces). Fall back to
    // whitespace if no commas were typed.
    const tokens = raw.includes(',')
      ? raw.split(',').map((t) => t.trim()).filter(Boolean)
      : raw.split(/\s+/).map((t) => t.trim()).filter(Boolean);

    if (tokens.length < 2) {
      errors.push({ line: i + 1, reason: 'Need at least flat + amount' });
      continue;
    }

    const flat = tokens[0];
    const amount = Number(tokens[1]);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ line: i + 1, reason: `Bad amount: ${tokens[1]}` });
      continue;
    }

    let method: ContributionMethod | undefined;
    let nextIdx = 2;
    if (tokens[2]) {
      const lc = tokens[2].toLowerCase() as ContributionMethod;
      if (allowed.includes(lc)) {
        method = lc;
        nextIdx = 3;
      }
    }

    const contributor_name = tokens[nextIdx]?.trim() || undefined;
    const reference_number = tokens[nextIdx + 1]?.trim() || undefined;
    const notes = tokens.slice(nextIdx + 2).join(', ').trim() || undefined;

    rows.push({ flat_number: flat, amount, method, contributor_name, reference_number, notes });
  }

  return { rows, errors };
}

function SpendModal({ open, onClose, fundId, onSaved }: { open: boolean; onClose: () => void; fundId: string; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [method, setMethod] = useState<SpendMethod>('upi');
  const [reference, setReference] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [isReimbursement, setIsReimbursement] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setAmount(''); setDescription(''); setVendor(''); setVendorPhone(''); setReference('');
    setPaidBy(''); setIsReimbursement(false); setNotes('');
    setDate(new Date().toISOString().slice(0, 10));
  }

  async function submit() {
    if (!description.trim()) { toast.error('Description required'); return; }
    if (!amount || Number(amount) <= 0) { toast.error('Amount required'); return; }
    setSubmitting(true);
    const res = await fetch(`/api/admin/funds/${fundId}/spends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Number(amount),
        spend_date: date,
        description: description.trim(),
        vendor_name: vendor.trim() || undefined,
        vendor_phone: vendorPhone.trim() || undefined,
        payment_method: method,
        payment_reference: reference.trim() || undefined,
        paid_by_name: paidBy.trim() || undefined,
        is_reimbursement: isReimbursement,
        notes: notes.trim() || undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed'); return;
    }
    toast.success('Spend recorded');
    reset();
    onClose();
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Record spend">
      <div className="space-y-3">
        <Textarea label="Description *" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="e.g. Diyas + flowers from KR Market" />
        <Input label="Amount (₹) *" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input label="Date *" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Vendor name" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        <Input label="Vendor phone" value={vendorPhone} onChange={(e) => setVendorPhone(e.target.value)} />
        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Payment method *</label>
          <div className="grid grid-cols-3 gap-2">
            {(['cash', 'upi', 'cheque', 'bank_transfer', 'credit_card', 'other'] as SpendMethod[]).map((m) => (
              <button key={m} type="button" onClick={() => setMethod(m)}
                className={`py-2 rounded-lg text-xs font-semibold uppercase border ${
                  method === m ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-300'
                }`}>{m.replace('_', ' ')}</button>
            ))}
          </div>
        </div>
        <Input label="Reference / UTR" value={reference} onChange={(e) => setReference(e.target.value)} />
        <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-gray-100">
          <input type="checkbox" checked={isReimbursement} onChange={(e) => setIsReimbursement(e.target.checked)} className="w-4 h-4 mt-0.5 rounded text-[#1B5E20]" />
          <span className="text-sm text-gray-700">Paid by a committee member out of pocket — needs reimbursement</span>
        </label>
        {isReimbursement && (
          <Input label="Paid by (name)" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} placeholder="Who fronted the cash" />
        )}
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <Button onClick={submit} loading={submitting} className="w-full">Save spend</Button>
      </div>
    </Modal>
  );
}

function CloseFundModal({ open, onClose, fund, onSaved }: { open: boolean; onClose: () => void; fund: FundFull; onSaved: () => void }) {
  const surplus = fund.total_collected - fund.total_spent - fund.total_refunded;
  const [notes, setNotes] = useState('');
  const [strategy, setStrategy] = useState<'leave_as_is' | 'roll_to_general_pool' | 'refund_pro_rata' | 'roll_to_next_year'>(
    surplus > 0 ? 'roll_to_general_pool' : 'leave_as_is'
  );
  const [poolFundId, setPoolFundId] = useState('');
  const [pools, setPools] = useState<{ id: string; name: string }[]>([]);
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/admin/funds').then((r) => r.json()).then((j) => {
      const list = (j.funds ?? []).filter((f: { status: string; id: string; fund_categories?: { code?: string } }) =>
        f.status !== 'closed' && f.status !== 'cancelled' && f.id !== fund.id
        && f.fund_categories?.code === 'general_pool'
      );
      setPools(list);
      if (list.length > 0) setPoolFundId(list[0].id);
    });
  }, [open, fund.id]);

  async function submit() {
    if (!notes.trim()) { toast.error('Closure notes required'); return; }
    if (strategy === 'roll_to_general_pool' && !poolFundId) {
      toast.error('Pick a general pool fund (or change strategy)');
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/admin/funds/${fund.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        closure_notes: notes.trim(),
        surplus_handling: strategy,
        general_pool_fund_id: strategy === 'roll_to_general_pool' ? poolFundId : undefined,
        notify,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed'); return;
    }
    toast.success('Fund closed');
    onClose();
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Close fund">
      <div className="space-y-3">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm">
          <p>Surplus to handle: <span className="font-bold">{formatINR(surplus)}</span></p>
        </div>

        {surplus > 0 && (
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Surplus handling</label>
            <div className="space-y-2">
              {[
                { v: 'roll_to_general_pool', l: '💰 Roll into General Community Pool' },
                { v: 'refund_pro_rata', l: '↩️ Refund pro-rata to contributors' },
                { v: 'roll_to_next_year', l: '📅 Carry over to next year (just close, no movement)' },
                { v: 'leave_as_is', l: '🔒 Leave as-is on this fund' },
              ].map((o) => (
                <label key={o.v} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${
                  strategy === o.v ? 'border-[#1B5E20] bg-emerald-50' : 'border-gray-200'
                }`}>
                  <input type="radio" name="strategy" checked={strategy === o.v} onChange={() => setStrategy(o.v as typeof strategy)} />
                  <span className="text-sm">{o.l}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {strategy === 'roll_to_general_pool' && (
          pools.length === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
              No active fund in the &quot;General Community Pool&quot; category exists. Create one first.
            </p>
          ) : (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Roll into</label>
              <select value={poolFundId} onChange={(e) => setPoolFundId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white">
                {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )
        )}

        <Textarea label="Closure notes (visible to all) *" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          placeholder="Summary of what we did, total raised, total spent, surplus handling, thanks." />
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="w-4 h-4 rounded text-[#1B5E20] mt-0.5" />
          <span className="text-sm text-gray-700">Notify all residents on close</span>
        </label>
        <Button onClick={submit} loading={submitting} className="w-full" variant="danger">
          Close fund
        </Button>
      </div>
    </Modal>
  );
}

function CancelFundModal({ open, onClose, fundId, onSaved }: { open: boolean; onClose: () => void; fundId: string; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    const res = await fetch(`/api/admin/funds/${fundId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed');
      return;
    }
    toast.success('Fund cancelled. Audit trail preserved.');
    onClose();
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Cancel fund">
      <div className="space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
          <p className="font-semibold mb-1">This is the right choice when…</p>
          <p>The fund was created in error, abandoned, superseded by another fund, or the collection drive will not happen. The fund will move to <span className="font-semibold">Cancelled</span> status — all contributions, spends and refunds remain visible for audit, but no new activity is allowed.</p>
          <p className="mt-2">Want to remove it entirely instead? Hard-delete is only possible when the fund has zero contributions, spends and refunds.</p>
        </div>
        <Textarea
          label="Reason (optional, shown in closure notes)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. Created twice by mistake — using the other Diwali 2026 fund."
        />
        <Button onClick={submit} loading={submitting} variant="danger" className="w-full">
          Cancel this fund
        </Button>
      </div>
    </Modal>
  );
}

// Force-delete is the destructive escape hatch when a fund has activity
// and the admin still wants it gone (e.g. duplicate fund created by
// mistake that already accumulated a few real contributions).
//
// The modal is intentionally noisy and slow:
//   * Big red banner explains the action is irreversible.
//   * Detailed list of EXACTLY what will be wiped, with counts.
//   * Type-the-fund-name confirmation (case-sensitive). The submit
//     button stays disabled until the typed phrase matches.
//   * Required reason (min 4 chars) — captured in the audit log.
function ForceDeleteFundModal({
  open, onClose, fundName, counts, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  fundName: string;
  counts: { contributions: number; spends: number; refunds: number; comments: number; attachments: number; child_funds: number; } | null;
  onConfirm: (payload: { confirm_phrase: string; reason: string }) => Promise<void>;
}) {
  const [phrase, setPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setPhrase(''); setReason(''); }
  }, [open]);

  if (!open || !counts) return null;

  const phraseOk = phrase === fundName;
  const reasonOk = reason.trim().length >= 4;
  const ready = phraseOk && reasonOk && !submitting;

  // Pretty print the wipe list — only show non-zero categories so we
  // don't dilute the warning with "0 attachments" lines.
  const wipeRowsAll: Array<[string, number]> = [
    ['Contributions (verified, pending, rejected, in-kind)', counts.contributions],
    ['Spends', counts.spends],
    ['Refunds', counts.refunds],
    ['Comments', counts.comments],
    ['Attachments / receipts', counts.attachments],
  ];
  const wipeRows = wipeRowsAll.filter(([, n]) => n > 0);

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    try {
      await onConfirm({ confirm_phrase: phrase, reason: reason.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Force delete this fund?">
      <div className="space-y-3">
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3">
          <p className="font-bold text-red-900 flex items-center gap-1.5 text-sm">
            <AlertTriangle size={16} /> This is irreversible.
          </p>
          <p className="text-xs text-red-800 mt-1">
            The fund and every row attached to it will be permanently removed from the database. There is no undo. For most situations <span className="font-semibold">Cancel fund</span> is the right choice — it preserves the audit trail.
          </p>
        </div>

        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">Will be wiped</p>
          {wipeRows.length === 0 ? (
            <p className="text-xs text-gray-500 italic">Just the fund row itself (no child rows).</p>
          ) : (
            <ul className="text-xs text-gray-800 space-y-1">
              {wipeRows.map(([label, n]) => (
                <li key={label} className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center min-w-[2rem] h-6 px-2 rounded-md bg-red-100 text-red-800 text-[11px] font-bold">{n}</span>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          )}
          {counts.child_funds > 0 ? (
            <p className="text-[11px] text-amber-800 mt-2">
              ℹ️ {counts.child_funds} child fund{counts.child_funds === 1 ? '' : 's'} will be detached (their <span className="font-mono">parent_fund_id</span> set to null) — they themselves will <span className="font-semibold">NOT</span> be deleted.
            </p>
          ) : null}
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">
            Type the fund name exactly to confirm:
          </label>
          <p className="text-xs text-gray-500 mb-1.5 font-mono bg-gray-100 inline-block px-1.5 py-0.5 rounded">{fundName}</p>
          <input
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="Type the fund name here"
            aria-label="Confirm fund name"
            className={`w-full px-3 py-2.5 border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 ${
              phrase.length === 0
                ? 'border-gray-300 focus:ring-gray-400'
                : phraseOk
                  ? 'border-emerald-400 bg-emerald-50 focus:ring-emerald-400'
                  : 'border-red-400 bg-red-50 focus:ring-red-400'
            }`}
          />
        </div>

        <Textarea
          label="Reason (required, captured in audit log)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="e.g. duplicate fund created by mistake, all 3 contributions were also re-logged on the correct fund."
        />

        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={!ready}
            loading={submitting}
            className="flex-1"
          >
            <Trash2 size={14} /> Force delete fund
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RejectModal({ contributionId, onClose, onDone }: { contributionId: string | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (contributionId) setReason(''); }, [contributionId]);

  if (!contributionId) return null;

  async function submit() {
    if (!reason.trim()) { toast.error('Reason required'); return; }
    setSubmitting(true);
    const res = await fetch(`/api/admin/funds/contributions/${contributionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', rejection_reason: reason.trim() }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed'); return;
    }
    toast.success('Rejected — resident notified.');
    onClose();
    onDone();
  }

  return (
    <Modal open={true} onClose={onClose} title="Reject contribution">
      <div className="space-y-3">
        <Textarea label="Reason (shown to the resident) *" value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          placeholder="e.g. Could not find ₹500 from your UPI ID in the bank statement. Please share the screenshot." />
        <Button onClick={submit} loading={submitting} variant="danger" className="w-full">
          Reject
        </Button>
      </div>
    </Modal>
  );
}
