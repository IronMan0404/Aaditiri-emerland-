import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireAdmin } from '@/lib/fund-auth';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';
import { notifyAfter } from '@/lib/notify';

// POST /api/admin/funds/dues/alert
//
// Fan out a "you have pending dues" notification to every flat with
// outstanding contributions. Two modes:
//
//   { mode: 'global' }     — alert across ALL active collecting funds
//                            with a per-flat suggestion. Each flat
//                            sees a single message with their summed
//                            outstanding (e.g. "₹1,500 across 3
//                            funds"). Linked to /dashboard/funds.
//
//   { mode: 'fund', fundId } — alert only flats short on this single
//                              fund. Each flat sees the fund name and
//                              the amount short. Linked to that fund.
//
// Auth: admin only (via requireAdmin).
//
// Audit: a single row per recipient lands in notification_events
// (kind='dues_reminder'). The dispatcher's per-recipient dedup uses
// a fresh batch UUID as the ref_id so the same flat can be nudged
// again next month — without it, the unique constraint in
// telegram_notifications_sent (kind, ref_id, user_id) would block
// repeated nudges. The trade-off: we lose dedup against accidental
// double-clicks on the same admin button. The UI has a confirm modal
// to make double-clicks deliberate, so this is acceptable.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AlertPayload {
  mode?: 'global' | 'fund';
  fundId?: string | null;
  // Optional: if true, also returns the dry-run preview without
  // dispatching. The UI uses this to populate the confirm modal.
  preview?: boolean;
}

interface FlatDue {
  flat_number: string;
  total_pending_paise: number;
  fund_count: number;
  fund_name: string | null;
  fund_id: string | null;
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as AlertPayload;
  const mode = body.mode === 'fund' ? 'fund' : 'global';
  const fundId = mode === 'fund' ? (body.fundId?.trim() ?? null) : null;
  const previewOnly = body.preview === true;

  if (mode === 'fund' && !fundId) {
    return NextResponse.json(
      { error: 'fundId is required when mode = "fund"' },
      { status: 400 },
    );
  }

  // Use the service-role client — we need to read every flat's
  // residents regardless of the admin's RLS scope, and we need to
  // resolve dues across funds the admin might not have refreshed
  // their session for.
  const adb = createAdminSupabaseClient();

  // 1. Pick the funds in scope.
  let fundsQuery = adb
    .from('community_funds')
    .select('id, name, suggested_per_flat')
    .eq('status', 'collecting')
    .not('suggested_per_flat', 'is', null)
    .gt('suggested_per_flat', 0);
  if (fundId) fundsQuery = fundsQuery.eq('id', fundId);

  const { data: fundsRaw } = await fundsQuery;
  const funds = (fundsRaw ?? []) as {
    id: string;
    name: string;
    suggested_per_flat: number;
  }[];

  if (funds.length === 0) {
    return NextResponse.json({
      mode,
      preview: previewOnly,
      recipients_count: 0,
      flats_with_dues: 0,
      total_pending_paise: 0,
      message: 'No matching active fund with a per-flat suggestion.',
    });
  }

  const fundIds = funds.map((f) => f.id);

  // 2. Sum received cash contributions per (flat, fund).
  const { data: contribRaw } = await adb
    .from('fund_contributions')
    .select('fund_id, flat_number, amount')
    .in('fund_id', fundIds)
    .eq('status', 'received')
    .eq('is_in_kind', false);
  const contribs = (contribRaw ?? []) as {
    fund_id: string;
    flat_number: string;
    amount: number;
  }[];
  const paidByFlatFund = new Map<string, number>();
  for (const c of contribs) {
    if (c.flat_number === 'OPENING' || c.flat_number === 'POOL') continue;
    const k = `${c.flat_number}|${c.fund_id}`;
    paidByFlatFund.set(k, (paidByFlatFund.get(k) ?? 0) + c.amount);
  }

  // 3. Every approved, non-bot resident — we need both the flat list
  // (so a flat with zero contributions still appears) and the
  // mapping flat -> [resident_id].
  const { data: profilesRaw } = await adb
    .from('profiles')
    .select('id, flat_number')
    .eq('is_approved', true)
    .eq('is_bot', false)
    .not('flat_number', 'is', null);
  const profiles = (profilesRaw ?? []) as {
    id: string;
    flat_number: string;
  }[];
  const residentsByFlat = new Map<string, string[]>();
  for (const p of profiles) {
    if (!p.flat_number) continue;
    const list = residentsByFlat.get(p.flat_number) ?? [];
    list.push(p.id);
    residentsByFlat.set(p.flat_number, list);
  }

  // 4. Compute per-flat dues.
  const flatNumbers = Array.from(residentsByFlat.keys());
  const flatDues: FlatDue[] = [];
  for (const flat of flatNumbers) {
    let totalPending = 0;
    let fundsShort = 0;
    for (const f of funds) {
      const paid = paidByFlatFund.get(`${flat}|${f.id}`) ?? 0;
      const pending = Math.max(0, f.suggested_per_flat - paid);
      if (pending > 0) {
        totalPending += pending;
        fundsShort += 1;
      }
    }
    if (totalPending > 0) {
      flatDues.push({
        flat_number: flat,
        total_pending_paise: totalPending,
        fund_count: fundsShort,
        // Per-fund mode → carry the fund name/id so the message can
        // be specific. Global mode → null and the renderer says
        // "across N funds".
        fund_name: mode === 'fund' ? funds[0].name : null,
        fund_id: mode === 'fund' ? funds[0].id : null,
      });
    }
  }

  const recipientsCount = flatDues.reduce(
    (s, d) => s + (residentsByFlat.get(d.flat_number)?.length ?? 0),
    0,
  );
  const totalPendingPaise = flatDues.reduce(
    (s, d) => s + d.total_pending_paise,
    0,
  );

  if (previewOnly) {
    return NextResponse.json({
      mode,
      preview: true,
      flats_with_dues: flatDues.length,
      recipients_count: recipientsCount,
      total_pending_paise: totalPendingPaise,
      fund_name: mode === 'fund' ? funds[0].name : null,
    });
  }

  // 5. Fan out. One notify() per resident per flat with dues.
  // Dispatch is per-recipient because the body is personalised
  // (their flat's amount). notifyAfter() ensures each fan-out runs
  // even after we've responded to the admin (Vercel `waitUntil`).
  const batchId = randomUUID();
  let dispatched = 0;
  for (const due of flatDues) {
    const residents = residentsByFlat.get(due.flat_number) ?? [];
    for (const recipientId of residents) {
      notifyAfter('dues_reminder', `${batchId}:${recipientId}`, {
        recipientId,
        flatNumber: due.flat_number,
        totalPendingPaise: due.total_pending_paise,
        fundCount: due.fund_count,
        fundName: due.fund_name,
        fundId: due.fund_id,
      });
      dispatched += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    mode,
    batch_id: batchId,
    flats_with_dues: flatDues.length,
    recipients_count: dispatched,
    total_pending_paise: totalPendingPaise,
    fund_name: mode === 'fund' ? funds[0].name : null,
    actor: { id: auth.user.id, name: auth.profile.full_name },
  });
}
