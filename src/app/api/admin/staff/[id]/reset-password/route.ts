import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '@/lib/fund-auth';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';

// /api/admin/staff/[id]/reset-password
//
// POST  Mint a fresh temp password for a staff member. The
//        password is returned to the admin in the response body
//        ONCE; the admin reads it to the staff member out-of-band.
//        This endpoint exists because staff members usually don't
//        have email or Telegram to do the normal forgot-password
//        flow. The admin is the recovery channel.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PWD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PWD_LEN = 12;

function generateTempPassword(): string {
  const buf = randomBytes(PWD_LEN);
  const out: string[] = [];
  for (let i = 0; i < PWD_LEN; i++) {
    out.push(PWD_ALPHABET[buf[i] % PWD_ALPHABET.length]);
  }
  const half = Math.floor(PWD_LEN / 2);
  return `${out.slice(0, half).join('')}-${out.slice(half).join('')}`;
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing staff id.' }, { status: 400 });

  const admin = createAdminSupabaseClient();

  // Confirm the target is actually a staff row, not a resident.
  // This endpoint is staff-only — admins should not be able to
  // reset another admin's password from here. Resident password
  // resets go through the admin-mediated recovery flow at
  // /api/admin/recovery-requests/[id]/resolve.
  const { data: target } = await admin
    .from('staff_profiles')
    .select('id, full_name, staff_role')
    .eq('id', id)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: 'Staff not found.' }, { status: 404 });
  }

  const tempPassword = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(id, {
    password: tempPassword,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // We log this as an `update` on the profile target with a
  // descriptive targetLabel so the audit feed makes the action
  // obvious without needing a new AdminAuditAction enum value.
  logAdminAction({
    actor: {
      id: auth.profile.id,
      email: auth.profile.email,
      name: auth.profile.full_name,
    },
    action: 'update',
    targetType: 'profile',
    targetId: id,
    targetLabel: `Staff password reset: ${target.full_name} (${target.staff_role})`,
    reason: 'admin reset staff password',
  });

  return NextResponse.json({ ok: true, temp_password: tempPassword });
}
