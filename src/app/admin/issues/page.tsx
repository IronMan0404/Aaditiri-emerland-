'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wrench, Zap, Brush, Shield, ArrowUp, Leaf, Bug, Wifi, HelpCircle, Send, X,
  LayoutDashboard, BarChart3,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { BarRows, KpiTile, LineChart, StackedAreaChart } from '@/components/admin/Charts';
import type { Issue, IssueCategory, IssueComment, IssuePriority, IssueStatus } from '@/types';

// Admin issue tracker: kanban board + analytics. The board reads ALL issues
// (RLS allows admin to see all rows) and lets the admin transition status
// inline. Analytics calls /api/admin/issues/analytics which computes
// burndown / cumulative-flow / category breakdown server-side.

const CATEGORY_META: Record<IssueCategory, { label: string; icon: typeof Wrench }> = {
  plumbing:     { label: 'Plumbing',     icon: Wrench     },
  electrical:   { label: 'Electrical',   icon: Zap        },
  housekeeping: { label: 'Housekeeping', icon: Brush      },
  security:     { label: 'Security',     icon: Shield     },
  lift:         { label: 'Lift',         icon: ArrowUp    },
  garden:       { label: 'Garden',       icon: Leaf       },
  pest_control: { label: 'Pest Control', icon: Bug        },
  internet:     { label: 'Internet',     icon: Wifi       },
  other:        { label: 'Other',        icon: HelpCircle },
};

const STATUSES: IssueStatus[] = ['todo', 'in_progress', 'resolved', 'closed'];
const STATUS_META: Record<IssueStatus, { label: string; pill: string; column: string }> = {
  todo:        { label: 'To Do',       pill: 'bg-amber-100 text-amber-700', column: 'border-t-amber-400' },
  in_progress: { label: 'In Progress', pill: 'bg-blue-100 text-blue-700',   column: 'border-t-blue-400' },
  resolved:    { label: 'Resolved',    pill: 'bg-green-100 text-green-700', column: 'border-t-green-400' },
  closed:      { label: 'Closed',      pill: 'bg-gray-100 text-gray-500',   column: 'border-t-gray-300' },
};

const PRIORITY_META: Record<IssuePriority, { label: string; pill: string }> = {
  low:    { label: 'Low',    pill: 'bg-gray-100 text-gray-600' },
  normal: { label: 'Normal', pill: 'bg-slate-100 text-slate-700' },
  high:   { label: 'High',   pill: 'bg-orange-100 text-orange-700' },
  urgent: { label: 'Urgent', pill: 'bg-red-100 text-red-700' },
};

interface AnalyticsResponse {
  kpis: { total: number; open: number; resolved: number; avgResolveHours: number; slaRate: number };
  burndown: { date: string; open: number }[];
  flow: { date: string; todo: number; inProgress: number; resolved: number; closed: number; open: number }[];
  byCategory: { category: IssueCategory; count: number }[];
}

type Tab = 'board' | 'analytics';

export default function AdminIssuesPage() {
  const { profile, isAdmin, mounted } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [tab, setTab] = useState<Tab>('board');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<IssueCategory | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<IssuePriority | 'all'>('all');
  const [search, setSearch] = useState('');

  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);
  const [commentSaving, setCommentSaving] = useState(false);

  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const fetchIssues = useCallback(async () => {
    const { data, error } = await supabase
      .from('issues')
      .select('*, profiles:created_by(full_name, flat_number)')
      .order('created_at', { ascending: false });
    if (error) toast.error(error.message);
    setIssues((data ?? []) as Issue[]);
    setLoading(false);
  }, [supabase]);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch('/api/admin/issues/analytics', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AnalyticsResponse;
      setAnalytics(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load analytics');
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    fetchIssues();
  }, [mounted, isAdmin, fetchIssues]);

  useEffect(() => {
    if (tab === 'analytics' && !analytics && !analyticsLoading) fetchAnalytics();
  }, [tab, analytics, analyticsLoading, fetchAnalytics]);

  async function fetchComments(issueId: string) {
    const { data } = await supabase
      .from('issue_comments')
      .select('*, profiles(full_name, role)')
      .eq('issue_id', issueId)
      .order('created_at', { ascending: true });
    setComments((data ?? []) as IssueComment[]);
  }

  function openIssue(issue: Issue) {
    setActiveIssue(issue);
    setComments([]);
    setCommentBody('');
    setCommentInternal(false);
    fetchComments(issue.id);
  }

  function closeIssue() {
    setActiveIssue(null);
  }

  async function changeStatus(issue: Issue, next: IssueStatus) {
    if (issue.status === next) return;
    const patch: Record<string, unknown> = { status: next };
    if (next === 'resolved' && !issue.resolved_at) patch.resolved_at = new Date().toISOString();
    if (next === 'closed' && !issue.closed_at) patch.closed_at = new Date().toISOString();
    const { error } = await supabase.from('issues').update(patch).eq('id', issue.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Marked ${STATUS_META[next].label.toLowerCase()}`);
    // Best-effort: notify resident on resolve so they know to verify.
    if (next === 'resolved') {
      fetch(`/api/admin/issues/${issue.id}/status-notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      }).catch(() => undefined);
    }
    fetchIssues();
    if (activeIssue?.id === issue.id) {
      setActiveIssue({ ...issue, ...patch, status: next } as Issue);
    }
    if (tab === 'analytics') fetchAnalytics();
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!activeIssue || !profile) return;
    const body = commentBody.trim();
    if (!body) return;
    setCommentSaving(true);
    const { error } = await supabase.from('issue_comments').insert({
      issue_id: activeIssue.id,
      author_id: profile.id,
      body,
      is_internal: commentInternal,
    });
    setCommentSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCommentBody('');
    if (!commentInternal) {
      fetch(`/api/issues/${activeIssue.id}/comment-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: body }),
      }).catch(() => undefined);
    }
    fetchComments(activeIssue.id);
  }

  const filtered = useMemo(() => {
    return issues.filter((iss) => {
      if (filterCategory !== 'all' && iss.category !== filterCategory) return false;
      if (filterPriority !== 'all' && iss.priority !== filterPriority) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const inTitle = iss.title.toLowerCase().includes(needle);
        const inFlat = (iss.flat_number ?? '').toLowerCase().includes(needle);
        const inAuthor = (iss.profiles?.full_name ?? '').toLowerCase().includes(needle);
        if (!inTitle && !inFlat && !inAuthor) return false;
      }
      return true;
    });
  }, [issues, filterCategory, filterPriority, search]);

  const grouped = useMemo(() => {
    const out: Record<IssueStatus, Issue[]> = { todo: [], in_progress: [], resolved: [], closed: [] };
    for (const iss of filtered) out[iss.status].push(iss);
    return out;
  }, [filtered]);

  if (mounted && !isAdmin) {
    return <p className="p-6 text-sm text-gray-500">Admin access required.</p>;
  }

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Community Issues</h1>
          <p className="text-xs text-gray-500 mt-0.5">Triage and track resident-raised tickets</p>
        </div>
      </div>

      <div className="flex gap-1.5 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { id: 'board' as const,     label: 'Board',     icon: LayoutDashboard },
          { id: 'analytics' as const, label: 'Analytics', icon: BarChart3       },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
              tab === id ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-500'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'board' && (
        <>
          <div className="bg-white rounded-xl p-3 shadow-sm mb-4 flex flex-wrap gap-2 items-center">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, flat or resident..."
              className="flex-1 min-w-[180px] px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#1B5E20]"
            />
            <select
              aria-label="Filter by category"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as IssueCategory | 'all')}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="all">All categories</option>
              {(Object.entries(CATEGORY_META) as [IssueCategory, typeof CATEGORY_META[IssueCategory]][]).map(([k, m]) => (
                <option key={k} value={k}>{m.label}</option>
              ))}
            </select>
            <select
              aria-label="Filter by priority"
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value as IssuePriority | 'all')}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="all">All priorities</option>
              {(Object.entries(PRIORITY_META) as [IssuePriority, typeof PRIORITY_META[IssuePriority]][]).map(([k, m]) => (
                <option key={k} value={k}>{m.label}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-64 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {STATUSES.map((s) => (
                <div key={s} className={`bg-gray-50 rounded-xl p-2 border-t-4 ${STATUS_META[s].column}`}>
                  <div className="px-1 py-1.5 mb-1 flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{STATUS_META[s].label}</span>
                    <span className="text-[10px] font-bold text-gray-500 bg-white rounded-full px-2 py-0.5">{grouped[s].length}</span>
                  </div>
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {grouped[s].length === 0 ? (
                      <p className="text-[11px] text-gray-400 italic px-1 py-3 text-center">Empty</p>
                    ) : grouped[s].map((iss) => {
                      const cat = CATEGORY_META[iss.category];
                      const CatIcon = cat.icon;
                      const priority = PRIORITY_META[iss.priority];
                      return (
                        <div key={iss.id} className="bg-white rounded-lg p-2.5 shadow-sm">
                          <button
                            type="button"
                            onClick={() => openIssue(iss)}
                            className="w-full text-left"
                          >
                            <div className="flex items-start gap-2 mb-1">
                              <span className="w-6 h-6 rounded bg-[#1B5E20]/10 text-[#1B5E20] flex items-center justify-center shrink-0">
                                <CatIcon size={12} />
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-xs text-gray-900 line-clamp-2">{iss.title}</p>
                                <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                                  {iss.profiles?.full_name ?? 'Resident'}
                                  {iss.flat_number ? ` \u00b7 Flat ${iss.flat_number}` : ''}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-1 mt-1">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${priority.pill}`}>{priority.label}</span>
                              <span className="text-[9px] text-gray-400" suppressHydrationWarning>
                                {formatDistanceToNow(new Date(iss.created_at), { addSuffix: true })}
                              </span>
                            </div>
                          </button>
                          <select
                            aria-label={`Change status of ${iss.title}`}
                            value={iss.status}
                            onChange={(e) => changeStatus(iss, e.target.value as IssueStatus)}
                            className="w-full mt-1.5 text-[10px] border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#1B5E20]"
                          >
                            {STATUSES.map((opt) => (
                              <option key={opt} value={opt}>{STATUS_META[opt].label}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'analytics' && (
        <div className="space-y-4">
          {analyticsLoading || !analytics ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiTile label="Open issues"     value={analytics.kpis.open} />
                <KpiTile label="Resolved (all time)" value={analytics.kpis.resolved} tone="good" />
                <KpiTile
                  label="Avg time to resolve"
                  value={`${analytics.kpis.avgResolveHours}h`}
                  hint="Mean across all resolved issues"
                />
                <KpiTile
                  label="SLA met"
                  value={`${analytics.kpis.slaRate}%`}
                  tone={analytics.kpis.slaRate >= 80 ? 'good' : analytics.kpis.slaRate >= 50 ? 'warn' : 'bad'}
                  hint="Resolved within priority target"
                />
              </div>

              <div className="bg-white rounded-xl p-4 shadow-sm">
                <LineChart
                  label="Burndown \u2014 open issues per day (last 30 days)"
                  data={analytics.burndown.map((d) => ({ date: d.date, value: d.open }))}
                />
              </div>

              <div className="bg-white rounded-xl p-4 shadow-sm">
                <StackedAreaChart
                  label="Cumulative flow \u2014 status breakdown per day"
                  data={analytics.flow.map((d) => ({
                    date: d.date,
                    segments: [
                      { key: 'To Do',       value: d.todo,       color: '#F59E0B' },
                      { key: 'In Progress', value: d.inProgress, color: '#3B82F6' },
                      { key: 'Resolved',    value: d.resolved,   color: '#10B981' },
                      { key: 'Closed',      value: d.closed,     color: '#9CA3AF' },
                    ],
                  }))}
                />
              </div>

              <div className="bg-white rounded-xl p-4 shadow-sm">
                <p className="text-xs font-semibold text-gray-600 mb-3">Open issues by category</p>
                <BarRows
                  data={analytics.byCategory.map((b) => ({
                    label: CATEGORY_META[b.category].label,
                    value: b.count,
                  }))}
                  emptyMessage="No open issues"
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Detail / reply modal */}
      <Modal open={!!activeIssue} onClose={closeIssue} title={activeIssue ? activeIssue.title : ''}>
        {activeIssue && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 -mt-1">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_META[activeIssue.status].pill}`}>
                {STATUS_META[activeIssue.status].label}
              </span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${PRIORITY_META[activeIssue.priority].pill}`}>
                {PRIORITY_META[activeIssue.priority].label}
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {CATEGORY_META[activeIssue.category].label}
              </span>
            </div>

            <p className="text-xs text-gray-500" suppressHydrationWarning>
              {activeIssue.profiles?.full_name ?? 'Resident'}
              {activeIssue.flat_number ? ` \u00b7 Flat ${activeIssue.flat_number}` : ''}
              {' \u00b7 '}
              {format(new Date(activeIssue.created_at), 'dd MMM yyyy, HH:mm')}
            </p>

            <p className="text-sm text-gray-700 whitespace-pre-wrap">{activeIssue.description}</p>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Status</label>
              <select
                aria-label="Change issue status"
                value={activeIssue.status}
                onChange={(e) => changeStatus(activeIssue, e.target.value as IssueStatus)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
              >
                {STATUSES.map((opt) => (
                  <option key={opt} value={opt}>{STATUS_META[opt].label}</option>
                ))}
              </select>
            </div>

            <div className="border-t pt-3">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Conversation</h3>
              {comments.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No comments yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className={`rounded-lg p-2.5 text-xs ${
                        c.is_internal
                          ? 'bg-amber-50 border border-amber-200'
                          : c.profiles?.role === 'admin'
                            ? 'bg-[#1B5E20]/5 border border-[#1B5E20]/20'
                            : 'bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-semibold text-gray-700">
                          {c.profiles?.full_name ?? 'Unknown'}
                          {c.profiles?.role === 'admin' && <span className="ml-1 text-[9px] font-bold text-[#1B5E20]">ADMIN</span>}
                          {c.is_internal && <span className="ml-1 text-[9px] font-bold text-amber-700">INTERNAL</span>}
                        </span>
                        <span className="text-[10px] text-gray-400" suppressHydrationWarning>
                          {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-gray-700 whitespace-pre-wrap">{c.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form onSubmit={submitComment} className="space-y-2">
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder={commentInternal ? 'Internal note (resident won\u2019t see this)' : 'Reply to resident...'}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] resize-none"
                maxLength={1000}
              />
              <div className="flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={commentInternal}
                    onChange={(e) => setCommentInternal(e.target.checked)}
                  />
                  Internal note
                </label>
                <Button type="submit" loading={commentSaving} disabled={!commentBody.trim()} size="sm">
                  <Send size={12} /> Send
                </Button>
              </div>
            </form>

            <div className="flex justify-end pt-1">
              <button type="button" onClick={closeIssue} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
                <X size={12} /> Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
