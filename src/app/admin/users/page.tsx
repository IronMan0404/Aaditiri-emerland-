'use client';
import { useEffect, useMemo, useState } from 'react';
import { Shield, ShieldOff, CheckCircle, Search, X, Pencil, AlertTriangle, Bot, Car, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import type { Profile } from '@/types';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import VehiclesEditor, { type VehicleDraft } from '@/components/ui/VehiclesEditor';

type ResidentFilter = 'owner' | 'tenant' | 'unspecified';
const FILTER_OPTIONS: { id: ResidentFilter; label: string; emoji: string }[] = [
  { id: 'owner', label: 'Owners', emoji: '🏠' },
  { id: 'tenant', label: 'Tenants', emoji: '🔑' },
  { id: 'unspecified', label: 'Unspecified', emoji: '❓' },
];

interface EditForm {
  full_name: string;
  phone: string;
  flat_number: string;
  resident_type: '' | 'owner' | 'tenant';
  role: 'admin' | 'user';
  is_approved: boolean;
  is_bot: boolean;
}

function emptyForm(): EditForm {
  return { full_name: '', phone: '', flat_number: '', resident_type: '', role: 'user', is_approved: false, is_bot: false };
}

function profileToForm(u: Profile): EditForm {
  return {
    full_name: u.full_name ?? '',
    phone: u.phone ?? '',
    flat_number: u.flat_number ?? '',
    resident_type: (u.resident_type ?? '') as EditForm['resident_type'],
    role: u.role,
    is_approved: u.is_approved,
    is_bot: Boolean(u.is_bot),
  };
}

export default function AdminUsersPage() {
  const { profile: currentAdmin } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [residentFilter, setResidentFilter] = useState<Set<ResidentFilter>>(new Set());
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(emptyForm());
  const [editVehicles, setEditVehicles] = useState<VehicleDraft[]>([]);
  const [confirmSelfDemote, setConfirmSelfDemote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vehiclesByUser, setVehiclesByUser] = useState<Record<string, VehicleDraft[]>>({});

  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const supabase = createClient();

  const fetchUsers = async () => {
    const [{ data: profilesData, error }, { data: vehiclesData }] = await Promise.all([
      supabase.from('profiles').select('*').order('is_approved').order('created_at', { ascending: false }),
      supabase.from('vehicles').select('id, user_id, number, type').order('created_at'),
    ]);
    if (error) toast.error(error.message);
    if (profilesData) setUsers(profilesData);
    if (vehiclesData) {
      const grouped: Record<string, VehicleDraft[]> = {};
      for (const v of vehiclesData) {
        const uid = (v as { user_id: string }).user_id;
        if (!grouped[uid]) grouped[uid] = [];
        grouped[uid].push({ id: (v as { id: string }).id, number: (v as { number: string }).number, type: (v as { type: VehicleDraft['type'] }).type });
      }
      setVehiclesByUser(grouped);
    }
    setLoading(false);
  };
  useEffect(() => { fetchUsers(); }, []);

  const pending = useMemo(() => users.filter(u => !u.is_approved), [users]);

  const typeCounts = useMemo(() => {
    const base = tab === 'pending' ? pending : users;
    return {
      owner: base.filter(u => u.resident_type === 'owner').length,
      tenant: base.filter(u => u.resident_type === 'tenant').length,
      unspecified: base.filter(u => !u.resident_type).length,
    };
  }, [users, pending, tab]);

  const displayed = useMemo(() => {
    const base = tab === 'pending' ? pending : users;
    const q = search.trim().toLowerCase();
    return base.filter((u) => {
      if (residentFilter.size > 0) {
        const bucket: ResidentFilter = u.resident_type === 'owner' ? 'owner' : u.resident_type === 'tenant' ? 'tenant' : 'unspecified';
        if (!residentFilter.has(bucket)) return false;
      }
      if (!q) return true;
      const platesText = (vehiclesByUser[u.id] ?? []).map((v) => v.number).join(' ').toLowerCase();
      return (
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        (u.flat_number ?? '').toLowerCase().includes(q) ||
        platesText.includes(q)
      );
    });
  }, [users, pending, tab, residentFilter, search, vehiclesByUser]);

  function toggleResidentFilter(id: ResidentFilter) {
    setResidentFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setResidentFilter(new Set());
    setSearch('');
  }

  const hasActiveFilters = residentFilter.size > 0 || search.trim().length > 0;

  function openEdit(user: Profile) {
    setEditing(user);
    setEditForm(profileToForm(user));
    setEditVehicles(vehiclesByUser[user.id] ?? []);
    setConfirmSelfDemote(false);
  }
  function closeEdit() {
    setEditing(null);
    setEditVehicles([]);
    setConfirmSelfDemote(false);
  }

  const isEditingSelf = !!editing && !!currentAdmin && editing.id === currentAdmin.id;
  const isSelfDemote = isEditingSelf && editing?.role === 'admin' && editForm.role === 'user';
  const blockSelfDemote = isSelfDemote && !confirmSelfDemote;

  async function approveUser(user: Profile) {
    const { error } = await supabase.from('profiles').update({ is_approved: true }).eq('id', user.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${user.full_name} approved!`);
    fetchUsers();
  }

  async function toggleRoleQuick(user: Profile) {
    if (currentAdmin?.id === user.id) {
      toast.error('Use Edit to change your own role (with confirmation).');
      return;
    }
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    if (!confirm(`Make ${user.full_name} an ${newRole}?`)) return;
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', user.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Role updated to ${newRole}`);
    fetchUsers();
  }

  async function toggleStatus(user: Profile) {
    const { error } = await supabase.from('profiles').update({ is_approved: !user.is_approved }).eq('id', user.id);
    if (error) { toast.error(error.message); return; }
    toast.success(user.is_approved ? 'User deactivated' : 'User activated');
    fetchUsers();
  }

  async function setResidentType(user: Profile, type: 'owner' | 'tenant') {
    const { error } = await supabase.from('profiles').update({ resident_type: type }).eq('id', user.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${user.full_name} marked as ${type}`);
    fetchUsers();
  }

  function openDelete(user: Profile) {
    setDeleteTarget(user);
    setDeleteConfirmText('');
  }
  function closeDelete() {
    setDeleteTarget(null);
    setDeleteConfirmText('');
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteConfirmText.trim().toLowerCase() !== 'delete') {
      toast.error('Type DELETE to confirm');
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}/delete`, {
        method: 'POST',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || `Delete failed (${res.status})`);
        return;
      }
      toast.success(`${deleteTarget.full_name} permanently deleted`);
      closeDelete();
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setDeleting(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editForm.full_name.trim()) { toast.error('Name is required'); return; }
    if (blockSelfDemote) { toast.error('Confirm the self-demotion checkbox first'); return; }
    setSaving(true);

    // Enforce single-bot: if we're tagging this user as the bot, clear is_bot on
    // every other row first so there's only ever one "Aaditri Bot" at a time.
    if (editForm.is_bot && !editing.is_bot) {
      const { error: clearError } = await supabase
        .from('profiles')
        .update({ is_bot: false })
        .eq('is_bot', true)
        .neq('id', editing.id);
      if (clearError) {
        setSaving(false);
        toast.error(`Couldn't clear existing bot: ${clearError.message}`);
        return;
      }
    }

    const payload = {
      full_name: editForm.full_name.trim(),
      phone: editForm.phone.trim() || null,
      flat_number: editForm.flat_number.trim() || null,
      resident_type: editForm.resident_type === '' ? null : editForm.resident_type,
      role: editForm.role,
      is_approved: editForm.is_approved,
      is_bot: editForm.is_bot,
    };
    const { error } = await supabase.from('profiles').update(payload).eq('id', editing.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${payload.full_name} updated`);
    closeEdit();
    fetchUsers();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Manage Users</h1>
        {pending.length > 0 && (
          <span className="bg-red-100 text-red-600 text-xs font-bold px-3 py-1 rounded-full">{pending.length} pending</span>
        )}
      </div>

      <div className="flex bg-gray-100 rounded-xl p-1 mb-3">
        {(['pending', 'all'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            {t === 'pending' ? `Pending Approval (${pending.length})` : `All Users (${users.length})`}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, flat, or vehicle…"
          aria-label="Search users"
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

      {/* Resident-type filter chips */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {FILTER_OPTIONS.map((opt) => {
          const active = residentFilter.has(opt.id);
          const count = typeCounts[opt.id];
          return (
            <button
              key={opt.id}
              onClick={() => toggleResidentFilter(opt.id)}
              aria-label={`${active ? 'Remove' : 'Apply'} filter: ${opt.label}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                active
                  ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20] hover:text-[#1B5E20]'
              }`}
            >
              <span aria-hidden>{opt.emoji}</span>
              <span>{opt.label}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                {count}
              </span>
            </button>
          );
        })}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          >
            <X size={12} />
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : displayed.length === 0 ? (
        <p className="text-center text-gray-400 py-12">
          {hasActiveFilters
            ? 'No users match your filters'
            : tab === 'pending' ? 'No pending approvals 🎉' : 'No users found'}
        </p>
      ) : (
        <>
          {hasActiveFilters && (
            <p className="text-xs text-gray-400 mb-2">
              Showing {displayed.length} of {tab === 'pending' ? pending.length : users.length}
            </p>
          )}
          <div className="space-y-2">
            {displayed.map((u) => {
              const initials = u.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
              const isSelf = currentAdmin?.id === u.id;
              return (
                <div key={u.id} className={`bg-white rounded-xl p-4 shadow-sm flex items-center gap-3 ${!u.is_approved ? 'border-l-4 border-amber-400' : ''}`}>
                  {u.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-green-100 text-[#1B5E20] flex items-center justify-center font-bold text-sm flex-shrink-0">{initials}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900 truncate">{u.full_name}</span>
                      {isSelf && <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">YOU</span>}
                      {u.role === 'admin' && <span className="text-[10px] font-bold bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">ADMIN</span>}
                      {u.is_bot && <span className="inline-flex items-center gap-0.5 text-[10px] font-bold bg-[#1B5E20] text-white px-2 py-0.5 rounded-full"><Bot size={10} />BOT</span>}
                      {u.resident_type ? (
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          title="Click to change resident type"
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${u.resident_type === 'owner' ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}
                        >
                          {u.resident_type === 'owner' ? '🏠 Owner' : '🔑 Tenant'}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-[10px] font-semibold text-gray-400">Set type:</span>
                          <button
                            type="button"
                            onClick={() => setResidentType(u, 'owner')}
                            title="Mark as owner"
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-blue-200 text-blue-700 hover:bg-blue-50"
                          >
                            🏠 Owner
                          </button>
                          <button
                            type="button"
                            onClick={() => setResidentType(u, 'tenant')}
                            title="Mark as tenant"
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white border border-purple-200 text-purple-700 hover:bg-purple-50"
                          >
                            🔑 Tenant
                          </button>
                        </span>
                      )}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${u.is_approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {u.is_approved ? 'Active' : 'Pending'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 truncate">{u.email}{u.flat_number ? ` · Flat ${u.flat_number}` : ''}</p>
                    {(vehiclesByUser[u.id]?.length ?? 0) > 0 && (
                      <p className="text-xs text-gray-400 truncate flex items-center gap-1">
                        <Car size={11} className="text-[#1B5E20] shrink-0" />
                        <span className="font-mono tracking-wide">{vehiclesByUser[u.id]!.map((v) => v.number).join(', ')}</span>
                      </p>
                    )}
                    <p className="text-xs text-gray-300">Joined {format(new Date(u.created_at), 'dd MMM yyyy')}</p>
                  </div>
                  <div className="flex flex-col gap-1 items-end flex-shrink-0">
                    {!u.is_approved && (
                      <button onClick={() => approveUser(u)} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition-colors">
                        <CheckCircle size={13} />Approve
                      </button>
                    )}
                    <div className="flex gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        title="Edit user"
                        aria-label={`Edit ${u.full_name}`}
                        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-50 hover:text-[#1B5E20] transition-colors"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => toggleRoleQuick(u)}
                        disabled={isSelf}
                        title={isSelf ? 'Use Edit to change your own role' : (u.role === 'admin' ? 'Remove admin' : 'Make admin')}
                        className={`p-1.5 rounded-lg transition-colors ${isSelf ? 'text-gray-300 cursor-not-allowed' : (u.role === 'admin' ? 'text-yellow-600 hover:bg-yellow-50' : 'text-gray-400 hover:bg-gray-50 hover:text-[#1B5E20]')}`}
                      >
                        {u.role === 'admin' ? <ShieldOff size={15} /> : <Shield size={15} />}
                      </button>
                      {u.is_approved && !isSelf && (
                        <button onClick={() => toggleStatus(u)} className="px-2 py-1 text-xs rounded-lg font-semibold text-red-500 hover:bg-red-50 transition-colors">
                          Deactivate
                        </button>
                      )}
                      {!isSelf && (
                        <button
                          onClick={() => openDelete(u)}
                          title={`Delete ${u.full_name} permanently`}
                          aria-label={`Delete ${u.full_name}`}
                          className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Edit User modal */}
      <Modal open={!!editing} onClose={closeEdit} title={editing ? `Edit ${editing.full_name}` : 'Edit user'}>
        {editing && (
          <form onSubmit={saveEdit} className="space-y-3">
            {isEditingSelf && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600">
                You're editing your <strong>own</strong> profile. Changes here update both this admin record and your own session.
              </div>
            )}

            <Input label="Full Name *" value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} placeholder="John Smith" />
            <Input label="Email" value={editing.email} disabled placeholder="(read-only)" />
            <Input label="Phone" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="+91 98765 43210" />
            <Input label="Flat Number" value={editForm.flat_number} onChange={(e) => setEditForm({ ...editForm, flat_number: e.target.value })} placeholder="A-101" />
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5 flex items-center gap-1.5">
                <Car size={14} className="text-[#1B5E20]" />Vehicles
                <span className="ml-auto text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{editVehicles.length}</span>
              </label>
              <VehiclesEditor
                vehicles={editVehicles}
                onChange={(next) => {
                  setEditVehicles(next);
                  setVehiclesByUser((prev) => ({ ...prev, [editing.id]: next }));
                }}
                userId={editing.id}
              />
            </div>

            {/* Resident Type */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">Resident Type</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v: '', label: 'Unspecified' },
                  { v: 'owner', label: '🏠 Owner' },
                  { v: 'tenant', label: '🔑 Tenant' },
                ] as const).map((opt) => {
                  const active = editForm.resident_type === opt.v;
                  return (
                    <button
                      key={opt.v || 'none'}
                      type="button"
                      onClick={() => setEditForm({ ...editForm, resident_type: opt.v as EditForm['resident_type'] })}
                      className={`py-2 rounded-xl text-xs font-semibold border transition-all ${active ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20]'}`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Role */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">Role</label>
              <div className="grid grid-cols-2 gap-2">
                {(['user', 'admin'] as const).map((r) => {
                  const active = editForm.role === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setEditForm({ ...editForm, role: r })}
                      className={`py-2 rounded-xl text-xs font-semibold border transition-all capitalize ${active ? (r === 'admin' ? 'bg-yellow-500 text-white border-yellow-500' : 'bg-[#1B5E20] text-white border-[#1B5E20]') : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B5E20]'}`}
                    >
                      {r === 'admin' ? 'Admin' : 'Resident'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Approval */}
            <label className="flex items-center justify-between bg-gray-50 px-3 py-2.5 rounded-xl">
              <span className="text-sm font-medium text-gray-700">Approved (can sign in)</span>
              <input
                type="checkbox"
                checked={editForm.is_approved}
                onChange={(e) => setEditForm({ ...editForm, is_approved: e.target.checked })}
                className="h-4 w-4 accent-[#1B5E20]"
              />
            </label>

            {/* Aaditri Bot */}
            <label className={`flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl border ${editForm.is_bot ? 'bg-green-50 border-[#1B5E20]/30' : 'bg-gray-50 border-transparent'}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                  <Bot size={14} className="text-[#1B5E20]" />
                  Tag as Aaditri Bot
                </div>
                <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                  Messages sent from the admin bot page will be posted as this user. Only one bot is allowed — tagging this user will <strong>untag any other bot</strong>.
                </p>
              </div>
              <input
                type="checkbox"
                checked={editForm.is_bot}
                onChange={(e) => setEditForm({ ...editForm, is_bot: e.target.checked })}
                className="h-4 w-4 accent-[#1B5E20] mt-1"
              />
            </label>

            {/* Self-demote warning */}
            {isSelfDemote && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-red-700">
                    <p className="font-bold mb-0.5">You are removing your own admin role.</p>
                    <p>If no other admin exists, you will <strong>lose access</strong> to this admin panel and will need another admin (or direct DB access) to restore it.</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-red-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmSelfDemote}
                    onChange={(e) => setConfirmSelfDemote(e.target.checked)}
                    className="h-4 w-4 accent-red-600"
                  />
                  I understand and want to demote myself
                </label>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeEdit} className="flex-1">Cancel</Button>
              <Button type="submit" loading={saving} disabled={blockSelfDemote} className="flex-1">Save changes</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete user modal */}
      <Modal open={!!deleteTarget} onClose={closeDelete} title="Delete user permanently?">
        {deleteTarget && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-red-700 leading-snug">
                <p className="font-bold mb-1">This cannot be undone.</p>
                <p>
                  All of <strong>{deleteTarget.full_name}</strong>'s data will be removed:
                  profile, vehicles, family members, pets, RSVPs, bookings,
                  uploaded photos, and login credentials. The email{' '}
                  <span className="font-mono">{deleteTarget.email}</span> will
                  become available for re-registration.
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="delete-confirm" className="text-sm font-medium text-gray-700 block mb-1.5">
                Type <span className="font-mono font-bold text-red-600">DELETE</span> to confirm
              </label>
              <input
                id="delete-confirm"
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeDelete} className="flex-1">Cancel</Button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting || deleteConfirmText.trim().toLowerCase() !== 'delete'}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting…' : (<><Trash2 size={14} />Delete forever</>)}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
