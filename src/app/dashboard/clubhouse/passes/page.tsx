'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Ticket, ArrowLeft, Clock, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type {
  ClubhouseFacility, ClubhousePass, ClubhouseSubscription, ClubhouseTier,
} from '@/types';

// Self-serve clubhouse pass generator. Residents pick a facility (from
// those included in their tier), pick a time window, and we mint a signed
// QR + short code on the server (/api/clubhouse/passes).
//
// Active passes show a big QR + short code. Used / expired passes drop
// to a greyed-out summary line for history.

const PASS_STATUS_PILL: Record<ClubhousePass['status'], string> = {
  active:  'bg-green-100 text-green-700',
  used:    'bg-gray-100 text-gray-500',
  expired: 'bg-red-100 text-red-700',
  revoked: 'bg-red-100 text-red-700',
};

interface PassWithFacility extends ClubhousePass {
  clubhouse_facilities?: { id: string; slug: string; name: string };
}

export default function PassesPage() {
  const { profile, mounted } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [subscription, setSubscription] = useState<ClubhouseSubscription | null>(null);
  const [tier, setTier] = useState<ClubhouseTier | null>(null);
  const [facilities, setFacilities] = useState<ClubhouseFacility[]>([]);
  const [passes, setPasses] = useState<PassWithFacility[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [activePass, setActivePass] = useState<PassWithFacility | null>(null);

  const fetchAll = useCallback(async () => {
    if (!profile?.flat_number) {
      setLoading(false);
      return;
    }
    const [{ data: sub }, { data: fac }, { data: ps }] = await Promise.all([
      supabase
        .from('clubhouse_subscriptions')
        .select('*, clubhouse_tiers(*)')
        .eq('flat_number', profile.flat_number)
        .eq('status', 'active')
        .maybeSingle(),
      supabase.from('clubhouse_facilities').select('*').eq('is_active', true).order('display_order'),
      supabase
        .from('clubhouse_passes')
        .select('*, clubhouse_facilities(id, slug, name)')
        .eq('flat_number', profile.flat_number)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    setSubscription((sub ?? null) as ClubhouseSubscription | null);
    setTier((sub?.clubhouse_tiers ?? null) as ClubhouseTier | null);
    setFacilities((fac ?? []) as ClubhouseFacility[]);
    setPasses((ps ?? []) as PassWithFacility[]);
    setLoading(false);
  }, [profile, supabase]);

  useEffect(() => {
    if (mounted && profile) fetchAll();
  }, [mounted, profile, fetchAll]);

  const eligibleFacilities = useMemo(() => {
    if (!tier) return [];
    const allowed = new Set(tier.included_facilities);
    return facilities.filter((f) => allowed.has(f.slug));
  }, [tier, facilities]);

  async function createPass(payload: { facility_id: string; valid_from: string; valid_until: string }) {
    const res = await fetch('/api/clubhouse/passes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; pass?: PassWithFacility };
    if (!res.ok || !json.pass) {
      toast.error(json.error ?? 'Could not generate pass');
      return null;
    }
    toast.success('Pass generated');
    setCreateOpen(false);
    fetchAll();
    return json.pass;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/clubhouse" className="text-gray-500 hover:text-gray-800" aria-label="Back to clubhouse">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">My Passes</h1>
          <p className="text-xs text-gray-500 mt-0.5">Generate a QR pass for clubhouse facilities</p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          disabled={!subscription || eligibleFacilities.length === 0}
        >
          <Plus size={14} />
          New pass
        </Button>
      </div>

      {!subscription && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-2">
          <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900">
            You need an active subscription to generate passes.{' '}
            <Link href="/dashboard/clubhouse" className="font-bold underline">Subscribe</Link>{' '}
            to get started.
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : passes.length === 0 ? (
        <div className="text-center py-10">
          <Ticket size={36} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No passes yet</p>
          <p className="text-xs text-gray-400 mt-1">Tap &quot;New pass&quot; to create your first one</p>
        </div>
      ) : (
        <div className="space-y-3">
          {passes.map((p) => {
            const isActive = p.status === 'active' && new Date(p.valid_until) > new Date();
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => isActive && setActivePass(p)}
                disabled={!isActive}
                className={`w-full text-left bg-white rounded-xl p-4 shadow-sm transition ${
                  isActive ? 'hover:shadow cursor-pointer' : 'opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-bold text-gray-900 text-sm truncate">{p.clubhouse_facilities?.name ?? 'Facility'}</h3>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${PASS_STATUS_PILL[p.status]}`}>
                        {p.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 font-mono">{p.code}</p>
                    <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1" suppressHydrationWarning>
                      <Clock size={10} />
                      {format(new Date(p.valid_from), 'dd MMM HH:mm')} → {format(new Date(p.valid_until), 'dd MMM HH:mm')}
                    </p>
                    {p.used_at && (
                      <p className="text-[11px] text-gray-400 mt-0.5" suppressHydrationWarning>
                        Used {formatDistanceToNow(new Date(p.used_at), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                  {isActive && <Ticket size={20} className="text-[#1B5E20] shrink-0" />}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Generate pass">
        <CreatePassForm
          tier={tier}
          facilities={eligibleFacilities}
          onSubmit={createPass}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      <Modal open={!!activePass} onClose={() => setActivePass(null)} title="Your pass">
        {activePass && <PassQrView pass={activePass} />}
      </Modal>
    </div>
  );
}

function CreatePassForm({
  tier, facilities, onSubmit, onCancel,
}: {
  tier: ClubhouseTier | null;
  facilities: ClubhouseFacility[];
  onSubmit: (p: { facility_id: string; valid_from: string; valid_until: string }) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? '');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [saving, setSaving] = useState(false);

  // Defer reading the wall clock until after mount so SSR + first render
  // are deterministic (and to satisfy react-hooks/purity, which forbids
  // calling Date.now() during render).
  useEffect(() => {
    const now = new Date();
    setFrom(now.toISOString().slice(0, 16));
    setUntil(new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16));
  }, []);

  const maxDurationLabel = tier ? `${tier.max_pass_duration_hours}h` : '';

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!facilityId) return;
        setSaving(true);
        await onSubmit({
          facility_id: facilityId,
          valid_from: new Date(from).toISOString(),
          valid_until: new Date(until).toISOString(),
        });
        setSaving(false);
      }}
      className="space-y-3"
    >
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">Facility *</label>
        <div className="flex flex-wrap gap-2">
          {facilities.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No facilities are included in your tier.</p>
          ) : facilities.map((f) => {
            const active = facilityId === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFacilityId(f.id)}
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
      <Input label="Valid from *" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
      <Input label="Valid until *" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} min={from} />
      {maxDurationLabel && (
        <p className="text-[11px] text-gray-500">Your tier allows up to {maxDurationLabel} per pass.</p>
      )}
      <div className="flex gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button type="submit" loading={saving} disabled={!facilityId} className="flex-1">Generate</Button>
      </div>
    </form>
  );
}

// Render the QR + short code in a print-friendly card. We use the qrcode npm
// package's data-url helper so the result is just an <img> the user can
// screenshot or save.
function PassQrView({ pass }: { pass: PassWithFacility }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(pass.qr_payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#1B5E20', light: '#FFFFFF' },
    })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'QR render failed'); });
    return () => { cancelled = true; };
  }, [pass.qr_payload]);

  return (
    <div className="text-center space-y-3">
      <div className="bg-white border border-gray-200 rounded-xl p-4 inline-block">
        {error ? (
          <p className="text-xs text-red-600">{error}</p>
        ) : dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="Pass QR code" className="w-64 h-64" width={256} height={256} />
        ) : (
          <div className="w-64 h-64 bg-gray-100 animate-pulse rounded" />
        )}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">Code</p>
        <p className="text-2xl font-mono font-bold text-[#1B5E20]">{pass.code}</p>
      </div>
      <div className="text-xs text-gray-600">
        <p className="font-semibold">{pass.clubhouse_facilities?.name}</p>
        <p suppressHydrationWarning>
          {format(new Date(pass.valid_from), 'dd MMM HH:mm')} → {format(new Date(pass.valid_until), 'dd MMM HH:mm')}
        </p>
      </div>
      <p className="text-[11px] text-gray-400">
        Show this QR or read the code aloud at the gate. The pass auto-expires after the end time.
      </p>
    </div>
  );
}
