'use client';
import { useCallback, useEffect, useState } from 'react';
import { use as usePromise } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Users, Receipt, MessageSquare, Calendar, Tag, ImageIcon,
  CheckCircle2, XCircle, Clock, Shield, Settings,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, formatINRCompact } from '@/lib/money';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import type { CommunityFund, FundContribution, FundSpend, FundComment, FundCategory } from '@/types/funds';
import AdminTagBadges from '@/components/admin-tags/AdminTagBadges';

interface FundWithCategory extends CommunityFund { fund_categories?: FundCategory }

export default function FundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const { isAdmin, profile, mounted } = useAuth();

  const [fund, setFund] = useState<FundWithCategory | null>(null);
  const [contributions, setContributions] = useState<FundContribution[]>([]);
  const [spends, setSpends] = useState<FundSpend[]>([]);
  const [comments, setComments] = useState<FundComment[]>([]);
  const [tab, setTab] = useState<'in' | 'out' | 'discussion'>('in');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [f, c, s, cm] = await Promise.all([
      fetch(`/api/funds/${id}`).then((r) => r.json()),
      fetch(`/api/funds/${id}/contributions?status=received`).then((r) => r.json()),
      fetch(`/api/funds/${id}/spends`).then((r) => r.json()),
      fetch(`/api/funds/${id}/comments`).then((r) => r.json()),
    ]);
    setFund(f.fund ?? null);
    setContributions(c.contributions ?? []);
    setSpends(s.spends ?? []);
    setComments(cm.comments ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (!mounted) return;
    refresh();
  }, [mounted, refresh]);

  if (loading || !fund) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-gray-400 text-sm">Loading fund...</p>
      </div>
    );
  }

  const balance = fund.total_collected - fund.total_spent - fund.total_refunded;
  const pct = fund.target_amount && fund.target_amount > 0
    ? Math.min(100, Math.round((fund.total_collected / fund.target_amount) * 100))
    : null;
  const canContribute = fund.status === 'collecting';
  const myFlatNotSet = !profile?.flat_number;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <button
        onClick={() => router.push('/dashboard/funds')}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3"
      >
        <ArrowLeft size={16} /> Back to funds
      </button>

      <header className="mb-5">
        <div className="flex items-start gap-3">
          <span
            className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
            style={{
              background: `${fund.fund_categories?.color ?? '#1B5E20'}1A`,
              color: fund.fund_categories?.color ?? '#1B5E20',
            }}
          >
            {fund.fund_categories?.icon ?? '📦'}
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{fund.name}</h1>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <Tag size={12} /> {fund.fund_categories?.name}
              </span>
              <StatusPill status={fund.status} />
              {fund.visibility === 'committee_only' && (
                <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                  <Shield size={10} /> Committee only
                </span>
              )}
            </div>
            {fund.description && (
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{fund.description}</p>
            )}
          </div>
          {isAdmin && (
            <Link
              href={`/admin/funds/${fund.id}`}
              className="hidden md:inline-flex items-center gap-1 text-xs px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold"
            >
              <Settings size={14} /> Manage
            </Link>
          )}
        </div>
      </header>

      {/* Stats card */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
        {fund.target_amount && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="font-semibold text-gray-900">
                {formatINR(fund.total_collected)}{' '}
                <span className="text-gray-400 font-normal">/ {formatINR(fund.target_amount)}</span>
              </span>
              <span className="font-bold text-[#1B5E20]">{pct ?? 0}%</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#1B5E20] transition-all" style={{ width: `${pct ?? 0}%` }} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 mt-2">
          <Stat label="Collected" value={formatINRCompact(fund.total_collected)} accent="text-emerald-700" />
          <Stat label="Spent" value={formatINRCompact(fund.total_spent)} accent="text-red-600" />
          <Stat label="Balance" value={formatINRCompact(balance)} accent="text-gray-900" />
        </div>
        {(fund.total_in_kind_value ?? 0) > 0 && (
          <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
            <span className="text-purple-700 font-semibold">+ {formatINR(fund.total_in_kind_value)}</span> in-kind value (items / services, tracked separately)
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-gray-500 mt-3 pt-3 border-t border-gray-100 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Users size={12} /> {fund.contributor_count} contributor{fund.contributor_count !== 1 ? 's' : ''}
          </span>
          {fund.suggested_per_flat && (
            <span>Suggested {formatINR(fund.suggested_per_flat)}/flat</span>
          )}
          {fund.collection_deadline && (
            <span className="inline-flex items-center gap-1">
              <Calendar size={12} /> Closes {new Date(fund.collection_deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {fund.event_date && (
            <span>📅 Event {new Date(fund.event_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mb-5">
        {canContribute && (
          <Link
            href={`/dashboard/funds/${fund.id}/contribute`}
            onClick={(e) => {
              if (myFlatNotSet) {
                e.preventDefault();
                toast.error('Set your flat number in your profile first.');
              }
            }}
            className="bg-[#1B5E20] hover:bg-[#2E7D32] text-white px-5 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center gap-2"
          >
            ✓ I&apos;ve contributed — report it
          </Link>
        )}
        <Link
          href={`/dashboard/funds/${fund.id}/flats`}
          className="bg-white border border-gray-300 hover:border-[#1B5E20] text-gray-800 px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center gap-2"
        >
          <Users size={16} /> Flat-wise grid
        </Link>
        {isAdmin && (
          <Link
            href={`/admin/funds/${fund.id}`}
            className="md:hidden bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center gap-2"
          >
            <Settings size={16} /> Manage
          </Link>
        )}
      </div>

      {fund.status === 'closed' && fund.closure_notes && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl p-3 mb-4 text-sm">
          <p className="font-semibold mb-1">Fund closed</p>
          <p className="whitespace-pre-wrap text-emerald-800">{fund.closure_notes}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
        {([
          { id: 'in', label: `Money in (${contributions.length})`, icon: <CheckCircle2 size={14} /> },
          { id: 'out', label: `Money out (${spends.length})`, icon: <Receipt size={14} /> },
          { id: 'discussion', label: `Discussion (${comments.length})`, icon: <MessageSquare size={14} /> },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs md:text-sm font-medium inline-flex items-center justify-center gap-1.5 transition-colors ${
              tab === t.id ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-500'
            }`}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden">{t.label.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      {tab === 'in' && <ContributionsList rows={contributions} />}
      {tab === 'out' && <SpendsList rows={spends} />}
      {tab === 'discussion' && <CommentsThread fundId={fund.id} comments={comments} onPosted={refresh} />}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{label}</p>
      <p className={`text-base md:text-lg font-bold ${accent}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: CommunityFund['status'] }) {
  const map = {
    collecting: { label: 'Collecting', cls: 'bg-blue-100 text-blue-700' },
    spending: { label: 'Spending', cls: 'bg-amber-100 text-amber-700' },
    closed: { label: 'Closed', cls: 'bg-emerald-100 text-emerald-700' },
    cancelled: { label: 'Cancelled', cls: 'bg-gray-200 text-gray-700' },
  };
  const c = map[status];
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${c.cls}`}>{c.label}</span>
  );
}

function ContributionsList({ rows }: { rows: FundContribution[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-10 text-gray-500 bg-white rounded-2xl border border-dashed border-gray-200">
        <Users className="mx-auto opacity-40 mb-2" size={28} />
        <p className="text-sm">No contributions verified yet.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
      {rows.map((c) => (
        <div key={c.id} className="p-3 flex items-start gap-3">
          <span className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
            {c.flat_number?.slice(0, 2) ?? '?'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {c.flat_number} · {c.contributor_name}
              </p>
              <div className="flex flex-col items-end flex-shrink-0">
                <p className={`text-sm font-bold ${c.is_in_kind ? 'text-purple-700' : 'text-emerald-700'}`}>
                  {formatINR(c.amount)}
                </p>
                {c.is_in_kind && (
                  <span className="text-[10px] uppercase tracking-wide font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded mt-0.5">
                    In-kind
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
              <span>{new Date(c.contribution_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              <span className="uppercase">· {c.method}</span>
              {c.reference_number && <span className="truncate">· UTR …{c.reference_number.slice(-4)}</span>}
            </div>
            {c.in_kind_description && (
              <p className="text-xs text-gray-600 mt-1 italic">{c.in_kind_description}</p>
            )}
            {c.notes && <p className="text-xs text-gray-500 mt-1 truncate">{c.notes}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function SpendsList({ rows }: { rows: FundSpend[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-10 text-gray-500 bg-white rounded-2xl border border-dashed border-gray-200">
        <Receipt className="mx-auto opacity-40 mb-2" size={28} />
        <p className="text-sm">No spends recorded yet.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
      {rows.map((s) => (
        <div key={s.id} className="p-3 flex items-start gap-3">
          <span className="w-9 h-9 rounded-full bg-red-100 text-red-700 flex items-center justify-center flex-shrink-0">
            <Receipt size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900 truncate">{s.description}</p>
              <p className="text-sm font-bold text-red-600 flex-shrink-0">−{formatINR(s.amount)}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 flex-wrap">
              <span>{new Date(s.spend_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              {s.vendor_name && <span>· {s.vendor_name}</span>}
              <span className="uppercase">· {s.payment_method.replace('_', ' ')}</span>
              {s.is_reimbursement && (
                <span className={`px-1.5 py-0.5 rounded ${s.reimbursed_at ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'} font-semibold`}>
                  {s.reimbursed_at ? 'Reimbursed' : 'Pending reimbursement'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              {s.receipt_url && (
                <a href={s.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs inline-flex items-center gap-1 text-[#1B5E20] underline">
                  <ImageIcon size={12} /> Receipt
                </a>
              )}
              {s.invoice_url && (
                <a href={s.invoice_url} target="_blank" rel="noopener noreferrer" className="text-xs inline-flex items-center gap-1 text-[#1B5E20] underline">
                  <ImageIcon size={12} /> Invoice
                </a>
              )}
            </div>
            {s.notes && <p className="text-xs text-gray-500 mt-1">{s.notes}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function CommentsThread({
  fundId,
  comments,
  onPosted,
}: {
  fundId: string;
  comments: FundComment[];
  onPosted: () => void;
}) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!body.trim()) return;
    setSubmitting(true);
    const res = await fetch(`/api/funds/${fundId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body.trim() }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Could not post comment');
      return;
    }
    setBody('');
    onPosted();
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-gray-200 p-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Ask a question or add context (visible to all residents)..."
        />
        <div className="flex justify-end mt-2">
          <Button size="sm" loading={submitting} onClick={submit} disabled={!body.trim()}>
            Post comment
          </Button>
        </div>
      </div>
      {comments.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">No comments yet — be the first.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
          {comments.map((c) => (
            <div key={c.id} className="p-3">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                <span className="font-semibold text-gray-800">{c.author_name}</span>
                <AdminTagBadges profileId={c.author_id} size="xs" />
                {c.author_flat && <span>· {c.author_flat}</span>}
                {c.is_admin_reply && (
                  <span className="bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded text-[10px] font-bold">ADMIN</span>
                )}
                {c.is_pinned && (
                  <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px] font-bold">📌 PINNED</span>
                )}
                <span className="ml-auto">
                  <Clock size={10} className="inline mr-0.5" />
                  {new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// XCircle imported for jsx but kept unused — remove if you want strict
// no-unused; kept here so future "rejected" badges work.
void XCircle;
