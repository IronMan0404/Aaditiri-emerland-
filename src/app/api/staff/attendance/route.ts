import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';

// /api/staff/attendance
//
// GET   list this staff member's recent attendance + the current
//        open shift (if any). Used by the /staff home page.
// POST  toggle action: { action: 'check_in' } or { action: 'check_out' }
//
// Auth: must be a staff role (profiles.role = 'staff' AND active in
//       staff_profiles).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AuthedStaff {
  id: string;
  staffRole: 'security' | 'housekeeping';
}

async function requireStaff(): Promise<
  { ok: true; staff: AuthedStaff } | { ok: false; res: NextResponse }
> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Not signed in' }, { status: 401 }),
    };
  }
  // We use the admin client to read staff_profiles because the
  // RLS policy "Staff read own staff_profiles" *does* grant the
  // read, but pointing at the same admin client used everywhere
  // else in this file keeps us consistent and lets a deactivated
  // staff member be detected even if their RLS context is stale.
  const admin = createAdminSupabaseClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || profile.role !== 'staff') {
    return {
      ok: false,
      res: NextResponse.json({ error: 'Staff access required' }, { status: 403 }),
    };
  }
  const { data: staffRow } = await admin
    .from('staff_profiles')
    .select('id, staff_role, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (!staffRow || !staffRow.is_active) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Your staff account is inactive. Contact admin.' },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true,
    staff: {
      id: staffRow.id,
      staffRole: staffRow.staff_role as 'security' | 'housekeeping',
    },
  };
}

export async function GET() {
  const auth = await requireStaff();
  if (!auth.ok) return auth.res;

  const admin = createAdminSupabaseClient();

  // Open shift (max 1 per staff thanks to the partial unique index).
  const { data: open } = await admin
    .from('staff_attendance')
    .select('id, check_in_at, check_out_at, notes')
    .eq('staff_id', auth.staff.id)
    .is('check_out_at', null)
    .maybeSingle();

  // Last 30 days of attendance.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: history } = await admin
    .from('staff_attendance')
    .select('id, check_in_at, check_out_at, duty_date, notes')
    .eq('staff_id', auth.staff.id)
    .gte('check_in_at', thirtyDaysAgo)
    .order('check_in_at', { ascending: false })
    .limit(60);

  return NextResponse.json({
    open_shift: open ?? null,
    history: history ?? [],
  });
}

interface PostBody {
  action?: 'check_in' | 'check_out';
  notes?: string | null;
}

export async function POST(req: Request) {
  const auth = await requireStaff();
  if (!auth.ok) return auth.res;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'check_in' && action !== 'check_out') {
    return NextResponse.json(
      { error: 'action must be check_in or check_out.' },
      { status: 400 },
    );
  }

  const notes = (body.notes ?? '').toString().trim().slice(0, 500) || null;
  const admin = createAdminSupabaseClient();

  if (action === 'check_in') {
    // The partial unique index on staff_attendance(staff_id) WHERE
    // check_out_at IS NULL means a duplicate insert returns a 23505.
    // We catch that and surface a friendly message.
    const { data: row, error } = await admin
      .from('staff_attendance')
      .insert({
        staff_id: auth.staff.id,
        check_in_at: new Date().toISOString(),
        check_in_by: auth.staff.id,
        notes,
      })
      .select('id, check_in_at')
      .single();

    if (error) {
      // 23505 = unique_violation (already-open shift)
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'You are already checked in. Check out first.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, action: 'check_in', shift: row });
  }

  // action === 'check_out'
  // Find the open shift, patch it.
  const { data: open } = await admin
    .from('staff_attendance')
    .select('id, check_in_at, notes')
    .eq('staff_id', auth.staff.id)
    .is('check_out_at', null)
    .maybeSingle();
  if (!open) {
    return NextResponse.json(
      { error: 'You are not currently checked in.' },
      { status: 409 },
    );
  }

  const { data: closed, error: closeErr } = await admin
    .from('staff_attendance')
    .update({
      check_out_at: new Date().toISOString(),
      check_out_by: auth.staff.id,
      notes: notes ?? open.notes,
    })
    .eq('id', open.id)
    .is('check_out_at', null) // CAS-style guard against double-tap
    .select('id, check_in_at, check_out_at')
    .maybeSingle();

  if (closeErr) {
    return NextResponse.json({ error: closeErr.message }, { status: 500 });
  }
  if (!closed) {
    // Lost the race — somebody else (or the user double-tapping)
    // closed it first. Treat as success.
    return NextResponse.json({
      ok: true,
      action: 'check_out',
      already_closed: true,
    });
  }

  return NextResponse.json({ ok: true, action: 'check_out', shift: closed });
}
