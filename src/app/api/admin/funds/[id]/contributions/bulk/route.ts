import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { rupeesToPaise } from '@/lib/money';
import { logAdminAction } from '@/lib/admin-audit';
import type { ContributionMethod } from '@/types/funds';

// Allowed methods (mirrors the contribute form / single quick-add).
const ALLOWED_METHODS: ContributionMethod[] = ['cash', 'upi', 'cheque', 'neft', 'imps', 'other'];

interface BulkRow {
  flat_number: string;
  amount: number; // rupees
  method?: ContributionMethod;
  contributor_name?: string;
  reference_number?: string;
  notes?: string;
}

interface Body {
  rows: BulkRow[];
  // Default method applied to any row that didn't specify one (the
  // paste UI sends the dropdown choice here so users don't have to
  // type "cash" / "upi" on every line).
  default_method?: ContributionMethod;
  // Default contribution date for every row (paste rows don't carry
  // dates). Defaults to today server-side if missing.
  contribution_date?: string;
}

// POST /api/admin/funds/[id]/contributions/bulk
// Records many auto-verified contributions in one round-trip. All
// rows are inserted in a single transaction-ish batch — Supabase's
// .insert([...]) is one statement, so either all rows land or the
// admin gets a single error and nothing is partially committed.
//
// Why a dedicated endpoint instead of N calls to the single route?
//   * One audit log row covers the entire batch (and tells you
//     exactly how many rows were created), which keeps /admin/audit
//     readable.
//   * Profile lookups are batched (one IN query) instead of N point
//     reads, which matters when Treasury pastes in 80 flats at once.
//   * One round-trip from the browser → one Vercel function invoke,
//     which keeps us comfortably under the Hobby timeout.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: fundId } = await ctx.params;
  const body = (await req.json()) as Body;

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: 'rows[] required' }, { status: 400 });
  }
  if (body.rows.length > 200) {
    return NextResponse.json({ error: 'Too many rows (max 200 per batch)' }, { status: 400 });
  }

  const defaultMethod: ContributionMethod = body.default_method && ALLOWED_METHODS.includes(body.default_method)
    ? body.default_method
    : 'cash';
  const date = body.contribution_date || new Date().toISOString().slice(0, 10);

  // Validate every row up-front so we never half-insert. Returns
  // the index in the original array so the UI can highlight the bad
  // row instead of dumping a generic "validation failed".
  const errors: Array<{ index: number; message: string }> = [];
  const rows = body.rows.map((r, i) => {
    const flat = r.flat_number?.trim();
    const amt = Number(r.amount);
    const method = (r.method && ALLOWED_METHODS.includes(r.method) ? r.method : defaultMethod);
    if (!flat) errors.push({ index: i, message: 'Flat number required' });
    if (!amt || amt <= 0) errors.push({ index: i, message: 'Amount must be > 0' });
    return { ...r, flat_number: flat ?? '', amount: amt, method };
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 });
  }

  // Batch-resolve profiles for every distinct flat_number so we can
  // fill resident_id + auto-derive contributor_name in one query.
  const flats = Array.from(new Set(rows.map((r) => r.flat_number)));
  const { data: profiles } = await auth.supabase
    .from('profiles')
    .select('id, full_name, flat_number')
    .in('flat_number', flats)
    .eq('is_approved', true)
    .eq('is_bot', false);
  const flatToProfile = new Map<string, { id: string; full_name: string | null }>();
  for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; flat_number: string }>) {
    // If a flat has multiple residents (owner + tenant), the first
    // one wins. The contributor_name fallback already handles the
    // ambiguous case ("Flat 413") if a row has no explicit name.
    if (!flatToProfile.has(p.flat_number)) {
      flatToProfile.set(p.flat_number, { id: p.id, full_name: p.full_name });
    }
  }

  const nowIso = new Date().toISOString();
  const insertPayload = rows.map((r) => {
    const profile = flatToProfile.get(r.flat_number);
    return {
      fund_id: fundId,
      flat_number: r.flat_number,
      resident_id: profile?.id ?? null,
      contributor_name: r.contributor_name?.trim() || profile?.full_name || `Flat ${r.flat_number}`,
      amount: rupeesToPaise(r.amount),
      method: r.method,
      reference_number: r.reference_number?.trim() || null,
      contribution_date: date,
      notes: r.notes?.trim() || null,
      status: 'received' as const,
      is_in_kind: false,
      reported_by: auth.profile.id,
      received_by: auth.profile.id,
      received_at: nowIso,
    };
  });

  const { data: inserted, error } = await auth.supabase
    .from('fund_contributions')
    .insert(insertPayload)
    .select('id, flat_number, amount, method');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Single audit row summarising the whole batch — keeps the audit
  // page readable, and the `after` snapshot still lists every
  // contribution ID for traceability.
  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'create',
    targetType: 'fund_contribution',
    targetId: 'bulk',
    targetLabel: `Bulk add: ${inserted?.length ?? 0} contributions`,
    after: {
      fund_id: fundId,
      contribution_date: date,
      default_method: defaultMethod,
      count: inserted?.length ?? 0,
      total_amount_paise: insertPayload.reduce((a, r) => a + r.amount, 0),
      ids: (inserted ?? []).map((r) => r.id),
    },
    request: req,
  });

  return NextResponse.json({ ok: true, count: inserted?.length ?? 0, contributions: inserted ?? [] });
}
