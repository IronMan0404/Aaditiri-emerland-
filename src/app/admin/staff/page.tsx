'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Plus,
  Shield,
  Sparkles,
  RotateCcw,
  Search,
  UserCog,
  Edit2,
  KeyRound,
  X,
  Copy,
  CheckCircle2,
  Phone,
  MapPin,
  Calendar as CalIcon,
  Clock,
  Loader2,
  PowerOff,
  Power,
  AlertCircle,
  TrendingUp,
  Activity,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  KpiTile,
  LineChart,
  BarRows,
  BarHistogram,
} from '@/components/admin/Charts';

// /admin/staff
//
// Admin-only management for security guards + housekeepers. Two
// tabs: "Roster" (CRUD on staff) and "Attendance" (who's on duty
// now + last 30 days summary).
//
// All write paths go through the API endpoints (/api/admin/staff,
// /api/admin/staff/[id], /api/admin/staff/[id]/reset-password)
// because creating a staff login requires the service-role admin
// client to provision the auth.users row.

type StaffRole = 'security' | 'housekeeping';
type Tab = 'roster' | 'attendance';

interface StaffRow {
  id: string;
  staff_role: StaffRole;
  full_name: string;
  phone: string;
  address: string | null;
  photo_url: string | null;
  is_active: boolean;
  hired_on: string | null;
  created_at: string;
  updated_at: string;
  on_duty_since: string | null;
}

interface CreateForm {
  full_name: string;
  phone: string;
  staff_role: StaffRole;
  address: string;
  hired_on: string;
}

const EMPTY_FORM: CreateForm = {
  full_name: '',
  phone: '',
  staff_role: 'security',
  address: '',
  hired_on: '',
};

const ROLE_BADGE: Record<StaffRole, { label: string; cls: string; Icon: typeof Shield }> = {
  security: { label: 'Security', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: Shield },
  housekeeping: { label: 'Housekeeping', cls: 'bg-sky-50 text-sky-700 border-sky-200', Icon: Sparkles },
};

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatRelative(iso: string, nowMs: number | null): string {
  if (nowMs === null) return formatTime(iso);
  const diffMs = nowMs - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins === 0 ? `${hours}h ago` : `${hours}h ${remMins}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminStaffPage() {
  const [tab, setTab] = useState<Tab>('roster');
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | StaffRole>('all');
  const [showInactive, setShowInactive] = useState(false);

  // Modal state.
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_FORM);
  const [createBusy, setCreateBusy] = useState(false);

  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const [resetting, setResetting] = useState<StaffRow | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  // Reveals the temporary password EXACTLY ONCE. Closing the
  // modal discards it; admin must do another reset to regenerate.
  const [tempPasswordReveal, setTempPasswordReveal] = useState<{
    staffId: string;
    staffName: string;
    password: string;
    isInitial: boolean;
  } | null>(null);

  // Tick state for relative timestamps in the attendance view.
  // Pre-computing nowMs with a setInterval avoids the React 19
  // purity rule violation that direct Date.now() in render causes.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('active', showInactive ? 'false' : 'true');
      if (roleFilter !== 'all') params.set('role', roleFilter);
      const res = await fetch(`/api/admin/staff?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error || 'Could not load staff.');
        return;
      }
      const j = (await res.json()) as { staff: StaffRow[] };
      setStaff(j.staff);
    } catch {
      toast.error('Network error.');
    } finally {
      setLoading(false);
    }
  }, [roleFilter, showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(
      (s) =>
        s.full_name.toLowerCase().includes(q)
        || s.phone.toLowerCase().includes(q)
        || (s.address ?? '').toLowerCase().includes(q),
    );
  }, [staff, search]);

  const onDutyCount = useMemo(
    () => staff.filter((s) => s.on_duty_since !== null).length,
    [staff],
  );

  // ─── Handlers ────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateBusy(true);
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: createForm.full_name.trim(),
          phone: createForm.phone.trim(),
          staff_role: createForm.staff_role,
          address: createForm.address.trim() || null,
          hired_on: createForm.hired_on || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        staff_id?: string;
        temp_password?: string;
      };
      if (!res.ok || !j.ok) {
        toast.error(j.error || 'Could not create staff.');
        return;
      }
      // Reveal the password once.
      if (j.staff_id && j.temp_password) {
        setTempPasswordReveal({
          staffId: j.staff_id,
          staffName: createForm.full_name,
          password: j.temp_password,
          isInitial: true,
        });
      }
      setCreating(false);
      setCreateForm(EMPTY_FORM);
      await load();
    } catch {
      toast.error('Network error.');
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditBusy(true);
    try {
      const res = await fetch(`/api/admin/staff/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: editing.full_name.trim(),
          phone: editing.phone.trim(),
          staff_role: editing.staff_role,
          address: editing.address?.trim() || null,
          hired_on: editing.hired_on || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        toast.error(j.error || 'Could not save changes.');
        return;
      }
      toast.success('Updated.');
      setEditing(null);
      await load();
    } catch {
      toast.error('Network error.');
    } finally {
      setEditBusy(false);
    }
  }

  async function handleToggleActive(row: StaffRow) {
    const verb = row.is_active ? 'Deactivate' : 'Reactivate';
    if (!window.confirm(`${verb} ${row.full_name}?`)) return;
    try {
      const res = await fetch(`/api/admin/staff/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !row.is_active }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error || 'Could not update.');
        return;
      }
      toast.success(`${verb}d.`);
      await load();
    } catch {
      toast.error('Network error.');
    }
  }

  async function handleResetPassword() {
    if (!resetting) return;
    setResetBusy(true);
    try {
      const res = await fetch(`/api/admin/staff/${resetting.id}/reset-password`, {
        method: 'POST',
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        temp_password?: string;
      };
      if (!res.ok || !j.ok || !j.temp_password) {
        toast.error(j.error || 'Could not reset password.');
        return;
      }
      setTempPasswordReveal({
        staffId: resetting.id,
        staffName: resetting.full_name,
        password: j.temp_password,
        isInitial: false,
      });
      setResetting(null);
    } catch {
      toast.error('Network error.');
    } finally {
      setResetBusy(false);
    }
  }

  async function copyPassword(p: string) {
    try {
      await navigator.clipboard.writeText(p);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed — read it manually.');
    }
  }

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <UserCog size={22} className="text-[#1B5E20]" />
          <h1 className="text-2xl font-bold text-gray-900">Manage Staff</h1>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} /> New
        </Button>
      </div>

      {/* Tab strip */}
      <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
        <button
          type="button"
          onClick={() => setTab('roster')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === 'roster' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          Roster
        </button>
        <button
          type="button"
          onClick={() => setTab('attendance')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            tab === 'attendance' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          Attendance
          {onDutyCount > 0 && (
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold">
              {onDutyCount} on duty
            </span>
          )}
        </button>
      </div>

      {tab === 'roster' && (
        <>
          {/* Filters */}
          <div className="bg-white rounded-2xl p-3 shadow-sm mb-3">
            <div className="flex items-center gap-2 mb-2">
              <Search size={14} className="text-gray-400 shrink-0" />
              <input
                type="text"
                placeholder="Search by name, phone, address"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 text-sm bg-transparent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => load()}
                className="text-gray-400 hover:text-gray-600 shrink-0"
                aria-label="Refresh"
              >
                <RotateCcw size={14} />
              </button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(['all', 'security', 'housekeeping'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
                    roleFilter === r
                      ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {r === 'all' ? 'All' : ROLE_BADGE[r].label}
                </button>
              ))}
              <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="accent-[#1B5E20]"
                />
                Show inactive
              </label>
            </div>
          </div>

          {/* List */}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
              <Loader2 className="animate-spin" size={16} /> Loading…
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 shadow-sm text-center">
              <UserCog size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500 mb-3">
                {staff.length === 0
                  ? 'No staff members yet.'
                  : 'No staff match the current filters.'}
              </p>
              {staff.length === 0 && (
                <Button onClick={() => setCreating(true)}>
                  <Plus size={16} /> Add first staff
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredStaff.map((s) => {
                const badge = ROLE_BADGE[s.staff_role];
                return (
                  <div
                    key={s.id}
                    className={`bg-white rounded-2xl p-3 shadow-sm border ${
                      s.is_active ? 'border-transparent' : 'border-gray-200 opacity-70'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                        {s.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.photo_url}
                            alt={s.full_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <badge.Icon size={18} className="text-gray-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {s.full_name}
                          </p>
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full border ${badge.cls}`}
                          >
                            <badge.Icon size={9} />
                            {badge.label}
                          </span>
                          {s.on_duty_since && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700">
                              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                              On duty
                            </span>
                          )}
                          {!s.is_active && (
                            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-gray-200 text-gray-600">
                              Inactive
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 flex items-center gap-1">
                          <Phone size={10} /> {s.phone}
                        </p>
                        {s.address && (
                          <p className="text-[11px] text-gray-500 flex items-center gap-1 truncate">
                            <MapPin size={10} /> {s.address}
                          </p>
                        )}
                        {s.on_duty_since && (
                          <p className="text-[11px] text-emerald-700 flex items-center gap-1 mt-0.5">
                            <Clock size={10} /> Since {formatTime(s.on_duty_since)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-100 -mx-1">
                      <button
                        type="button"
                        onClick={() => setEditing({ ...s })}
                        className="flex-1 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 rounded-lg flex items-center justify-center gap-1"
                      >
                        <Edit2 size={11} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setResetting(s)}
                        className="flex-1 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 rounded-lg flex items-center justify-center gap-1"
                      >
                        <KeyRound size={11} /> Reset password
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(s)}
                        className={`flex-1 py-1.5 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1 ${
                          s.is_active
                            ? 'text-rose-700 hover:bg-rose-50'
                            : 'text-emerald-700 hover:bg-emerald-50'
                        }`}
                      >
                        {s.is_active ? <PowerOff size={11} /> : <Power size={11} />}
                        {s.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'attendance' && (
        <AttendanceView staff={staff} loading={loading} nowMs={nowMs} onRefresh={load} />
      )}

      {/* ─── Create modal ─── */}
      <Modal
        open={creating}
        onClose={() => {
          if (!createBusy) setCreating(false);
        }}
        title="Add staff member"
      >
        <form onSubmit={handleCreate} className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1 block">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {(['security', 'housekeeping'] as const).map((r) => {
                const badge = ROLE_BADGE[r];
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCreateForm((f) => ({ ...f, staff_role: r }))}
                    className={`py-2.5 rounded-xl text-sm font-semibold border flex items-center justify-center gap-1.5 ${
                      createForm.staff_role === r
                        ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <badge.Icon size={14} />
                    {badge.label}
                  </button>
                );
              })}
            </div>
          </div>
          <Input
            label="Full Name *"
            value={createForm.full_name}
            onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
            placeholder="Ramesh Kumar"
          />
          <Input
            label="Phone Number *"
            type="tel"
            value={createForm.phone}
            onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
            placeholder="+91 98765 43210"
          />
          <div>
            <label className="text-xs font-semibold text-gray-700 mb-1 block">
              Address <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={createForm.address}
              onChange={(e) => setCreateForm({ ...createForm, address: e.target.value.slice(0, 500) })}
              placeholder="House 4-12, Boduppal"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent resize-none"
            />
          </div>
          <Input
            label="Hire Date (optional)"
            type="date"
            value={createForm.hired_on}
            onChange={(e) => setCreateForm({ ...createForm, hired_on: e.target.value })}
          />
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 leading-snug">
            A temporary password will be generated and shown to you ONCE on the next screen.
            Read it to the staff member — they sign in with their phone number + this password.
          </p>
          <Button type="submit" loading={createBusy} className="w-full">
            Create staff login
          </Button>
        </form>
      </Modal>

      {/* ─── Edit modal ─── */}
      <Modal
        open={!!editing}
        onClose={() => {
          if (!editBusy) setEditing(null);
        }}
        title="Edit staff member"
      >
        {editing && (
          <form onSubmit={handleSaveEdit} className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">Role</label>
              <div className="grid grid-cols-2 gap-2">
                {(['security', 'housekeeping'] as const).map((r) => {
                  const badge = ROLE_BADGE[r];
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setEditing({ ...editing, staff_role: r })}
                      className={`py-2.5 rounded-xl text-sm font-semibold border flex items-center justify-center gap-1.5 ${
                        editing.staff_role === r
                          ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <badge.Icon size={14} />
                      {badge.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <Input
              label="Full Name *"
              value={editing.full_name}
              onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
            />
            <Input
              label="Phone Number *"
              type="tel"
              value={editing.phone}
              onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
            />
            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                Address <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={editing.address ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, address: e.target.value.slice(0, 500) || null })
                }
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent resize-none"
              />
            </div>
            <Input
              label="Hire Date"
              type="date"
              value={editing.hired_on ?? ''}
              onChange={(e) => setEditing({ ...editing, hired_on: e.target.value || null })}
            />
            <Button type="submit" loading={editBusy} className="w-full">
              Save changes
            </Button>
          </form>
        )}
      </Modal>

      {/* ─── Reset password confirm ─── */}
      <Modal
        open={!!resetting}
        onClose={() => {
          if (!resetBusy) setResetting(null);
        }}
        title="Reset password"
      >
        {resetting && (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-snug">
              <strong>You&apos;re about to reset the password for {resetting.full_name}.</strong>
              <br />
              The current password will stop working immediately. You&apos;ll see the new
              temporary password ONCE on the next screen — read it to them and ask them to
              sign in.
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setResetting(null)}
                disabled={resetBusy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleResetPassword}
                loading={resetBusy}
                className="flex-1"
              >
                Reset & reveal
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Temp password reveal (one-shot) ─── */}
      <Modal
        open={!!tempPasswordReveal}
        onClose={() => setTempPasswordReveal(null)}
        title="Temporary password"
      >
        {tempPasswordReveal && (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 leading-snug flex items-start gap-2">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              <span>
                {tempPasswordReveal.isInitial ? 'Staff login created.' : 'Password reset.'}{' '}
                Read this to <strong>{tempPasswordReveal.staffName}</strong>. It will not be
                shown again.
              </span>
            </div>
            <div className="bg-gray-900 text-emerald-300 font-mono text-lg text-center py-4 rounded-xl tracking-wider select-all">
              {tempPasswordReveal.password}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => copyPassword(tempPasswordReveal.password)}
                className="py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5"
              >
                <Copy size={14} /> Copy
              </button>
              <button
                type="button"
                onClick={() => setTempPasswordReveal(null)}
                className="py-2.5 bg-[#1B5E20] hover:bg-[#155318] text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5"
              >
                <X size={14} /> Done
              </button>
            </div>
            <p className="text-[10px] text-gray-400 text-center leading-snug">
              The staff member should sign in with their phone number + this password. Ask
              them to change it from the staff app.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── Attendance subview ────────────────────────────────────────

interface AttendanceViewProps {
  staff: StaffRow[];
  loading: boolean;
  nowMs: number | null;
  onRefresh: () => void;
}

function AttendanceView({ staff, loading, nowMs, onRefresh }: AttendanceViewProps) {
  const onDuty = useMemo(
    () => staff.filter((s) => s.on_duty_since !== null && s.is_active),
    [staff],
  );
  const offDuty = useMemo(
    () => staff.filter((s) => s.on_duty_since === null && s.is_active),
    [staff],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400 text-sm gap-2">
        <Loader2 className="animate-spin" size={16} /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* On-duty card */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <h3 className="text-sm font-bold text-emerald-900">
              On duty now ({onDuty.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="text-emerald-700 hover:text-emerald-900"
            aria-label="Refresh"
          >
            <RotateCcw size={14} />
          </button>
        </div>
        {onDuty.length === 0 ? (
          <p className="text-xs text-emerald-800/70 italic">Nobody is currently checked in.</p>
        ) : (
          <div className="space-y-2">
            {onDuty.map((s) => {
              const badge = ROLE_BADGE[s.staff_role];
              return (
                <div
                  key={s.id}
                  className="bg-white rounded-xl p-2.5 flex items-center gap-2.5"
                >
                  <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 overflow-hidden">
                    {s.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.photo_url}
                        alt={s.full_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <badge.Icon size={16} className="text-emerald-700" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1.5">
                      {s.full_name}
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full border ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </p>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1">
                      <Phone size={9} /> {s.phone}
                    </p>
                  </div>
                  {s.on_duty_since && (
                    <p className="text-[11px] text-emerald-700 font-semibold shrink-0 text-right">
                      Since {formatTime(s.on_duty_since)}
                      <br />
                      <span className="font-normal text-[10px] text-emerald-600/80">
                        {formatRelative(s.on_duty_since, nowMs)}
                      </span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Off-duty card */}
      <div className="bg-white rounded-2xl p-4 shadow-sm">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
          <CalIcon size={12} />
          Off duty ({offDuty.length})
        </h3>
        {offDuty.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Everyone&apos;s on duty right now.</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {offDuty.map((s) => {
              const badge = ROLE_BADGE[s.staff_role];
              return (
                <div
                  key={s.id}
                  className="bg-gray-50 rounded-xl p-2 flex items-center gap-2 min-w-0"
                >
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                    {s.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.photo_url}
                        alt={s.full_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <badge.Icon size={12} className="text-gray-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gray-700 truncate">
                      {s.full_name}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate">{badge.label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Analytics block (KPIs + charts + per-staff hours) */}
      <StaffAnalyticsBlock />

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 text-[11px] text-blue-800 leading-snug">
        <strong>Tip:</strong> A staff member is &quot;on duty&quot; when they&apos;ve tapped Check
        In and haven&apos;t yet checked out. Open shifts count toward today&apos;s hours up to the
        current moment.
      </div>
    </div>
  );
}

// ─── Analytics block (lives at the bottom of the Attendance tab) ─

type AnalyticsRange = 7 | 30 | 90;

interface AnalyticsResp {
  days: number;
  window: { start: string; end: string };
  kpis: {
    activeStaffTotal: number;
    activeSecurity: number;
    activeHousekeeping: number;
    onDutyNow: number;
    onDutySecurity: number;
    onDutyHousekeeping: number;
    checkedInToday: number;
    avgDailyHours: number;
    totalWindowHours: number;
  };
  todayGrid: Array<{
    id: string;
    full_name: string;
    staff_role: StaffRole;
    first_check_in_at: string | null;
    on_duty_now: boolean;
  }>;
  hoursTrend: Array<{
    date: string;
    security: number;
    housekeeping: number;
    total: number;
  }>;
  hoursPerStaff: Array<{
    id: string;
    full_name: string;
    staff_role: StaffRole | null;
    hours: number;
    shifts: number;
  }>;
  hourCoverage: Array<{ hour: number; avg_staff: number }>;
}

function StaffAnalyticsBlock() {
  const [range, setRange] = useState<AnalyticsRange>(30);
  const [data, setData] = useState<AnalyticsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (days: AnalyticsRange) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/admin/staff/analytics?days=${days}`, {
        cache: 'no-store',
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      const j = (await resp.json()) as AnalyticsResp;
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [load, range]);

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm flex items-center justify-center text-sm text-gray-400 gap-2">
        <Loader2 className="animate-spin" size={16} /> Loading analytics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-800 flex items-start gap-2">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">Couldn&apos;t load analytics</p>
          <p className="text-rose-700/80">{error}</p>
        </div>
        <button
          type="button"
          onClick={() => load(range)}
          className="text-xs font-semibold underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const k = data.kpis;
  const hoursLabel =
    range === 7 ? 'last 7 days' : range === 30 ? 'last 30 days' : 'last 90 days';

  // Trend chart prefers a single overall line — split-by-role is in the
  // hoursPerStaff bar list and that's enough on a small mobile viewport.
  const trendData = data.hoursTrend.map((d) => ({ date: d.date, value: d.total }));

  const hoursPerStaffData = data.hoursPerStaff.slice(0, 8).map((s) => ({
    label: `${s.full_name}${s.staff_role === 'security' ? ' \u00b7 S' : s.staff_role === 'housekeeping' ? ' \u00b7 H' : ''}`,
    value: s.hours,
  }));

  const coverageData = data.hourCoverage.map((c) => ({
    label: String(c.hour).padStart(2, '0'),
    value: c.avg_staff,
  }));

  return (
    <div className="space-y-3">
      {/* Range picker + heading */}
      <div className="flex items-center gap-2 px-1">
        <TrendingUp size={14} className="text-gray-500" />
        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
          Analytics
        </h3>
        <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setRange(d)}
              className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                range === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiTile
          label="Active staff"
          value={k.activeStaffTotal}
          hint={`${k.activeSecurity} sec \u00b7 ${k.activeHousekeeping} hk`}
        />
        <KpiTile
          label="On duty now"
          value={k.onDutyNow}
          tone={k.onDutyNow > 0 ? 'good' : 'default'}
          hint={`${k.onDutySecurity} sec \u00b7 ${k.onDutyHousekeeping} hk`}
        />
        <KpiTile
          label="Checked in today"
          value={`${k.checkedInToday}/${k.activeStaffTotal}`}
          tone={
            k.activeStaffTotal === 0 ? 'default'
            : k.checkedInToday === k.activeStaffTotal ? 'good'
            : k.checkedInToday === 0 ? 'bad'
            : 'warn'
          }
        />
        <KpiTile
          label="Avg daily hours"
          value={k.avgDailyHours}
          hint={`total ${k.totalWindowHours}h \u00b7 ${hoursLabel}`}
        />
      </div>

      {/* Today's attendance grid */}
      <div className="bg-white rounded-2xl p-3 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <CalIcon size={13} className="text-gray-500" />
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
            Today&apos;s attendance
          </h4>
          <span className="ml-auto text-[10px] text-gray-400">
            {data.window.end}
          </span>
        </div>
        {data.todayGrid.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-2">
            No active staff yet.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 -mx-1">
            {data.todayGrid.map((s) => {
              const badge = ROLE_BADGE[s.staff_role];
              const checkedIn = !!s.first_check_in_at;
              return (
                <li
                  key={s.id}
                  className="px-1 py-1.5 flex items-center gap-2"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      s.on_duty_now ? 'bg-emerald-500' : checkedIn ? 'bg-gray-300' : 'bg-rose-400'
                    }`}
                    aria-label={
                      s.on_duty_now ? 'On duty' : checkedIn ? 'Checked in earlier' : 'Absent'
                    }
                  />
                  <p className="text-xs font-medium text-gray-800 truncate flex-1">
                    {s.full_name}
                  </p>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${badge.cls}`}
                  >
                    {s.staff_role === 'security' ? 'S' : 'H'}
                  </span>
                  <p className={`text-[10px] tabular-nums shrink-0 w-14 text-right ${
                    s.on_duty_now ? 'text-emerald-700 font-semibold'
                    : checkedIn ? 'text-gray-500'
                    : 'text-rose-500 italic'
                  }`}>
                    {checkedIn ? formatTime(s.first_check_in_at) : 'absent'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> On duty
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-300" /> Checked in
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Absent
          </span>
        </div>
      </div>

      {/* Hours trend */}
      <div className="bg-white rounded-2xl p-3 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Activity size={13} className="text-gray-500" />
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
            Hours on duty &middot; {hoursLabel}
          </h4>
        </div>
        <LineChart data={trendData} height={100} />
      </div>

      {/* 24h shift coverage */}
      <div className="bg-white rounded-2xl p-3 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Clock size={13} className="text-gray-500" />
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
            Average coverage by hour (IST)
          </h4>
        </div>
        <BarHistogram
          data={coverageData}
          height={90}
          color="#1B5E20"
          showEveryNthLabel={4}
          formatValue={(v) => `${v} staff`}
        />
        <p className="text-[10px] text-gray-400 mt-1.5 leading-snug">
          Average number of staff simultaneously on duty during each
          IST hour over the {hoursLabel}. Helps spot uncovered windows
          (typically pre-dawn).
        </p>
      </div>

      {/* Per-staff hours (top 8) */}
      <div className="bg-white rounded-2xl p-3 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <UserCog size={13} className="text-gray-500" />
          <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
            Hours by staff &middot; {hoursLabel}
          </h4>
          {data.hoursPerStaff.length > 8 && (
            <span className="ml-auto text-[10px] text-gray-400">
              top 8 of {data.hoursPerStaff.length}
            </span>
          )}
        </div>
        <BarRows
          data={hoursPerStaffData}
          color="#1B5E20"
          emptyMessage="No attendance recorded in this window."
        />
      </div>
    </div>
  );
}
