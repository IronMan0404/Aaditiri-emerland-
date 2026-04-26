import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/admin-audit';
import { normalizePhoneE164 } from '@/lib/phone';

// Admin-only: modify a user profile. Replaces direct
// `supabase.from('profiles').update` calls in the admin UI so every
// privileged change to a profile lands in the audit log.
//
// Allowed fields are explicitly enumerated to prevent the admin from
// flipping columns we don't want them to (e.g. `id`, `created_at`).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UpdatePayload {
  full_name?: string;
  email?: string;
  phone?: string | null;
  flat_number?: string | null;
  vehicle_number?: string | null;
  resident_type?: 'owner' | 'tenant' | null;
  role?: 'admin' | 'user';
  is_approved?: boolean;
  is_bot?: boolean;
  reason?: string;
}

const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'full_name', 'email', 'phone', 'flat_number', 'vehicle_number',
  'resident_type', 'role', 'is_approved', 'is_bot',
]);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'User id required' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as UpdatePayload;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'reason') continue;
    if (!ALLOWED_FIELDS.has(key)) continue;
    patch[key] = value;
  }

  if (patch.role !== undefined && patch.role !== 'admin' && patch.role !== 'user') {
    return NextResponse.json({ error: "role must be 'admin' or 'user'" }, { status: 400 });
  }
  if (patch.resident_type !== undefined
      && patch.resident_type !== null
      && patch.resident_type !== 'owner'
      && patch.resident_type !== 'tenant') {
    return NextResponse.json({ error: "resident_type must be 'owner' | 'tenant' | null" }, { status: 400 });
  }
  if (patch.full_name !== undefined) {
    const n = String(patch.full_name).trim();
    if (n.length < 1 || n.length > 200) {
      return NextResponse.json({ error: 'full_name must be 1-200 chars' }, { status: 400 });
    }
    patch.full_name = n;
  }

  // Normalize phone to E.164 so the phone-as-username lookup at
  // /api/auth/resolve-identifier works for residents whose phone admins
  // edit here. Empty string => clear it (NULL); a non-empty unparseable
  // value is rejected rather than silently mangled.
  if (patch.phone !== undefined) {
    const raw = patch.phone === null ? '' : String(patch.phone).trim();
    if (!raw) {
      patch.phone = null;
    } else {
      const normalized = normalizePhoneE164(raw);
      if (!normalized) {
        return NextResponse.json(
          { error: 'phone format not recognised. Use +91 followed by 10 digits or leave blank.' },
          { status: 400 },
        );
      }
      patch.phone = normalized;
    }
  }

  // Self-demotion guard - prevent the only admin from accidentally
  // turning themselves into a regular user and locking everyone out.
  if (id === me.id && patch.role === 'user') {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin');
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "You're the last admin. Promote someone else before demoting yourself." },
        { status: 400 },
      );
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data: before, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const { data: after, error: updErr } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const reason = (body.reason ?? '').trim().slice(0, 500) || null;
  await logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'update',
    targetType: 'profile',
    targetId: id,
    targetLabel: `${before.full_name ?? before.email ?? id}`,
    reason,
    before,
    after,
    request: req,
  });

  return NextResponse.json({ ok: true, id, after });
}
