import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import type { IssueCategory, IssueStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Cache for 5 min so the chart-heavy page doesn't hammer the DB on every
// dashboard refresh. Admin will rarely need sub-minute freshness here.
export const revalidate = 300;

// Window we care about for the burndown / cumulative-flow charts.
const WINDOW_DAYS = 30;

// SLA targets (hours) per priority. "% resolved within SLA" KPI counts an
// issue as SLA-met when (resolved_at - created_at) <= target for its priority.
const SLA_HOURS: Record<'low' | 'normal' | 'high' | 'urgent', number> = {
  urgent: 24,
  high: 72,
  normal: 24 * 7,
  low: 24 * 30,
};

interface IssueRow {
  id: string;
  status: IssueStatus;
  category: IssueCategory;
  priority: keyof typeof SLA_HOURS;
  created_at: string;
  resolved_at: string | null;
}

interface EventRow {
  issue_id: string;
  from_status: IssueStatus | null;
  to_status: IssueStatus;
  changed_at: string;
}

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: authRes } = await supabase.auth.getUser();
  const user = authRes?.user;
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Pull all issues + every status event in the last 30 days. Even thousands
  // of issues over 30d is a few KB of JSON, so doing the rollup in JS keeps
  // the SQL boring and cacheable.
  const [{ data: issues }, { data: events }] = await Promise.all([
    supabase
      .from('issues')
      .select('id, status, category, priority, created_at, resolved_at'),
    supabase
      .from('issue_status_events')
      .select('issue_id, from_status, to_status, changed_at')
      .gte('changed_at', windowStart.toISOString()),
  ]);

  const issueList = (issues ?? []) as IssueRow[];
  const eventList = (events ?? []) as EventRow[];

  // ---- KPIs ----
  const openIssues = issueList.filter((i) => i.status === 'todo' || i.status === 'in_progress');
  const resolvedIssues = issueList.filter((i) => i.resolved_at);
  const avgResolveMs = resolvedIssues.length
    ? resolvedIssues.reduce(
        (sum, i) => sum + (new Date(i.resolved_at!).getTime() - new Date(i.created_at).getTime()),
        0
      ) / resolvedIssues.length
    : 0;
  const slaMet = resolvedIssues.filter((i) => {
    const targetMs = (SLA_HOURS[i.priority] ?? SLA_HOURS.normal) * 60 * 60 * 1000;
    return new Date(i.resolved_at!).getTime() - new Date(i.created_at).getTime() <= targetMs;
  }).length;
  const slaRate = resolvedIssues.length ? Math.round((slaMet / resolvedIssues.length) * 100) : 0;

  // ---- Burndown + cumulative flow ----
  // For each day in the window we compute the count of issues in each status
  // *as of end of that day*. Strategy:
  //   1. Replay every status event in chronological order keyed by issue_id.
  //   2. Snapshot the in-memory map at the close of each day.
  // We ignore issues with NO event in the window (they didn't change), which
  // is fine because their state was already counted in the prior day's
  // snapshot \u2014 except for issues created BEFORE the window. To handle that,
  // we seed the map with each issue's status-at-window-start derived from
  // their current status minus any events that occurred inside the window.

  const finalStatus = new Map<string, IssueStatus>();
  for (const i of issueList) finalStatus.set(i.id, i.status);

  // Build per-issue timeline within window, sorted ascending.
  const eventsByIssue = new Map<string, EventRow[]>();
  for (const ev of eventList) {
    const arr = eventsByIssue.get(ev.issue_id) ?? [];
    arr.push(ev);
    eventsByIssue.set(ev.issue_id, arr);
  }
  for (const arr of eventsByIssue.values()) {
    arr.sort((a, b) => a.changed_at.localeCompare(b.changed_at));
  }

  // status at start of window = (final status) walked backwards through the
  // window's events. For each issue with events in window, the status at
  // window-start is the from_status of the FIRST event inside the window
  // (if any). For issues with no events in window, status at window-start
  // equals the current status.
  const stateAtWindowStart = new Map<string, IssueStatus | 'pre_existing_none'>();
  for (const i of issueList) {
    const evs = eventsByIssue.get(i.id);
    if (!evs || evs.length === 0) {
      stateAtWindowStart.set(i.id, i.status);
    } else {
      const first = evs[0];
      // If the first event in window is the 'INSERT' transition (from = null),
      // the issue didn't exist at window-start yet.
      if (first.from_status === null) {
        stateAtWindowStart.set(i.id, 'pre_existing_none');
      } else {
        stateAtWindowStart.set(i.id, first.from_status);
      }
    }
  }

  // Walk day by day.
  const days: { date: string; todo: number; inProgress: number; resolved: number; closed: number; open: number }[] = [];
  for (let d = 0; d < WINDOW_DAYS; d++) {
    const dayEnd = new Date(windowStart.getTime() + (d + 1) * 24 * 60 * 60 * 1000);
    const dayLabel = dayEnd.toISOString().slice(0, 10);

    // Compute each issue's status as of dayEnd by replaying events
    // in [windowStart, dayEnd] over its starting status.
    let todo = 0, inProgress = 0, resolved = 0, closed = 0;
    for (const i of issueList) {
      let status: IssueStatus | 'pre_existing_none' = stateAtWindowStart.get(i.id) ?? i.status;
      const evs = eventsByIssue.get(i.id) ?? [];
      for (const ev of evs) {
        if (new Date(ev.changed_at) > dayEnd) break;
        status = ev.to_status;
      }
      if (status === 'pre_existing_none') continue;
      if (status === 'todo') todo += 1;
      else if (status === 'in_progress') inProgress += 1;
      else if (status === 'resolved') resolved += 1;
      else if (status === 'closed') closed += 1;
    }

    days.push({
      date: dayLabel,
      todo, inProgress, resolved, closed,
      open: todo + inProgress,
    });
  }

  // ---- By category (open only, current state) ----
  const byCategoryMap = new Map<IssueCategory, number>();
  for (const i of openIssues) {
    byCategoryMap.set(i.category, (byCategoryMap.get(i.category) ?? 0) + 1);
  }
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    kpis: {
      total: issueList.length,
      open: openIssues.length,
      resolved: resolvedIssues.length,
      avgResolveHours: Math.round((avgResolveMs / (60 * 60 * 1000)) * 10) / 10,
      slaRate,
    },
    burndown: days.map((d) => ({ date: d.date, open: d.open })),
    flow: days,
    byCategory,
  });
}
