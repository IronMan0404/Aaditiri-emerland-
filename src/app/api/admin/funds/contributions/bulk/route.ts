import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { logAdminAction } from '@/lib/admin-audit';

interface BulkBody {
  action: 'verify' | 'reject';
  ids: string[];
  rejection_reason?: string;
}

// POST /api/admin/funds/contributions/bulk — bulk verify or reject.
// Used by the admin verification queue when reconciling against a bank
// statement (treasurer ticks 30 boxes, hits Verify Selected).
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as BulkBody;
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'No contributions selected' }, { status: 400 });
  }
  if (body.ids.length > 200) {
    return NextResponse.json({ error: 'Max 200 per bulk action' }, { status: 400 });
  }

  if (body.action === 'verify') {
    const { data, error } = await auth.supabase
      .from('fund_contributions')
      .update({
        status: 'received',
        received_by: auth.profile.id,
        received_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .in('id', body.ids)
      .neq('status', 'received')
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // One audit row per batch — per-row would flood the log on a 200-tick run.
    // We record the affected ids so a forensic trace is still possible.
    if ((data?.length ?? 0) > 0) {
      logAdminAction({
        actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
        action: 'update',
        targetType: 'fund_contribution',
        targetId: 'bulk',
        targetLabel: `Bulk verify (${data!.length} contributions)`,
        after: { ids: data!.map((r) => r.id), action: 'verify' },
        request: req,
      });
    }
    return NextResponse.json({ updated: data?.length ?? 0 });
  }

  if (body.action === 'reject') {
    const reason = body.rejection_reason?.trim();
    if (!reason) return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 });
    const { data, error } = await auth.supabase
      .from('fund_contributions')
      .update({
        status: 'rejected',
        received_by: auth.profile.id,
        received_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .in('id', body.ids)
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if ((data?.length ?? 0) > 0) {
      logAdminAction({
        actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
        action: 'update',
        targetType: 'fund_contribution',
        targetId: 'bulk',
        targetLabel: `Bulk reject (${data!.length} contributions)`,
        reason,
        after: { ids: data!.map((r) => r.id), action: 'reject' },
        request: req,
      });
    }
    return NextResponse.json({ updated: data?.length ?? 0 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
