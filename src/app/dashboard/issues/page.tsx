'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, AlertTriangle, Wrench, Zap, Brush, Shield, ArrowUp, Leaf, Bug, Wifi, HelpCircle,
  X, Send, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow } from 'date-fns';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import type { Issue, IssueCategory, IssueComment, IssuePriority, IssueStatus } from '@/types';

// Resident-facing issue tracker. The list and detail drawer are scoped to
// the signed-in user's own issues (RLS enforces this server-side too).
// Status transitions and admin replies arrive via the same Supabase row,
// so we just refetch the open issue when the drawer is open.

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

const STATUS_META: Record<IssueStatus, { label: string; pill: string }> = {
  todo:        { label: 'To Do',       pill: 'bg-amber-100 text-amber-700' },
  in_progress: { label: 'In Progress', pill: 'bg-blue-100 text-blue-700' },
  resolved:    { label: 'Resolved',    pill: 'bg-green-100 text-green-700' },
  closed:      { label: 'Closed',      pill: 'bg-gray-100 text-gray-500' },
};

const PRIORITY_META: Record<IssuePriority, { label: string; pill: string }> = {
  low:    { label: 'Low',    pill: 'bg-gray-100 text-gray-600' },
  normal: { label: 'Normal', pill: 'bg-slate-100 text-slate-700' },
  high:   { label: 'High',   pill: 'bg-orange-100 text-orange-700' },
  urgent: { label: 'Urgent', pill: 'bg-red-100 text-red-700' },
};

// 7-day reopen window matches the description in the plan: residents who
// notice a regression after admin marked something resolved can reopen
// without having to file a brand new ticket.
const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default function IssuesPage() {
  const { profile, mounted } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    description: string;
    category: IssueCategory;
    priority: IssuePriority;
  }>({ title: '', description: '', category: 'plumbing', priority: 'normal' });
  const [saving, setSaving] = useState(false);

  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);

  const fetchIssues = useCallback(async () => {
    if (!profile) return;
    // Join the creator's profile so the card can show "Raised by <name> ·
    // Flat <number>". RLS still scopes the result set to the resident's
    // own rows (admins use /admin/issues for the cross-resident board), so
    // this is just surfacing the same identity the resident already owns.
    const { data, error } = await supabase
      .from('issues')
      .select('*, profiles:created_by(full_name, flat_number)')
      .eq('created_by', profile.id)
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(error.message);
    } else {
      setIssues((data ?? []) as Issue[]);
    }
    setLoading(false);
  }, [profile, supabase]);

  useEffect(() => { if (mounted && profile) fetchIssues(); }, [mounted, profile, fetchIssues]);

  const fetchComments = useCallback(
    async (issueId: string) => {
      setCommentsLoading(true);
      const { data } = await supabase
        .from('issue_comments')
        .select('*, profiles(full_name, role)')
        .eq('issue_id', issueId)
        .order('created_at', { ascending: true });
      // is_internal rows are filtered out for the resident by RLS; we still
      // skip them client-side as a safety net in case RLS policies change.
      setComments(((data ?? []) as IssueComment[]).filter((c) => !c.is_internal));
      setCommentsLoading(false);
    },
    [supabase]
  );

  function openIssue(issue: Issue) {
    setActiveIssue(issue);
    setComments([]);
    setCommentBody('');
    fetchComments(issue.id);
  }

  function closeIssue() {
    setActiveIssue(null);
    setComments([]);
    setCommentBody('');
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    const title = form.title.trim();
    const description = form.description.trim();
    if (!title || !description) {
      toast.error('Title and description are required');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('issues').insert({
      created_by: profile.id,
      title,
      description,
      category: form.category,
      priority: form.priority,
      // Snapshot the reporter's flat so admin can filter by it later even
      // if the resident moves out and updates their profile.
      flat_number: profile.flat_number ?? null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Issue raised');
    setCreateOpen(false);
    setForm({ title: '', description: '', category: 'plumbing', priority: 'normal' });
    fetchIssues();
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!activeIssue || !profile) return;
    const body = commentBody.trim();
    if (!body) return;
    setCommentSaving(true);
    // Resident comments are always public (is_internal = false). RLS will
    // also reject any attempt to set is_internal = true from a non-admin.
    const { error } = await supabase.from('issue_comments').insert({
      issue_id: activeIssue.id,
      author_id: profile.id,
      body,
      is_internal: false,
    });
    setCommentSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCommentBody('');
    // Best-effort: ping the server so admins get a push. Failures are silent
    // because the comment row itself is what matters.
    fetch(`/api/issues/${activeIssue.id}/comment-notify`, { method: 'POST' }).catch(() => undefined);
    fetchComments(activeIssue.id);
  }

  async function reopenIssue() {
    if (!activeIssue) return;
    const resolvedAt = activeIssue.resolved_at ? new Date(activeIssue.resolved_at).getTime() : 0;
    if (Date.now() - resolvedAt > REOPEN_WINDOW_MS) {
      toast.error('Reopen window has expired. Please raise a new issue.');
      return;
    }
    const { error } = await supabase
      .from('issues')
      .update({ status: 'in_progress', resolved_at: null })
      .eq('id', activeIssue.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Issue reopened');
    closeIssue();
    fetchIssues();
  }

  const [canReopen, setCanReopen] = useState(false);
  useEffect(() => {
    if (activeIssue?.status === 'resolved' && activeIssue.resolved_at) {
      const ageMs = Date.now() - new Date(activeIssue.resolved_at).getTime();
      setCanReopen(ageMs <= REOPEN_WINDOW_MS);
    } else {
      setCanReopen(false);
    }
  }, [activeIssue?.status, activeIssue?.resolved_at]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Issues</h1>
          <p className="text-xs text-gray-500 mt-0.5">Raise and track community service requests</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm"><Plus size={16} />Raise</Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : issues.length === 0 ? (
        <div className="text-center py-12">
          <HelpCircle size={36} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No issues yet</p>
          <p className="text-xs text-gray-400 mt-1">Tap &quot;Raise&quot; to report a community problem</p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map((iss) => {
            const cat = CATEGORY_META[iss.category];
            const CatIcon = cat.icon;
            const status = STATUS_META[iss.status];
            const priority = PRIORITY_META[iss.priority];
            return (
              <button
                key={iss.id}
                type="button"
                onClick={() => openIssue(iss)}
                className="w-full text-left bg-white rounded-xl p-4 shadow-sm hover:shadow transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-lg bg-[#1B5E20]/10 text-[#1B5E20] flex items-center justify-center shrink-0">
                    <CatIcon size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <h3 className="font-semibold text-gray-900 text-sm truncate">{iss.title}</h3>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.pill}`}>{status.label}</span>
                      {iss.priority !== 'normal' && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${priority.pill}`}>{priority.label}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2">{iss.description}</p>
                    <p className="text-[11px] text-gray-400 mt-1.5" suppressHydrationWarning>
                      {cat.label}
                      {' · '}
                      {iss.profiles?.full_name ?? 'Resident'}
                      {iss.flat_number ? ` · Flat ${iss.flat_number}` : iss.profiles?.flat_number ? ` · Flat ${iss.profiles.flat_number}` : ''}
                      {' · raised '}
                      {formatDistanceToNow(new Date(iss.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Raise an issue">
        <form onSubmit={submitCreate} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Category *</label>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(CATEGORY_META) as [IssueCategory, typeof CATEGORY_META[IssueCategory]][]).map(([k, meta]) => {
                const Icon = meta.icon;
                const active = form.category === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, category: k }))}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      active
                        ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-[#1B5E20]'
                    }`}
                  >
                    <Icon size={12} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Priority *</label>
            <div className="flex gap-2">
              {(Object.entries(PRIORITY_META) as [IssuePriority, typeof PRIORITY_META[IssuePriority]][]).map(([k, meta]) => {
                const active = form.priority === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, priority: k }))}
                    className={`flex-1 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      active
                        ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-[#1B5E20]'
                    }`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Input
            label="Title *"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Lift on tower B making grinding noise"
            maxLength={120}
          />
          <Textarea
            label="Description *"
            rows={4}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Describe the problem, when it started, and any details that will help admin resolve it."
            maxLength={2000}
          />

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Submit</Button>
          </div>
        </form>
      </Modal>

      {/* Detail drawer (rendered as a Modal so it works on mobile too) */}
      <Modal
        open={!!activeIssue}
        onClose={closeIssue}
        title={activeIssue ? activeIssue.title : ''}
      >
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

            <p className="text-sm text-gray-700 whitespace-pre-wrap">{activeIssue.description}</p>

            <div className="text-[11px] text-gray-500 space-y-0.5" suppressHydrationWarning>
              <p>
                <span className="text-gray-400">Raised by </span>
                <span className="font-semibold text-gray-700">{activeIssue.profiles?.full_name ?? 'Resident'}</span>
                {(activeIssue.flat_number || activeIssue.profiles?.flat_number) && (
                  <>
                    {' · '}
                    <span className="font-semibold text-gray-700">
                      Flat {activeIssue.flat_number ?? activeIssue.profiles?.flat_number}
                    </span>
                  </>
                )}
              </p>
              <p className="text-gray-400">
                {format(new Date(activeIssue.created_at), 'dd MMM yyyy, HH:mm')}
                {activeIssue.resolved_at && ` · Resolved ${format(new Date(activeIssue.resolved_at), 'dd MMM yyyy')}`}
              </p>
            </div>

            <div className="border-t pt-3">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Conversation</h3>
              {commentsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
                </div>
              ) : comments.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No replies yet. Admin will respond here.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {comments.map((c) => {
                    const isAdminAuthor = c.profiles?.role === 'admin';
                    return (
                      <div
                        key={c.id}
                        className={`rounded-lg p-2.5 text-xs ${
                          isAdminAuthor ? 'bg-[#1B5E20]/5 border border-[#1B5E20]/20' : 'bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={`font-semibold ${isAdminAuthor ? 'text-[#1B5E20]' : 'text-gray-700'}`}>
                            {c.profiles?.full_name ?? 'Resident'}
                            {isAdminAuthor && <span className="ml-1 text-[9px] font-bold">ADMIN</span>}
                          </span>
                          <span className="text-[10px] text-gray-400" suppressHydrationWarning>
                            {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-gray-700 whitespace-pre-wrap">{c.body}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {activeIssue.status !== 'closed' && (
              <form onSubmit={submitComment} className="flex gap-2">
                <input
                  type="text"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Add a reply..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
                  maxLength={1000}
                />
                <Button type="submit" loading={commentSaving} disabled={!commentBody.trim()} size="sm">
                  <Send size={14} />
                </Button>
              </form>
            )}

            {canReopen && (
              <button
                type="button"
                onClick={reopenIssue}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900"
              >
                <RefreshCw size={12} />
                Reopen this issue
              </button>
            )}

            {activeIssue.status === 'resolved' && !canReopen && (
              <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                The 7-day reopen window has expired. Please raise a new issue if the problem returns.
              </p>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={closeIssue}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
              >
                <X size={12} /> Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
