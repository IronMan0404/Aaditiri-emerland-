import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import type { Service, ServiceRate, ServiceWithRates } from '@/types';

// /api/admin/services
//
// GET  — list ALL services (active + inactive) with their rates.
//        Admins need both states so they can re-enable an archived
//        service without losing its rate history. Sorted by
//        is_active desc, display_order asc, name asc.
//
// POST — create a new service AND its initial rate lines in a
//        single request. We do this rather than two calls because
//        a "service with no prices" is meaningless to a resident,
//        and forcing a follow-up POST creates a window where the
//        service shows up empty.
//
// All ops use the service-role client so we have a clean writer
// that also sets `created_by` from the verified admin session
// without trusting client input.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RatePayload {
  label?: string;
  rate_paise?: number | null;
  unit_label?: string | null;
  note?: string | null;
}

interface CreatePayload {
  name?: string;
  category?: string;
  description?: string | null;
  vendor_name?: string | null;
  vendor_phone?: string | null;
  vendor_whatsapp?: string | null;
  vendor_email?: string | null;
  image_url?: string | null;
  display_order?: number;
  is_active?: boolean;
  rates?: RatePayload[];
}

const PHONE_RX = /^[0-9+\-\s()]{6,20}$/;
const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function trimOrNull(v: unknown, max = 255): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function validateRates(raw: unknown): { rates: Omit<ServiceRate, 'id' | 'service_id' | 'created_at'>[] } | { error: string } {
  if (!Array.isArray(raw)) return { rates: [] };
  if (raw.length > 50) return { error: 'A service can have at most 50 rate lines.' };
  const rates: Omit<ServiceRate, 'id' | 'service_id' | 'created_at'>[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as RatePayload;
    const label = (r.label ?? '').trim();
    if (!label) return { error: `Rate #${i + 1}: label is required.` };
    if (label.length > 60) return { error: `Rate #${i + 1}: label must be 60 characters or fewer.` };
    let ratePaise: number | null = null;
    if (r.rate_paise !== null && r.rate_paise !== undefined) {
      const n = Number(r.rate_paise);
      if (!Number.isFinite(n) || n < 0 || n > 100_000_000 || !Number.isInteger(n)) {
        return { error: `Rate #${i + 1}: rate_paise must be an integer between 0 and 100,000,000.` };
      }
      ratePaise = n;
    }
    rates.push({
      label,
      rate_paise: ratePaise,
      unit_label: trimOrNull(r.unit_label, 30),
      note: trimOrNull(r.note, 100),
      display_order: i * 10,
    });
  }
  return { rates };
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const adb = createAdminSupabaseClient();
  const { data: services, error: sErr } = await adb
    .from('services')
    .select('*')
    .order('is_active', { ascending: false })
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(500);
  if (sErr) {
    console.error('[admin/services] list services failed', sErr);
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  const ids = (services ?? []).map((s) => s.id);
  const { data: rates, error: rErr } = ids.length
    ? await adb
        .from('service_rates')
        .select('*')
        .in('service_id', ids)
        .order('display_order', { ascending: true })
    : { data: [] as ServiceRate[], error: null };
  if (rErr) {
    console.error('[admin/services] list rates failed', rErr);
    return NextResponse.json({ error: rErr.message }, { status: 500 });
  }

  const byService = new Map<string, ServiceRate[]>();
  for (const r of rates ?? []) {
    const list = byService.get(r.service_id) ?? [];
    list.push(r as ServiceRate);
    byService.set(r.service_id, list);
  }

  const out: ServiceWithRates[] = (services ?? []).map((s) => ({
    ...(s as Service),
    rates: byService.get(s.id) ?? [],
  }));

  return NextResponse.json({ services: out });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as CreatePayload;

  const name = (body.name ?? '').trim();
  const category = (body.category ?? '').trim();
  if (name.length < 1 || name.length > 80) {
    return NextResponse.json({ error: 'Name must be 1-80 characters.' }, { status: 400 });
  }
  if (category.length < 1 || category.length > 40) {
    return NextResponse.json({ error: 'Category must be 1-40 characters.' }, { status: 400 });
  }

  const phone = trimOrNull(body.vendor_phone, 20);
  if (phone && !PHONE_RX.test(phone)) {
    return NextResponse.json({ error: 'Vendor phone is not a valid number.' }, { status: 400 });
  }
  const whatsapp = trimOrNull(body.vendor_whatsapp, 20);
  if (whatsapp && !PHONE_RX.test(whatsapp)) {
    return NextResponse.json({ error: 'Vendor WhatsApp is not a valid number.' }, { status: 400 });
  }
  const email = trimOrNull(body.vendor_email, 120);
  if (email && !EMAIL_RX.test(email)) {
    return NextResponse.json({ error: 'Vendor email is not valid.' }, { status: 400 });
  }

  const ratesResult = validateRates(body.rates);
  if ('error' in ratesResult) {
    return NextResponse.json({ error: ratesResult.error }, { status: 400 });
  }

  const adb = createAdminSupabaseClient();
  const { data: service, error: sErr } = await adb
    .from('services')
    .insert({
      name,
      category,
      description: trimOrNull(body.description, 500),
      vendor_name: trimOrNull(body.vendor_name, 80),
      vendor_phone: phone,
      vendor_whatsapp: whatsapp,
      vendor_email: email,
      image_url: trimOrNull(body.image_url, 500),
      display_order: Number.isFinite(body.display_order) ? Number(body.display_order) : 100,
      is_active: body.is_active === false ? false : true,
      created_by: auth.user.id,
    })
    .select('*')
    .single();
  if (sErr || !service) {
    console.error('[admin/services] insert failed', sErr);
    return NextResponse.json({ error: sErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  if (ratesResult.rates.length > 0) {
    const insertRates = ratesResult.rates.map((r) => ({ ...r, service_id: service.id }));
    const { error: rErr } = await adb.from('service_rates').insert(insertRates);
    if (rErr) {
      // Roll back the service insert so we don't leave an orphan
      // (no transactions across REST calls — best-effort cleanup).
      await adb.from('services').delete().eq('id', service.id);
      console.error('[admin/services] insert rates failed; rolled back parent', rErr);
      return NextResponse.json({ error: rErr.message }, { status: 500 });
    }
  }

  await logAdminAction({
    actor: { id: auth.user.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'create',
    targetType: 'service',
    targetId: service.id,
    targetLabel: `${service.category} · ${service.name}`,
    reason: `Created with ${ratesResult.rates.length} rate lines`,
    after: service as unknown as Record<string, unknown>,
    request: req,
  });

  return NextResponse.json(
    { service: { ...service, rates: ratesResult.rates } as unknown as ServiceWithRates },
    { status: 201 },
  );
}
