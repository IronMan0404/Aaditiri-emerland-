import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/fund-auth';
import { rupeesToPaise } from '@/lib/money';
import type { ContributionMethod } from '@/types/funds';

// GET /api/funds/[id]/contributions — list contributions for a fund
// Query: ?status=received|reported|rejected (default: received)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'received';

  const { data, error } = await auth.supabase
    .from('fund_contributions')
    .select('*')
    .eq('fund_id', id)
    .eq('status', status)
    .order('contribution_date', { ascending: false })
    .order('reported_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Anonymize names for non-admin viewers when contributor opted in.
  const isAdmin = auth.profile.role === 'admin';
  const contributions = (data ?? []).map((c) => {
    if (c.is_anonymous && !isAdmin) {
      const tower = (c.flat_number ?? '').slice(0, 1);
      return {
        ...c,
        contributor_name: 'Anonymous',
        flat_number: tower ? `${tower}-tower` : 'Anonymous',
      };
    }
    return c;
  });

  return NextResponse.json({ contributions });
}

// POST /api/funds/[id]/contributions — resident self-reports a contribution
// Body: { amount (rupees), method, reference_number?, contribution_date,
//         notes?, screenshot_url?, is_anonymous?, is_in_kind?, in_kind_description? }
interface ReportBody {
  amount: number;
  method: ContributionMethod;
  reference_number?: string;
  contribution_date: string;
  notes?: string;
  screenshot_url?: string;
  is_anonymous?: boolean;
  is_in_kind?: boolean;
  in_kind_description?: string;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id: fundId } = await ctx.params;
  const body = (await req.json()) as ReportBody;

  if (!body.amount || body.amount <= 0) {
    return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  }
  if (!body.method) {
    return NextResponse.json({ error: 'Payment method required' }, { status: 400 });
  }
  if (!body.contribution_date) {
    return NextResponse.json({ error: 'Contribution date required' }, { status: 400 });
  }
  if (body.is_in_kind && !body.in_kind_description?.trim()) {
    return NextResponse.json({ error: 'Describe what you contributed' }, { status: 400 });
  }
  if (!auth.profile.flat_number) {
    return NextResponse.json(
      { error: 'Add your flat number in your profile before contributing.' },
      { status: 400 }
    );
  }

  // Confirm fund exists and is in a state that accepts contributions.
  const { data: fund } = await auth.supabase
    .from('community_funds')
    .select('id, status')
    .eq('id', fundId)
    .single();
  if (!fund) return NextResponse.json({ error: 'Fund not found' }, { status: 404 });
  if (fund.status !== 'collecting') {
    return NextResponse.json(
      { error: `This fund is no longer accepting contributions (status: ${fund.status}).` },
      { status: 400 }
    );
  }

  const paise = rupeesToPaise(body.amount);
  if (paise <= 0) {
    return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from('fund_contributions')
    .insert({
      fund_id: fundId,
      flat_number: auth.profile.flat_number,
      resident_id: auth.profile.id,
      contributor_name: auth.profile.full_name,
      amount: paise,
      method: body.method,
      reference_number: body.reference_number?.trim() || null,
      contribution_date: body.contribution_date,
      notes: body.notes?.trim() || null,
      screenshot_url: body.screenshot_url || null,
      status: 'reported',
      is_in_kind: body.is_in_kind === true,
      in_kind_description: body.in_kind_description?.trim() || null,
      is_anonymous: body.is_anonymous === true,
      reported_by: auth.profile.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contribution: data });
}
