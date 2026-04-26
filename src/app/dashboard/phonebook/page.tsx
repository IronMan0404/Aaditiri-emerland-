'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Phone,
  MessageCircle,
  Search,
  X,
  Plus,
  ThumbsUp,
  Flag,
  ShieldCheck,
  Pencil,
  Trash2,
  BookOpen,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { DirectoryContact, DirectoryCategory, DirectoryVote } from '@/types';

// Display metadata for every category. The slug list is the canonical
// source of truth — it must match the DB CHECK constraint and the
// `DirectoryCategory` union in src/types.
const CATEGORIES: { id: DirectoryCategory; label: string; emoji: string }[] = [
  { id: 'plumbing',         label: 'Plumbing',         emoji: '🔧' },
  { id: 'electrical',       label: 'Electrical',       emoji: '💡' },
  { id: 'carpentry',        label: 'Carpentry',        emoji: '🪚' },
  { id: 'painting',         label: 'Painting',         emoji: '🎨' },
  { id: 'pest_control',     label: 'Pest control',     emoji: '🐜' },
  { id: 'lift_amc',         label: 'Lift / AMC',       emoji: '🛗' },
  { id: 'maid',             label: 'Maid',             emoji: '🧹' },
  { id: 'cook',             label: 'Cook',             emoji: '👩‍🍳' },
  { id: 'nanny',            label: 'Nanny',            emoji: '🍼' },
  { id: 'driver',           label: 'Driver',           emoji: '🚗' },
  { id: 'milkman',          label: 'Milkman',          emoji: '🥛' },
  { id: 'newspaper',        label: 'Newspaper',        emoji: '📰' },
  { id: 'gas_cylinder',     label: 'Gas cylinder',     emoji: '🔥' },
  { id: 'laundry',          label: 'Laundry',          emoji: '👕' },
  { id: 'tailor',           label: 'Tailor',           emoji: '🧵' },
  { id: 'cab_auto',         label: 'Cab / Auto',       emoji: '🚕' },
  { id: 'doctor',           label: 'Doctor',           emoji: '🩺' },
  { id: 'hospital',         label: 'Hospital',         emoji: '🏥' },
  { id: 'pharmacy',         label: 'Pharmacy',         emoji: '💊' },
  { id: 'police',           label: 'Police',           emoji: '👮' },
  { id: 'ambulance',        label: 'Ambulance',        emoji: '🚑' },
  { id: 'fire',             label: 'Fire',             emoji: '🚒' },
  { id: 'hardware',         label: 'Hardware',         emoji: '🔩' },
  { id: 'grocery',          label: 'Grocery',          emoji: '🛒' },
  { id: 'rwa_official',     label: 'RWA official',     emoji: '🏛️' },
  { id: 'society_office',   label: 'Society office',   emoji: '📋' },
  { id: 'security_agency',  label: 'Security',         emoji: '🛡️' },
  { id: 'other',            label: 'Other',            emoji: '📞' },
];

const CATEGORY_LABELS: Record<DirectoryCategory, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label]),
) as Record<DirectoryCategory, string>;

const CATEGORY_EMOJI: Record<DirectoryCategory, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.emoji]),
) as Record<DirectoryCategory, string>;

type Bucket = 'society' | 'recommended';

function digitsOnly(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

// Format a stored phone (which is normalised to digits with optional
// leading +) for display: groups of 4-3-3 for Indian-style numbers,
// otherwise just inserts spaces every 3 from the right.
function formatPhone(input: string | null | undefined): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (trimmed.length <= 6) return trimmed;
  return trimmed;
}

export default function PhonebookPage() {
  const { profile: me, isAdmin, mounted } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [contacts, setContacts] = useState<DirectoryContact[]>([]);
  const [myVotes, setMyVotes] = useState<Map<string, Set<'helpful' | 'reported'>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState<Bucket>('society');
  const [categoryFilter, setCategoryFilter] = useState<Set<DirectoryCategory>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<DirectoryContact | null>(null);

  const loadAll = useMemo(() => async () => {
    setLoading(true);
    const [contactsRes, votesRes] = await Promise.all([
      supabase
        .from('directory_contacts')
        .select('*')
        .eq('is_archived', false)
        .order('is_verified', { ascending: false })
        .order('vote_count', { ascending: false })
        .order('name', { ascending: true }),
      supabase
        .from('directory_votes')
        .select('contact_id, kind')
        .eq('user_id', me?.id ?? ''),
    ]);

    if (contactsRes.error) {
      toast.error(contactsRes.error.message);
      setLoading(false);
      return;
    }
    setContacts((contactsRes.data ?? []) as DirectoryContact[]);

    const votesMap = new Map<string, Set<'helpful' | 'reported'>>();
    for (const v of (votesRes.data ?? []) as Pick<DirectoryVote, 'contact_id' | 'kind'>[]) {
      const set = votesMap.get(v.contact_id) ?? new Set<'helpful' | 'reported'>();
      set.add(v.kind);
      votesMap.set(v.contact_id, set);
    }
    setMyVotes(votesMap);
    setLoading(false);
  }, [supabase, me?.id]);

  useEffect(() => {
    if (!mounted || !me) return;
    loadAll();
  }, [mounted, me, loadAll]);

  const counts = useMemo(() => {
    let society = 0;
    let recommended = 0;
    for (const c of contacts) {
      if (c.is_society_contact) society++; else recommended++;
    }
    return { society, recommended };
  }, [contacts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      const inBucket = bucket === 'society' ? c.is_society_contact : !c.is_society_contact;
      if (!inBucket) return false;
      if (categoryFilter.size > 0 && !categoryFilter.has(c.category)) return false;
      if (!q) return true;
      const haystack = [
        c.name,
        c.phone,
        c.alt_phone ?? '',
        c.whatsapp ?? '',
        c.notes ?? '',
        c.area_served ?? '',
        CATEGORY_LABELS[c.category] ?? '',
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [contacts, search, bucket, categoryFilter]);

  function toggleCategory(id: DirectoryCategory) {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleVote(contact: DirectoryContact, kind: 'helpful' | 'reported') {
    const has = myVotes.get(contact.id)?.has(kind) ?? false;
    const action = has ? 'remove' : 'add';

    // Optimistic update — flip the vote locally and adjust the
    // counter, then reconcile with server response. If the server
    // rejects, we swap back.
    setMyVotes((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(contact.id) ?? []);
      if (has) set.delete(kind); else set.add(kind);
      next.set(contact.id, set);
      return next;
    });
    setContacts((prev) =>
      prev.map((c) => {
        if (c.id !== contact.id) return c;
        const delta = has ? -1 : 1;
        return {
          ...c,
          vote_count: kind === 'helpful' ? Math.max(0, c.vote_count + delta) : c.vote_count,
          report_count: kind === 'reported' ? Math.max(0, c.report_count + delta) : c.report_count,
        };
      }),
    );

    try {
      const res = await fetch(`/api/phonebook/${contact.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Vote failed');
      }
      if (kind === 'reported' && !has) {
        toast.success('Reported. Admins will review.');
      }
    } catch (err) {
      // Roll back the optimistic flip.
      setMyVotes((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(contact.id) ?? []);
        if (has) set.add(kind); else set.delete(kind);
        next.set(contact.id, set);
        return next;
      });
      setContacts((prev) =>
        prev.map((c) => {
          if (c.id !== contact.id) return c;
          const delta = has ? 1 : -1;
          return {
            ...c,
            vote_count: kind === 'helpful' ? Math.max(0, c.vote_count + delta) : c.vote_count,
            report_count: kind === 'reported' ? Math.max(0, c.report_count + delta) : c.report_count,
          };
        }),
      );
      toast.error(err instanceof Error ? err.message : 'Could not save your vote');
    }
  }

  async function handleDelete(contact: DirectoryContact) {
    if (!confirm(`Remove "${contact.name}" from the phone book?`)) return;
    const { error } = await supabase.from('directory_contacts').delete().eq('id', contact.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Contact removed');
    setContacts((prev) => prev.filter((c) => c.id !== contact.id));
  }

  if (!mounted) {
    return <div className="max-w-3xl mx-auto px-4 py-6"><div className="h-20 bg-gray-100 rounded-xl animate-pulse" /></div>;
  }

  const hasActiveFilters = search.trim().length > 0 || categoryFilter.size > 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BookOpen size={22} className="text-[#1B5E20]" />
          <h1 className="text-2xl font-bold text-gray-900">Phone Book</h1>
        </div>
        <button
          onClick={() => { setEditing(null); setShowAdd(true); }}
          className="inline-flex items-center gap-1 bg-[#1B5E20] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#155318]"
        >
          <Plus size={14} />Add
        </button>
      </div>

      {/* Bucket toggle */}
      <div className="flex bg-gray-100 rounded-xl p-1 mb-3" role="tablist">
        <button
          role="tab"
          aria-selected={bucket === 'society'}
          onClick={() => setBucket('society')}
          className={`flex-1 text-xs font-semibold px-3 py-2 rounded-lg transition-colors ${
            bucket === 'society' ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-600'
          }`}
        >
          Society <span className="ml-1 text-[10px] opacity-70">{counts.society}</span>
        </button>
        <button
          role="tab"
          aria-selected={bucket === 'recommended'}
          onClick={() => setBucket('recommended')}
          className={`flex-1 text-xs font-semibold px-3 py-2 rounded-lg transition-colors ${
            bucket === 'recommended' ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-600'
          }`}
        >
          Recommended <span className="ml-1 text-[10px] opacity-70">{counts.recommended}</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, category, phone, area…"
          aria-label="Search phone book"
          className="w-full pl-9 pr-9 py-2.5 border border-gray-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Category chips — horizontally scrollable on mobile */}
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 mb-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max sm:flex-wrap">
          {CATEGORIES.map((c) => {
            const active = categoryFilter.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCategory(c.id)}
                aria-label={`${active ? 'Remove' : 'Apply'} filter: ${c.label}`}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all whitespace-nowrap ${
                  active
                    ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20]'
                }`}
              >
                <span aria-hidden>{c.emoji}</span>
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {hasActiveFilters && (
        <button
          onClick={() => { setSearch(''); setCategoryFilter(new Set()); }}
          className="mb-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-100"
        >
          <X size={12} />Clear filters
        </button>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
          <p className="text-sm text-gray-400">
            {hasActiveFilters
              ? 'No contacts match your filters.'
              : bucket === 'society'
                ? 'No society contacts yet. Admins can add them from the admin panel.'
                : 'No recommended contacts yet. Be the first to add one!'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <ContactCard
              key={c.id}
              contact={c}
              isMine={c.submitted_by === me?.id}
              isAdmin={!!isAdmin}
              myVotes={myVotes.get(c.id) ?? new Set()}
              onVote={(kind) => handleVote(c, kind)}
              onEdit={() => { setEditing(c); setShowAdd(true); }}
              onDelete={() => handleDelete(c)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <ContactFormModal
          contact={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={() => { setShowAdd(false); setEditing(null); loadAll(); }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Contact card
// ----------------------------------------------------------------
interface ContactCardProps {
  contact: DirectoryContact;
  isMine: boolean;
  isAdmin: boolean;
  myVotes: Set<'helpful' | 'reported'>;
  onVote: (kind: 'helpful' | 'reported') => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ContactCard({ contact, isMine, isAdmin, myVotes, onVote, onEdit, onDelete }: ContactCardProps) {
  const phoneDigits = digitsOnly(contact.phone);
  const altDigits = digitsOnly(contact.alt_phone);
  // Default WhatsApp to the main phone when the whatsapp field is
  // empty — most service providers use the same number for calls
  // and WhatsApp.
  const waDigits = digitsOnly(contact.whatsapp || contact.phone);

  // Build href values defensively. tel:/wa.me with empty digits would
  // open the dialler with nothing in it, which is a bad UX.
  const telHref = phoneDigits ? `tel:${phoneDigits}` : undefined;
  const altTelHref = altDigits ? `tel:${altDigits}` : undefined;
  const waHref = waDigits ? `https://wa.me/${waDigits}` : undefined;

  const helpful = myVotes.has('helpful');
  const reported = myVotes.has('reported');

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-green-50 text-[#1B5E20] flex items-center justify-center text-lg shrink-0">
          {CATEGORY_EMOJI[contact.category] ?? '📞'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-bold text-gray-900 truncate">{contact.name}</h3>
            {contact.is_verified && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold bg-green-100 text-[#1B5E20] px-1.5 py-0.5 rounded-full">
                <ShieldCheck size={10} />
                Verified
              </span>
            )}
            {contact.is_society_contact && (
              <span className="text-[10px] font-bold bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded-full">
                Society
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {CATEGORY_LABELS[contact.category]}
            {contact.area_served ? ` · ${contact.area_served}` : ''}
            {contact.hourly_rate ? ` · ₹${contact.hourly_rate}/hr` : ''}
          </p>

          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
              <Phone size={14} className="text-gray-400" />
              {telHref ? (
                <a href={telHref} className="hover:underline tracking-wide">{formatPhone(contact.phone)}</a>
              ) : (
                <span>{formatPhone(contact.phone)}</span>
              )}
            </div>
            {contact.alt_phone && altTelHref && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Phone size={12} className="text-gray-300" />
                <a href={altTelHref} className="hover:underline">{formatPhone(contact.alt_phone)}</a>
                <span className="text-gray-300">(alt)</span>
              </div>
            )}
          </div>

          {contact.notes && (
            <p className="mt-2 text-xs text-gray-600 leading-relaxed line-clamp-3">{contact.notes}</p>
          )}

          {/* Action row */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {telHref && (
              <a
                href={telHref}
                className="inline-flex items-center gap-1 bg-[#1B5E20] text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-[#155318]"
              >
                <Phone size={12} />Call
              </a>
            )}
            {waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-green-100"
              >
                <MessageCircle size={12} />WhatsApp
              </a>
            )}

            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => onVote('helpful')}
                aria-label={helpful ? 'Remove helpful vote' : 'Mark as helpful'}
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors ${
                  helpful ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <ThumbsUp size={12} />
                <span>{contact.vote_count}</span>
              </button>
              <button
                onClick={() => onVote('reported')}
                aria-label={reported ? 'Remove report' : 'Report this contact'}
                title={reported ? 'You reported this' : 'Report'}
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors ${
                  reported ? 'bg-red-100 text-red-700' : 'text-gray-400 hover:bg-gray-100 hover:text-red-600'
                }`}
              >
                <Flag size={12} />
              </button>
              {(isMine || isAdmin) && (
                <button
                  onClick={onEdit}
                  aria-label="Edit"
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  <Pencil size={12} />
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={onDelete}
                  aria-label="Delete"
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Add / edit modal
// ----------------------------------------------------------------
interface FormModalProps {
  contact: DirectoryContact | null;
  onClose: () => void;
  onSaved: () => void;
}

function ContactFormModal({ contact, onClose, onSaved }: FormModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const isEdit = !!contact;
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    category: (contact?.category ?? 'plumbing') as DirectoryCategory,
    phone: contact?.phone ?? '',
    alt_phone: contact?.alt_phone ?? '',
    whatsapp: contact?.whatsapp ?? '',
    notes: contact?.notes ?? '',
    area_served: contact?.area_served ?? '',
    hourly_rate: contact?.hourly_rate?.toString() ?? '',
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (isEdit && contact) {
        // Edit goes via PATCH /api/phonebook/[id] (NOT direct
        // supabase-js) so the same shared validator + phone
        // normaliser runs as on create. Otherwise edits silently
        // drift the stored format ("+91 98xxx" vs "98xxx") and
        // break dedup/search.
        const res = await fetch(`/api/phonebook/${contact.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || 'Failed to update contact');
        }
        toast.success('Updated');
      } else {
        const res = await fetch('/api/phonebook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || 'Failed to add contact');
        }
        toast.success('Contact added');
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-base font-bold text-gray-900">
            {isEdit ? 'Edit contact' : 'Add a recommendation'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 overflow-y-auto">
          <Field label="Name *">
            <input
              required
              type="text"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              maxLength={80}
              placeholder="e.g. Ramesh Plumbing Services"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
            />
          </Field>

          <Field label="Category *">
            <select
              value={form.category}
              onChange={(e) => update('category', e.target.value as DirectoryCategory)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent bg-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Phone *">
            <input
              required
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="+91 98xxx xxxxx"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Alt phone">
              <input
                type="tel"
                inputMode="tel"
                value={form.alt_phone}
                onChange={(e) => update('alt_phone', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
              />
            </Field>
            <Field label="WhatsApp">
              <input
                type="tel"
                inputMode="tel"
                value={form.whatsapp}
                onChange={(e) => update('whatsapp', e.target.value)}
                placeholder="Same as phone if empty"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Area served">
              <input
                type="text"
                value={form.area_served}
                onChange={(e) => update('area_served', e.target.value)}
                maxLength={100}
                placeholder="Tellapur"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
              />
            </Field>
            <Field label="Rate ₹/hr">
              <input
                type="number"
                min={0}
                step={1}
                value={form.hourly_rate}
                onChange={(e) => update('hourly_rate', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent"
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="What do they do well? Anything residents should know?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent resize-none"
            />
          </Field>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#1B5E20] hover:bg-[#155318] disabled:opacity-50"
            >
              {submitting ? 'Saving…' : (isEdit ? 'Save changes' : 'Add to phone book')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
