'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Calendar, Users as UsersIcon, Award, Ticket, ArrowRight, Hourglass, AlertCircle, X, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { format, differenceInDays } from 'date-fns';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import type {
  ClubhouseFacility, ClubhouseRequestMonths, ClubhouseSubscription, ClubhouseTier, FamilyMember,
} from '@/types';

// Resident-facing clubhouse home. Shows the flat's current subscription
// (if any), pending request banner, rejection notice, the resident's
// family list (already managed elsewhere), the included facilities
// with their rates, and a CTA to generate a pass.
//
// Subscriptions are resident-initiated and admin-approved (see
// /api/clubhouse/subscriptions/request). We render different states:
//   - pending_approval -> "Awaiting admin approval" amber card
//   - rejected         -> red card with the rejection reason + Try again
//   - active/expiring  -> green tier card with days left + manage passes
//   - none             -> "Subscribe" CTA opens the request modal

const ALLOWED_MONTHS: ClubhouseRequestMonths[] = [1, 3, 6, 12];

export default function ClubhouseHomePage() {
  const { profile, mounted } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [subscription, setSubscription] = useState<ClubhouseSubscription | null>(null);
  const [pending, setPending] = useState<ClubhouseSubscription | null>(null);
  const [rejected, setRejected] = useState<ClubhouseSubscription | null>(null);
  const [facilities, setFacilities] = useState<ClubhouseFacility[]>([]);
  const [tiers, setTiers] = useState<ClubhouseTier[]>([]);
  const [tier, setTier] = useState<ClubhouseTier | null>(null);
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!profile?.flat_number) {
      setLoading(false);
      return;
    }
    // Pull every subscription for the flat (not just active) so we
    // can render pending / rejected banners alongside the active tier.
    const [{ data: subs }, { data: fac }, { data: tiersData }, { data: fam }] = await Promise.all([
      supabase
        .from('clubhouse_subscriptions')
        .select('*, clubhouse_tiers(*)')
        .eq('flat_number', profile.flat_number)
        .order('created_at', { ascending: false }),
      supabase.from('clubhouse_facilities').select('*').eq('is_active', true).order('display_order'),
      supabase.from('clubhouse_tiers').select('*').eq('is_active', true).order('display_order'),
      supabase.from('family_members').select('*').eq('user_id', profile.id),
    ]);
    const list = (subs ?? []) as ClubhouseSubscription[];
    const active = list.find((s) => s.status === 'active' || s.status === 'expiring') ?? null;
    const pendingRow = list.find((s) => s.status === 'pending_approval') ?? null;
    // Show only the most recent rejection, and only if there isn't
    // already an active or pending sub overriding it.
    const rejectedRow = !active && !pendingRow
      ? list.find((s) => s.status === 'rejected') ?? null
      : null;

    setSubscription(active);
    setTier((active?.clubhouse_tiers ?? null) as ClubhouseTier | null);
    setPending(pendingRow);
    setRejected(rejectedRow);
    setFacilities((fac ?? []) as ClubhouseFacility[]);
    setTiers((tiersData ?? []) as ClubhouseTier[]);
    setFamily((fam ?? []) as FamilyMember[]);
    setLoading(false);
  }, [profile, supabase]);

  useEffect(() => {
    if (mounted && profile) fetchAll();
  }, [mounted, profile, fetchAll]);

  const daysRemaining = subscription ? differenceInDays(new Date(subscription.end_date), new Date()) : 0;
  const includedFacilitySlugs = new Set(tier?.included_facilities ?? []);
  const includedFacilities = facilities.filter((f) => includedFacilitySlugs.has(f.slug));
  const otherFacilities = facilities.filter((f) => !includedFacilitySlugs.has(f.slug));

  if (loading || !mounted) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <KeyRound size={22} className="text-[#1B5E20]" />
          <h1 className="text-2xl font-bold text-gray-900">Clubhouse</h1>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {profile?.flat_number ? `Flat ${profile.flat_number}` : 'Set your flat number in your profile to subscribe.'}
        </p>
      </div>

      {/* Subscription card */}
      {subscription && tier ? (
        <div className="bg-gradient-to-br from-[#1B5E20] to-[#2E7D32] text-white rounded-xl p-5 shadow">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wider opacity-80 font-bold">Your tier</p>
              <h2 className="text-2xl font-bold mt-0.5">{tier.name}</h2>
              {tier.description && <p className="text-xs opacity-90 mt-0.5">{tier.description}</p>}
            </div>
            <Award size={28} className="opacity-90" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="opacity-70 uppercase tracking-wider">Status</p>
              <p className="font-bold mt-0.5 capitalize">{subscription.status}</p>
            </div>
            <div>
              <p className="opacity-70 uppercase tracking-wider">Days left</p>
              <p className="font-bold mt-0.5">{daysRemaining > 0 ? daysRemaining : 0}</p>
            </div>
            <div>
              <p className="opacity-70 uppercase tracking-wider">Pass quota</p>
              <p className="font-bold mt-0.5">{tier.pass_quota_per_month ?? '∞'} / mo</p>
            </div>
          </div>
          <p className="mt-3 text-[11px] opacity-80" suppressHydrationWarning>
            Valid until {format(new Date(subscription.end_date), 'dd MMM yyyy')}
          </p>
          <Link
            href="/dashboard/clubhouse/passes"
            className="mt-3 inline-flex items-center gap-1.5 bg-white text-[#1B5E20] px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-50"
          >
            <Ticket size={14} />
            Manage passes
            <ArrowRight size={12} />
          </Link>
        </div>
      ) : pending ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <Hourglass size={18} className="text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h2 className="font-bold text-amber-900">Awaiting admin approval</h2>
              <p className="text-xs text-amber-800 mt-1">
                Your request for{' '}
                <strong>{(pending.clubhouse_tiers as ClubhouseTier | undefined)?.name ?? 'a clubhouse subscription'}</strong>
                {pending.requested_months ? ` (${pending.requested_months} month${pending.requested_months === 1 ? '' : 's'})` : ''}
                {' '}is being reviewed by the admin team. You&apos;ll be notified as soon as it&apos;s approved.
              </p>
              {pending.request_notes && (
                <p className="text-[11px] text-amber-700 italic mt-1.5">Your note: &ldquo;{pending.request_notes}&rdquo;</p>
              )}
              <p className="text-[11px] text-amber-700 mt-2" suppressHydrationWarning>
                Submitted {pending.requested_at ? format(new Date(pending.requested_at), 'dd MMM yyyy, HH:mm') : ''}
              </p>
            </div>
          </div>
        </div>
      ) : rejected ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h2 className="font-bold text-red-900">Subscription request declined</h2>
              <p className="text-xs text-red-800 mt-1">
                Your request for{' '}
                <strong>{(rejected.clubhouse_tiers as ClubhouseTier | undefined)?.name ?? 'a clubhouse subscription'}</strong>
                {' '}was declined.
              </p>
              {rejected.rejected_reason && (
                <p className="text-xs text-red-800 mt-2 bg-white/50 rounded-lg p-2 border border-red-100">
                  <strong>Reason:</strong> {rejected.rejected_reason}
                </p>
              )}
              <button
                type="button"
                onClick={() => setSubscribeOpen(true)}
                className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#1B5E20] hover:underline"
              >
                Submit a new request
                <ArrowRight size={12} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="font-bold text-gray-900">No active subscription</h2>
          <p className="text-xs text-gray-600 mt-1">
            Subscribe monthly to unlock the gym, pool, yoga room and more. Your request goes to the
            admin team for approval &mdash; payments are collected offline.
          </p>
          <Button
            size="sm"
            onClick={() => setSubscribeOpen(true)}
            className="mt-3"
            disabled={!profile?.flat_number || tiers.length === 0}
          >
            <Award size={14} />
            Subscribe
          </Button>
          {!profile?.flat_number && (
            <p className="text-[11px] text-gray-400 italic mt-2">
              Set your flat number in your profile to subscribe.
            </p>
          )}
          {profile?.flat_number && tiers.length === 0 && (
            <p className="text-[11px] text-gray-400 italic mt-2">
              No clubhouse tiers are currently offered. Check back later.
            </p>
          )}
        </div>
      )}

      {/* Subscribe modal */}
      <Modal open={subscribeOpen} onClose={() => setSubscribeOpen(false)} title="Request a subscription">
        <SubscribeForm
          tiers={tiers}
          facilities={facilities}
          onCancel={() => setSubscribeOpen(false)}
          onSubmitted={() => {
            setSubscribeOpen(false);
            fetchAll();
          }}
        />
      </Modal>

      {/* Family members */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <UsersIcon size={14} className="text-[#1B5E20]" />
            Covered family ({family.length})
          </h3>
          <Link href="/dashboard/profile" className="text-[11px] font-semibold text-[#1B5E20] hover:underline">
            Manage
          </Link>
        </div>
        {family.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No family members yet. Add them from your profile.</p>
        ) : (
          <ul className="space-y-1 text-xs text-gray-700">
            {family.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span>{m.full_name}</span>
                <span className="text-gray-400 capitalize">{m.relation}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Included facilities */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1.5">
          <Calendar size={14} className="text-[#1B5E20]" />
          Included in your tier
        </h3>
        {includedFacilities.length === 0 ? (
          <p className="text-xs text-gray-400 italic">
            {tier ? 'No facilities are included in this tier yet.' : 'Subscribe to unlock facilities.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {includedFacilities.map((f) => (
              <div key={f.id} className="border border-gray-100 rounded-lg p-3">
                <p className="font-semibold text-sm text-gray-900">{f.name}</p>
                {f.description && <p className="text-[11px] text-gray-500 mt-0.5">{f.description}</p>}
                <p className="text-[11px] text-gray-600 mt-1">
                  ₹{f.hourly_rate}/h · ₹{f.pass_rate_per_visit}/pass
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Other facilities (not included) */}
      {otherFacilities.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-2">Other facilities (open booking)</h3>
          <div className="flex flex-wrap gap-1">
            {otherFacilities.map((f) => (
              <span key={f.id} className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                {f.name}
              </span>
            ))}
          </div>
          <Link
            href="/dashboard/bookings"
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1B5E20] hover:underline"
          >
            Open the bookings page
            <ArrowRight size={11} />
          </Link>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Subscribe form (resident-initiated subscription request)
// ============================================================

function SubscribeForm({
  tiers, facilities, onCancel, onSubmitted,
}: {
  tiers: ClubhouseTier[];
  facilities: ClubhouseFacility[];
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const [tierId, setTierId] = useState(tiers[0]?.id ?? '');
  const [months, setMonths] = useState<ClubhouseRequestMonths>(1);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const tier = useMemo(() => tiers.find((t) => t.id === tierId) ?? null, [tiers, tierId]);
  const includedNames = useMemo(() => {
    if (!tier) return [] as string[];
    const slugSet = new Set(tier.included_facilities);
    return facilities.filter((f) => slugSet.has(f.slug)).map((f) => f.name);
  }, [tier, facilities]);

  const total = tier ? tier.monthly_price * months : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tierId) {
      toast.error('Pick a tier');
      return;
    }
    setSubmitting(true);
    try {
      const res = await globalThis.fetch('/api/clubhouse/subscriptions/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier_id: tierId, months, notes: notes.trim() || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? `Request failed (${res.status})`);
        return;
      }
      toast.success('Request submitted! Awaiting admin approval.');
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  if (tiers.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-gray-500">No subscription tiers are currently offered.</p>
        <Button variant="secondary" onClick={onCancel} className="mt-3">Close</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">Select tier *</label>
        <div className="space-y-2">
          {tiers.map((t) => {
            const selected = t.id === tierId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTierId(t.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all ${
                  selected ? 'border-[#1B5E20] bg-[#1B5E20]/5' : 'border-gray-200 bg-white hover:border-[#1B5E20]/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-sm text-gray-900">{t.name}</p>
                    {t.description && <p className="text-[11px] text-gray-500 mt-0.5">{t.description}</p>}
                  </div>
                  <p className="text-base font-bold text-[#1B5E20] shrink-0">
                    ₹{t.monthly_price}<span className="text-[10px] font-normal text-gray-500">/mo</span>
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">Duration *</label>
        <div className="grid grid-cols-4 gap-2">
          {ALLOWED_MONTHS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMonths(m)}
              className={`px-2 py-2 rounded-xl text-sm font-bold border-2 transition ${
                months === m
                  ? 'border-[#1B5E20] bg-[#1B5E20] text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-[#1B5E20]/40'
              }`}
            >
              {m}
              <span className="block text-[9px] font-normal opacity-80">
                {m === 1 ? 'month' : 'months'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {tier && (
        <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-700 space-y-1">
          <p><strong>Total dues:</strong> ₹{total.toLocaleString('en-IN')} (collected offline by admin)</p>
          <p><strong>Pass quota:</strong> {tier.pass_quota_per_month ?? 'Unlimited'} / month</p>
          <div>
            <strong>Includes:</strong>{' '}
            {includedNames.length === 0
              ? <span className="italic text-gray-400">No facilities listed</span>
              : <span>{includedNames.join(', ')}</span>}
          </div>
        </div>
      )}

      <Textarea
        label="Notes for the admin (optional)"
        value={notes}
        maxLength={500}
        rows={2}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="e.g. We&rsquo;d like to start from 1 May."
      />

      <div className="flex gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          <X size={14} />Cancel
        </Button>
        <Button type="submit" loading={submitting} className="flex-1">
          Request approval
        </Button>
      </div>
    </form>
  );
}
