import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { sendEmail, isEmailConfigured } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Self-service registration that bypasses Supabase's built-in email mailer.
 *
 * Background: Supabase's free SMTP cap is ~2 confirmation emails per project
 * per hour, which kept tripping `email rate limit exceeded` for our community.
 * We sidestep it by:
 *   1) Creating the auth user pre-confirmed via the service-role admin API
 *      (so Supabase NEVER tries to send an email).
 *   2) Inserting their public.profiles row with `is_approved = false` so they
 *      still cannot reach /dashboard until an admin approves them.
 *   3) Sending a "welcome / pending approval" email ourselves through Brevo
 *      (the same path used by booking notifications), which has 300/day free.
 *
 * This route is the ONLY public-facing endpoint that uses the service-role
 * key — same justification as the user-delete route. The endpoint validates
 * input strictly so a bad actor can't smuggle elevated fields like `role` or
 * `is_approved`.
 */

interface RegisterPayload {
  email?: string;
  password?: string;
  full_name?: string;
  phone?: string;
  flat_number?: string;
  resident_type?: 'owner' | 'tenant';
  vehicles?: Array<{ number: string; type: 'car' | 'bike' | 'other' }>;
  family?: Array<{
    full_name: string;
    relation: 'spouse' | 'son' | 'daughter' | 'parent' | 'sibling' | 'other';
    gender?: 'male' | 'female' | 'other' | null;
    age?: number | null;
    phone?: string | null;
  }>;
  pets?: Array<{
    name: string;
    species: 'dog' | 'cat' | 'bird' | 'other';
    vaccinated: boolean;
  }>;
}

const RESIDENT_TYPES = new Set(['owner', 'tenant']);
const VEHICLE_TYPES = new Set(['car', 'bike', 'other']);
const FAMILY_RELATIONS = new Set(['spouse', 'son', 'daughter', 'parent', 'sibling', 'other']);
const GENDERS = new Set(['male', 'female', 'other']);
const PET_SPECIES = new Set(['dog', 'cat', 'bird', 'other']);

export async function POST(req: Request) {
  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      {
        error:
          'Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local and Vercel ' +
          '(Project Settings → Environment Variables) from Supabase Dashboard → Project Settings → API.',
      },
      { status: 500 },
    );
  }

  let body: RegisterPayload;
  try {
    body = (await req.json()) as RegisterPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? '';
  const fullName = body.full_name?.trim() ?? '';
  const flatNumber = body.flat_number?.trim() ?? '';
  const residentType = body.resident_type;
  const phone = body.phone?.trim() ?? '';

  if (!email || !password || !fullName || !flatNumber) {
    return NextResponse.json(
      { error: 'email, password, full_name and flat_number are required' },
      { status: 400 },
    );
  }
  if (!residentType || !RESIDENT_TYPES.has(residentType)) {
    return NextResponse.json({ error: 'resident_type must be owner or tenant' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }
  // Soft email shape check — Supabase will give a tighter error if it's truly bad.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // STEP 1: create the auth user pre-confirmed.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // critical: skips Supabase's confirmation mailer entirely
    user_metadata: {
      full_name: fullName,
      flat_number: flatNumber,
      resident_type: residentType,
    },
  });

  if (createErr || !created.user) {
    // Translate Supabase's "User already registered" into a friendlier 409.
    const msg = createErr?.message ?? 'Failed to create user';
    const status = /already.*regist|already.*exist/i.test(msg) ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }

  const userId = created.user.id;

  // STEP 2: persist the profile + optional collections. Failures here are
  // non-fatal because the auth user already exists — the resident can fix
  // up profile details from the Profile page after admin approval.
  // We collect partial-failure messages so the response can warn the UI.
  const warnings: string[] = [];

  const { error: profileErr } = await admin.from('profiles').upsert({
    id: userId,
    email,
    full_name: fullName,
    phone: phone || null,
    flat_number: flatNumber,
    resident_type: residentType,
    role: 'user',
    is_approved: false, // admin still has to flip this
  });
  if (profileErr) warnings.push(`profile: ${profileErr.message}`);

  if (Array.isArray(body.vehicles) && body.vehicles.length > 0) {
    const rows = body.vehicles
      .filter((v) => v && typeof v.number === 'string' && v.number.trim())
      .map((v) => ({
        user_id: userId,
        number: v.number.trim(),
        type: VEHICLE_TYPES.has(v.type) ? v.type : 'car',
      }));
    if (rows.length > 0) {
      const { error } = await admin.from('vehicles').insert(rows);
      if (error) warnings.push(`vehicles: ${error.message}`);
    }
  }

  if (Array.isArray(body.family) && body.family.length > 0) {
    const rows = body.family
      .filter((f) => f && typeof f.full_name === 'string' && f.full_name.trim())
      .map((f) => ({
        user_id: userId,
        full_name: f.full_name.trim(),
        relation: FAMILY_RELATIONS.has(f.relation) ? f.relation : 'other',
        gender: f.gender && GENDERS.has(f.gender) ? f.gender : null,
        age: typeof f.age === 'number' && f.age >= 0 && f.age <= 120 ? f.age : null,
        phone: f.phone?.trim() || null,
      }));
    if (rows.length > 0) {
      const { error } = await admin.from('family_members').insert(rows);
      if (error) warnings.push(`family: ${error.message}`);
    }
  }

  if (Array.isArray(body.pets) && body.pets.length > 0) {
    const rows = body.pets
      .filter((p) => p && typeof p.name === 'string' && p.name.trim())
      .map((p) => ({
        user_id: userId,
        name: p.name.trim(),
        species: PET_SPECIES.has(p.species) ? p.species : 'dog',
        vaccinated: Boolean(p.vaccinated),
      }));
    if (rows.length > 0) {
      const { error } = await admin.from('pets').insert(rows);
      if (error) warnings.push(`pets: ${error.message}`);
    }
  }

  // STEP 3: send our own welcome email via Brevo. Fire-and-watch: a failure
  // here is logged but does NOT fail the registration — the resident is
  // already created and pending. Admins can resend if needed.
  let emailStatus: 'sent' | 'skipped' | 'failed' = 'skipped';
  let emailError: string | null = null;
  if (isEmailConfigured()) {
    const result = await sendEmail({
      to: email,
      subject: 'Welcome to Aaditri Emerland — pending approval',
      html: buildWelcomeHtml({ fullName, flatNumber, residentType }),
      text: buildWelcomeText({ fullName, flatNumber, residentType }),
    });
    if (result.ok) {
      emailStatus = 'sent';
    } else if ('skipped' in result && result.skipped) {
      emailStatus = 'skipped';
    } else {
      emailStatus = 'failed';
      emailError = 'error' in result ? result.error : 'unknown';
    }
  }

  return NextResponse.json({
    ok: true,
    user_id: userId,
    email_status: emailStatus,
    email_error: emailError,
    warnings,
  });
}

interface WelcomeArgs {
  fullName: string;
  flatNumber: string;
  residentType: 'owner' | 'tenant';
}

function buildWelcomeHtml({ fullName, flatNumber, residentType }: WelcomeArgs): string {
  const safeName = escapeHtml(fullName);
  const safeFlat = escapeHtml(flatNumber);
  const safeType = residentType === 'owner' ? '🏠 Owner' : '🔑 Tenant';
  return `
<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:16px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,.06);">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="display:inline-block;width:56px;height:56px;border-radius:14px;background:#1B5E20;color:#fff;font-weight:700;font-size:22px;line-height:56px;">AE</div>
        <h1 style="margin:14px 0 4px;font-size:22px;color:#1B5E20;">Welcome, ${safeName}!</h1>
        <p style="margin:0;color:#6b7280;font-size:14px;">Aaditri Emerland Community</p>
      </div>
      <p style="font-size:15px;line-height:1.55;">
        Your account has been created successfully. Here's what you registered with:
      </p>
      <ul style="font-size:14px;color:#374151;line-height:1.7;padding-left:18px;">
        <li><strong>Flat:</strong> ${safeFlat}</li>
        <li><strong>Type:</strong> ${safeType}</li>
      </ul>
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:14px;margin:20px 0;">
        <p style="margin:0;font-weight:700;color:#92400e;font-size:14px;">⏳ Approval pending</p>
        <p style="margin:6px 0 0;color:#92400e;font-size:13px;line-height:1.5;">
          Your registration is currently <strong>awaiting admin approval</strong>.
          You'll be able to sign in as soon as an admin reviews your details
          (usually within 24–48 hours).
        </p>
      </div>
      <p style="font-size:13px;color:#6b7280;line-height:1.6;">
        If you didn't sign up for this account, you can safely ignore this email.
        No further action is needed.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;"/>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
        Aaditri Emerland Community · automated message · please do not reply
      </p>
    </div>
  </div>
</body></html>`.trim();
}

function buildWelcomeText({ fullName, flatNumber, residentType }: WelcomeArgs): string {
  return [
    `Welcome to Aaditri Emerland, ${fullName}!`,
    '',
    'Your account has been created successfully.',
    `  Flat: ${flatNumber}`,
    `  Type: ${residentType === 'owner' ? 'Owner' : 'Tenant'}`,
    '',
    'APPROVAL PENDING',
    'Your registration is currently awaiting admin approval.',
    "You'll be able to sign in as soon as an admin reviews your details",
    '(usually within 24–48 hours).',
    '',
    "If you didn't sign up for this account, you can safely ignore this email.",
    '',
    '— Aaditri Emerland Community',
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
