import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { rupeesToPaise } from '@/lib/money';
import { sendPushToAllResidents } from '@/lib/push';
import { logAdminAction } from '@/lib/admin-audit';
import type { FundRecurringPeriod, FundVisibility } from '@/types/funds';

// GET /api/admin/funds — list all funds (incl. drafts/restricted)
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from('community_funds')
    .select('*, fund_categories(icon, color, name, code)')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ funds: data ?? [] });
}

// POST /api/admin/funds — create a fund
interface CreateBody {
  name: string;
  category_id: string;
  description?: string;
  purpose?: string;
  target_amount?: number; // in rupees
  suggested_per_flat?: number; // in rupees
  collection_deadline?: string;
  event_date?: string;
  visibility?: FundVisibility;
  is_recurring?: boolean;
  recurring_period?: FundRecurringPeriod;
  parent_fund_id?: string;
  cover_image_url?: string;
  notify?: boolean; // if true, push to all residents on create
  // Optional opening balance (₹ amount). When > 0 we insert a synthetic
  // 'opening balance' contribution row so the fund starts with that money
  // counted toward total_collected. Used for carry-over from previous
  // closed funds, cash already in hand, etc.
  opening_balance?: number; // in rupees
  opening_balance_note?: string;
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = (await req.json()) as CreateBody;
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Fund name required' }, { status: 400 });
  }
  if (!body.category_id) {
    return NextResponse.json({ error: 'Category required' }, { status: 400 });
  }
  if (body.opening_balance != null && body.opening_balance < 0) {
    return NextResponse.json({ error: 'Opening balance cannot be negative' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from('community_funds')
    .insert({
      name: body.name.trim(),
      category_id: body.category_id,
      description: body.description?.trim() || null,
      purpose: body.purpose?.trim() || null,
      target_amount: body.target_amount ? rupeesToPaise(body.target_amount) : null,
      suggested_per_flat: body.suggested_per_flat ? rupeesToPaise(body.suggested_per_flat) : null,
      collection_deadline: body.collection_deadline || null,
      event_date: body.event_date || null,
      visibility: body.visibility ?? 'all_residents',
      is_recurring: body.is_recurring === true,
      recurring_period: body.recurring_period ?? null,
      parent_fund_id: body.parent_fund_id || null,
      cover_image_url: body.cover_image_url || null,
      status: 'collecting',
      created_by: auth.profile.id,
      start_date: new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Seed an opening-balance contribution row when requested. We model this
  // as a normal contribution (status='received', is_in_kind=false, method='other')
  // with flat_number='OPENING' so it never gets confused with an actual
  // resident's payment. The recalc trigger will roll it into total_collected.
  let openingContributionId: string | null = null;
  if (body.opening_balance && body.opening_balance > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const note = body.opening_balance_note?.trim()
      || 'Opening balance — money already in hand at fund creation.';
    const { data: contrib, error: cErr } = await auth.supabase
      .from('fund_contributions')
      .insert({
        fund_id: data.id,
        flat_number: 'OPENING',
        contributor_name: 'Opening balance',
        amount: rupeesToPaise(body.opening_balance),
        method: 'other',
        contribution_date: today,
        notes: note,
        status: 'received',
        is_in_kind: false,
        is_anonymous: false,
        reported_by: auth.profile.id,
        received_by: auth.profile.id,
        received_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (cErr) {
      // The fund itself is already created; surface the seed-failure but
      // don't roll back. Admin can re-add via Quick-add if needed.
      console.error('[admin-funds] opening balance seed failed', cErr);
    } else {
      openingContributionId = contrib.id;
    }
  }

  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'create',
    targetType: 'community_fund',
    targetId: data.id,
    targetLabel: data.name,
    after: {
      ...data,
      opening_balance_paise: body.opening_balance ? rupeesToPaise(body.opening_balance) : 0,
      opening_contribution_id: openingContributionId,
    },
    request: req,
  });

  if (body.notify && data.visibility === 'all_residents') {
    sendPushToAllResidents({
      title: `New community fund: ${data.name}`,
      body: data.suggested_per_flat
        ? `Suggested ₹${(data.suggested_per_flat / 100).toLocaleString('en-IN')}/flat. Tap to contribute.`
        : 'Tap to view details and contribute.',
      url: `/dashboard/funds/${data.id}`,
      tag: `fund-created-${data.id}`,
    }).catch(() => {});
  }

  return NextResponse.json({ fund: data });
}
