'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck, KeyRound, X, Copy, RefreshCw, Phone, Mail, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

// =============================================================
// Recovery requests panel for /admin/users.
//
// Renders the pending admin_recovery_requests rows at the top of
// the page so a co-admin can:
//   1. See who's locked out (name, flat, phone, contact note,
//      coarse IP for sanity-check).
//   2. Click "Verify & reset" → confirm modal → server generates
//      a temp password, returns it ONCE, admin reads it to the
//      resident by phone or in person.
//   3. Or click "Dismiss" if the request looks bogus.
//
// We DON'T merge this into AdminUsersPage to keep that file from
// growing past its current ~660 lines. The panel is a standalone
// component with its own data fetch, modal state, and refresh.
//
// Triggers a soft refresh:
//   - On mount.
//   - After every resolve / cancel.
//   - When the user clicks the manual refresh icon.
//   - When deep-linked via ?recovery=<id> (a Telegram tap from
//     the admin DM lands here with the row scrolled into view).
// =============================================================

interface RecoveryRequest {
  id: string;
  status: 'pending' | 'resolved' | 'cancelled' | 'expired';
  contact_note: string | null;
  request_ip: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  profile: {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
    flat_number: string | null;
    is_approved: boolean;
  } | null;
  resolver: {
    id: string;
    full_name: string | null;
  } | null;
}

interface ResolveResponse {
  ok?: boolean;
  status?: string;
  temp_password?: string;
  profile?: {
    id: string;
    full_name: string | null;
    email: string | null;
    flat_number: string | null;
    phone: string | null;
  };
  error?: string;
}

const REFRESH_MS = 60_000;

export default function RecoveryRequestsPanel() {
  const searchParams = useSearchParams();
  const deepLinkedRequestId = searchParams.get('recovery');

  const [requests, setRequests] = useState<RecoveryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [confirming, setConfirming] = useState<RecoveryRequest | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Successful reset response — owns the modal that displays the
  // one-time temp password. This is shown ONCE, in-app, the
  // moment the API returns. The admin must capture it and read
  // it to the resident; there is no "show again" path on purpose.
  const [tempReveal, setTempReveal] = useState<{
    password: string;
    profile: ResolveResponse['profile'];
  } | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/recovery-requests?status=pending', { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        requests?: RecoveryRequest[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        if (!silent) toast.error(data.error ?? 'Could not load recovery requests');
        return;
      }
      setRequests(data.requests ?? []);
    } catch {
      if (!silent) toast.error('Network error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Deep-link: if Telegram or push opened us with ?recovery=<id>,
  // pop the confirm modal directly. Only fires once after the
  // first successful load.
  useEffect(() => {
    if (!deepLinkedRequestId || loading) return;
    const target = requests.find((r) => r.id === deepLinkedRequestId);
    if (target && !confirming) {
      setConfirming(target);
    }
  }, [deepLinkedRequestId, loading, requests, confirming]);

  async function handleResolve(action: 'reset' | 'cancel') {
    if (!confirming) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/recovery-requests/${confirming.id}/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            resolution_note: resolutionNote.trim() || null,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as ResolveResponse;
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? `Could not ${action} request`);
        return;
      }
      if (action === 'reset' && data.temp_password) {
        setTempReveal({ password: data.temp_password, profile: data.profile });
      } else {
        toast.success('Request dismissed');
      }
      setConfirming(null);
      setResolutionNote('');
      load(true);
    } catch {
      toast.error('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyPassword() {
    if (!tempReveal) return;
    try {
      await navigator.clipboard.writeText(tempReveal.password);
      toast.success('Copied to clipboard');
    } catch {
      // Older browsers / no permission. Fall back to selecting the
      // text so the admin can ctrl+c manually.
      toast('Press the password text and copy manually', { icon: 'ℹ️' });
    }
  }

  // Memoise the section header right-side count so we don't render
  // a stale number while a refresh is in flight.
  const pendingCount = useMemo(() => requests.length, [requests]);

  // "ago" tick — useState seeded in a layout effect so the initial
  // render is deterministic (matches SSR), then updates every 30s
  // so the stale-time labels stay roughly accurate without thrashing.
  // React 19's purity rule forbids `Date.now()` in render bodies, so
  // we plumb the timestamp down to RequestRow as a prop.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!loading && pendingCount === 0) {
    // Don't render anything when there's nothing to do — keeps the
    // /admin/users page free of empty-state clutter.
    return null;
  }

  return (
    <section id="recovery" className="mb-5">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-amber-700" />
            <h2 className="text-sm font-bold text-amber-900">
              Password recovery requests
              {pendingCount > 0 && (
                <span className="ml-2 bg-amber-200 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {pendingCount}
                </span>
              )}
            </h2>
          </div>
          <button
            onClick={() => load()}
            disabled={refreshing}
            aria-label="Refresh recovery requests"
            className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        <p className="text-[11px] text-amber-800/80 mb-3 leading-snug">
          These residents have neither email nor Telegram. Verify each one out-of-band
          (call them or see them in person), then tap <strong>Verify &amp; reset</strong>.
        </p>

        {loading ? (
          <p className="text-xs text-amber-700/70 italic">Loading…</p>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                nowMs={nowMs}
                onPick={(req) => setConfirming(req)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---------- Confirm modal ---------- */}
      <Modal
        open={!!confirming}
        onClose={() => {
          if (submitting) return;
          setConfirming(null);
          setResolutionNote('');
        }}
        title="Verify & reset password"
      >
        {confirming && (
          <div className="space-y-4 text-sm">
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-1.5">
              <div className="font-semibold text-gray-900">
                {confirming.profile?.full_name ?? 'Resident'}
                {confirming.profile?.flat_number && (
                  <span className="text-gray-500 font-normal">
                    {' '}
                    · Flat {confirming.profile.flat_number}
                  </span>
                )}
              </div>
              {confirming.profile?.phone && (
                <div className="flex items-center gap-1.5 text-xs text-gray-700">
                  <Phone size={12} />
                  <a
                    href={`tel:${confirming.profile.phone}`}
                    className="text-[#1B5E20] hover:underline"
                  >
                    {confirming.profile.phone}
                  </a>
                </div>
              )}
              {confirming.profile?.email && !confirming.profile.email.endsWith('@aaditri.invalid') && (
                <div className="flex items-center gap-1.5 text-xs text-gray-700">
                  <Mail size={12} />
                  <span>{confirming.profile.email}</span>
                </div>
              )}
              {confirming.contact_note && (
                <div className="text-xs text-gray-700 mt-2 pt-2 border-t border-gray-200">
                  <span className="font-semibold">Note:</span> {confirming.contact_note}
                </div>
              )}
              {confirming.request_ip && (
                <div className="text-[10px] text-gray-400 mt-1">
                  Request from {confirming.request_ip} ·{' '}
                  {new Date(confirming.created_at).toLocaleString()}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 leading-snug">
              <strong>Verify identity FIRST.</strong> Call the number above or see the
              resident in person. Don&apos;t reset based on the request alone — the
              fingerprint is not strong enough to bypass identity confirmation.
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Resolution note <span className="text-gray-400 font-normal">(optional, audit trail)</span>
              </label>
              <textarea
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value.slice(0, 500))}
                placeholder="e.g. Verified by phone at 6:30 PM, gave temp password verbally."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent resize-none"
                disabled={submitting}
              />
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Button
                type="button"
                onClick={() => handleResolve('reset')}
                loading={submitting}
                disabled={submitting}
                className="w-full"
              >
                <ShieldCheck size={16} />
                Generate temporary password & reset
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleResolve('cancel')}
                disabled={submitting}
                className="w-full"
              >
                <X size={14} />
                Dismiss request without reset
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- Temp password reveal modal ---------- */}
      <Modal
        open={!!tempReveal}
        onClose={() => setTempReveal(null)}
        title="Temporary password"
      >
        {tempReveal && (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900 leading-snug">
              <strong>Read this to {tempReveal.profile?.full_name ?? 'the resident'} now.</strong>{' '}
              This password is shown <em>once</em>. Copy it before closing — there is no
              recover-later option.
            </div>

            <div className="rounded-xl border-2 border-emerald-300 bg-white p-4 text-center">
              <div className="font-mono text-xl font-bold tracking-wider text-gray-900 select-all break-all">
                {tempReveal.password}
              </div>
            </div>

            <Button onClick={copyPassword} variant="outline" className="w-full">
              <Copy size={14} />
              Copy to clipboard
            </Button>

            <div className="text-[11px] text-gray-500 leading-snug">
              The resident should sign in with this password and immediately change it
              from <strong>Profile → Edit</strong>. We&apos;ve also pushed a notification
              to their device telling them to do so.
            </div>

            <Button onClick={() => setTempReveal(null)} className="w-full">
              I&apos;ve shared this password — close
            </Button>
          </div>
        )}
      </Modal>
    </section>
  );
}

function RequestRow({
  request,
  nowMs,
  onPick,
}: {
  request: RecoveryRequest;
  /** Parent-supplied "now" tick. null on the very first SSR-equivalent render. */
  nowMs: number | null;
  onPick: (r: RecoveryRequest) => void;
}) {
  const created = new Date(request.created_at);
  // Render-stable "ago" label. Until the parent's nowMs tick lands
  // (right after mount) we just show the absolute time, which keeps
  // SSR and the first client render byte-identical.
  let ageLabel: string;
  if (nowMs === null) {
    ageLabel = created.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } else {
    const ageMin = Math.floor((nowMs - created.getTime()) / 60000);
    ageLabel =
      ageMin < 1
        ? 'just now'
        : ageMin < 60
          ? `${ageMin}m ago`
          : ageMin < 1440
            ? `${Math.floor(ageMin / 60)}h ago`
            : `${Math.floor(ageMin / 1440)}d ago`;
  }

  return (
    <div
      id={`recovery-${request.id}`}
      className="bg-white rounded-xl border border-amber-200 p-3 flex items-center justify-between gap-3 scroll-mt-20"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-gray-900 truncate">
            {request.profile?.full_name ?? 'Resident (deleted profile?)'}
          </span>
          {request.profile?.flat_number && (
            <span className="text-[11px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
              Flat {request.profile.flat_number}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-800">
            <Clock size={10} />
            {ageLabel}
          </span>
        </div>
        {request.profile?.phone && (
          <div className="text-xs text-gray-600 truncate mt-0.5">
            {request.profile.phone}
          </div>
        )}
        {request.contact_note && (
          <div className="text-[11px] text-gray-500 truncate mt-0.5">
            {request.contact_note}
          </div>
        )}
      </div>
      <Button size="sm" onClick={() => onPick(request)}>
        Verify &amp; reset
      </Button>
    </div>
  );
}
