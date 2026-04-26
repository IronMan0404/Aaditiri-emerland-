import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient, isAdminClientConfigured } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin-audit';
import { normalizePhoneE164 } from '@/lib/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============================================================
// Admin-only one-shot: normalize every profiles.phone to E.164.
//
// Why this exists
// ---------------
// Phone-based login at /auth/login goes through
// /api/auth/resolve-identifier, which always normalizes the typed
// input to E.164 ("+919876543210") before doing
// `select email from profiles where phone = $1`. Any legacy row
// that stored "9876543210" or "098765 43210" or "+91 9876543210"
// will silently miss that lookup and the resident will see "Invalid
// login credentials" even with the right password.
//
// This route walks every approved-or-not profile, normalizes the
// phone column with the same helper login uses, and writes back the
// canonical form. It's idempotent — re-running it on already-clean
// rows is a no-op.
//
// Two extra safety rails:
//   1) GET returns a dry-run preview (counts + a sample of rows that
//      would change) so the admin can sanity-check before any write.
//   2) Duplicates that would trip the partial unique index
//      `profiles_phone_unique_idx` are reported but NOT written. The
//      admin has to manually decide which of the two flats keeps the
//      number and clear the other.
// =============================================================

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  flat_number: string | null;
  phone: string | null;
}

interface PhoneRowDiff {
  id: string;
  flat: string | null;
  name: string | null;
  before: string;
  after: string;
}

async function loadAllProfilesWithPhone(): Promise<ProfileRow[]> {
  const admin = createAdminSupabaseClient();
  const out: ProfileRow[] = [];
  let offset = 0;
  const PAGE = 1000;
  // Page just in case the community ever exceeds the default Supabase
  // 1000-row PostgREST cap.
  while (true) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, full_name, email, flat_number, phone')
      .not('phone', 'is', null)
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as ProfileRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

interface DiffSummary {
  total_with_phone: number;
  already_canonical: number;
  to_change: PhoneRowDiff[];
  to_clear: ProfileRow[];
  conflicts: Array<{ phone: string; rows: ProfileRow[] }>;
}

function buildDiff(rows: ProfileRow[]): DiffSummary {
  const summary: DiffSummary = {
    total_with_phone: rows.length,
    already_canonical: 0,
    to_change: [],
    to_clear: [],
    conflicts: [],
  };

  const byNormalized = new Map<string, ProfileRow[]>();

  for (const row of rows) {
    const before = (row.phone ?? '').trim();
    if (!before) continue;
    const after = normalizePhoneE164(before);
    if (!after) {
      // Unparseable input — clear it so the unique index isn't blocked
      // by garbage. We log this in audit so it's not silent.
      summary.to_clear.push(row);
      continue;
    }
    if (after === before) {
      summary.already_canonical += 1;
    } else {
      summary.to_change.push({
        id: row.id,
        flat: row.flat_number,
        name: row.full_name,
        before,
        after,
      });
    }
    const list = byNormalized.get(after) ?? [];
    list.push(row);
    byNormalized.set(after, list);
  }

  for (const [phone, list] of byNormalized.entries()) {
    if (list.length > 1) {
      summary.conflicts.push({ phone, rows: list });
    }
  }

  return summary;
}

async function ensureAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) {
    return {
      err: NextResponse.json({ error: 'Not signed in' }, { status: 401 }),
    };
  }
  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== 'admin') {
    return {
      err: NextResponse.json({ error: 'Admin access required' }, { status: 403 }),
    };
  }
  return { me };
}

export async function GET() {
  const guard = await ensureAdmin();
  if ('err' in guard) return guard.err;
  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' },
      { status: 500 },
    );
  }

  let rows: ProfileRow[];
  try {
    rows = await loadAllProfilesWithPhone();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: `Read failed: ${msg}` }, { status: 500 });
  }

  const summary = buildDiff(rows);
  return NextResponse.json({
    ok: true,
    dry_run: true,
    ...summary,
    sample: summary.to_change.slice(0, 25),
  });
}

export async function POST(req: Request) {
  const guard = await ensureAdmin();
  if ('err' in guard) return guard.err;
  const me = guard.me;

  if (!isAdminClientConfigured()) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' },
      { status: 500 },
    );
  }

  let rows: ProfileRow[];
  try {
    rows = await loadAllProfilesWithPhone();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: `Read failed: ${msg}` }, { status: 500 });
  }

  const summary = buildDiff(rows);
  const admin = createAdminSupabaseClient();

  let updated = 0;
  const failed: Array<{ id: string; error: string }> = [];

  // Skip rows whose normalized phone collides with another row that's
  // already in the canonical form — writing here would trip the unique
  // index. Surface them in the response so the admin can resolve manually.
  const conflictSet = new Set<string>();
  for (const c of summary.conflicts) {
    for (const r of c.rows) conflictSet.add(r.id);
  }

  for (const change of summary.to_change) {
    if (conflictSet.has(change.id)) continue;
    const { error } = await admin
      .from('profiles')
      .update({ phone: change.after })
      .eq('id', change.id);
    if (error) {
      failed.push({ id: change.id, error: error.message });
    } else {
      updated += 1;
    }
  }

  // Clear out unparseable garbage that would otherwise sit forever.
  let cleared = 0;
  for (const row of summary.to_clear) {
    if (conflictSet.has(row.id)) continue;
    const { error } = await admin
      .from('profiles')
      .update({ phone: null })
      .eq('id', row.id);
    if (error) {
      failed.push({ id: row.id, error: error.message });
    } else {
      cleared += 1;
    }
  }

  await logAdminAction({
    actor: { id: me.id, email: me.email, name: me.full_name },
    action: 'update',
    targetType: 'profile',
    targetId: 'bulk:normalize-phones',
    targetLabel: `Phone normalization: ${updated} updated, ${cleared} cleared, ${summary.conflicts.length} conflicts, ${failed.length} failed`,
    before: { total_with_phone: summary.total_with_phone },
    after: {
      already_canonical: summary.already_canonical,
      updated,
      cleared,
      failed: failed.length,
      conflicts: summary.conflicts.length,
    },
    request: req,
  });

  return NextResponse.json({
    ok: true,
    total_with_phone: summary.total_with_phone,
    already_canonical: summary.already_canonical,
    updated,
    cleared,
    conflicts: summary.conflicts.map((c) => ({
      phone: c.phone,
      ids: c.rows.map((r) => r.id),
      flats: c.rows.map((r) => r.flat_number),
    })),
    failed,
  });
}
