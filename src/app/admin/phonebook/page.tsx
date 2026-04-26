'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  ShieldCheck,
  Archive,
  ArchiveRestore,
  Flag,
  X,
  Phone,
  BookOpen,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { DirectoryContact, DirectoryCategory } from '@/types';

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

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<DirectoryCategory, string>;
const CATEGORY_EMOJI = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.emoji])) as Record<DirectoryCategory, string>;

type AdminTab = 'society' | 'recommended' | 'reported' | 'archived';

export default function AdminPhonebookPage() {
  const { isAdmin, mounted } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [contacts, setContacts] = useState<DirectoryContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<AdminTab>('society');
  const [editing, setEditing] = useState<DirectoryContact | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Admin queries `is_archived` both ways so it's the source of
  // truth for the Archived tab AND the Reported tab.
  const loadAll = useMemo(() => async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('directory_contacts')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setContacts((data ?? []) as DirectoryContact[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    loadAll();
  }, [mounted, isAdmin, loadAll]);

  const buckets = useMemo(() => {
    const b = {
      society:     contacts.filter((c) => c.is_society_contact && !c.is_archived),
      recommended: contacts.filter((c) => !c.is_society_contact && !c.is_archived),
      reported:    contacts.filter((c) => c.report_count > 0 && !c.is_archived),
      archived:    contacts.filter((c) => c.is_archived),
    };
    return b;
  }, [contacts]);

  async function handleVerify(c: DirectoryContact) {
    const { error } = await supabase
      .from('directory_contacts')
      .update({ is_verified: !c.is_verified })
      .eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    toast.success(c.is_verified ? 'Verified flag removed' : 'Marked verified');
    loadAll();
  }

  async function handleArchive(c: DirectoryContact, archive: boolean) {
    const { error } = await supabase
      .from('directory_contacts')
      .update({ is_archived: archive })
      .eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    toast.success(archive ? 'Archived' : 'Restored');
    loadAll();
  }

  async function handleDelete(c: DirectoryContact) {
    if (!confirm(`Permanently delete "${c.name}"?`)) return;
    const { error } = await supabase
      .from('directory_contacts')
      .delete()
      .eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Deleted');
    loadAll();
  }

  async function handleClearReports(c: DirectoryContact) {
    // Wipe all 'reported' votes for this contact. The trigger
    // will decrement report_count to 0 automatically.
    const { error } = await supabase
      .from('directory_votes')
      .delete()
      .eq('contact_id', c.id)
      .eq('kind', 'reported');
    if (error) { toast.error(error.message); return; }
    toast.success('Reports dismissed');
    loadAll();
  }

  if (!mounted) {
    return <div className="max-w-3xl mx-auto px-4 py-6"><div className="h-20 bg-gray-100 rounded-xl animate-pulse" /></div>;
  }
  if (!isAdmin) {
    return <div className="max-w-3xl mx-auto px-4 py-6 text-center text-gray-500">Admin only.</div>;
  }

  const visible = buckets[tab];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BookOpen size={22} className="text-[#1B5E20]" />
          <h1 className="text-2xl font-bold text-gray-900">Phone Book</h1>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="inline-flex items-center gap-1 bg-[#1B5E20] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#155318]"
        >
          <Plus size={14} />New society contact
        </button>
      </div>

      {/* Tabs */}
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 mb-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {(
            [
              { id: 'society',     label: 'Society',     count: buckets.society.length },
              { id: 'recommended', label: 'Recommended', count: buckets.recommended.length },
              { id: 'reported',    label: 'Reported',    count: buckets.reported.length },
              { id: 'archived',    label: 'Archived',    count: buckets.archived.length },
            ] as { id: AdminTab; label: string; count: number }[]
          ).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#1B5E20] text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-[#1B5E20]'
                }`}
              >
                {t.label}
                <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/25' : 'bg-gray-100 text-gray-500'}`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
          <p className="text-sm text-gray-400">
            {tab === 'reported' ? 'No reported contacts. ' : ''}
            {tab === 'archived' ? 'No archived contacts.' : 'Nothing here yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((c) => (
            <AdminContactRow
              key={c.id}
              contact={c}
              tab={tab}
              onVerify={() => handleVerify(c)}
              onArchive={(archive) => handleArchive(c, archive)}
              onDelete={() => handleDelete(c)}
              onClearReports={() => handleClearReports(c)}
              onEdit={() => { setEditing(c); setShowForm(true); }}
            />
          ))}
        </div>
      )}

      {showForm && (
        <SocietyContactFormModal
          contact={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); loadAll(); }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Admin row
// ----------------------------------------------------------------
interface AdminRowProps {
  contact: DirectoryContact;
  tab: AdminTab;
  onVerify: () => void;
  onArchive: (archive: boolean) => void;
  onDelete: () => void;
  onClearReports: () => void;
  onEdit: () => void;
}

function AdminContactRow({ contact, tab, onVerify, onArchive, onDelete, onClearReports, onEdit }: AdminRowProps) {
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
                <ShieldCheck size={10} />Verified
              </span>
            )}
            {contact.is_society_contact && (
              <span className="text-[10px] font-bold bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded-full">Society</span>
            )}
            {contact.report_count > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                <Flag size={10} />{contact.report_count} report{contact.report_count > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {CATEGORY_LABELS[contact.category]}
            {contact.area_served ? ` · ${contact.area_served}` : ''}
            {' · '}
            <span className="font-medium">{contact.vote_count}</span> helpful
          </p>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-700">
            <Phone size={12} className="text-gray-400" />
            <span className="font-medium">{contact.phone}</span>
          </div>
          {contact.notes && (
            <p className="mt-1.5 text-xs text-gray-600 line-clamp-2">{contact.notes}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-gray-200"
            >
              <Pencil size={12} />Edit
            </button>
            <button
              onClick={onVerify}
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg ${
                contact.is_verified
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <ShieldCheck size={12} />{contact.is_verified ? 'Verified' : 'Verify'}
            </button>
            {tab === 'reported' && (
              <button
                onClick={onClearReports}
                className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-yellow-200"
              >
                <Flag size={12} />Dismiss reports
              </button>
            )}
            {!contact.is_archived ? (
              <button
                onClick={() => onArchive(true)}
                className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-amber-100"
              >
                <Archive size={12} />Archive
              </button>
            ) : (
              <button
                onClick={() => onArchive(false)}
                className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-blue-100"
              >
                <ArchiveRestore size={12} />Restore
              </button>
            )}
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1 ml-auto bg-red-50 text-red-700 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-red-100"
            >
              <Trash2 size={12} />Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Society contact form (admin only)
// ----------------------------------------------------------------
interface FormProps {
  contact: DirectoryContact | null;
  onClose: () => void;
  onSaved: () => void;
}

function SocietyContactFormModal({ contact, onClose, onSaved }: FormProps) {
  const supabase = useMemo(() => createClient(), []);
  const isEdit = !!contact;
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    category: (contact?.category ?? 'rwa_official') as DirectoryCategory,
    phone: contact?.phone ?? '',
    alt_phone: contact?.alt_phone ?? '',
    whatsapp: contact?.whatsapp ?? '',
    notes: contact?.notes ?? '',
    area_served: contact?.area_served ?? '',
    hourly_rate: contact?.hourly_rate?.toString() ?? '',
    is_society_contact: contact?.is_society_contact ?? true,
    is_verified: contact?.is_verified ?? true,
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        phone: form.phone.trim(),
        alt_phone: form.alt_phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        notes: form.notes.trim() || null,
        area_served: form.area_served.trim() || null,
        hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
        is_society_contact: form.is_society_contact,
        is_verified: form.is_verified,
      };
      if (isEdit && contact) {
        const { error } = await supabase
          .from('directory_contacts')
          .update(payload)
          .eq('id', contact.id);
        if (error) throw error;
        toast.success('Updated');
      } else {
        const { error } = await supabase
          .from('directory_contacts')
          .insert(payload);
        if (error) throw error;
        toast.success('Created');
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
            {isEdit ? 'Edit contact' : 'New contact'}
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
            />
          </Field>

          <Field label="Category *">
            <select
              value={form.category}
              onChange={(e) => update('category', e.target.value as DirectoryCategory)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] bg-white"
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Alt phone">
              <input
                type="tel"
                inputMode="tel"
                value={form.alt_phone}
                onChange={(e) => update('alt_phone', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
              />
            </Field>
            <Field label="WhatsApp">
              <input
                type="tel"
                inputMode="tel"
                value={form.whatsapp}
                onChange={(e) => update('whatsapp', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
              />
            </Field>
            <Field label="Rate ₹/hr">
              <input
                type="number"
                min={0}
                step={1}
                value={form.hourly_rate}
                onChange={(e) => update('hourly_rate', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] resize-none"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_society_contact}
              onChange={(e) => update('is_society_contact', e.target.checked)}
              className="rounded text-[#1B5E20] focus:ring-[#1B5E20]"
            />
            Mark as Society contact (pinned, admin-curated)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_verified}
              onChange={(e) => update('is_verified', e.target.checked)}
              className="rounded text-[#1B5E20] focus:ring-[#1B5E20]"
            />
            Verified
          </label>

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
              {submitting ? 'Saving…' : (isEdit ? 'Save' : 'Create')}
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
