'use client';
import { useEffect, useState } from 'react';
import { Plus, Clock, Calendar, AlertTriangle, Ban, Lock, Edit3, Trash2, CalendarDays, Bookmark, CheckCircle2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { format } from 'date-fns';
import type { Booking, ClubhouseFacility } from '@/types';

type AdminAction = 'revoke' | 'reject';

const ADMIN_ACTION_META: Record<AdminAction, { targetStatus: 'cancelled' | 'rejected'; verb: string; pastTense: string; noteLabel: string; }> = {
  revoke:  { targetStatus: 'cancelled', verb: 'Revoke',  pastTense: 'revoked',  noteLabel: 'Revoked by admin' },
  reject:  { targetStatus: 'rejected',  verb: 'Reject',  pastTense: 'rejected', noteLabel: 'Rejected by admin' },
};

// Facility list now comes from the clubhouse_facilities table (admin-managed,
// see /admin/clubhouse). Time slots are still hard-coded \u2014 admins can
// move that to a table later if they need per-facility schedules.
const TIME_SLOTS = ['6:00 AM - 8:00 AM', '8:00 AM - 10:00 AM', '10:00 AM - 12:00 PM', '12:00 PM - 2:00 PM', '2:00 PM - 4:00 PM', '4:00 PM - 6:00 PM', '6:00 PM - 8:00 PM', '8:00 PM - 10:00 PM'];

const STATUS = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500' };

export default function BookingsPage() {
  const { profile, isAdmin } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [facilities, setFacilities] = useState<ClubhouseFacility[]>([]);
  const [activeTierFacilitySlugs, setActiveTierFacilitySlugs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'my' | 'all'>('my');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ facility_id: '', date: '', time_slot: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const [adminTarget, setAdminTarget] = useState<Booking | null>(null);
  const [adminAction, setAdminAction] = useState<AdminAction>('revoke');
  const [adminReason, setAdminReason] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);

  // Admin: hard-delete (used to prune past bookings) and edit
  // (date/slot/notes/facility). Both flow through audited APIs.
  const [deleteTarget, setDeleteTarget] = useState<Booking | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteSaving, setDeleteSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<Booking | null>(null);
  const [editForm, setEditForm] = useState({ date: '', time_slot: '', facility: '', notes: '', reason: '' });
  const [editSaving, setEditSaving] = useState(false);

  const supabase = createClient();

  const fetch = async () => {
    let q = supabase.from('bookings').select('*, profiles(full_name, flat_number)').order('created_at', { ascending: false });
    if (view === 'my' && profile) q = q.eq('user_id', profile.id);
    const { data } = await q;
    if (data) setBookings(data);
    setLoading(false);
  };
  useEffect(() => { fetch(); }, [view]);

  // Load the facility catalog + the resident's active subscription so we can
  // render a "Locked" badge on facilities they can't book today.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: fac }, { data: sub }] = await Promise.all([
        supabase.from('clubhouse_facilities').select('*').eq('is_active', true).eq('is_bookable', true).order('display_order'),
        profile?.flat_number
          ? supabase
              .from('clubhouse_subscriptions')
              .select('clubhouse_tiers(included_facilities)')
              .eq('flat_number', profile.flat_number)
              .eq('status', 'active')
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setFacilities((fac ?? []) as ClubhouseFacility[]);
      const slugs = ((sub?.clubhouse_tiers as { included_facilities?: string[] } | null)?.included_facilities ?? []);
      setActiveTierFacilitySlugs(new Set(slugs));
    })();
    return () => { cancelled = true; };
  }, [profile?.flat_number, supabase]);

  function isFacilityLocked(f: ClubhouseFacility): boolean {
    return f.requires_subscription && !activeTierFacilitySlugs.has(f.slug);
  }

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    if (!form.facility_id || !form.date || !form.time_slot) { toast.error('Fill all required fields'); return; }
    setSaving(true);
    try {
      const res = await globalThis.fetch('/api/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? `Booking failed (${res.status})`);
        return;
      }
      toast.success('Booking request submitted!');
      setOpen(false);
      setForm({ facility_id: '', date: '', time_slot: '', notes: '' });
      fetch();
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('bookings').update({ status }).eq('id', id);
    toast.success(`Booking ${status}`);
    fetch();
  }

  async function approveBooking(id: string) {
    const t = toast.loading('Approving…');
    try {
      const res = await globalThis.fetch(`/api/admin/bookings/${id}/approve`, { method: 'POST' });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        email?: { sent?: boolean; reason?: string; error?: string };
      };
      toast.dismiss(t);
      if (!res.ok) { toast.error(payload.error ?? 'Approve failed'); return; }
      const email = payload.email;
      if (email?.sent) toast.success('Approved & invite emailed');
      else if (email?.reason === 'provider_disabled') toast.success('Approved (email not configured)');
      else if (email?.reason === 'no_email') toast.success('Approved (resident has no email)');
      else if (email?.error) toast.success(`Approved, but email failed: ${email.error}`);
      else toast.success('Approved');
      fetch();
    } catch (err) {
      toast.dismiss(t);
      toast.error(err instanceof Error ? err.message : 'Approve failed');
    }
  }

  function openAdminAction(booking: Booking, action: AdminAction) {
    setAdminTarget(booking);
    setAdminAction(action);
    setAdminReason('');
  }

  function closeAdminAction() {
    setAdminTarget(null);
    setAdminReason('');
  }

  async function submitAdminAction(e: React.FormEvent) {
    e.preventDefault();
    if (!adminTarget || !profile) return;

    const reason = adminReason.trim();
    if (!reason) { toast.error('Please enter a reason'); return; }

    const meta = ADMIN_ACTION_META[adminAction];
    const timestamp = format(new Date(), 'dd MMM yyyy, HH:mm');
    const auditLine = `[${meta.noteLabel} · ${timestamp}] ${reason}`;
    const mergedNotes = adminTarget.notes ? `${adminTarget.notes}\n\n${auditLine}` : auditLine;

    setAdminSaving(true);
    try {
      const { error: updateError } = await supabase
        .from('bookings')
        .update({ status: meta.targetStatus, notes: mergedNotes })
        .eq('id', adminTarget.id);
      if (updateError) throw updateError;

      // Notify the resident via the Aaditri Bot inbox (only if they aren't the
      // same admin acting on their own booking). Failures here are non-fatal —
      // the booking status change is what matters most.
      if (adminTarget.user_id && adminTarget.user_id !== profile.id) {
        const bookingLabel = `${adminTarget.facility} on ${format(new Date(adminTarget.date), 'dd MMM yyyy')} (${adminTarget.time_slot})`;
        const botBody =
          `Your approved booking for ${bookingLabel} was ${meta.pastTense} by the admin.\n\n` +
          `Reason: ${reason}\n\n` +
          `If this is a mistake, please contact the admin team.`;

        const { data: botMsg, error: botErr } = await supabase
          .from('bot_messages')
          .insert({ body: botBody, authored_by: profile.id })
          .select('id')
          .single();
        if (!botErr && botMsg) {
          await supabase
            .from('bot_message_recipients')
            .insert({ message_id: botMsg.id, user_id: adminTarget.user_id });
        }
      }

      toast.success(`Booking ${meta.pastTense}`);
      closeAdminAction();
      fetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Couldn't ${meta.verb.toLowerCase()} booking`;
      toast.error(msg);
    } finally {
      setAdminSaving(false);
    }
  }

  function openDelete(b: Booking) {
    setDeleteTarget(b);
    setDeleteReason('');
  }
  function closeDelete() { setDeleteTarget(null); setDeleteReason(''); }

  async function submitDelete() {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      const res = await globalThis.fetch(`/api/admin/bookings/${deleteTarget.id}/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast.error(json.error ?? 'Delete failed'); return; }
      toast.success('Booking deleted');
      closeDelete();
      fetch();
    } finally {
      setDeleteSaving(false);
    }
  }

  function openEdit(b: Booking) {
    setEditTarget(b);
    setEditForm({
      date: b.date,
      time_slot: b.time_slot,
      facility: b.facility,
      notes: b.notes ?? '',
      reason: '',
    });
  }
  function closeEdit() { setEditTarget(null); }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const res = await globalThis.fetch(`/api/admin/bookings/${editTarget.id}/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date: editForm.date,
          time_slot: editForm.time_slot,
          facility: editForm.facility,
          notes: editForm.notes || null,
          reason: editForm.reason.trim(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast.error(json.error ?? 'Update failed'); return; }
      toast.success('Booking updated');
      closeEdit();
      fetch();
    } finally {
      setEditSaving(false);
    }
  }

  // A booking is "past" if its date is strictly before today (IST is the
  // app's timezone but a date-only comparison is good enough here).
  function isPastBooking(b: Booking): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(b.date).getTime() < today.getTime();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Bookmark size={22} className="text-[#1B5E20]" />
            <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">Reserve a clubhouse facility &amp; track your requests.</p>
        </div>
        <Button onClick={() => setOpen(true)} size="sm" className="flex-shrink-0">
          <Plus size={16} className="mr-1" />
          Book
        </Button>
      </div>

      {isAdmin && (
        <div className="flex bg-gray-100 rounded-xl p-1 mb-4">
          {(['my', 'all'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {v === 'my' ? 'My Bookings' : 'All Bookings'}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <Bookmark className="mx-auto text-gray-300 mb-3" size={36} />
          <p className="text-sm text-gray-500">No bookings yet. Tap &quot;Book&quot; to reserve a facility.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <div key={b.id} className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-gray-900 truncate">{b.facility}</h3>
                  {isAdmin && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {(b.profiles as any)?.full_name} &middot; Flat {(b.profiles as any)?.flat_number}
                    </p>
                  )}
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${STATUS[b.status]}`}>
                  {b.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar size={13} className="text-gray-400" />
                  {format(new Date(b.date), 'dd MMM yyyy')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={13} className="text-gray-400" />
                  {b.time_slot}
                </span>
              </div>

              {b.notes && (
                <p className="text-xs text-gray-500 mt-2 italic whitespace-pre-wrap leading-relaxed">{b.notes}</p>
              )}

              <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
                {isAdmin && b.status === 'pending' && (
                  <>
                    <button onClick={() => approveBooking(b.id)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-100 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-200 transition-colors">
                      <CheckCircle2 size={13} />Approve
                    </button>
                    <button onClick={() => openAdminAction(b, 'reject')} className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-100 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-200 transition-colors">
                      <XCircle size={13} />Reject
                    </button>
                  </>
                )}
                {isAdmin && b.status === 'approved' && (
                  <>
                    <button onClick={() => openAdminAction(b, 'revoke')} className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-100 text-amber-800 text-xs font-semibold rounded-lg hover:bg-amber-200 transition-colors">
                      <Ban size={13} />Revoke
                    </button>
                    <button onClick={() => openAdminAction(b, 'reject')} className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-100 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-200 transition-colors">
                      <XCircle size={13} />Reject
                    </button>
                  </>
                )}
                {b.user_id === profile?.id && b.status === 'pending' && (
                  <button onClick={() => updateStatus(b.id, 'cancelled')} className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors">
                    <XCircle size={13} />Cancel
                  </button>
                )}
                {b.user_id === profile?.id && (b.status === 'pending' || b.status === 'approved') && (
                  <a
                    href={`/api/bookings/${b.id}/ics`}
                    download
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-lg hover:bg-blue-100 transition-colors"
                    title="Download as a .ics file you can add to any calendar app"
                  >
                    <CalendarDays size={13} />Add to calendar
                  </a>
                )}
                {isAdmin && (
                  <>
                    {/* Push edit/delete to the right on wider screens so they
                        don't elbow the contextual approve/reject actions. */}
                    <span className="flex-1" />
                    <button
                      onClick={() => openEdit(b)}
                      title="Edit booking (admin)"
                      aria-label="Edit booking"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <Edit3 size={13} />
                      <span className="hidden sm:inline">Edit</span>
                    </button>
                    <button
                      onClick={() => openDelete(b)}
                      title={isPastBooking(b) ? 'Delete past booking' : 'Delete booking'}
                      aria-label="Delete booking"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-red-50 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-100 transition-colors"
                    >
                      <Trash2 size={13} />
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Book a Facility">
        <form onSubmit={handleBook} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Select Facility *</label>
            {facilities.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No bookable facilities available.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {facilities.map((f) => {
                  const locked = isFacilityLocked(f);
                  const selected = form.facility_id === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        if (locked) {
                          toast.error(`${f.name} requires an active clubhouse subscription that includes it.`);
                          return;
                        }
                        setForm({ ...form, facility_id: f.id });
                      }}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                        selected
                          ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                          : locked
                            ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-[#1B5E20]'
                      }`}
                    >
                      {locked && <Lock size={11} />}
                      {f.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Input label="Date *" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} min={new Date().toISOString().split('T')[0]} />
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Time Slot *</label>
            <div className="flex flex-col gap-1.5">
              {TIME_SLOTS.map((s) => (
                <button key={s} type="button" onClick={() => setForm({ ...form, time_slot: s })} className={`px-3 py-2 rounded-xl text-sm font-medium border text-left transition-all ${form.time_slot === s ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:border-[#1B5E20]'}`}>{s}</button>
              ))}
            </div>
          </div>
          <Textarea label="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Book</Button>
          </div>
        </form>
      </Modal>

      {/* Admin: revoke or reject an approved booking */}
      <Modal
        open={!!adminTarget}
        onClose={closeAdminAction}
        title={adminTarget ? `${ADMIN_ACTION_META[adminAction].verb} booking` : ''}
      >
        {adminTarget && (
          <form onSubmit={submitAdminAction} className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 leading-snug">
                You are about to <strong>{ADMIN_ACTION_META[adminAction].pastTense}</strong>{' '}
                <strong>{adminTarget.facility}</strong> on{' '}
                <strong>{format(new Date(adminTarget.date), 'dd MMM yyyy')}</strong> ({adminTarget.time_slot}).
                {adminTarget.user_id !== profile?.id && ' The resident will be notified via their inbox.'}
              </div>
            </div>

            <Textarea
              label="Reason (shown to the resident) *"
              value={adminReason}
              onChange={(e) => setAdminReason(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder={adminAction === 'revoke'
                ? 'e.g. Clubhouse is under repair that day; please rebook another slot.'
                : 'e.g. This slot conflicts with a society-wide event.'}
            />
            <p className="text-[11px] text-gray-400 -mt-2" suppressHydrationWarning>
              {adminReason.trim().length}/500
            </p>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={closeAdminAction} className="flex-1">Cancel</Button>
              <Button
                type="submit"
                variant={adminAction === 'reject' ? 'danger' : 'primary'}
                loading={adminSaving}
                disabled={!adminReason.trim()}
                className="flex-1"
              >
                {ADMIN_ACTION_META[adminAction].verb}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Admin: edit a booking */}
      <Modal open={!!editTarget} onClose={closeEdit} title="Edit booking">
        {editTarget && (
          <form onSubmit={submitEdit} className="space-y-3">
            <Input
              label="Facility"
              value={editForm.facility}
              onChange={(e) => setEditForm({ ...editForm, facility: e.target.value })}
            />
            <Input
              label="Date"
              type="date"
              value={editForm.date}
              onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
            />
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Time slot</label>
              <select
                aria-label="Time slot"
                value={editForm.time_slot}
                onChange={(e) => setEditForm({ ...editForm, time_slot: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
              >
                {TIME_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <Textarea
              label="Notes"
              value={editForm.notes}
              rows={2}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
            />
            <Textarea
              label="Reason for change (recorded in audit log)"
              value={editForm.reason}
              rows={2}
              maxLength={500}
              onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
              placeholder="e.g. Resident requested a slot swap"
            />
            <div className="flex gap-3 pt-1">
              <Button type="button" variant="secondary" onClick={closeEdit} className="flex-1">Cancel</Button>
              <Button type="submit" loading={editSaving} className="flex-1">Save</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Admin: delete a booking */}
      <Modal open={!!deleteTarget} onClose={closeDelete} title="Delete booking?">
        {deleteTarget && (
          <div className="space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800">
              <p className="font-bold">This cannot be undone.</p>
              <p className="mt-1">
                <strong>{deleteTarget.facility}</strong> on{' '}
                <strong>{format(new Date(deleteTarget.date), 'dd MMM yyyy')}</strong>{' '}
                ({deleteTarget.time_slot})
              </p>
              <p className="mt-1">
                {(deleteTarget.profiles as { full_name?: string; flat_number?: string } | null)?.full_name ?? '\u2014'}
                {' \u00b7 Flat '}
                {(deleteTarget.profiles as { flat_number?: string } | null)?.flat_number ?? '\u2014'}
              </p>
            </div>
            <Textarea
              label="Reason for deletion (recorded in audit log)"
              value={deleteReason}
              rows={2}
              maxLength={500}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="e.g. Cleaning up old data after the event"
            />
            <div className="flex gap-3 pt-1">
              <Button type="button" variant="secondary" onClick={closeDelete} className="flex-1">Cancel</Button>
              <Button
                type="button"
                variant="danger"
                onClick={submitDelete}
                loading={deleteSaving}
                className="flex-1"
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
