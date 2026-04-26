import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { approveRegistration } from '@/lib/decisions/registrations';

// Admin-only: approve a pending registration. Mutation + audit log
// + notify() all live in src/lib/decisions/registrations.ts so the
// Telegram callback runner triggers exactly the same side effects.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Profile id required' }, { status: 400 });

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

  const result = await approveRegistration(id, {
    id: me.id,
    fullName: me.full_name,
    email: me.email,
    via: 'web',
    request: req,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.label }, { status: 400 });
  }
  return NextResponse.json({ ok: true, status: result.status, label: result.label });
}
