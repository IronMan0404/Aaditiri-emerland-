'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Award, Plus, Pencil, Trash2, Save, X, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import AdminTagBadges, { refreshAdminTagBadges } from '@/components/admin-tags/AdminTagBadges';
import type { AdminTag } from '@/types/admin-tags';

interface AdminProfile {
  id: string;
  full_name: string | null;
  flat_number: string | null;
  email: string | null;
  role: string;
}

export default function AdminTagsPage() {
  const router = useRouter();
  const { isAdmin, mounted } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [tags, setTags] = useState<AdminTag[]>([]);
  const [admins, setAdmins] = useState<AdminProfile[]>([]);
  const [adminTagMap, setAdminTagMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [editingTag, setEditingTag] = useState<AdminTag | null>(null);
  const [assigningProfile, setAssigningProfile] = useState<AdminProfile | null>(null);

  // Auth-gate the page client-side. The server-side proxy already
  // protects /admin/* but a redirect feels nicer than a 403 dump.
  useEffect(() => {
    if (mounted && !isAdmin) router.push('/dashboard');
  }, [mounted, isAdmin, router]);

  async function load() {
    setLoading(true);
    const [tagsRes, adminsRes, mappingsRes] = await Promise.all([
      fetch('/api/admin/admin-tags', { cache: 'no-store' }),
      // We read profiles directly with the client (RLS lets every
      // authenticated user read profiles in this app). Filtering on
      // role='admin' here so the assignment list only shows people
      // who are actually eligible.
      supabase.from('profiles').select('id, full_name, flat_number, email, role')
        .eq('role', 'admin').order('full_name', { ascending: true }),
      supabase.from('profile_admin_tags').select('profile_id, tag_id'),
    ]);

    const tagsJson = await tagsRes.json().catch(() => ({ tags: [] }));
    setTags(tagsJson.tags ?? []);
    setAdmins((adminsRes.data ?? []) as AdminProfile[]);

    const map: Record<string, string[]> = {};
    for (const r of (mappingsRes.data ?? []) as Array<{ profile_id: string; tag_id: string }>) {
      (map[r.profile_id] ??= []).push(r.tag_id);
    }
    setAdminTagMap(map);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted || !isAdmin) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-24">
      <header className="flex items-start gap-3 mb-6">
        <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center">
          <Award size={20} className="text-amber-700" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Association tags</h1>
          <p className="text-sm text-gray-500">
            Office-bearer badges (President, Vice President, Secretary, Treasurer …) shown next to admin names across the app. Tags are display-only and do not change permissions.
          </p>
        </div>
      </header>

      {/* Tag library */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Tag library</h2>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus size={14} /> New tag</Button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : tags.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            No tags yet. The default office bearers (President, VP, Secretary, Treasurer) should have been seeded by the migration. If you don&apos;t see them, run <code className="bg-white px-1 rounded">npx supabase db push</code>.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tags.map((t) => (
              <div key={t.id} className="bg-white rounded-xl p-4 shadow-sm flex items-start gap-3">
                <span
                  className="inline-flex items-center gap-1 rounded-full text-white text-xs font-semibold px-2.5 py-1 whitespace-nowrap shrink-0"
                  style={{ backgroundColor: t.color }}
                >
                  {t.icon ? <span aria-hidden>{t.icon}</span> : null}
                  {t.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 truncate">code: <span className="font-mono">{t.code}</span></p>
                  {t.description ? (
                    <p className="text-xs text-gray-600 mt-1 line-clamp-2">{t.description}</p>
                  ) : null}
                  {!t.is_active ? (
                    <p className="text-xs font-semibold text-rose-600 mt-1">INACTIVE</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingTag(t)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                    title="Edit tag"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Admins + their assigned tags */}
      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Users size={14} /> Admins ({admins.length})
        </h2>

        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : admins.length === 0 ? (
          <p className="text-sm text-gray-500">No admins yet.</p>
        ) : (
          <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
            {admins.map((a) => {
              const assigned = adminTagMap[a.id] ?? [];
              const tagObjs = assigned
                .map((id) => tags.find((t) => t.id === id))
                .filter((x): x is AdminTag => Boolean(x));
              return (
                <div key={a.id} className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-gray-900 truncate">
                        {a.full_name ?? a.email ?? a.id}
                      </p>
                      {a.flat_number ? <span className="text-xs text-gray-400">{a.flat_number}</span> : null}
                      <AdminTagBadges profileId={a.id} size="xs" />
                    </div>
                    {tagObjs.length === 0 ? (
                      <p className="text-xs text-gray-400 mt-1">No tags</p>
                    ) : null}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setAssigningProfile(a)}>
                    Manage tags
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <CreateTagModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={async () => { await load(); refreshAdminTagBadges(); }}
      />

      <EditTagModal
        tag={editingTag}
        onClose={() => setEditingTag(null)}
        onSaved={async () => { await load(); refreshAdminTagBadges(); }}
      />

      <AssignTagsModal
        profile={assigningProfile}
        allTags={tags}
        currentTagIds={assigningProfile ? adminTagMap[assigningProfile.id] ?? [] : []}
        onClose={() => setAssigningProfile(null)}
        onSaved={async () => { await load(); refreshAdminTagBadges(); }}
      />
    </div>
  );
}

function CreateTagModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#1B5E20');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [order, setOrder] = useState('100');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCode(''); setLabel(''); setColor('#1B5E20');
    setIcon(''); setDescription(''); setOrder('100');
  }

  async function submit() {
    if (!code.trim() || !label.trim()) {
      toast.error('Code and label are required');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/admin/admin-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.trim(),
        label: label.trim(),
        description: description.trim() || undefined,
        color: color.trim(),
        icon: icon.trim() || undefined,
        display_order: Number(order) || 100,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed to create tag');
      return;
    }
    toast.success('Tag created');
    reset();
    onClose();
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="New association tag">
      <div className="space-y-3">
        <Input label="Label *" placeholder="Joint Secretary" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Input label="Code (lowercase, snake_case) *" placeholder="joint_secretary" value={code} onChange={(e) => setCode(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Colour</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Tag colour"
              className="w-full h-10 border border-gray-300 rounded-xl cursor-pointer"
            />
          </div>
          <Input label="Icon (emoji, optional)" placeholder="🥉" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </div>
        <Input label="Display order" type="number" value={order} onChange={(e) => setOrder(e.target.value)} />
        <Textarea label="Description (optional)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full text-white text-xs font-semibold px-2.5 py-1"
            style={{ backgroundColor: color || '#374151' }}
          >
            {icon ? <span aria-hidden>{icon}</span> : null}
            {label || 'Preview'}
          </span>
          <span className="text-xs text-gray-400">Preview</span>
        </div>
        <Button onClick={submit} loading={submitting} className="w-full"><Save size={14} /> Create tag</Button>
      </div>
    </Modal>
  );
}

function EditTagModal({ tag, onClose, onSaved }: {
  tag: AdminTag | null; onClose: () => void; onSaved: () => void;
}) {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#1B5E20');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [order, setOrder] = useState('100');
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Pre-fill whenever a new tag is opened so the form never carries
  // stale values from the previous tag the admin was editing.
  useEffect(() => {
    if (!tag) return;
    setLabel(tag.label);
    setColor(tag.color);
    setIcon(tag.icon ?? '');
    setDescription(tag.description ?? '');
    setOrder(String(tag.display_order));
    setActive(tag.is_active);
  }, [tag]);

  if (!tag) return null;

  async function submit() {
    if (!tag) return;
    setSubmitting(true);
    const res = await fetch(`/api/admin/admin-tags/${tag.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: label.trim(),
        description,
        color: color.trim(),
        icon: icon.trim() || null,
        display_order: Number(order) || 100,
        is_active: active,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed');
      return;
    }
    toast.success('Tag updated');
    onClose();
    onSaved();
  }

  async function remove() {
    if (!tag) return;
    if (!confirm(`Delete tag "${tag.label}"? This will remove it from every admin currently wearing it.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/admin/admin-tags/${tag.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed');
      return;
    }
    toast.success('Tag deleted');
    onClose();
    onSaved();
  }

  return (
    <Modal open={!!tag} onClose={onClose} title={`Edit tag: ${tag.label}`}>
      <div className="space-y-3">
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <p className="text-xs text-gray-500">Code <span className="font-mono">{tag.code}</span> cannot be changed.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Colour</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Tag colour"
              className="w-full h-10 border border-gray-300 rounded-xl cursor-pointer"
            />
          </div>
          <Input label="Icon" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </div>
        <Input label="Display order" type="number" value={order} onChange={(e) => setOrder(e.target.value)} />
        <Textarea label="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (uncheck to hide without deleting)
        </label>
        <div className="flex items-center gap-2">
          <Button onClick={submit} loading={submitting} className="flex-1"><Save size={14} /> Save</Button>
          <Button onClick={remove} loading={deleting} variant="outline" className="text-rose-600 border-rose-300">
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AssignTagsModal({
  profile, allTags, currentTagIds, onClose, onSaved,
}: {
  profile: AdminProfile | null;
  allTags: AdminTag[];
  currentTagIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) setSelected(currentTagIds);
  }, [profile, currentTagIds]);

  if (!profile) return null;

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function save() {
    if (!profile) return;
    setSaving(true);
    const res = await fetch(`/api/admin/profiles/${profile.id}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_ids: selected }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed');
      return;
    }
    toast.success('Tags updated');
    onClose();
    onSaved();
  }

  return (
    <Modal open={!!profile} onClose={onClose} title={`Tags for ${profile.full_name ?? profile.email ?? 'admin'}`}>
      <div className="space-y-3">
        {allTags.length === 0 ? (
          <p className="text-sm text-gray-500">No tags defined yet. Create some first.</p>
        ) : (
          <div className="space-y-2">
            {allTags.filter((t) => t.is_active).map((t) => {
              const on = selected.includes(t.id);
              return (
                <label key={t.id} className={`flex items-center gap-3 p-2 rounded-xl border cursor-pointer ${on ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(t.id)}
                    className="w-4 h-4"
                  />
                  <span
                    className="inline-flex items-center gap-1 rounded-full text-white text-xs font-semibold px-2 py-0.5"
                    style={{ backgroundColor: t.color }}
                  >
                    {t.icon ? <span aria-hidden>{t.icon}</span> : null}
                    {t.label}
                  </span>
                  {t.description ? (
                    <span className="text-xs text-gray-500 truncate">{t.description}</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={save} loading={saving} className="flex-1"><Save size={14} /> Save</Button>
          <Button variant="outline" onClick={onClose}><X size={14} /> Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
