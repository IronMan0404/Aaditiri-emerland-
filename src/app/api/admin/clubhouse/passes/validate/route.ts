import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { verifyPassToken } from '@/lib/clubhouse-pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pass validation endpoint used by the admin/security gate scanner.
//
// The client may submit either:
//   - { token: '<qr_payload>' } from the camera scanner
//   - { code: 'AE-XXXXXX' } typed at the gate when the camera fails
//
// In both cases we resolve to the canonical clubhouse_passes row, return
// the pass + flat + facility metadata for display, and (if `consume:true`)
// flip the row to status='used' atomically. We do NOT implicitly consume on
// every scan so the gate operator can verify before tapping "admit".

interface ValidatePayload {
  token?: string;
  code?: string;
  consume?: boolean;
}

interface PassRow {
  id: string;
  code: string;
  qr_payload: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
  flat_number: string;
  valid_from: string;
  valid_until: string;
  used_at: string | null;
  issued_to: string;
  facility_id: string;
  subscription_id: string;
  profiles?: { full_name: string | null; email: string | null } | null;
  clubhouse_facilities?: { id: string; slug: string; name: string } | null;
}

export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase.from('profiles').select('id, role').eq('id', user.id).single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as ValidatePayload;
  const token = body.token?.trim();
  const code = body.code?.trim().toUpperCase();
  const consume = Boolean(body.consume);

  if (!token && !code) {
    return NextResponse.json({ error: 'Provide a QR token or pass code' }, { status: 400 });
  }

  // 1. Resolve the pass row. Token wins if both are supplied (camera path).
  let pass: PassRow | null = null;
  let signatureWarning: string | null = null;

  if (token) {
    const verify = verifyPassToken(token);
    if (!verify.ok) {
      // For 'expired' we still try to look the row up so the gate can show
      // the resident's name + the original window for context. For
      // 'malformed' / 'bad_signature' we hard-fail \u2014 a bogus token never
      // matches a real DB row anyway.
      if (verify.reason !== 'expired') {
        return NextResponse.json({ ok: false, reason: verify.reason ?? 'invalid' }, { status: 400 });
      }
      signatureWarning = 'token_expired';
    }
    const passId = verify.payload?.id;
    if (passId) {
      const { data } = await supabase
        .from('clubhouse_passes')
        .select(`
          id, code, qr_payload, status, flat_number, valid_from, valid_until, used_at,
          issued_to, facility_id, subscription_id,
          profiles:issued_to(full_name, email),
          clubhouse_facilities(id, slug, name)
        `)
        .eq('id', passId)
        .maybeSingle();
      pass = (data as unknown as PassRow) ?? null;
    }
  }

  if (!pass && code) {
    const { data } = await supabase
      .from('clubhouse_passes')
      .select(`
        id, code, qr_payload, status, flat_number, valid_from, valid_until, used_at,
        issued_to, facility_id, subscription_id,
        profiles:issued_to(full_name, email),
        clubhouse_facilities(id, slug, name)
      `)
      .eq('code', code)
      .maybeSingle();
    pass = (data as unknown as PassRow) ?? null;
  }

  if (!pass) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }

  // 2. Compute the effective state. The DB has a separate cron-driven sweep
  // that lazily flips expired rows; until then we surface 'expired' here so
  // the gate UI is always correct.
  const now = Date.now();
  const validFromMs = new Date(pass.valid_from).getTime();
  const validUntilMs = new Date(pass.valid_until).getTime();
  let effectiveStatus: PassRow['status'] | 'not_yet_valid' = pass.status;
  if (pass.status === 'active') {
    if (now < validFromMs) effectiveStatus = 'not_yet_valid';
    else if (now > validUntilMs) effectiveStatus = 'expired';
  }

  // 3. Optionally consume the pass. Only allowed when the pass is in its
  // valid window AND currently 'active'.
  let consumed = false;
  if (consume) {
    if (effectiveStatus !== 'active') {
      return NextResponse.json({
        ok: false,
        reason: `cannot_consume_${effectiveStatus}`,
        pass: serializePass(pass, effectiveStatus, signatureWarning),
      }, { status: 409 });
    }
    const { error } = await supabase
      .from('clubhouse_passes')
      .update({ status: 'used', used_at: new Date().toISOString(), validated_by: user.id })
      .eq('id', pass.id)
      .eq('status', 'active');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    consumed = true;
  }

  return NextResponse.json({
    ok: true,
    consumed,
    pass: serializePass(pass, consumed ? 'used' : effectiveStatus, signatureWarning),
  });
}

function serializePass(p: PassRow, effectiveStatus: string, warning: string | null) {
  return {
    id: p.id,
    code: p.code,
    status: p.status,
    effective_status: effectiveStatus,
    flat_number: p.flat_number,
    valid_from: p.valid_from,
    valid_until: p.valid_until,
    used_at: p.used_at,
    issued_to_name: p.profiles?.full_name ?? null,
    issued_to_email: p.profiles?.email ?? null,
    facility: p.clubhouse_facilities ? { id: p.clubhouse_facilities.id, name: p.clubhouse_facilities.name, slug: p.clubhouse_facilities.slug } : null,
    warning,
  };
}
