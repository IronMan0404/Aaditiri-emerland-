import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { normalizePhoneE164 } from '@/lib/phone';
import { logAdminAction } from '@/lib/admin-audit';

// /api/admin/staff/[id]
//
// PATCH   update a staff member's profile (name, phone, address,
//         photo, hire date, active flag, role).
// DELETE  hard-delete the staff member. Cascades to staff_profiles
//         and staff_attendance via FK ON DELETE CASCADE. The
//         normal "remove from active roster" path is PATCH with
//         { is_active: false } — this DELETE is for the rare case
//         where you want to fully purge.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UpdateBody {
  full_name?: string;
  phone?: string;
  address?: string | null;
  staff_role?: 'security' | 'housekeeping';
  hired_on?: string | null;
  photo_url?: string | null;
  is_active?: boolean;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing staff id.' }, { status: 400 });

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // Fetch the existing row so the audit log can capture before/after.
  const { data: existing, error: fetchErr } = await admin
    .from('staff_profiles')
    .select('id, full_name, phone, address, staff_role, hired_on, photo_url, is_active')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Staff not found.' }, { status: 404 });

  const updates: Record<string, unknown> = {};

  if (typeof body.full_name === 'string') {
    const v = body.full_name.trim();
    if (!v) return NextResponse.json({ error: 'Full name cannot be empty.' }, { status: 400 });
    updates.full_name = v;
  }
  if (typeof body.phone === 'string') {
    const v = normalizePhoneE164(body.phone);
    if (!v) return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 });
    // Reject if another profile (resident or staff) already owns
    // the new number.
    if (v !== existing.phone) {
      const { data: clash } = await admin
        .from('profiles')
        .select('id')
        .eq('phone', v)
        .maybeSingle();
      if (clash && clash.id !== id) {
        return NextResponse.json(
          { error: 'Another user already has this phone number.' },
          { status: 409 },
        );
      }
    }
    updates.phone = v;
  }
  if (body.address !== undefined) {
    if (body.address === null || body.address === '') {
      updates.address = null;
    } else {
      const v = body.address.trim();
      if (v.length > 500) return NextResponse.json({ error: 'Address is too long.' }, { status: 400 });
      updates.address = v;
    }
  }
  if (body.staff_role !== undefined) {
    if (body.staff_role !== 'security' && body.staff_role !== 'housekeeping') {
      return NextResponse.json({ error: 'Role must be security or housekeeping.' }, { status: 400 });
    }
    updates.staff_role = body.staff_role;
  }
  if (body.hired_on !== undefined) {
    updates.hired_on = body.hired_on || null;
  }
  if (body.photo_url !== undefined) {
    updates.photo_url = body.photo_url?.trim() || null;
  }
  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
    // Deactivating a staff member also closes their open shift —
    // we can't leave them "checked in" while disabled. The
    // partial unique index forces at most one open shift, so we
    // patch by staff_id.
    if (!body.is_active) {
      await admin
        .from('staff_attendance')
        .update({ check_out_at: new Date().toISOString(), check_out_by: auth.profile.id })
        .eq('staff_id', id)
        .is('check_out_at', null);
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, no_op: true });
  }

  const { error: updErr } = await admin
    .from('staff_profiles')
    .update(updates)
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Mirror the few fields that also live on profiles.
  const profileMirror: Record<string, unknown> = {};
  if (updates.full_name !== undefined) profileMirror.full_name = updates.full_name;
  if (updates.phone !== undefined) profileMirror.phone = updates.phone;
  if (Object.keys(profileMirror).length > 0) {
    await admin.from('profiles').update(profileMirror).eq('id', id);
  }

  logAdminAction({
    actor: {
      id: auth.profile.id,
      email: auth.profile.email,
      name: auth.profile.full_name,
    },
    action: 'update',
    targetType: 'profile',
    targetId: id,
    targetLabel: `Staff: ${existing.full_name} (${existing.staff_role})`,
    before: existing as unknown as Record<string, unknown>,
    after: updates,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing staff id.' }, { status: 400 });

  const admin = createAdminSupabaseClient();

  // Confirm it's actually a staff row first; we don't want a
  // typoed UUID nuking a resident.
  const { data: target } = await admin
    .from('staff_profiles')
    .select('id, full_name, staff_role')
    .eq('id', id)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: 'Staff not found.' }, { status: 404 });
  }

  // Delete the auth.users row; profiles + staff_profiles +
  // staff_attendance are all FK-cascaded.
  const { error: delErr } = await admin.auth.admin.deleteUser(id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  logAdminAction({
    actor: {
      id: auth.profile.id,
      email: auth.profile.email,
      name: auth.profile.full_name,
    },
    action: 'delete',
    targetType: 'profile',
    targetId: id,
    targetLabel: `Staff: ${target.full_name} (${target.staff_role})`,
    before: { full_name: target.full_name, staff_role: target.staff_role },
  });

  return NextResponse.json({ ok: true });
}
