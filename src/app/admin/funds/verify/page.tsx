'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, XCircle, ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { formatINR } from '@/lib/money';
import type { FundContribution } from '@/types/funds';

interface QueuedContribution extends FundContribution {
  community_funds?: { id: string; name: string };
}

// Cross-fund verify queue. Treasurer's main workflow: open this once a day,
// reconcile against the bank statement, bulk-verify what matches, reject
// what doesn't.
export default function VerifyQueuePage() {
  const { isAdmin, mounted } = useAuth();
  const supabase = createClient();
  const [items, setItems] = useState<QueuedContribution[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [submittingReject, setSubmittingReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('fund_contributions')
      .select('*, community_funds(id, name)')
      .eq('status', 'reported')
      .order('reported_at', { ascending: true });
    setItems((data ?? []) as QueuedContribution[]);
    setSelected(new Set());
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    refresh();
  }, [isAdmin, mounted, refresh]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  }

  async function bulkVerify() {
    if (selected.size === 0) return;
    if (!confirm(`Verify ${selected.size} contributions?`)) return;
    const res = await fetch('/api/admin/funds/contributions/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', ids: Array.from(selected) }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(j.error ?? 'Failed'); return; }
    toast.success(`Verified ${j.updated ?? 0}`);
    refresh();
  }

  async function bulkReject() {
    if (!rejectReason.trim()) { toast.error('Reason required'); return; }
    setSubmittingReject(true);
    const res = await fetch('/api/admin/funds/contributions/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', ids: Array.from(selected), rejection_reason: rejectReason.trim() }),
    });
    setSubmittingReject(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(j.error ?? 'Failed'); return; }
    toast.success(`Rejected ${j.updated ?? 0}`);
    setBulkRejecting(false);
    setRejectReason('');
    refresh();
  }

  if (mounted && !isAdmin) {
    return <div className="max-w-3xl mx-auto p-6 text-sm text-gray-500">Admin access required.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <Link href="/admin/funds" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft size={16} /> Back to admin
      </Link>

      <header className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Verification queue</h1>
        <p className="text-sm text-gray-500 mt-1">
          {items.length} reported contributions awaiting verification across all funds.
        </p>
      </header>

      {items.length > 0 && (
        <div className="sticky top-0 bg-white py-3 border-b border-gray-200 z-10 flex items-center gap-2 mb-3 -mx-4 md:mx-0 px-4 md:px-0 md:rounded-2xl md:border md:bg-gray-50">
          <label className="flex items-center gap-2 text-sm cursor-pointer mr-auto">
            <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} className="w-4 h-4 rounded text-[#1B5E20]" />
            <span className="font-semibold text-gray-700">Select all ({selected.size}/{items.length})</span>
          </label>
          {selected.size > 0 && (
            <>
              <Button onClick={bulkVerify} size="sm" variant="primary">
                <CheckCircle2 size={14} /> Verify {selected.size}
              </Button>
              <Button onClick={() => setBulkRejecting(true)} size="sm" variant="danger">
                <XCircle size={14} /> Reject {selected.size}
              </Button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm py-10 text-center">Loading...</p>
      ) : items.length === 0 ? (
        <div className="text-center py-12 bg-emerald-50 rounded-2xl border border-emerald-200">
          <CheckCircle2 className="mx-auto text-emerald-600 mb-3" size={32} />
          <p className="text-sm font-semibold text-emerald-800">All caught up!</p>
          <p className="text-xs text-emerald-700 mt-1">No contributions waiting for verification.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
          {items.map((c) => (
            <div key={c.id} className="p-3 flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="w-4 h-4 mt-1 rounded text-[#1B5E20]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">
                      {c.flat_number} · {c.contributor_name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      For:{' '}
                      <Link href={`/admin/funds/${c.fund_id}`} className="text-[#1B5E20] underline font-semibold">
                        {c.community_funds?.name ?? 'Fund'}
                      </Link>
                    </p>
                  </div>
                  <p className="text-base font-bold text-gray-900 flex-shrink-0">
                    {c.is_in_kind ? 'In-kind' : formatINR(c.amount)}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-1 flex-wrap">
                  <span>{new Date(c.contribution_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                  <span className="uppercase font-semibold">{c.method}</span>
                  {c.reference_number && <span className="font-mono">…{c.reference_number.slice(-6)}</span>}
                  {c.screenshot_url && (
                    <a href={c.screenshot_url} target="_blank" rel="noopener noreferrer" className="text-[#1B5E20] underline inline-flex items-center gap-0.5">
                      <ImageIcon size={11} /> screenshot
                    </a>
                  )}
                </div>
                {c.notes && <p className="text-xs text-gray-600 mt-1 italic">&ldquo;{c.notes}&rdquo;</p>}
                {c.in_kind_description && <p className="text-xs text-gray-700 mt-1">In-kind: {c.in_kind_description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={bulkRejecting} onClose={() => setBulkRejecting(false)} title={`Reject ${selected.size} contributions`}>
        <div className="space-y-3">
          <Textarea
            label="Rejection reason (sent to all selected residents) *"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            placeholder="e.g. Could not match these against the bank statement. Please re-share the screenshot."
          />
          <Button onClick={bulkReject} loading={submittingReject} variant="danger" className="w-full">
            Reject {selected.size}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
