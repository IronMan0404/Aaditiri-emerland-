'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, BarChart3, Building2, Award, Users, Edit3, ScanLine, RefreshCw, Check, X } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { BarRows, KpiTile, LineChart } from '@/components/admin/Charts';
import type {
  ClubhouseFacility, ClubhouseSubscription, ClubhouseSubscriptionStatus, ClubhouseTier,
} from '@/types';

// Admin-only management UI for the clubhouse: facility catalog, subscription
// tiers, per-flat subscriptions, plus an analytics tab. There is no payment
// gateway integration \u2014 admins flip a flat to "subscribed" after collecting
// dues offline (see plan.md \u00a73).

type Tab = 'facilities' | 'tiers' | 'subscriptions' | 'analytics';

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: 'facilities',    label: 'Facilities',    icon: Building2 },
  { id: 'tiers',         label: 'Tiers',         icon: Award     },
  { id: 'subscriptions', label: 'Subscriptions', icon: Users     },
  { id: 'analytics',     label: 'Analytics',     icon: BarChart3 },
];

const SUB_STATUS_PILL: Record<ClubhouseSubscriptionStatus, string> = {
  pending_approval: 'bg-amber-100 text-amber-700',
  active:           'bg-green-100 text-green-700',
  expiring:         'bg-amber-100 text-amber-700',
  expired:          'bg-gray-100 text-gray-500',
  cancelled:        'bg-red-100 text-red-700',
  rejected:         'bg-red-100 text-red-700',
};

const SUB_STATUS_LABEL: Record<ClubhouseSubscriptionStatus, string> = {
  pending_approval: 'pending',
  active:           'active',
  expiring:         'expiring',
  expired:          'expired',
  cancelled:        'cancelled',
  rejected:         'rejected',
};

interface AnalyticsResponse {
  kpis: {
    activeFlats: number;
    coveredResidents: number;
    mrr: number;
    passesThisMonth: number;
    passesUsedThisMonth: number;
    utilizationRate: number;
    churnedThisMonth: number;
  };
  timeseries: { date: string; active: number }[];
  passesByFacility: { label: string; value: number }[];
  revenueByTier: { label: string; value: number }[];
  funnel: { new: number; renewed: number; cancelled: number; expired: number };
}

export default function AdminClubhousePage() {
  const { isAdmin, mounted } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [tab, setTab] = useState<Tab>('facilities');
  const [facilities, setFacilities] = useState<ClubhouseFacility[]>([]);
  const [tiers, setTiers] = useState<ClubhouseTier[]>([]);
  const [subs, setSubs] = useState<ClubhouseSubscription[]>([]);
  const [profilesByFlat, setProfilesByFlat] = useState<{ id: string; full_name: string; flat_number: string | null }[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);

  const fetchAll = useCallback(async () => {
    const [{ data: f }, { data: t }, { data: s }, { data: p }] = await Promise.all([
      supabase.from('clubhouse_facilities').select('*').order('display_order'),
      supabase.from('clubhouse_tiers').select('*').order('display_order'),
      supabase
        .from('clubhouse_subscriptions')
        .select('*, clubhouse_tiers(*), primary_user:profiles!clubhouse_subscriptions_primary_user_id_fkey(full_name, email, phone)')
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, flat_number').not('flat_number', 'is', null),
    ]);
    setFacilities((f ?? []) as ClubhouseFacility[]);
    setTiers((t ?? []) as ClubhouseTier[]);
    setSubs((s ?? []) as ClubhouseSubscription[]);
    setProfilesByFlat((p ?? []) as { id: string; full_name: string; flat_number: string | null }[]);
  }, [supabase]);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/clubhouse/analytics', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AnalyticsResponse;
      setAnalytics(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load analytics');
    }
  }, []);

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    fetchAll();
  }, [mounted, isAdmin, fetchAll]);

  useEffect(() => {
    if (tab === 'analytics' && !analytics) fetchAnalytics();
  }, [tab, analytics, fetchAnalytics]);

  if (mounted && !isAdmin) {
    return <p className="p-6 text-sm text-gray-500">Admin access required.</p>;
  }

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clubhouse</h1>
          <p className="text-xs text-gray-500 mt-0.5">Facilities, tiers, subscriptions and usage analytics</p>
        </div>
        <Link
          href="/admin/clubhouse/validate"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1B5E20] text-white text-xs font-semibold hover:bg-[#2E7D32]"
        >
          <ScanLine size={14} />
          Validate pass
        </Link>
      </div>

      <div className="flex gap-1.5 mb-4 overflow-x-auto bg-gray-100 rounded-xl p-1 w-fit max-w-full">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition shrink-0 ${
              tab === id ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-500'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'facilities' && (
        <FacilitiesTab facilities={facilities} onRefresh={fetchAll} supabase={supabase} />
      )}
      {tab === 'tiers' && (
        <TiersTab tiers={tiers} facilities={facilities} onRefresh={fetchAll} supabase={supabase} />
      )}
      {tab === 'subscriptions' && (
        <SubscriptionsTab
          subs={subs}
          tiers={tiers}
          profiles={profilesByFlat}
          onRefresh={fetchAll}
          supabase={supabase}
        />
      )}
      {tab === 'analytics' && <AnalyticsTab data={analytics} />}
    </div>
  );
}

// ============================================================
// Facilities tab
// ============================================================

function FacilitiesTab({
  facilities, onRefresh, supabase,
}: {
  facilities: ClubhouseFacility[];
  onRefresh: () => void;
  supabase: ReturnType<typeof createClient>;
}) {
  const [editing, setEditing] = useState<ClubhouseFacility | null>(null);
  const [open, setOpen] = useState(false);

  function startCreate() {
    setEditing({
      id: '', slug: '', name: '', description: '',
      hourly_rate: 0, pass_rate_per_visit: 0,
      requires_subscription: false, is_bookable: true,
      is_active: true, display_order: facilities.length * 10 + 10,
      created_at: '',
    });
    setOpen(true);
  }
  function startEdit(f: ClubhouseFacility) {
    setEditing(f);
    setOpen(true);
  }

  async function save(form: ClubhouseFacility) {
    const payload = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      description: form.description?.trim() || null,
      hourly_rate: Number(form.hourly_rate) || 0,
      pass_rate_per_visit: Number(form.pass_rate_per_visit) || 0,
      requires_subscription: form.requires_subscription,
      is_bookable: form.is_bookable,
      is_active: form.is_active,
      display_order: Number(form.display_order) || 0,
    };
    if (!payload.slug || !payload.name) {
      toast.error('Slug and name are required');
      return;
    }
    const { error } = form.id
      ? await supabase.from('clubhouse_facilities').update(payload).eq('id', form.id)
      : await supabase.from('clubhouse_facilities').insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(form.id ? 'Facility updated' : 'Facility added');
    setOpen(false);
    onRefresh();
  }

  async function remove(f: ClubhouseFacility) {
    if (!confirm(`Delete facility "${f.name}"?`)) return;
    const { error } = await supabase.from('clubhouse_facilities').delete().eq('id', f.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Facility deleted');
    onRefresh();
  }

  const [seeding, setSeeding] = useState(false);
  async function seedDefaults() {
    setSeeding(true);
    try {
      const res = await globalThis.fetch('/api/admin/clubhouse/facilities/seed', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as { error?: string; total?: number };
      if (!res.ok) {
        toast.error(json.error ?? 'Could not seed catalogue');
        return;
      }
      toast.success(`Catalogue ready (${json.total ?? 0} facilities)`);
      onRefresh();
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={seedDefaults}
          loading={seeding}
          title="Re-insert the default 8 facilities (gym, pool, etc). Safe to run \u2014 existing rows are left alone."
        >
          <RefreshCw size={14} />Reset catalogue
        </Button>
        <Button size="sm" onClick={startCreate}><Plus size={14} />Add facility</Button>
      </div>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 border-b">
          <div className="col-span-4">Name</div>
          <div className="col-span-3">Slug</div>
          <div className="col-span-2 text-right">Hourly / Pass</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>
        {facilities.length === 0 ? (
          <div className="py-6 text-center text-xs">
            <p className="text-gray-400 italic mb-2">No facilities yet</p>
            <button
              type="button"
              onClick={seedDefaults}
              className="text-[#1B5E20] font-semibold hover:underline"
            >
              Tap here to load the default catalogue
            </button>
          </div>
        ) : facilities.map((f) => (
          <div key={f.id} className="grid grid-cols-12 gap-2 px-3 py-3 text-sm border-b last:border-b-0 items-center">
            <div className="col-span-4">
              <p className="font-semibold text-gray-900">{f.name}</p>
              {f.description && <p className="text-[11px] text-gray-500 line-clamp-1">{f.description}</p>}
            </div>
            <div className="col-span-3 text-xs text-gray-600 font-mono">{f.slug}</div>
            <div className="col-span-2 text-right text-xs text-gray-700">
              ₹{f.hourly_rate}/h · ₹{f.pass_rate_per_visit}/visit
            </div>
            <div className="col-span-2 flex flex-wrap gap-1">
              {f.requires_subscription && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">SUB</span>}
              {!f.is_active && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">OFF</span>}
              {f.is_bookable && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">BOOK</span>}
            </div>
            <div className="col-span-1 flex justify-end gap-1">
              <button type="button" aria-label="Edit" onClick={() => startEdit(f)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
                <Edit3 size={13} />
              </button>
              <button type="button" aria-label="Delete" onClick={() => remove(f)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing?.id ? 'Edit facility' : 'Add facility'}>
        {editing && <FacilityForm initial={editing} onSubmit={save} onCancel={() => setOpen(false)} />}
      </Modal>
    </div>
  );
}

function FacilityForm({
  initial, onSubmit, onCancel,
}: {
  initial: ClubhouseFacility;
  onSubmit: (f: ClubhouseFacility) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ClubhouseFacility>(initial);
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={async (e) => { e.preventDefault(); setSaving(true); await onSubmit(form); setSaving(false); }}
      className="space-y-3"
    >
      <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Input
        label="Slug * (lowercase, underscore_separated)"
        value={form.slug}
        onChange={(e) => setForm({ ...form, slug: e.target.value })}
        placeholder="e.g. swimming_pool"
      />
      <Textarea label="Description" rows={2} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Hourly rate (\u20b9)" type="number" min={0} value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: Number(e.target.value) })} />
        <Input label="Pass rate (\u20b9/visit)" type="number" min={0} value={form.pass_rate_per_visit} onChange={(e) => setForm({ ...form, pass_rate_per_visit: Number(e.target.value) })} />
      </div>
      <Input label="Display order" type="number" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) })} />
      <div className="flex flex-col gap-2 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={form.requires_subscription} onChange={(e) => setForm({ ...form, requires_subscription: e.target.checked })} />
          Requires active subscription
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={form.is_bookable} onChange={(e) => setForm({ ...form, is_bookable: e.target.checked })} />
          Open for hourly bookings
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Active (visible to residents)
        </label>
      </div>
      <div className="flex gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" loading={saving} className="flex-1">Save</Button>
      </div>
    </form>
  );
}

// ============================================================
// Tiers tab
// ============================================================

function TiersTab({
  tiers, facilities, onRefresh, supabase,
}: {
  tiers: ClubhouseTier[];
  facilities: ClubhouseFacility[];
  onRefresh: () => void;
  supabase: ReturnType<typeof createClient>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClubhouseTier | null>(null);

  function startCreate() {
    setEditing({
      id: '', name: '', description: '', monthly_price: 0, yearly_price: null,
      included_facilities: [], pass_quota_per_month: null, max_pass_duration_hours: 168,
      is_active: true, display_order: tiers.length * 10 + 10, created_at: '',
    });
    setOpen(true);
  }
  function startEdit(t: ClubhouseTier) { setEditing(t); setOpen(true); }

  async function save(form: ClubhouseTier) {
    const payload = {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      monthly_price: Number(form.monthly_price) || 0,
      yearly_price: form.yearly_price === null || form.yearly_price === undefined ? null : Number(form.yearly_price),
      included_facilities: form.included_facilities,
      pass_quota_per_month: form.pass_quota_per_month === null || form.pass_quota_per_month === undefined
        ? null
        : Number(form.pass_quota_per_month),
      max_pass_duration_hours: Number(form.max_pass_duration_hours) || 24,
      is_active: form.is_active,
      display_order: Number(form.display_order) || 0,
    };
    if (!payload.name) { toast.error('Name is required'); return; }
    const { error } = form.id
      ? await supabase.from('clubhouse_tiers').update(payload).eq('id', form.id)
      : await supabase.from('clubhouse_tiers').insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(form.id ? 'Tier updated' : 'Tier added');
    setOpen(false);
    onRefresh();
  }

  async function remove(t: ClubhouseTier) {
    if (!confirm(`Delete tier "${t.name}"? This will fail if any subscription still references it.`)) return;
    const { error } = await supabase.from('clubhouse_tiers').delete().eq('id', t.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Tier deleted');
    onRefresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={startCreate}><Plus size={14} />Add tier</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {tiers.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-6 text-center col-span-full">No tiers yet</p>
        ) : tiers.map((t) => (
          <div key={t.id} className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="font-bold text-gray-900">{t.name}</h3>
                {t.description && <p className="text-xs text-gray-500">{t.description}</p>}
              </div>
              <div className="flex gap-1">
                <button type="button" aria-label="Edit" onClick={() => startEdit(t)} className="p-1.5 rounded hover:bg-gray-100 text-gray-600">
                  <Edit3 size={13} />
                </button>
                <button type="button" aria-label="Delete" onClick={() => remove(t)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <p className="text-2xl font-bold text-[#1B5E20]">
              ₹{t.monthly_price}<span className="text-xs font-normal text-gray-500">/month</span>
            </p>
            {t.yearly_price !== null && <p className="text-xs text-gray-500">₹{t.yearly_price} / year</p>}
            <div className="mt-3 space-y-1.5 text-xs">
              <p className="text-gray-500">
                <strong className="text-gray-800">Pass quota:</strong> {t.pass_quota_per_month ?? 'Unlimited'}
              </p>
              <p className="text-gray-500">
                <strong className="text-gray-800">Max pass duration:</strong> {t.max_pass_duration_hours}h
              </p>
              <div>
                <p className="text-gray-500 mb-1"><strong className="text-gray-800">Includes:</strong></p>
                <div className="flex flex-wrap gap-1">
                  {t.included_facilities.length === 0
                    ? <span className="text-gray-400 italic">No facilities</span>
                    : t.included_facilities.map((slug) => {
                        const f = facilities.find((fc) => fc.slug === slug);
                        return (
                          <span key={slug} className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                            {f?.name ?? slug}
                          </span>
                        );
                      })}
                </div>
              </div>
            </div>
            {!t.is_active && (
              <p className="mt-2 text-[10px] font-bold text-amber-700 uppercase">Inactive (hidden from residents)</p>
            )}
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing?.id ? 'Edit tier' : 'Add tier'}>
        {editing && <TierForm initial={editing} facilities={facilities} onSubmit={save} onCancel={() => setOpen(false)} />}
      </Modal>
    </div>
  );
}

function TierForm({
  initial, facilities, onSubmit, onCancel,
}: {
  initial: ClubhouseTier;
  facilities: ClubhouseFacility[];
  onSubmit: (t: ClubhouseTier) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ClubhouseTier>(initial);
  const [saving, setSaving] = useState(false);

  function toggleFacility(slug: string) {
    setForm((f) => ({
      ...f,
      included_facilities: f.included_facilities.includes(slug)
        ? f.included_facilities.filter((s) => s !== slug)
        : [...f.included_facilities, slug],
    }));
  }

  return (
    <form
      onSubmit={async (e) => { e.preventDefault(); setSaving(true); await onSubmit(form); setSaving(false); }}
      className="space-y-3"
    >
      <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Textarea label="Description" rows={2} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Monthly price (\u20b9)" type="number" min={0} value={form.monthly_price} onChange={(e) => setForm({ ...form, monthly_price: Number(e.target.value) })} />
        <Input
          label="Yearly price (\u20b9, optional)"
          type="number"
          min={0}
          value={form.yearly_price ?? ''}
          onChange={(e) => setForm({ ...form, yearly_price: e.target.value === '' ? null : Number(e.target.value) })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Pass quota / month (blank = unlimited)"
          type="number"
          min={0}
          value={form.pass_quota_per_month ?? ''}
          onChange={(e) => setForm({ ...form, pass_quota_per_month: e.target.value === '' ? null : Number(e.target.value) })}
        />
        <Input
          label="Max pass duration (hours)"
          type="number"
          min={1}
          value={form.max_pass_duration_hours}
          onChange={(e) => setForm({ ...form, max_pass_duration_hours: Number(e.target.value) })}
        />
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">Included facilities</label>
        <div className="flex flex-wrap gap-2">
          {facilities.length === 0
            ? <p className="text-xs text-gray-400 italic">Add facilities first.</p>
            : facilities.map((f) => {
                const active = form.included_facilities.includes(f.slug);
                return (
                  <button
                    key={f.slug}
                    type="button"
                    onClick={() => toggleFacility(f.slug)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      active ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:border-[#1B5E20]'
                    }`}
                  >
                    {f.name}
                  </button>
                );
              })}
        </div>
      </div>
      <Input label="Display order" type="number" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) })} />
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        Active (visible to residents)
      </label>
      <div className="flex gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" loading={saving} className="flex-1">Save</Button>
      </div>
    </form>
  );
}

// ============================================================
// Subscriptions tab
// ============================================================

function SubscriptionsTab({
  subs, tiers, profiles, onRefresh, supabase,
}: {
  subs: ClubhouseSubscription[];
  tiers: ClubhouseTier[];
  profiles: { id: string; full_name: string; flat_number: string | null }[];
  onRefresh: () => void;
  supabase: ReturnType<typeof createClient>;
}) {
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ClubhouseSubscriptionStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  // Approve/reject modal state for resident-initiated requests.
  const [pendingTarget, setPendingTarget] = useState<ClubhouseSubscription | null>(null);
  const [pendingMode, setPendingMode] = useState<'approve' | 'reject'>('approve');
  const [pendingReason, setPendingReason] = useState('');
  const [pendingMonthsOverride, setPendingMonthsOverride] = useState<number>(1);
  const [pendingStartDate, setPendingStartDate] = useState('');
  const [pendingSaving, setPendingSaving] = useState(false);

  const pendingRequests = useMemo(
    () => subs.filter((s) => s.status === 'pending_approval'),
    [subs],
  );

  function openApprove(s: ClubhouseSubscription) {
    setPendingTarget(s);
    setPendingMode('approve');
    setPendingReason('');
    setPendingMonthsOverride(s.requested_months ?? 1);
    setPendingStartDate(new Date().toISOString().slice(0, 10));
  }
  function openReject(s: ClubhouseSubscription) {
    setPendingTarget(s);
    setPendingMode('reject');
    setPendingReason('');
  }
  function closePendingModal() {
    setPendingTarget(null);
    setPendingReason('');
  }

  async function submitPendingDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingTarget) return;
    setPendingSaving(true);
    try {
      const url = pendingMode === 'approve'
        ? `/api/admin/clubhouse/subscriptions/${pendingTarget.id}/approve`
        : `/api/admin/clubhouse/subscriptions/${pendingTarget.id}/reject`;
      const body = pendingMode === 'approve'
        ? { months_override: pendingMonthsOverride, start_date: pendingStartDate }
        : { reason: pendingReason };
      const res = await globalThis.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? `${pendingMode} failed`);
        return;
      }
      toast.success(pendingMode === 'approve' ? 'Subscription activated' : 'Request declined');
      closePendingModal();
      onRefresh();
    } finally {
      setPendingSaving(false);
    }
  }

  // Group profiles by flat so the admin can pick a flat (autocomplete-style)
  // and we can default the primary user to the first profile of that flat.
  const flats = useMemo(() => {
    const map = new Map<string, { id: string; full_name: string }[]>();
    for (const p of profiles) {
      if (!p.flat_number) continue;
      const arr = map.get(p.flat_number) ?? [];
      arr.push({ id: p.id, full_name: p.full_name });
      map.set(p.flat_number, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [profiles]);

  const filtered = useMemo(() => {
    return subs.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!s.flat_number.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [subs, statusFilter, search]);

  async function changeStatus(sub: ClubhouseSubscription, next: ClubhouseSubscriptionStatus) {
    if (sub.status === next) return;
    const patch: Record<string, unknown> = { status: next };
    if (next === 'cancelled' && !sub.cancelled_at) patch.cancelled_at = new Date().toISOString();
    const { error } = await supabase.from('clubhouse_subscriptions').update(patch).eq('id', sub.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Marked ${next}`);
    onRefresh();
  }

  return (
    <div className="space-y-3">
      {/* Pending requests panel \u2014 only rendered when there's at least one. */}
      {pendingRequests.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-amber-900 text-sm">
              Pending requests ({pendingRequests.length})
            </h3>
            <span className="text-[10px] uppercase tracking-wider font-bold text-amber-700">
              Awaiting your action
            </span>
          </div>
          <div className="space-y-2">
            {pendingRequests.map((s) => (
              <div key={s.id} className="bg-white rounded-lg p-3 border border-amber-200">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900">
                      Flat {s.flat_number}
                      <span className="text-gray-500 font-normal"> &middot; </span>
                      <span className="text-gray-700">{s.primary_user?.full_name ?? 'Resident'}</span>
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      <strong>{s.clubhouse_tiers?.name ?? 'Tier'}</strong>
                      {s.clubhouse_tiers && <span className="text-gray-400"> &middot; ₹{s.clubhouse_tiers.monthly_price}/mo</span>}
                      {s.requested_months && <span> &middot; {s.requested_months} month{s.requested_months === 1 ? '' : 's'}</span>}
                    </p>
                    {s.request_notes && (
                      <p className="text-[11px] text-gray-500 italic mt-1">&ldquo;{s.request_notes}&rdquo;</p>
                    )}
                    {s.requested_at && (
                      <p className="text-[10px] text-gray-400 mt-1" suppressHydrationWarning>
                        Requested {format(new Date(s.requested_at), 'dd MMM yyyy, HH:mm')}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openApprove(s)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700"
                    >
                      <Check size={13} />Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => openReject(s)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200"
                    >
                      <X size={13} />Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl p-3 shadow-sm flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search flat..."
          className="flex-1 min-w-[160px] px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#1B5E20]"
        />
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ClubhouseSubscriptionStatus | 'all')}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="all">All statuses</option>
          <option value="pending_approval">Pending approval</option>
          <option value="active">Active</option>
          <option value="expiring">Expiring</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
          <option value="rejected">Rejected</option>
        </select>
        <Button size="sm" onClick={() => setOpen(true)}><Plus size={14} />Add subscription</Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="hidden md:grid grid-cols-12 gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 border-b">
          <div className="col-span-2">Flat</div>
          <div className="col-span-3">Resident</div>
          <div className="col-span-2">Tier</div>
          <div className="col-span-3">Period</div>
          <div className="col-span-2 text-right">Status / actions</div>
        </div>
        {filtered.length === 0
          ? <p className="text-xs text-gray-400 italic py-6 text-center">No subscriptions match these filters</p>
          : filtered.map((s) => (
            <div key={s.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 px-3 py-3 text-sm border-b last:border-b-0 items-center">
              <div className="md:col-span-2 font-bold">{s.flat_number}</div>
              <div className="md:col-span-3 text-xs text-gray-700">
                {s.primary_user?.full_name ?? '\u2014'}
                {s.primary_user?.email && <p className="text-[10px] text-gray-400">{s.primary_user.email}</p>}
              </div>
              <div className="md:col-span-2 text-xs">
                <p className="font-semibold">{s.clubhouse_tiers?.name ?? '\u2014'}</p>
                {s.clubhouse_tiers && <p className="text-[10px] text-gray-400">₹{s.clubhouse_tiers.monthly_price}/mo</p>}
              </div>
              <div className="md:col-span-3 text-xs text-gray-700" suppressHydrationWarning>
                {format(new Date(s.start_date), 'dd MMM yyyy')} → {format(new Date(s.end_date), 'dd MMM yyyy')}
              </div>
              <div className="md:col-span-2 flex items-center justify-end gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SUB_STATUS_PILL[s.status]}`}>{SUB_STATUS_LABEL[s.status]}</span>
                {s.status === 'pending_approval' ? (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => openApprove(s)}
                      className="text-[10px] font-bold px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => openReject(s)}
                      className="text-[10px] font-bold px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <select
                    aria-label="Change subscription status"
                    value={s.status}
                    onChange={(e) => changeStatus(s, e.target.value as ClubhouseSubscriptionStatus)}
                    className="text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="expiring">Expiring</option>
                    <option value="expired">Expired</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                )}
              </div>
            </div>
          ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add subscription">
        <SubscriptionForm
          tiers={tiers}
          flats={flats}
          onCancel={() => setOpen(false)}
          onSubmit={async (payload) => {
            const { error } = await supabase.from('clubhouse_subscriptions').insert(payload);
            if (error) { toast.error(error.message); return; }
            toast.success('Subscription added');
            setOpen(false);
            onRefresh();
          }}
        />
      </Modal>

      {/* Approve / reject pending request modal */}
      <Modal
        open={!!pendingTarget}
        onClose={closePendingModal}
        title={pendingMode === 'approve' ? 'Approve subscription' : 'Reject subscription'}
      >
        {pendingTarget && (
          <form onSubmit={submitPendingDecision} className="space-y-3">
            <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
              <p>
                <strong>{pendingTarget.primary_user?.full_name ?? 'Resident'}</strong>
                <span className="text-gray-500"> &middot; Flat {pendingTarget.flat_number}</span>
              </p>
              <p>
                Tier: <strong>{pendingTarget.clubhouse_tiers?.name ?? '\u2014'}</strong>
                {pendingTarget.clubhouse_tiers && (
                  <span className="text-gray-500"> (\u20b9{pendingTarget.clubhouse_tiers.monthly_price}/mo)</span>
                )}
              </p>
              <p>
                Requested: <strong>{pendingTarget.requested_months ?? 1} month{(pendingTarget.requested_months ?? 1) === 1 ? '' : 's'}</strong>
              </p>
              {pendingTarget.request_notes && (
                <p className="italic text-gray-600">&ldquo;{pendingTarget.request_notes}&rdquo;</p>
              )}
            </div>

            {pendingMode === 'approve' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Start date *"
                    type="date"
                    value={pendingStartDate}
                    onChange={(e) => setPendingStartDate(e.target.value)}
                  />
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">Months *</label>
                    <select
                      aria-label="Months override"
                      value={pendingMonthsOverride}
                      onChange={(e) => setPendingMonthsOverride(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
                    >
                      {[1, 3, 6, 12].map((m) => (
                        <option key={m} value={m}>{m} month{m === 1 ? '' : 's'}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">
                  End date will be calculated automatically. Total dues:{' '}
                  <strong>
                    \u20b9{((pendingTarget.clubhouse_tiers?.monthly_price ?? 0) * pendingMonthsOverride).toLocaleString('en-IN')}
                  </strong>
                  {' '}(collected offline).
                </p>
              </>
            ) : (
              <Textarea
                label="Reason (shown to resident) *"
                value={pendingReason}
                rows={4}
                maxLength={500}
                onChange={(e) => setPendingReason(e.target.value)}
                placeholder="e.g. Outstanding maintenance dues for this flat. Please clear them and re-apply."
              />
            )}

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="secondary" onClick={closePendingModal} className="flex-1">
                Cancel
              </Button>
              <Button
                type="submit"
                loading={pendingSaving}
                variant={pendingMode === 'reject' ? 'danger' : 'primary'}
                disabled={pendingMode === 'reject' && !pendingReason.trim()}
                className="flex-1"
              >
                {pendingMode === 'approve' ? 'Approve & activate' : 'Reject request'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

interface SubscriptionFormPayload {
  flat_number: string;
  tier_id: string;
  primary_user_id: string;
  start_date: string;
  end_date: string;
  status: ClubhouseSubscriptionStatus;
}

function SubscriptionForm({
  tiers, flats, onSubmit, onCancel,
}: {
  tiers: ClubhouseTier[];
  flats: [string, { id: string; full_name: string }[]][];
  onSubmit: (payload: SubscriptionFormPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const [flatNumber, setFlatNumber] = useState('');
  const [primaryUserId, setPrimaryUserId] = useState('');
  const [tierId, setTierId] = useState(tiers[0]?.id ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);

  // Defer wall-clock reads until after mount so the initial render is
  // deterministic across SSR and the client (and react-hooks/purity is
  // happy). The user can still tweak both date inputs.
  useEffect(() => {
    const now = new Date();
    setStartDate(now.toISOString().split('T')[0]);
    setEndDate(new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  }, []);

  const residents = useMemo(() => flats.find(([f]) => f === flatNumber)?.[1] ?? [], [flatNumber, flats]);

  useEffect(() => {
    if (residents.length > 0 && !residents.find((r) => r.id === primaryUserId)) {
      setPrimaryUserId(residents[0].id);
    }
  }, [residents, primaryUserId]);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!flatNumber || !primaryUserId || !tierId) {
          toast.error('Fill all required fields');
          return;
        }
        setSaving(true);
        await onSubmit({
          flat_number: flatNumber,
          primary_user_id: primaryUserId,
          tier_id: tierId,
          start_date: startDate,
          end_date: endDate,
          status: 'active',
        });
        setSaving(false);
      }}
      className="space-y-3"
    >
      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Flat *</label>
        <select
          aria-label="Select flat"
          value={flatNumber}
          onChange={(e) => setFlatNumber(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
        >
          <option value="">Select flat…</option>
          {flats.map(([f]) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      {residents.length > 0 && (
        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Primary resident *</label>
          <select
            aria-label="Select primary resident"
            value={primaryUserId}
            onChange={(e) => setPrimaryUserId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
          >
            {residents.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="text-sm font-medium text-gray-700 mb-1 block">Tier *</label>
        <select
          aria-label="Select tier"
          value={tierId}
          onChange={(e) => setTierId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
        >
          {tiers.map((t) => <option key={t.id} value={t.id}>{t.name} (₹{t.monthly_price}/mo)</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Start date *" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <Input label="End date *" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate} />
      </div>
      <div className="flex gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" loading={saving} className="flex-1">Save</Button>
      </div>
    </form>
  );
}

// ============================================================
// Analytics tab
// ============================================================

function AnalyticsTab({ data }: { data: AnalyticsResponse | null }) {
  if (!data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Active flats" value={data.kpis.activeFlats} />
        <KpiTile label="Covered residents" value={data.kpis.coveredResidents} hint="incl. family members" />
        <KpiTile label="MRR" value={`\u20b9${data.kpis.mrr.toLocaleString('en-IN')}`} tone="good" />
        <KpiTile
          label="Churn this month"
          value={data.kpis.churnedThisMonth}
          tone={data.kpis.churnedThisMonth > 0 ? 'warn' : 'default'}
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <KpiTile label="Passes (this month)" value={data.kpis.passesThisMonth} />
        <KpiTile label="Used" value={data.kpis.passesUsedThisMonth} />
        <KpiTile
          label="Utilization"
          value={`${data.kpis.utilizationRate}%`}
          tone={data.kpis.utilizationRate >= 60 ? 'good' : data.kpis.utilizationRate >= 30 ? 'warn' : 'bad'}
        />
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm">
        <LineChart
          label="Active subscriptions per day (last 90 days)"
          data={data.timeseries.map((d) => ({ date: d.date, value: d.active }))}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-600 mb-3">Passes per facility (this month)</p>
          <BarRows data={data.passesByFacility} emptyMessage="No passes generated yet" />
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-gray-600 mb-3">Revenue by tier (active subs only)</p>
          <BarRows
            data={data.revenueByTier.map((b) => ({ label: b.label, value: Math.round(b.value) }))}
            color="#7C3AED"
            emptyMessage="No active subscriptions yet"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm">
        <p className="text-xs font-semibold text-gray-600 mb-3">Drop-off funnel (this month)</p>
        <div className="grid grid-cols-4 gap-2">
          {([
            { label: 'New',       value: data.funnel.new,       color: 'bg-blue-100 text-blue-700' },
            { label: 'Renewed',   value: data.funnel.renewed,   color: 'bg-green-100 text-green-700' },
            { label: 'Expired',   value: data.funnel.expired,   color: 'bg-amber-100 text-amber-700' },
            { label: 'Cancelled', value: data.funnel.cancelled, color: 'bg-red-100 text-red-700' },
          ]).map((f) => (
            <div key={f.label} className={`rounded-lg p-3 text-center ${f.color}`}>
              <p className="text-[10px] uppercase tracking-wider font-bold">{f.label}</p>
              <p className="text-xl font-bold mt-0.5">{f.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

