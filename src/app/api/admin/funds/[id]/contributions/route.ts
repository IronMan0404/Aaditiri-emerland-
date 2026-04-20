import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { rupeesToPaise } from '@/lib/money';
import { logAdminAction } from '@/lib/admin-audit';
import type { ContributionMethod, ContributionStatus } from '@/types/funds';

// GET /api/admin/funds/[id]/contributions — admin view of all contributions
// (includes 'reported' rows pending verification). Optional ?status=...
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const status = url.searchParams.get('status') as ContributionStatus | null;

  let query = auth.supabase
    .from('fund_contributions')
    .select('*')
    .eq('fund_id', id)
    .order('reported_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contributions: data ?? [] });
}

// POST /api/admin/funds/[id]/contributions — quick-add a cash contribution
// on behalf of a flat (status auto-set to 'received').
interface QuickAddBody {
  flat_number: string;
  contributor_name?: string;
  amount: number; // rupees
  method: ContributionMethod;
  reference_number?: string;
  contribution_date: string;
  notes?: string;
  is_in_kind?: boolean;
  in_kind_description?: string;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: fundId } = await ctx.params;
  const body = (await req.json()) as QuickAddBody;

  if (!body.flat_number?.trim()) return NextResponse.json({ error: 'Flat number required' }, { status: 400 });
  if (!body.amount || body.amount <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  if (!body.method) return NextResponse.json({ error: 'Method required' }, { status: 400 });
  if (!body.contribution_date) return NextResponse.json({ error: 'Date required' }, { status: 400 });

  // Resolve resident_id + name from flat_number when possible.
  const { data: profile } = await auth.supabase
    .from('profiles')
    .select('id, full_name')
    .eq('flat_number', body.flat_number.trim())
    .eq('is_approved', true)
    .eq('is_bot', false)
    .limit(1)
    .maybeSingle();

  const { data, error } = await auth.supabase
    .from('fund_contributions')
    .insert({
      fund_id: fundId,
      flat_number: body.flat_number.trim(),
      resident_id: profile?.id ?? null,
      contributor_name: body.contributor_name?.trim() || profile?.full_name || `Flat ${body.flat_number.trim()}`,
      amount: rupeesToPaise(body.amount),
      method: body.method,
      reference_number: body.reference_number?.trim() || null,
      contribution_date: body.contribution_date,
      notes: body.notes?.trim() || null,
      status: 'received',
      is_in_kind: body.is_in_kind === true,
      in_kind_description: body.in_kind_description?.trim() || null,
      reported_by: auth.profile.id,
      received_by: auth.profile.id,
      received_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'create',
    targetType: 'fund_contribution',
    targetId: data.id,
    targetLabel: `Quick-add: Flat ${data.flat_number} — ₹${(data.amount / 100).toLocaleString('en-IN')} (${data.method})`,
    after: data,
    request: req,
  });

  return NextResponse.json({ contribution: data });
}
