'use client';
import { useEffect, useState } from 'react';
import { Plus, Clock, MapPin, AlertTriangle, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { format } from 'date-fns';
import type { Booking } from '@/types';

type AdminAction = 'revoke' | 'reject';

const ADMIN_ACTION_META: Record<AdminAction, { targetStatus: 'cancelled' | 'rejected'; verb: string; pastTense: string; noteLabel: string; }> = {
  revoke:  { targetStatus: 'cancelled', verb: 'Revoke',  pastTense: 'revoked',  noteLabel: 'Revoked by admin' },
  reject:  { targetStatus: 'rejected',  verb: 'Reject',  pastTense: 'rejected', noteLabel: 'Rejected by admin' },
};

const FACILITIES = ['Clubhouse', 'Swimming Pool', 'Tennis Court', 'Badminton Court', 'Gym', 'Party Hall', 'Conference Room'];
const TIME_SLOTS = ['6:00 AM - 8:00 AM', '8:00 AM - 10:00 AM', '10:00 AM - 12:00 PM', '12:00 PM - 2:00 PM', '2:00 PM - 4:00 PM', '4:00 PM - 6:00 PM', '6:00 PM - 8:00 PM', '8:00 PM - 10:00 PM'];

const STATUS = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-500' };

export default function BookingsPage() {
  const { profile, isAdmin } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'my' | 'all'>('my');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ facility: '', date: '', time_slot: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const [adminTarget, setAdminTarget] = useState<Booking | null>(null);
  const [adminAction, setAdminAction] = useState<AdminAction>('revoke');
  const [adminReason, setAdminReason] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);

  const supabase = createClient();

  const fetch = async () => {
    let q = supabase.from('bookings').select('*, profiles(full_name, flat_number)').order('created_at', { ascending: false });
    if (view === 'my' && profile) q = q.eq('user_id', profile.id);
    const { data } = await q;
    if (data) setBookings(data);
    setLoading(false);
  };
  useEffect(() => { fetch(); }, [view]);

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    if (!form.facility || !form.date || !form.time_slot) { toast.error('Fill all required fields'); return; }
    setSaving(true);
    const { error } = await supabase.from('bookings').insert({ ...form, user_id: profile?.id, status: 'pending' });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Booking request submitted!');
    setOpen(false);
    setForm({ facility: '', date: '', time_slot: '', notes: '' });
    fetch();
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
        <Button onClick={() => setOpen(true)} size="sm"><Plus size={16} />Book</Button>
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
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : bookings.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No bookings found</p>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <div key={b.id} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-gray-900">{b.facility}</h3>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS[b.status]}`}>{b.status.toUpperCase()}</span>
                  </div>
                  {isAdmin && <p className="text-xs text-gray-500">{(b.profiles as any)?.full_name} · Flat {(b.profiles as any)?.flat_number}</p>}
                  <div className="flex gap-4 mt-2">
                    <span className="flex items-center gap-1 text-xs text-gray-500"><MapPin size={11} />{format(new Date(b.date), 'dd MMM yyyy')}</span>
                    <span className="flex items-center gap-1 text-xs text-gray-500"><Clock size={11} />{b.time_slot}</span>
                  </div>
                  {b.notes && <p className="text-xs text-gray-400 mt-1 italic whitespace-pre-wrap">{b.notes}</p>}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {isAdmin && b.status === 'pending' && (
                      <>
                        <button onClick={() => approveBooking(b.id)} className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-200 transition-colors">Approve</button>
                        <button onClick={() => openAdminAction(b, 'reject')} className="px-3 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-200 transition-colors">Reject</button>
                      </>
                    )}
                    {isAdmin && b.status === 'approved' && (
                      <>
                        <button onClick={() => openAdminAction(b, 'revoke')} className="inline-flex items-center gap-1 px-3 py-1 bg-amber-100 text-amber-800 text-xs font-semibold rounded-lg hover:bg-amber-200 transition-colors">
                          <Ban size={12} />Revoke
                        </button>
                        <button onClick={() => openAdminAction(b, 'reject')} className="px-3 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-200 transition-colors">Reject</button>
                      </>
                    )}
                    {b.user_id === profile?.id && b.status === 'pending' && (
                      <button onClick={() => updateStatus(b.id, 'cancelled')} className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Book a Facility">
        <form onSubmit={handleBook} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Select Facility *</label>
            <div className="flex flex-wrap gap-2">
              {FACILITIES.map((f) => (
                <button key={f} type="button" onClick={() => setForm({ ...form, facility: f })} className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${form.facility === f ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:border-[#1B5E20]'}`}>{f}</button>
              ))}
            </div>
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
    </div>
  );
}
