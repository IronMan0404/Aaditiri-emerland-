import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { rupeesToPaise } from '@/lib/money';
import { logAdminAction } from '@/lib/admin-audit';
import type { FundStatus, FundVisibility } from '@/types/funds';

interface UpdateBody {
  name?: string;
  category_id?: string;
  description?: string | null;
  purpose?: string | null;
  target_amount?: number | null;
  suggested_per_flat?: number | null;
  collection_deadline?: string | null;
  event_date?: string | null;
  visibility?: FundVisibility;
  status?: FundStatus;
  cover_image_url?: string | null;
}

// PATCH /api/admin/funds/[id] — edit fund metadata. Note: closing a fund
// goes through /close (which handles surplus); this endpoint only allows
// freeform field edits.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const body = (await req.json()) as UpdateBody;

  // Build patch carefully — only set keys actually present on the body.
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name?.trim() || null;
  if (body.category_id !== undefined) patch.category_id = body.category_id;
  if (body.description !== undefined) patch.description = body.description?.trim?.() || null;
  if (body.purpose !== undefined) patch.purpose = body.purpose?.trim?.() || null;
  if (body.target_amount !== undefined) {
    patch.target_amount = body.target_amount == null ? null : rupeesToPaise(body.target_amount);
  }
  if (body.suggested_per_flat !== undefined) {
    patch.suggested_per_flat =
      body.suggested_per_flat == null ? null : rupeesToPaise(body.suggested_per_flat);
  }
  if (body.collection_deadline !== undefined) patch.collection_deadline = body.collection_deadline;
  if (body.event_date !== undefined) patch.event_date = body.event_date;
  if (body.visibility !== undefined) patch.visibility = body.visibility;
  if (body.status !== undefined) patch.status = body.status;
  if (body.cover_image_url !== undefined) patch.cover_image_url = body.cover_image_url;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  // Snapshot the row BEFORE the update so the audit log can show what changed.
  const { data: before } = await auth.supabase
    .from('community_funds')
    .select('*')
    .eq('id', id)
    .single();

  const { data, error } = await auth.supabase
    .from('community_funds')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'update',
    targetType: 'community_fund',
    targetId: id,
    targetLabel: data.name,
    before: before ?? undefined,
    after: data,
    request: req,
  });

  return NextResponse.json({ fund: data });
}

// DELETE — there are TWO modes:
//
//   1. Safe delete (default). Only allowed when the fund has ZERO child rows
//      in fund_contributions / fund_spends / fund_refunds. We return a 409
//      otherwise with `code: 'has_activity'` and a count breakdown so the UI
//      can switch to the force-delete confirmation flow.
//
//   2. Force delete (?force=true). Hard-deletes the fund AND every child
//      row (contributions, spends, refunds, comments, attachments). The
//      contributions/spends/refunds tables are FK'd `on delete restrict` so
//      we have to wipe them explicitly first; comments + attachments are
//      `on delete cascade` and would clean themselves, but we delete them
//      explicitly too for symmetry and so the audit captures the counts.
//      Force-mode REQUIRES:
//        * `confirm_phrase` exactly equal to the fund name (typed by the
//          admin in the modal — guards against muscle-memory clicks),
//        * `reason` (non-empty string, captured in the audit log).
//      Any child fund whose `parent_fund_id` points here is detached
//      (parent_fund_id := null) rather than deleted — we don't want a
//      "delete the Diwali 2026 fund" click to also nuke "Diwali 2026 raffle"
//      transitively.
//
// Force-delete is destructive and IRREVERSIBLE. The /cancel endpoint is still
// the recommended path for almost every situation; force-delete only exists
// for cases like a duplicate fund created by mistake that already had a few
// real contributions logged against it.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';

  // Force-mode requires confirm_phrase + reason in the JSON body. We accept
  // an empty body for the safe-delete case so the existing simple-confirm
  // UI doesn't have to send anything.
  let confirmPhrase: string | null = null;
  let reason: string | null = null;
  if (force) {
    try {
      const body = (await req.json()) as { confirm_phrase?: string; reason?: string };
      confirmPhrase = body.confirm_phrase?.trim() ?? null;
      reason = body.reason?.trim() ?? null;
    } catch {
      // Body parse failure in force mode is treated as missing confirmation.
      return NextResponse.json(
        { error: 'Force delete requires { confirm_phrase, reason } in the request body.' },
        { status: 400 }
      );
    }
    if (!confirmPhrase) {
      return NextResponse.json(
        { error: 'Type the fund name to confirm force delete.' },
        { status: 400 }
      );
    }
    if (!reason || reason.length < 4) {
      return NextResponse.json(
        { error: 'A short reason (min 4 chars) is required for force delete — captured in the audit log.' },
        { status: 400 }
      );
    }
  }

  // Snapshot the full row first so the audit entry preserves what was deleted.
  const { data: fund, error: fErr } = await auth.supabase
    .from('community_funds')
    .select('*')
    .eq('id', id)
    .single();
  if (fErr || !fund) return NextResponse.json({ error: 'Fund not found' }, { status: 404 });

  // Cheap parallel count of every child table. Used for both:
  //   - the safe-delete 409 message (when force=false), AND
  //   - the force-delete audit snapshot (so the log shows what was wiped).
  const [
    { count: cContribs }, { count: cSpends }, { count: cRefunds },
    { count: cComments }, { count: cAttachments }, { count: cChildFunds },
  ] = await Promise.all([
    auth.supabase.from('fund_contributions').select('id', { count: 'exact', head: true }).eq('fund_id', id),
    auth.supabase.from('fund_spends').select('id', { count: 'exact', head: true }).eq('fund_id', id),
    auth.supabase.from('fund_refunds').select('id', { count: 'exact', head: true }).eq('fund_id', id),
    auth.supabase.from('fund_comments').select('id', { count: 'exact', head: true }).eq('fund_id', id),
    auth.supabase.from('fund_attachments').select('id', { count: 'exact', head: true }).eq('fund_id', id),
    auth.supabase.from('community_funds').select('id', { count: 'exact', head: true }).eq('parent_fund_id', id),
  ]);
  const counts = {
    contributions: cContribs ?? 0,
    spends: cSpends ?? 0,
    refunds: cRefunds ?? 0,
    comments: cComments ?? 0,
    attachments: cAttachments ?? 0,
    child_funds: cChildFunds ?? 0,
  };
  const restrictedTotal = counts.contributions + counts.spends + counts.refunds;

  if (!force) {
    if (restrictedTotal > 0) {
      const bits: string[] = [];
      if (counts.contributions > 0) bits.push(`${counts.contributions} contribution${counts.contributions === 1 ? '' : 's'}`);
      if (counts.spends > 0) bits.push(`${counts.spends} spend${counts.spends === 1 ? '' : 's'}`);
      if (counts.refunds > 0) bits.push(`${counts.refunds} refund${counts.refunds === 1 ? '' : 's'}`);
      return NextResponse.json(
        {
          error: `Fund has ${bits.join(' + ')} on it. Cancel the fund (preserves audit trail) or force-delete (irreversible).`,
          code: 'has_activity',
          counts,
        },
        { status: 409 }
      );
    }

    const { error: dErr } = await auth.supabase.from('community_funds').delete().eq('id', id);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

    logAdminAction({
      actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
      action: 'delete',
      targetType: 'community_fund',
      targetId: id,
      targetLabel: fund.name,
      before: fund,
      request: req,
    });

    return NextResponse.json({ ok: true, mode: 'safe' });
  }

  // ===== Force-delete path =====
  // Confirm phrase must match the fund name EXACTLY (case-sensitive). This
  // is the speed-bump that prevents an accidental "yes" click from wiping
  // a real fund.
  if (confirmPhrase !== fund.name) {
    return NextResponse.json(
      { error: `Confirmation mismatch. Type the fund name exactly: "${fund.name}".` },
      { status: 400 }
    );
  }

  // Detach any child funds first (parent_fund_id := null). Failing to do
  // this would block the parent delete via the parent_fund_id FK.
  if (counts.child_funds > 0) {
    const { error: detachErr } = await auth.supabase
      .from('community_funds')
      .update({ parent_fund_id: null })
      .eq('parent_fund_id', id);
    if (detachErr) return NextResponse.json({ error: `Failed to detach child funds: ${detachErr.message}` }, { status: 500 });
  }

  // Wipe child rows in dependency order. Refunds reference contributions via
  // contribution_id (on delete cascade), so deleting refunds first is the
  // safe order even if the cascade would otherwise pick up the slack.
  // Comments + attachments would cascade automatically, but explicit deletes
  // give us per-table errors instead of a generic "FK violation" 500 if
  // anything goes wrong.
  const wipeSteps: Array<{ table: string; n: number }> = [
    { table: 'fund_attachments', n: counts.attachments },
    { table: 'fund_comments',    n: counts.comments },
    { table: 'fund_refunds',     n: counts.refunds },
    { table: 'fund_spends',      n: counts.spends },
    { table: 'fund_contributions', n: counts.contributions },
  ];
  for (const step of wipeSteps) {
    if (step.n === 0) continue;
    const { error } = await auth.supabase.from(step.table).delete().eq('fund_id', id);
    if (error) {
      return NextResponse.json(
        { error: `Force delete failed wiping ${step.table}: ${error.message}` },
        { status: 500 }
      );
    }
  }

  const { error: dErr } = await auth.supabase.from('community_funds').delete().eq('id', id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'delete',
    targetType: 'community_fund',
    targetId: id,
    targetLabel: `[FORCE] ${fund.name}`,
    reason,
    before: { ...fund, _force_delete: true, _wiped_children: counts },
    request: req,
  });

  return NextResponse.json({ ok: true, mode: 'force', wiped: counts });
}
