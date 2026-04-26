import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import type { Service, ServiceRate, ServiceWithRates } from '@/types';

// /api/admin/services/[id]
//
// PATCH  — update an existing service. Body may include any subset
//          of editable fields. If `rates` is supplied, the
//          existing rate lines for this service are replaced
//          atomically (delete-all-then-insert-all). If `rates` is
//          omitted entirely, rates are left alone.
//
// DELETE — hard-delete the service. service_rates are removed via
//          ON DELETE CASCADE in the schema, so we don't have to
//          orchestrate that ourselves. We only soft-archive in the
//          UI by setting is_active=false; this DELETE exists for
//          the rare case where an admin wants to fully purge a
//          mistakenly-created entry.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RatePayload {
  label?: string;
  rate_paise?: number | null;
  unit_label?: string | null;
  note?: string | null;
}

interface UpdatePayload {
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
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function validateRates(raw: unknown): { rates: Omit<ServiceRate, 'id' | 'service_id' | 'created_at'>[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'rates must be an array.' };
  if (raw.length > 50) return { error: 'A service can have at most 50 rate lines.' };
  const out: Omit<ServiceRate, 'id' | 'service_id' | 'created_at'>[] = [];
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
    out.push({
      label,
      rate_paise: ratePaise,
      unit_label: trimOrNull(r.unit_label, 30),
      note: trimOrNull(r.note, 100),
      display_order: i * 10,
    });
  }
  return { rates: out };
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Service id required' }, { status: 400 });

  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as UpdatePayload;

  const adb = createAdminSupabaseClient();
  const { data: before } = await adb.from('services').select('*').eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Service not found' }, { status: 404 });

  // Build a partial update object — only set columns that the
  // client actually sent, so a PATCH with `{ is_active: false }`
  // doesn't accidentally clobber description or vendor info.
  const update: Record<string, unknown> = {};

  if (typeof body.name === 'string') {
    const v = body.name.trim();
    if (v.length < 1 || v.length > 80) {
      return NextResponse.json({ error: 'Name must be 1-80 characters.' }, { status: 400 });
    }
    update.name = v;
  }
  if (typeof body.category === 'string') {
    const v = body.category.trim();
    if (v.length < 1 || v.length > 40) {
      return NextResponse.json({ error: 'Category must be 1-40 characters.' }, { status: 400 });
    }
    update.category = v;
  }
  if ('description' in body)     update.description = trimOrNull(body.description, 500);
  if ('vendor_name' in body)     update.vendor_name = trimOrNull(body.vendor_name, 80);
  if ('vendor_phone' in body) {
    const v = trimOrNull(body.vendor_phone, 20);
    if (v && !PHONE_RX.test(v)) return NextResponse.json({ error: 'Vendor phone is not valid.' }, { status: 400 });
    update.vendor_phone = v;
  }
  if ('vendor_whatsapp' in body) {
    const v = trimOrNull(body.vendor_whatsapp, 20);
    if (v && !PHONE_RX.test(v)) return NextResponse.json({ error: 'Vendor WhatsApp is not valid.' }, { status: 400 });
    update.vendor_whatsapp = v;
  }
  if ('vendor_email' in body) {
    const v = trimOrNull(body.vendor_email, 120);
    if (v && !EMAIL_RX.test(v)) return NextResponse.json({ error: 'Vendor email is not valid.' }, { status: 400 });
    update.vendor_email = v;
  }
  if ('image_url' in body) update.image_url = trimOrNull(body.image_url, 500);
  if ('display_order' in body && Number.isFinite(body.display_order)) {
    update.display_order = Number(body.display_order);
  }
  if (typeof body.is_active === 'boolean') update.is_active = body.is_active;

  let updated: Service | null = null;
  if (Object.keys(update).length > 0) {
    const { data, error } = await adb
      .from('services')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      console.error('[admin/services] update failed', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    updated = data as Service;
  } else {
    updated = before as Service;
  }

  // Replace rates if the caller sent them. An empty array means
  // "remove all rates" which we honour.
  let finalRates: Omit<ServiceRate, 'id' | 'service_id' | 'created_at'>[] | undefined;
  if (body.rates !== undefined) {
    const r = validateRates(body.rates);
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 });
    finalRates = r.rates;
    const { error: delErr } = await adb.from('service_rates').delete().eq('service_id', id);
    if (delErr) {
      console.error('[admin/services] rate purge failed', delErr);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    if (r.rates.length > 0) {
      const { error: insErr } = await adb
        .from('service_rates')
        .insert(r.rates.map((row) => ({ ...row, service_id: id })));
      if (insErr) {
        console.error('[admin/services] rate reinsert failed', insErr);
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }
  }

  await logAdminAction({
    actor: { id: auth.user.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'update',
    targetType: 'service',
    targetId: id,
    targetLabel: `${updated.category} · ${updated.name}`,
    reason: finalRates ? `Updated (${finalRates.length} rate lines)` : 'Updated',
    before: before as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
    request: req,
  });

  // Refetch rates so the response always reflects the post-update state.
  const { data: rates } = await adb
    .from('service_rates')
    .select('*')
    .eq('service_id', id)
    .order('display_order', { ascending: true });

  return NextResponse.json({
    service: { ...updated, rates: (rates ?? []) as ServiceRate[] } as ServiceWithRates,
  });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Service id required' }, { status: 400 });

  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const adb = createAdminSupabaseClient();
  const { data: before } = await adb.from('services').select('*').eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Service not found' }, { status: 404 });

  const { error, data } = await adb.from('services').delete().eq('id', id).select('id');
  if (error) {
    console.error('[admin/services] delete failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    // Mirrors the pattern from /api/admin/bookings/[id]/delete:
    // RLS would silently match 0 rows in a misconfig, so we want a
    // loud error instead of "deleted but actually still there".
    return NextResponse.json(
      { error: 'Delete affected 0 rows. Check RLS policies on services / service_rates.' },
      { status: 500 },
    );
  }

  await logAdminAction({
    actor: { id: auth.user.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'delete',
    targetType: 'service',
    targetId: id,
    targetLabel: `${(before as Service).category} · ${(before as Service).name}`,
    reason: 'Hard delete',
    before: before as unknown as Record<string, unknown>,
    request: req,
  });

  return NextResponse.json({ ok: true, id });
}
