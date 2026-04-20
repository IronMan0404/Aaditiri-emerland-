import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { rupeesToPaise } from '@/lib/money';
import { logAdminAction } from '@/lib/admin-audit';
import type { SpendMethod } from '@/types/funds';

interface CreateSpendBody {
  amount: number; // rupees
  spend_date: string;
  description: string;
  vendor_name?: string;
  vendor_phone?: string;
  category_hint?: string;
  payment_method: SpendMethod;
  payment_reference?: string;
  paid_by_name?: string;
  paid_by_user_id?: string;
  is_reimbursement?: boolean;
  receipt_url?: string;
  invoice_url?: string;
  notes?: string;
}

// POST /api/admin/funds/[id]/spends — record a spend against a fund
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: fundId } = await ctx.params;
  const body = (await req.json()) as CreateSpendBody;

  if (!body.amount || body.amount <= 0) return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
  if (!body.description?.trim()) return NextResponse.json({ error: 'Description required' }, { status: 400 });
  if (!body.spend_date) return NextResponse.json({ error: 'Date required' }, { status: 400 });
  if (!body.payment_method) return NextResponse.json({ error: 'Payment method required' }, { status: 400 });

  const { data, error } = await auth.supabase
    .from('fund_spends')
    .insert({
      fund_id: fundId,
      amount: rupeesToPaise(body.amount),
      spend_date: body.spend_date,
      description: body.description.trim(),
      vendor_name: body.vendor_name?.trim() || null,
      vendor_phone: body.vendor_phone?.trim() || null,
      category_hint: body.category_hint?.trim() || null,
      payment_method: body.payment_method,
      payment_reference: body.payment_reference?.trim() || null,
      paid_by_name: body.paid_by_name?.trim() || null,
      paid_by_user_id: body.paid_by_user_id || null,
      is_reimbursement: body.is_reimbursement === true,
      receipt_url: body.receipt_url || null,
      invoice_url: body.invoice_url || null,
      notes: body.notes?.trim() || null,
      recorded_by: auth.profile.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAdminAction({
    actor: { id: auth.profile.id, email: auth.profile.email, name: auth.profile.full_name },
    action: 'create',
    targetType: 'fund_spend',
    targetId: data.id,
    targetLabel: `Spend: ${data.description} — ₹${(data.amount / 100).toLocaleString('en-IN')}${data.vendor_name ? ' @ ' + data.vendor_name : ''}`,
    after: data,
    request: req,
  });

  return NextResponse.json({ spend: data });
}
