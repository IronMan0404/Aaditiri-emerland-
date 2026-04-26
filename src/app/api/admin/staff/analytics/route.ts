import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/fund-auth';
import { createAdminSupabaseClient } from '@/lib/supabase-admin';

// /api/admin/staff/analytics
//
// GET ?days=N (default 30, allowed 7|30|90)
// Returns the rolled-up numbers powering the Attendance tab on
// /admin/staff:
//
//   - kpis: roster size + on-duty-now + checked-in-today +
//     average daily hours over the window.
//   - todayGrid: every active staff member with their first
//     check-in time today (or null = absent so far).
//   - hoursTrend: per-day total hours-on-duty, split by role,
//     for the requested window.
//   - hoursPerStaff: top-N total hours per staff over the window
//     (used for the bar list).
//   - hourCoverage: 24-element array, one entry per IST hour,
//     showing the *average* number of staff on duty during that
//     hour over the window. Used for the shift-coverage chart.
//
// Why we compute everything server-side: the attendance rows
// could be thousands per month at scale and we don't want to
// ship them all to the browser just to bucket them into charts.
// Postgres is also way better at the date arithmetic than JS,
// and we get to keep the chart components dumb.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaffRole = 'security' | 'housekeeping';

const ALLOWED_DAYS = new Set([7, 30, 90]);
const DEFAULT_DAYS = 30;

// Asia/Kolkata is a fixed +05:30 offset, no DST. We use this to
// stamp "duty_date" the same way the database column does, and
// to compute "today" / "now" in the user's mental model.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function istNow(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function istDateStr(d: Date): string {
  // d is already shifted into IST, so use UTC accessors.
  return d.toISOString().slice(0, 10);
}

function shiftDays(yyyymmdd: string, delta: number): string {
  const [y, m, day] = yyyymmdd.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, day + delta));
  return dt.toISOString().slice(0, 10);
}

interface AttendanceRow {
  staff_id: string;
  check_in_at: string;
  check_out_at: string | null;
  duty_date: string;
}

interface StaffLite {
  id: string;
  staff_role: StaffRole;
  full_name: string;
  is_active: boolean;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = req.nextUrl;
  const rawDays = parseInt(url.searchParams.get('days') ?? String(DEFAULT_DAYS), 10);
  const days = ALLOWED_DAYS.has(rawDays) ? rawDays : DEFAULT_DAYS;

  const admin = createAdminSupabaseClient();

  // Window is inclusive of today — fire from today going
  // backwards (days - 1) days. Both sides are IST date strings
  // because staff_attendance.duty_date is stored as the IST date.
  const today = istDateStr(istNow());
  const windowStart = shiftDays(today, -(days - 1));

  // Pull everything we need in two queries: staff (small) and
  // attendance rows in the window (bounded).
  const { data: staffList, error: staffErr } = await admin
    .from('staff_profiles')
    .select('id, staff_role, full_name, is_active');

  if (staffErr) {
    return NextResponse.json({ error: staffErr.message }, { status: 500 });
  }

  const staff: StaffLite[] = (staffList ?? []) as StaffLite[];
  const staffById = new Map<string, StaffLite>();
  for (const s of staff) staffById.set(s.id, s);

  // We don't filter by staff_id here — we want every attendance
  // row in the window. If a staff member is now inactive but
  // their attendance from last month should still count, we keep
  // it. The chart will still attribute hours to them.
  const { data: attRows, error: attErr } = await admin
    .from('staff_attendance')
    .select('staff_id, check_in_at, check_out_at, duty_date')
    .gte('duty_date', windowStart)
    .lte('duty_date', today)
    .order('check_in_at', { ascending: true });

  if (attErr) {
    return NextResponse.json({ error: attErr.message }, { status: 500 });
  }

  const rows: AttendanceRow[] = (attRows ?? []) as AttendanceRow[];
  const nowMs = Date.now();

  // ─── KPIs ────────────────────────────────────────────────
  const activeStaff = staff.filter((s) => s.is_active);
  const securityCount = activeStaff.filter((s) => s.staff_role === 'security').length;
  const housekeepingCount = activeStaff.filter((s) => s.staff_role === 'housekeeping').length;

  const onDutyNow = rows.filter((r) => r.check_out_at === null);
  const onDutySecurity = onDutyNow.filter(
    (r) => staffById.get(r.staff_id)?.staff_role === 'security',
  ).length;
  const onDutyHousekeeping = onDutyNow.filter(
    (r) => staffById.get(r.staff_id)?.staff_role === 'housekeeping',
  ).length;

  const todayRows = rows.filter((r) => r.duty_date === today);
  const checkedInTodayIds = new Set(todayRows.map((r) => r.staff_id));

  // Per-day per-role hours, used for both the trend chart and
  // the average-daily-hours KPI.
  interface DayBucket { security: number; housekeeping: number; total: number }
  const perDay = new Map<string, DayBucket>();

  // Helper: hours of a single shift, capped at the day boundary
  // and at "now" for open shifts. Open shifts use now as their
  // virtual end so the trend chart doesn't suddenly drop today's
  // total to zero just because nobody checked out yet.
  const hoursForRow = (r: AttendanceRow): number => {
    const start = new Date(r.check_in_at).getTime();
    const end = r.check_out_at ? new Date(r.check_out_at).getTime() : nowMs;
    if (end <= start) return 0;
    return (end - start) / 3_600_000;
  };

  // Per-staff totals.
  const perStaffHours = new Map<string, number>();

  for (const r of rows) {
    const role = staffById.get(r.staff_id)?.staff_role;
    const hrs = hoursForRow(r);
    const bucket = perDay.get(r.duty_date) ?? { security: 0, housekeeping: 0, total: 0 };
    if (role === 'security') bucket.security += hrs;
    else if (role === 'housekeeping') bucket.housekeeping += hrs;
    bucket.total += hrs;
    perDay.set(r.duty_date, bucket);

    perStaffHours.set(r.staff_id, (perStaffHours.get(r.staff_id) ?? 0) + hrs);
  }

  // Densify: every day in the window should have a row, even if
  // it's all zeros. Otherwise the chart skips the gap visually.
  const hoursTrend: { date: string; security: number; housekeeping: number; total: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = shiftDays(windowStart, i);
    const b = perDay.get(d) ?? { security: 0, housekeeping: 0, total: 0 };
    hoursTrend.push({
      date: d,
      security: round1(b.security),
      housekeeping: round1(b.housekeeping),
      total: round1(b.total),
    });
  }

  const totalWindowHours = hoursTrend.reduce((acc, d) => acc + d.total, 0);
  const avgDailyHours = round1(totalWindowHours / days);

  // ─── Today's grid ────────────────────────────────────────
  // For each ACTIVE staff member, find the earliest check-in
  // today (or null = absent so far). We don't show inactive
  // staff in this grid — they're not expected to check in.
  const firstCheckInToday = new Map<string, string>();
  for (const r of todayRows) {
    if (!firstCheckInToday.has(r.staff_id)) {
      firstCheckInToday.set(r.staff_id, r.check_in_at);
    }
  }

  const todayGrid = activeStaff
    .map((s) => ({
      id: s.id,
      full_name: s.full_name,
      staff_role: s.staff_role,
      first_check_in_at: firstCheckInToday.get(s.id) ?? null,
      on_duty_now: onDutyNow.some((r) => r.staff_id === s.id),
    }))
    .sort((a, b) => {
      // Checked-in first, then by check-in time, then absent.
      if (a.first_check_in_at && b.first_check_in_at) {
        return a.first_check_in_at.localeCompare(b.first_check_in_at);
      }
      if (a.first_check_in_at && !b.first_check_in_at) return -1;
      if (!a.first_check_in_at && b.first_check_in_at) return 1;
      return a.full_name.localeCompare(b.full_name);
    });

  // ─── Per-staff totals for the bar list ──────────────────
  const hoursPerStaff = Array.from(perStaffHours.entries())
    .map(([id, h]) => ({
      id,
      full_name: staffById.get(id)?.full_name ?? '(removed)',
      staff_role: staffById.get(id)?.staff_role ?? null,
      hours: round1(h),
      shifts: rows.filter((r) => r.staff_id === id).length,
    }))
    .sort((a, b) => b.hours - a.hours);

  // ─── 24h coverage histogram ─────────────────────────────
  // For each shift, mark every IST hour-of-day it overlaps.
  // We count partial overlaps as +1 (an hour bucket is "covered"
  // if anyone was on duty for any part of it) and additionally
  // track the total minutes covered so we can derive an average
  // staff count per hour-of-day at the end.
  // Total minutes per IST hour-of-day across the whole window:
  const minutesPerHour = new Array<number>(24).fill(0);

  for (const r of rows) {
    const startMs = new Date(r.check_in_at).getTime();
    // Open shifts: cap at "now" so the chart doesn't suddenly
    // attribute future hours to today.
    const endMs = r.check_out_at ? new Date(r.check_out_at).getTime() : nowMs;
    if (endMs <= startMs) continue;

    // Walk the shift in 10-minute slices. Slice resolution is a
    // tradeoff: 1-minute slices are 100% accurate but 10x the
    // CPU; 10-minute slices undercount by at most 9 min per
    // shift end and that's fine for an average chart.
    const SLICE_MS = 10 * 60 * 1000;
    for (let t = startMs; t < endMs; t += SLICE_MS) {
      const istMs = t + IST_OFFSET_MS;
      const istHour = new Date(istMs).getUTCHours();
      // Don't let the last slice tip over into the next hour:
      const sliceEnd = Math.min(t + SLICE_MS, endMs);
      minutesPerHour[istHour] += (sliceEnd - t) / 60_000;
    }
  }

  // Convert "minutes of staff-coverage in this hour over the
  // whole window" to "average staff count during this hour".
  // Each window-day contributes 60 minutes per hour bucket, so
  // dividing by (60 * days) gives a simultaneous-staff average.
  const hourCoverage = minutesPerHour.map((mins, hour) => ({
    hour,
    avg_staff: round2(mins / (60 * days)),
  }));

  return NextResponse.json({
    days,
    window: { start: windowStart, end: today },
    kpis: {
      activeStaffTotal: activeStaff.length,
      activeSecurity: securityCount,
      activeHousekeeping: housekeepingCount,
      onDutyNow: onDutyNow.length,
      onDutySecurity,
      onDutyHousekeeping,
      checkedInToday: checkedInTodayIds.size,
      avgDailyHours,
      totalWindowHours: round1(totalWindowHours),
    },
    todayGrid,
    hoursTrend,
    hoursPerStaff,
    hourCoverage,
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
