import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '@/lib/fund-auth';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { normalizePhoneE164 } from '@/lib/phone';
import { logAdminAction } from '@/lib/admin-audit';

// /api/admin/staff
//
// GET    list staff (filter by role, active flag)
// POST   create a staff login (admin types phone + temp password,
//         we provision the auth.users row + profiles row +
//         staff_profiles row in one transaction-ish flow)
//
// All operations require admin. Auth user creation uses the
// service-role admin client because we need to bypass the
// "phone provider is disabled" Supabase rule (we synthesize an
// email and never touch auth.users.phone, mirroring the resident
// registration flow in /api/auth/register).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Strong but human-readable password. 16 chars from a confusable-
// character-stripped alphabet. The admin reads this aloud or
// types it into the staff member's phone, so we want to skip
// 0/O/1/l/I etc.
const PWD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PWD_LEN = 12;

function generateTempPassword(): string {
  const buf = randomBytes(PWD_LEN);
  const out: string[] = [];
  for (let i = 0; i < PWD_LEN; i++) {
    out.push(PWD_ALPHABET[buf[i] % PWD_ALPHABET.length]);
  }
  // Insert a hyphen mid-string so it's easier to dictate. The
  // backend doesn't care about the separator (Supabase password
  // policy just checks length), it's purely UX.
  const half = Math.floor(PWD_LEN / 2);
  return `${out.slice(0, half).join('')}-${out.slice(half).join('')}`;
}

interface CreateStaffBody {
  full_name?: string;
  phone?: string;
  staff_role?: 'security' | 'housekeeping';
  address?: string | null;
  hired_on?: string | null;
  photo_url?: string | null;
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const role = url.searchParams.get('role');
  const onlyActive = url.searchParams.get('active') !== 'false';

  // We use the admin (service-role) client even though admins
  // technically have RLS access, because we follow up with a
  // second query against staff_attendance to compute "on duty
  // right now" — keeping both reads under the admin client makes
  // the API a single auth path.
  const admin = createAdminSupabaseClient();

  // Build the staff list query. We do a plain SELECT (no join) and
  // fetch open shifts separately so a brand-new staff member with
  // zero attendance rows still appears.
  const filter: Record<string, string | boolean> = {};
  if (role === 'security' || role === 'housekeeping') {
    filter.staff_role = role;
  }
  if (onlyActive) {
    filter.is_active = true;
  }

  const { data: staffList, error } = await admin
    .from('staff_profiles')
    .select(
      'id, staff_role, full_name, phone, address, photo_url, is_active, hired_on, created_at, updated_at',
    )
    .match(filter)
    .order('staff_role', { ascending: true })
    .order('full_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const staffIds = (staffList ?? []).map((s) => s.id);
  let onDutyMap: Record<string, string> = {};
  if (staffIds.length > 0) {
    const { data: openShifts } = await admin
      .from('staff_attendance')
      .select('staff_id, check_in_at')
      .is('check_out_at', null)
      .in('staff_id', staffIds);
    onDutyMap = Object.fromEntries(
      (openShifts ?? []).map((s) => [s.staff_id, s.check_in_at]),
    );
  }

  return NextResponse.json({
    staff: (staffList ?? []).map((s) => ({
      ...s,
      on_duty_since: onDutyMap[s.id] ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: CreateStaffBody;
  try {
    body = (await req.json()) as CreateStaffBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const fullName = (body.full_name ?? '').trim();
  const phoneRaw = (body.phone ?? '').trim();
  const staffRole = body.staff_role;
  const address = body.address?.trim() || null;
  const hiredOn = body.hired_on || null;
  const photoUrl = body.photo_url?.trim() || null;

  if (!fullName) {
    return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
  }
  if (!phoneRaw) {
    return NextResponse.json({ error: 'Phone number is required.' }, { status: 400 });
  }
  if (staffRole !== 'security' && staffRole !== 'housekeeping') {
    return NextResponse.json({ error: 'Role must be security or housekeeping.' }, { status: 400 });
  }
  const phone = normalizePhoneE164(phoneRaw);
  if (!phone) {
    return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 });
  }
  if (address !== null && address.length > 500) {
    return NextResponse.json({ error: 'Address is too long.' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // Defensive: reject if the phone is already used by ANY profile
  // (resident or staff). The login resolver looks up by phone, so
  // duplicates would route the wrong user.
  const { data: existing } = await admin
    .from('profiles')
    .select('id, role')
    .eq('phone', phone)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: 'A user with this phone number already exists.' },
      { status: 409 },
    );
  }

  // Synthesize an email — phone-only account, same trick as
  // /api/auth/register. Supabase won't actually email it.
  // Using a stable hash of the phone as the local-part means a
  // duplicate POST returns the "already exists" branch below
  // rather than creating two accounts with the same phone but
  // different synthetic emails.
  const synthEmail = `staff${phone.replace(/[^0-9]/g, '')}@aaditri.invalid`;
  const tempPassword = generateTempPassword();

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: synthEmail,
    email_confirm: true,
    password: tempPassword,
    user_metadata: {
      full_name: fullName,
      staff_role: staffRole,
    },
  });

  if (createErr || !created.user) {
    const msg = createErr?.message ?? 'Failed to create staff login.';
    const status = /already.*regist|already.*exist|duplicate/i.test(msg) ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }

  const userId = created.user.id;

  // Upsert the shadow profiles row. The handle_new_user trigger
  // would have created a default `role='user', is_approved=true`
  // row already (good defaults for residents, wrong for staff).
  // We override here with the staff fields.
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({
      id: userId,
      email: synthEmail,
      full_name: fullName,
      phone,
      role: 'staff',
      is_approved: true,
    });
  if (profileErr) {
    // Roll back the auth user so a half-created staff account
    // doesn't sit there with no profile + no staff_profiles row
    // (which would make subsequent POSTs hit the "phone exists"
    // branch for a non-functional account).
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json(
      { error: `Profile create failed: ${profileErr.message}` },
      { status: 500 },
    );
  }

  const { error: staffErr } = await admin.from('staff_profiles').insert({
    id: userId,
    staff_role: staffRole,
    full_name: fullName,
    phone,
    address,
    photo_url: photoUrl,
    hired_on: hiredOn,
    is_active: true,
  });
  if (staffErr) {
    // Same rollback rationale.
    await admin.auth.admin.deleteUser(userId);
    await admin.from('profiles').delete().eq('id', userId);
    return NextResponse.json(
      { error: `Staff record create failed: ${staffErr.message}` },
      { status: 500 },
    );
  }

  logAdminAction({
    actor: {
      id: auth.profile.id,
      email: auth.profile.email,
      name: auth.profile.full_name,
    },
    action: 'create',
    targetType: 'profile',
    targetId: userId,
    targetLabel: `Staff: ${fullName} (${staffRole})`,
    after: { staff_role: staffRole, full_name: fullName, phone, address, hired_on: hiredOn },
  });

  return NextResponse.json({
    ok: true,
    staff_id: userId,
    // Returned ONCE so the admin can read the password to the
    // staff member. Never persisted in plain text anywhere; the
    // admin reveal modal in the UI shows it once and then
    // discards it. If the admin closes the modal they need to
    // do a password reset (handled by /api/admin/staff/[id]/reset).
    temp_password: tempPassword,
  });
}
