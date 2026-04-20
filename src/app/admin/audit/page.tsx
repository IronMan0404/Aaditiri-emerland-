'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  FileClock, Filter, ChevronDown, ChevronRight, RefreshCw,
  Trash2, Pencil, PlusCircle, ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

// Read-only view of the admin_audit_log table. Lets the admin team
// trace every privileged write (delete / update / create) back to the
// actor, see the before/after snapshot, and filter by target type or
// action.
//
// This page is rendered as a client component because the admin
// filters interactively. Access is double-gated:
//   1. RLS denies SELECT to non-admins (see 20260422_admin_audit_log.sql)
//   2. We also no-render until `isAdmin` is true so a non-admin who
//      somehow bypasses RLS still sees nothing.

interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: 'create' | 'update' | 'delete';
  target_type: string;
  target_id: string;
  target_label: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

const PAGE_SIZE = 50;

const ACTION_META: Record<AuditRow['action'], { icon: typeof Trash2; pill: string; label: string }> = {
  create: { icon: PlusCircle, pill: 'bg-green-100 text-green-700', label: 'create' },
  update: { icon: Pencil,     pill: 'bg-blue-100 text-blue-700',   label: 'update' },
  delete: { icon: Trash2,     pill: 'bg-red-100 text-red-700',     label: 'delete' },
};

const TARGET_TYPES = [
  'profile', 'booking', 'clubhouse_subscription', 'clubhouse_facility',
  'clubhouse_tier', 'clubhouse_pass', 'issue', 'announcement',
  'event', 'broadcast', 'photo',
  'community_fund', 'fund_contribution', 'fund_spend', 'fund_refund',
  'admin_tag', 'profile_admin_tag',
] as const;

export default function AdminAuditPage() {
  const { isAdmin, mounted } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const [actionFilter, setActionFilter] = useState<'all' | AuditRow['action']>('all');
  const [targetFilter, setTargetFilter] = useState<'all' | (typeof TARGET_TYPES)[number]>('all');
  const [search, setSearch] = useState('');

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Keyset (a.k.a. seek) pagination instead of OFFSET. The
  // (created_at, id) tuple from the last row of the current page is
  // used as a cursor for the next page. This stays O(log n) on the
  // (created_at desc, id) index even when the table grows past
  // hundreds of thousands of rows, where OFFSET-based pagination
  // would force Postgres to scan and discard everything before the
  // current page on every "Load more" click.
  const load = useCallback(async (opts: {
    reset?: boolean;
    cursor?: { created_at: string; id: string } | null;
  } = {}) => {
    setLoading(true);
    try {
      let q = supabase
        .from('admin_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);
      if (actionFilter !== 'all') q = q.eq('action', actionFilter);
      if (targetFilter !== 'all') q = q.eq('target_type', targetFilter);
      // Apply the keyset cursor: "rows older than the cursor". The
      // tuple comparison `(created_at, id) < (cursor.created_at, cursor.id)`
      // is implemented as the equivalent OR expression because
      // PostgREST doesn't expose row-comparison literals.
      if (opts.cursor && !opts.reset) {
        q = q.or(
          `created_at.lt.${opts.cursor.created_at},`
          + `and(created_at.eq.${opts.cursor.created_at},id.lt.${opts.cursor.id})`,
        );
      }
      const { data, error } = await q;
      if (error) {
        toast.error(error.message);
        return;
      }
      const fresh = (data ?? []) as AuditRow[];
      setHasMore(fresh.length === PAGE_SIZE);
      if (opts.reset) {
        setRows(fresh);
      } else {
        setRows((prev) => [...prev, ...fresh]);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, actionFilter, targetFilter]);

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    load({ reset: true });
  }, [mounted, isAdmin, actionFilter, targetFilter, load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter((r) =>
      (r.actor_name ?? '').toLowerCase().includes(needle)
      || (r.actor_email ?? '').toLowerCase().includes(needle)
      || (r.target_label ?? '').toLowerCase().includes(needle)
      || r.target_id.toLowerCase().includes(needle)
      || (r.reason ?? '').toLowerCase().includes(needle)
    );
  }, [rows, search]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (mounted && !isAdmin) {
    return <p className="p-6 text-sm text-gray-500">Admin access required.</p>;
  }

  return (
    <div className="max-w-5xl mx-auto w-full px-3 sm:px-4 py-4 sm:py-6">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#1B5E20] flex items-center justify-center shrink-0">
            <FileClock size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">Audit Log</h1>
            <p className="text-xs text-gray-500 mt-0.5">Every privileged change made through the admin panel</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { load({ reset: true }); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 shrink-0"
        >
          <RefreshCw size={14} />Refresh
        </button>
      </div>

      <div className="bg-white rounded-xl p-3 shadow-sm flex flex-wrap gap-2 items-center mb-3">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Filter size={13} /> Filter
        </div>
        <select
          aria-label="Filter by action"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as typeof actionFilter)}
          className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="all">Any action</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
        </select>
        <select
          aria-label="Filter by target type"
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value as typeof targetFilter)}
          className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="all">Any target</option>
          {TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search actor / target / reason\u2026"
          className="flex-1 min-w-[180px] px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#1B5E20]"
        />
      </div>

      {loading && rows.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center shadow-sm">
          <ShieldAlert size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">No audit entries match these filters.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const meta = ACTION_META[r.action];
            const Icon = meta.icon;
            const isOpen = expanded.has(r.id);
            return (
              <li key={r.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleExpanded(r.id)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? 'Collapse audit entry' : 'Expand audit entry'}
                  className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-gray-50"
                >
                  <span className={`inline-flex items-center justify-center shrink-0 w-7 h-7 rounded-lg ${meta.pill}`}>
                    <Icon size={14} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold text-gray-900">
                        {r.actor_name ?? r.actor_email ?? 'Unknown admin'}
                      </span>
                      <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${meta.pill}`}>
                        {meta.label}
                      </span>
                      <span className="text-xs text-gray-500 truncate">
                        {r.target_type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 truncate">
                      {r.target_label ?? r.target_id}
                    </p>
                    {r.reason && (
                      <p className="text-[11px] text-gray-500 italic line-clamp-1">&ldquo;{r.reason}&rdquo;</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] text-gray-400" suppressHydrationWarning>
                      {format(new Date(r.created_at), 'dd MMM yyyy')}
                    </p>
                    <p className="text-[10px] text-gray-400" suppressHydrationWarning>
                      {format(new Date(r.created_at), 'HH:mm:ss')}
                    </p>
                  </div>
                  <span className="ml-1 text-gray-400 shrink-0 mt-1">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100 px-3 py-3 bg-gray-50 text-xs space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Field label="Actor email" value={r.actor_email ?? '\u2014'} />
                      <Field label="Actor id" value={r.actor_id ?? '\u2014'} mono />
                      <Field label="Target id" value={r.target_id} mono />
                      <Field label="IP address" value={r.ip_address ?? '\u2014'} mono />
                      <Field label="Created at" value={format(new Date(r.created_at), 'dd MMM yyyy, HH:mm:ss')} />
                      <Field label="User agent" value={r.user_agent ?? '\u2014'} />
                    </div>
                    {r.before !== null && (
                      <SnapshotBlock title="Before" payload={r.before} />
                    )}
                    {r.after !== null && (
                      <SnapshotBlock title="After" payload={r.after} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={() => {
              const last = rows[rows.length - 1];
              if (!last) return;
              load({ cursor: { created_at: last.created_at, id: last.id } });
            }}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Loading\u2026' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400">{label}</p>
      <p className={`text-xs text-gray-800 ${mono ? 'font-mono break-all' : 'break-words'}`}>{value}</p>
    </div>
  );
}

function SnapshotBlock({ title, payload }: { title: string; payload: unknown }) {
  // JSON.stringify here is safe - the value comes from a JSONB column
  // populated server-side by `logAdminAction`, never directly from
  // user input as a string. Pretty-printed at indent 2 so admins can
  // eyeball field changes.
  let pretty: string;
  try {
    pretty = JSON.stringify(payload, null, 2);
  } catch {
    pretty = '<unserialisable>';
  }
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-1">{title}</p>
      <pre className="bg-white border border-gray-200 rounded-lg p-2 overflow-x-auto text-[11px] leading-snug text-gray-700 max-h-64">
        {pretty}
      </pre>
    </div>
  );
}
