'use client';
import { useEffect, useState } from 'react';
import { Plus, MapPin, Clock, Users, Trash2, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { format } from 'date-fns';
import type { Event } from '@/types';

export default function EventsPage() {
  const { profile, isAdmin } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', date: '', time: '', location: '', max_attendees: '' });
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  const fetch = async () => {
    const { data } = await supabase.from('events').select('*, profiles(full_name), event_rsvps(id, user_id, status)').order('date');
    if (data) setEvents(data);
    setLoading(false);
  };
  useEffect(() => { fetch(); }, []);

  async function handleRsvp(eventId: string, hasRsvp: boolean) {
    if (!profile) return;
    if (hasRsvp) {
      await supabase.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', profile.id);
      toast.success('RSVP removed');
    } else {
      await supabase.from('event_rsvps').upsert({ event_id: eventId, user_id: profile.id, status: 'going' });
      toast.success("You're going! 🎉");
    }
    fetch();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.date || !form.time || !form.location) { toast.error('Fill required fields'); return; }
    setSaving(true);
    const { error } = await supabase.from('events').insert({ ...form, max_attendees: form.max_attendees ? parseInt(form.max_attendees) : null, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Event created!');
    setOpen(false);
    setForm({ title: '', description: '', date: '', time: '', location: '', max_attendees: '' });
    fetch();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this event?')) return;
    await supabase.from('events').delete().eq('id', id);
    toast.success('Deleted');
    fetch();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
        {isAdmin && <Button onClick={() => setOpen(true)} size="sm"><Plus size={16} />Create Event</Button>}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-36 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : events.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No events scheduled</p>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => {
            const rsvps = (ev as any).event_rsvps || [];
            const userRsvp = rsvps.find((r: any) => r.user_id === profile?.id);
            const count = rsvps.filter((r: any) => r.status === 'going').length;
            const isPast = new Date(ev.date) < new Date();
            return (
              <div key={ev.id} className={`bg-white rounded-xl p-4 shadow-sm ${isPast ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-900">{ev.title}</h3>
                      {isPast && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Past</span>}
                    </div>
                    {ev.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{ev.description}</p>}
                    <div className="grid grid-cols-2 gap-y-1 mt-3">
                      <span className="flex items-center gap-1.5 text-xs text-gray-500"><Clock size={12} />{format(new Date(ev.date), 'dd MMM yyyy')} · {ev.time}</span>
                      <span className="flex items-center gap-1.5 text-xs text-gray-500"><MapPin size={12} />{ev.location}</span>
                      <span className="flex items-center gap-1.5 text-xs text-gray-500"><Users size={12} />{count} going{ev.max_attendees ? ` / ${ev.max_attendees}` : ''}</span>
                    </div>
                    {!isPast && (
                      <button
                        onClick={() => handleRsvp(ev.id, !!userRsvp)}
                        className={`mt-3 flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all ${userRsvp ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700 hover:bg-green-50 hover:text-green-700'}`}
                      >
                        <CheckCircle size={14} />
                        {userRsvp ? "You're Going!" : "RSVP"}
                      </button>
                    )}
                  </div>
                  {isAdmin && !isPast && (
                    <button onClick={() => handleDelete(ev.id)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Create Event">
        <form onSubmit={handleCreate} className="space-y-3">
          <Input label="Event Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Date * (YYYY-MM-DD)" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} placeholder="2025-12-25" />
            <Input label="Time *" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} placeholder="10:00 AM" />
          </div>
          <Input label="Location *" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <Input label="Max Attendees" type="number" value={form.max_attendees} onChange={(e) => setForm({ ...form, max_attendees: e.target.value })} />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Create</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
