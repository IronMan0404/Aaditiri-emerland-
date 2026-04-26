import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { approveSubscription } from '@/lib/decisions/subscriptions';

// Admin-only: approve a pending clubhouse subscription request.
// All business logic lives in src/lib/decisions/subscriptions.ts so
// the Telegram callback runner triggers the same audit + notify
// fan-out.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApprovePayload {
  start_date?: string;
  months_override?: number;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Subscription id required' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', user.id)
    .single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as ApprovePayload;

  const result = await approveSubscription(
    id,
    {
      id: me.id,
      fullName: me.full_name,
      email: me.email,
      via: 'web',
      request: req,
    },
    {
      startDate: body.start_date,
      monthsOverride: body.months_override,
    },
  );

  if (!result.ok) {
    const status =
      result.label.startsWith('Cannot') || result.label.includes('already has')
        ? 409
        : 400;
    return NextResponse.json({ error: result.label }, { status });
  }
  return NextResponse.json({ ok: true, id, status: result.status, label: result.label });
}
