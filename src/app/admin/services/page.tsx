'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Plus,
  Pencil,
  Trash2,
  EyeOff,
  Eye,
  Phone,
  MessageCircle,
  Mail,
  Image as ImageIcon,
  X,
  GripVertical,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import type { ServiceWithRates } from '@/types';

// Admin: community services directory.
//
// One page that lists every service (active + inactive together,
// active first), a "New service" button that opens a modal, and an
// inline Edit/Hide/Delete affordance per row. The modal collects
// the service card AND its rate lines in a single submit so an
// empty card never lands in the directory.

interface RateForm {
  /** local key for stable React lists; not sent. */
  key: string;
  label: string;
  rate_rupees: string;
  unit_label: string;
  note: string;
}

interface ServiceForm {
  id?: string;
  name: string;
  category: string;
  description: string;
  vendor_name: string;
  vendor_phone: string;
  vendor_whatsapp: string;
  vendor_email: string;
  image_url: string;
  display_order: number;
  is_active: boolean;
  rates: RateForm[];
}

const COMMON_CATEGORIES = [
  'Cleaning',
  'Laundry',
  'Security',
  'Repairs',
  'Wellness',
  'Food',
  'Transport',
  'Other',
];

function emptyRate(): RateForm {
  return {
    key: Math.random().toString(36).slice(2),
    label: '',
    rate_rupees: '',
    unit_label: '',
    note: '',
  };
}

function emptyForm(): ServiceForm {
  return {
    name: '',
    category: 'Cleaning',
    description: '',
    vendor_name: '',
    vendor_phone: '',
    vendor_whatsapp: '',
    vendor_email: '',
    image_url: '',
    display_order: 100,
    is_active: true,
    rates: [emptyRate()],
  };
}

function formFromService(s: ServiceWithRates): ServiceForm {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    description: s.description ?? '',
    vendor_name: s.vendor_name ?? '',
    vendor_phone: s.vendor_phone ?? '',
    vendor_whatsapp: s.vendor_whatsapp ?? '',
    vendor_email: s.vendor_email ?? '',
    image_url: s.image_url ?? '',
    display_order: s.display_order,
    is_active: s.is_active,
    rates:
      s.rates.length === 0
        ? [emptyRate()]
        : s.rates.map((r) => ({
            key: r.id,
            label: r.label,
            rate_rupees: r.rate_paise === null ? '' : (r.rate_paise / 100).toString(),
            unit_label: r.unit_label ?? '',
            note: r.note ?? '',
          })),
  };
}

function rupeesToPaise(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 100);
}

function formatRate(p: number | null, unit: string | null, note: string | null): string {
  const amount = p === null ? '—' : `₹${(p / 100).toLocaleString('en-IN')}`;
  const u = unit ? ` ${unit}` : '';
  const n = note ? ` ${note}` : '';
  return `${amount}${u}${n}`;
}

export default function AdminServicesPage() {
  const [services, setServices] = useState<ServiceWithRates[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ServiceForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/services', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load services');
      setServices((data.services ?? []) as ServiceWithRates[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => set.add(s.category));
    return ['all', ...Array.from(set).sort()];
  }, [services]);

  const visible = useMemo(() => {
    if (filterCategory === 'all') return services;
    return services.filter((s) => s.category === filterCategory);
  }, [services, filterCategory]);

  function openNew() {
    setEditing(emptyForm());
  }

  function openEdit(s: ServiceWithRates) {
    setEditing(formFromService(s));
  }

  async function save() {
    if (!editing) return;
    const name = editing.name.trim();
    const category = editing.category.trim();
    if (!name) {
      toast.error('Name is required.');
      return;
    }
    if (!category) {
      toast.error('Category is required.');
      return;
    }

    const rates: { label: string; rate_paise: number | null; unit_label: string | null; note: string | null }[] = [];
    for (const [i, r] of editing.rates.entries()) {
      const label = r.label.trim();
      if (!label) {
        toast.error(`Rate #${i + 1}: label is required.`);
        return;
      }
      const paise = rupeesToPaise(r.rate_rupees);
      if (Number.isNaN(paise)) {
        toast.error(`Rate #${i + 1}: amount must be a positive number, or blank for "rate on request".`);
        return;
      }
      rates.push({
        label,
        rate_paise: paise,
        unit_label: r.unit_label.trim() || null,
        note: r.note.trim() || null,
      });
    }

    setSaving(true);
    try {
      const payload = {
        name,
        category,
        description: editing.description.trim() || null,
        vendor_name: editing.vendor_name.trim() || null,
        vendor_phone: editing.vendor_phone.trim() || null,
        vendor_whatsapp: editing.vendor_whatsapp.trim() || null,
        vendor_email: editing.vendor_email.trim() || null,
        image_url: editing.image_url.trim() || null,
        display_order: editing.display_order,
        is_active: editing.is_active,
        rates,
      };
      const res = editing.id
        ? await fetch(`/api/admin/services/${editing.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/admin/services', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save');
      toast.success(editing.id ? 'Service updated' : 'Service created');
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: ServiceWithRates) {
    try {
      const res = await fetch(`/api/admin/services/${s.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active: !s.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      toast.success(s.is_active ? 'Hidden from residents' : 'Visible to residents');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function remove(s: ServiceWithRates) {
    if (!confirm(`Delete "${s.name}"? This will also remove its ${s.rates.length} rate line(s). Use Hide instead if you might want it back.`)) {
      return;
    }
    setDeleting(s.id);
    try {
      const res = await fetch(`/api/admin/services/${s.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      toast.success('Service deleted');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Briefcase size={22} className="text-[#1B5E20]" />
            <h1 className="text-2xl font-bold text-gray-900">Services Directory</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Curate the &quot;yellow pages&quot; residents see at <span className="font-mono text-xs">/dashboard/services</span>. Each card holds a vendor contact and any number of rate lines.
          </p>
        </div>
        <Button onClick={openNew} className="shrink-0">
          <Plus size={16} className="mr-1" />
          New service
        </Button>
      </div>

      {categories.length > 2 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setFilterCategory(c)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filterCategory === c
                  ? 'bg-[#1B5E20] text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {c === 'all' ? `All (${services.length})` : c}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <Briefcase className="mx-auto text-gray-300 mb-3" size={36} />
          <p className="text-sm text-gray-500">No services yet. Tap &quot;New service&quot; to add the first one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((s) => (
            <div
              key={s.id}
              className={`rounded-xl border p-4 transition-shadow ${
                s.is_active ? 'bg-white border-gray-200 hover:shadow-sm' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex items-start gap-3">
                {s.image_url ? (
                  <img
                    src={s.image_url}
                    alt=""
                    className="h-14 w-14 rounded-lg object-cover bg-gray-100 flex-shrink-0"
                  />
                ) : (
                  <div className="h-14 w-14 rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center flex-shrink-0">
                    <Briefcase size={22} className="text-[#1B5E20]" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="font-semibold text-gray-900 truncate">{s.name}</h3>
                    <span className="text-xs text-gray-500">{s.category}</span>
                    {!s.is_active && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                        Hidden
                      </span>
                    )}
                  </div>
                  {s.description && (
                    <p className="text-sm text-gray-600 mt-1 line-clamp-2">{s.description}</p>
                  )}
                  {s.rates.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.rates.slice(0, 6).map((r) => (
                        <span
                          key={r.id}
                          className="inline-flex items-baseline gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 text-xs"
                        >
                          <span className="font-medium">{r.label}</span>
                          <span className="text-emerald-700">— {formatRate(r.rate_paise, r.unit_label, r.note)}</span>
                        </span>
                      ))}
                      {s.rates.length > 6 && (
                        <span className="text-xs text-gray-500">+{s.rates.length - 6} more</span>
                      )}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                    {s.vendor_name && <span>{s.vendor_name}</span>}
                    {s.vendor_phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone size={11} />
                        {s.vendor_phone}
                      </span>
                    )}
                    {s.vendor_whatsapp && (
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle size={11} />
                        {s.vendor_whatsapp}
                      </span>
                    )}
                    {s.vendor_email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail size={11} />
                        {s.vendor_email}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => openEdit(s)}
                    className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => toggleActive(s)}
                    className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600"
                    title={s.is_active ? 'Hide from residents' : 'Show to residents'}
                  >
                    {s.is_active ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    onClick={() => remove(s)}
                    disabled={deleting === s.id}
                    className="p-1.5 rounded-md hover:bg-red-50 text-red-600 disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ServiceModal
          form={editing}
          onChange={setEditing}
          onSubmit={save}
          onClose={() => setEditing(null)}
          saving={saving}
        />
      )}
    </div>
  );
}

interface ModalProps {
  form: ServiceForm;
  onChange: (form: ServiceForm) => void;
  onSubmit: () => void;
  onClose: () => void;
  saving: boolean;
}

function ServiceModal({ form, onChange, onSubmit, onClose, saving }: ModalProps) {
  function set<K extends keyof ServiceForm>(key: K, value: ServiceForm[K]) {
    onChange({ ...form, [key]: value });
  }

  function setRate(idx: number, patch: Partial<RateForm>) {
    const rates = form.rates.slice();
    rates[idx] = { ...rates[idx], ...patch };
    onChange({ ...form, rates });
  }

  function addRate() {
    onChange({ ...form, rates: [...form.rates, emptyRate()] });
  }

  function removeRate(idx: number) {
    if (form.rates.length === 1) {
      onChange({ ...form, rates: [emptyRate()] });
      return;
    }
    onChange({ ...form, rates: form.rates.filter((_, i) => i !== idx) });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">
            {form.id ? 'Edit service' : 'New service'}
          </h2>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Name *</label>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Watchman duty"
                maxLength={80}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Category *</label>
              <select
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
              >
                {COMMON_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">Description (optional)</label>
            <Textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What does the vendor offer? Hours, location, anything residents should know."
              rows={2}
              maxLength={500}
            />
          </div>

          <div className="rounded-lg bg-gray-50 p-3 space-y-3">
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Vendor contact</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Vendor name</label>
                <Input
                  value={form.vendor_name}
                  onChange={(e) => set('vendor_name', e.target.value)}
                  placeholder="Ramesh"
                  maxLength={80}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Phone</label>
                <Input
                  value={form.vendor_phone}
                  onChange={(e) => set('vendor_phone', e.target.value)}
                  placeholder="+91 98765 43210"
                  maxLength={20}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">WhatsApp</label>
                <Input
                  value={form.vendor_whatsapp}
                  onChange={(e) => set('vendor_whatsapp', e.target.value)}
                  placeholder="+91 98765 43210"
                  maxLength={20}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Email</label>
                <Input
                  value={form.vendor_email}
                  onChange={(e) => set('vendor_email', e.target.value)}
                  placeholder="ramesh@example.com"
                  maxLength={120}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                <ImageIcon size={11} />
                Image URL (optional)
              </label>
              <Input
                value={form.image_url}
                onChange={(e) => set('image_url', e.target.value)}
                placeholder="https://..."
                maxLength={500}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Rates</div>
              <button
                onClick={addRate}
                type="button"
                className="text-xs font-semibold text-[#1B5E20] hover:underline inline-flex items-center gap-1"
              >
                <Plus size={12} />
                Add rate line
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Add one row per priced item. Leave the amount blank for &quot;rate on request&quot;.
            </p>
            <div className="space-y-2">
              {form.rates.map((r, i) => (
                <div key={r.key} className="rounded-lg border border-gray-200 p-2 bg-white">
                  <div className="flex items-center gap-2">
                    <GripVertical size={14} className="text-gray-300 flex-shrink-0" />
                    <Input
                      value={r.label}
                      onChange={(e) => setRate(i, { label: e.target.value })}
                      placeholder="Shirt"
                      maxLength={60}
                      className="flex-1"
                    />
                    <button
                      onClick={() => removeRate(i)}
                      type="button"
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 ml-6">
                    <div>
                      <label className="text-[10px] text-gray-500 block">₹</label>
                      <Input
                        value={r.rate_rupees}
                        onChange={(e) => setRate(i, { rate_rupees: e.target.value })}
                        placeholder="10"
                        type="number"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block">Unit</label>
                      <Input
                        value={r.unit_label}
                        onChange={(e) => setRate(i, { unit_label: e.target.value })}
                        placeholder="/shirt"
                        maxLength={30}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block">Note</label>
                      <Input
                        value={r.note}
                        onChange={(e) => setRate(i, { note: e.target.value })}
                        placeholder="(both paths)"
                        maxLength={100}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Display order</label>
              <Input
                type="number"
                value={form.display_order}
                onChange={(e) => set('display_order', Number(e.target.value) || 100)}
              />
              <p className="text-[10px] text-gray-400 mt-0.5">Lower = appears first.</p>
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => set('is_active', e.target.checked)}
                  className="rounded"
                />
                Visible to residents
              </label>
            </div>
          </div>
        </div>
        <div className="px-4 sm:px-6 py-3 border-t bg-gray-50 flex justify-end gap-2 sticky bottom-0">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? 'Saving…' : form.id ? 'Save changes' : 'Create service'}
          </Button>
        </div>
      </div>
    </div>
  );
}
