'use client';
import { useEffect, useState } from 'react';
import { Plus, Clock, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { format } from 'date-fns';
import type { Booking } from '@/types';

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
                  {b.notes && <p className="text-xs text-gray-400 mt-1 italic">{b.notes}</p>}
                  <div className="flex gap-2 mt-3">
                    {isAdmin && b.status === 'pending' && (
                      <>
                        <button onClick={() => updateStatus(b.id, 'approved')} className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-200 transition-colors">Approve</button>
                        <button onClick={() => updateStatus(b.id, 'rejected')} className="px-3 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-200 transition-colors">Reject</button>
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
    </div>
  );
}
