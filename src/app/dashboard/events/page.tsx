'use client';
import { useEffect, useState } from 'react';
import { Plus, MapPin, Clock, Calendar, Users, Trash2, Check, HelpCircle, X, Pin, PinOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { format } from 'date-fns';
import type { Event } from '@/types';

type RsvpStatus = 'going' | 'maybe' | 'not_going';

interface RsvpButtonProps {
  status: RsvpStatus;
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  activeClass: string;
}

function RsvpButton({ active, onClick, icon: Icon, label, activeClass }: RsvpButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
        active ? activeClass : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

export default function EventsPage() {
  const { profile, isAdmin } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', date: '', time: '', location: '', max_attendees: '' });
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  const fetch = async () => {
    // Pull everything (incl. past events so admins can prune them) and sort
    // client-side: pinned events first, then upcoming events (soonest at
    // top), then past events (most recent at top). Plain `order('date')`
    // was putting old events above new ones, which the admin team
    // complained about. We also surface any error from supabase-js so a
    // hidden RLS / network failure doesn't silently produce an empty list
    // (which is what was happening when an admin reported "I created an
    // event but it never showed up").
    // Disambiguate the `profiles` embed: PostgREST sees TWO paths from
    // events → profiles (events.created_by → profiles, plus the indirect
    // path via event_reminders_sent.user_id → profiles) and refuses to
    // pick one without an explicit FK hint. Without the !FK suffix the
    // entire SELECT fails with "Could not embed because more than one
    // relationship was found", which was the real reason newly-created
    // events appeared to vanish from the list.
    const { data, error } = await supabase
      .from('events')
      .select('*, profiles!events_created_by_fkey(full_name), event_rsvps(id, user_id, status)');
    if (error) {
      console.error('[events] fetch failed', error);
      toast.error(`Could not load events: ${error.message}`);
      setLoading(false);
      return;
    }
    if (data) {
      // Use the IST date so a 9pm-IST admin doesn't see today's event
      // marked as "Past" just because the UTC clock has rolled over.
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const sorted = [...data].sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        const aPast = a.date < today;
        const bPast = b.date < today;
        if (aPast !== bPast) return aPast ? 1 : -1;
        if (aPast) {
          return b.date.localeCompare(a.date);
        }
        return a.date.localeCompare(b.date);
      });
      setEvents(sorted);
    }
    setLoading(false);
  };
  useEffect(() => { fetch(); }, []);

  // Set the user's RSVP status. Tapping the same status twice clears it
  // (delete row), which lets a user undo an accidental tap without forcing
  // them to pick a different bucket.
  async function handleRsvp(eventId: string, status: RsvpStatus, current: RsvpStatus | null) {
    if (!profile) return;
    if (current === status) {
      await supabase.from('event_rsvps').delete().eq('event_id', eventId).eq('user_id', profile.id);
      toast.success('RSVP cleared');
    } else {
      const { error } = await supabase
        .from('event_rsvps')
        .upsert(
          { event_id: eventId, user_id: profile.id, status },
          { onConflict: 'event_id,user_id' }
        );
      if (error) { toast.error(error.message); return; }
      const labels: Record<RsvpStatus, string> = {
        going: "You're going!",
        maybe: 'Marked as maybe',
        not_going: "Marked as not going",
      };
      toast.success(labels[status]);
    }
    fetch();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.date || !form.time || !form.location) { toast.error('Fill required fields'); return; }
    if (!profile?.id) { toast.error('Still loading your profile, try again in a moment.'); return; }
    setSaving(true);
    const eventPayload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      date: form.date,
      time: form.time,
      location: form.location.trim(),
      max_attendees: form.max_attendees ? parseInt(form.max_attendees, 10) : null,
      created_by: profile.id,
    };
    const { data: inserted, error } = await supabase
      .from('events')
      .insert(eventPayload)
      .select('id')
      .single();
    setSaving(false);
    if (error || !inserted) {
      // We previously swallowed RLS / shape errors and only showed
      // `error.message`. Some environments return a vague message when
      // the post-insert SELECT fails its RLS check — log the full
      // error so we can diagnose the "event was created but doesn't
      // appear" class of bug quickly from the browser console.
      console.error('[events] insert failed', error, 'payload:', eventPayload);
      toast.error(error?.message || 'Could not create event');
      return;
    }
    toast.success('Event created!');
    setOpen(false);
    setForm({ title: '', description: '', date: '', time: '', location: '', max_attendees: '' });
    await fetch();

    // Fire-and-watch: send calendar invites to all approved residents.
    // We don't block the UI on this — failures are surfaced as a toast but the
    // event is already saved. The endpoint itself is a no-op if Resend isn't
    // configured, so this is safe to run locally without env vars.
    if (inserted?.id) {
      toast.loading('Sending calendar invites…', { id: 'invite' });
      try {
        const res = await globalThis.fetch('/api/admin/events/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: inserted.id }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string; sent?: number; failed?: number; skipped?: number;
          reason?: string;
        };
        toast.dismiss('invite');
        if (!res.ok) {
          toast.error(`Invites: ${payload.error ?? 'failed'}`);
        } else if (payload.reason) {
          toast(`Event saved. ${payload.reason}`, { icon: 'ℹ️' });
        } else {
          const sent = payload.sent ?? 0;
          const failed = payload.failed ?? 0;
          const parts = [`${sent} sent`];
          if (failed) parts.push(`${failed} failed`);
          toast.success(`Invites: ${parts.join(', ')}`);
        }
      } catch (err) {
        toast.dismiss('invite');
        const msg = err instanceof Error ? err.message : 'Invites failed';
        toast.error(msg);
      }

      // Channel companions: push + Telegram. Best-effort, no toast
      // on failure (the calendar-invite toast already gave the user
      // feedback that the event itself was saved).
      try {
        await globalThis.fetch('/api/push/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: inserted.id }),
        });
      } catch {
        // Channels are best-effort; in-app + email invite already
        // covered.
      }
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this event?')) return;
    await supabase.from('events').delete().eq('id', id);
    toast.success('Deleted');
    fetch();
  }

  // Optimistic pin/unpin: flip locally first so the row jumps to / from
  // the top instantly, then reconcile with the server. Mirrors the
  // /dashboard/announcements behaviour — keep them in lock-step.
  async function handleTogglePin(ev: Event) {
    const next = !ev.is_pinned;
    setEvents((prev) => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      return [...prev.map((x) => (x.id === ev.id ? { ...x, is_pinned: next } : x))].sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        const aPast = a.date < today;
        const bPast = b.date < today;
        if (aPast !== bPast) return aPast ? 1 : -1;
        if (aPast) return b.date.localeCompare(a.date);
        return a.date.localeCompare(b.date);
      });
    });
    const { error } = await supabase
      .from('events')
      .update({ is_pinned: next })
      .eq('id', ev.id);
    if (error) {
      toast.error(error.message || 'Could not update pin');
      fetch();
      return;
    }
    toast.success(next ? 'Pinned to top' : 'Unpinned');
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Calendar size={22} className="text-[#1B5E20]" />
            <h1 className="text-2xl font-bold text-gray-900">Events</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">RSVP to upcoming community events.</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setOpen(true)} size="sm" className="flex-shrink-0">
            <Plus size={16} className="mr-1" />Create
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-36 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : events.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <Calendar className="mx-auto text-gray-300 mb-3" size={36} />
          <p className="text-sm text-gray-500">No events scheduled.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => {
            const rsvps = ev.event_rsvps ?? [];
            const userRsvp = rsvps.find((r) => r.user_id === profile?.id) ?? null;
            const userStatus = (userRsvp?.status ?? null) as RsvpStatus | null;
            const goingCount = rsvps.filter((r) => r.status === 'going').length;
            const maybeCount = rsvps.filter((r) => r.status === 'maybe').length;
            // Compare the event's IST date to today's IST date as plain
            // YYYY-MM-DD strings. The previous `new Date(ev.date) < new Date()`
            // parsed ev.date as UTC midnight, which marked today's event as
            // "Past" for any IST viewer past 5:30am.
            const todayIst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            const isPast = ev.date < todayIst;
            return (
              <div key={ev.id} className={`bg-white rounded-xl p-4 border border-gray-200 hover:shadow-sm transition-shadow ${ev.is_pinned ? 'border-l-4 border-l-yellow-400' : ''} ${isPast ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {ev.is_pinned && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1"><Pin size={10} />Pinned</span>}
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{ev.title}</h3>
                      {isPast && <span className="text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Past</span>}
                    </div>
                    {ev.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{ev.description}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-gray-600">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar size={13} className="text-gray-400" />
                        {format(new Date(ev.date), 'dd MMM yyyy')}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock size={13} className="text-gray-400" />
                        {ev.time}
                      </span>
                      {ev.location && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin size={13} className="text-gray-400" />
                          {ev.location}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5">
                        <Users size={13} className="text-gray-400" />
                        {goingCount} going{maybeCount ? ` · ${maybeCount} maybe` : ''}{ev.max_attendees ? ` / ${ev.max_attendees}` : ''}
                      </span>
                    </div>
                    {!isPast && (
                      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="RSVP">
                        <RsvpButton
                          status="going"
                          active={userStatus === 'going'}
                          onClick={() => handleRsvp(ev.id, 'going', userStatus)}
                          icon={Check}
                          label="Going"
                          activeClass="bg-green-100 text-green-700 ring-1 ring-green-300"
                        />
                        <RsvpButton
                          status="maybe"
                          active={userStatus === 'maybe'}
                          onClick={() => handleRsvp(ev.id, 'maybe', userStatus)}
                          icon={HelpCircle}
                          label="Maybe"
                          activeClass="bg-amber-100 text-amber-700 ring-1 ring-amber-300"
                        />
                        <RsvpButton
                          status="not_going"
                          active={userStatus === 'not_going'}
                          onClick={() => handleRsvp(ev.id, 'not_going', userStatus)}
                          icon={X}
                          label="Not Going"
                          activeClass="bg-red-100 text-red-700 ring-1 ring-red-300"
                        />
                      </div>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTogglePin(ev)}
                        title={ev.is_pinned ? 'Unpin event' : 'Pin event to the top'}
                        aria-label={ev.is_pinned ? `Unpin ${ev.title}` : `Pin ${ev.title}`}
                        className={`transition-colors p-1 -m-1 ${
                          ev.is_pinned
                            ? 'text-amber-500 hover:text-amber-600'
                            : 'text-gray-300 hover:text-amber-500'
                        }`}
                      >
                        {ev.is_pinned ? <PinOff size={16} /> : <Pin size={16} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(ev.id)}
                        title={isPast ? 'Delete past event' : 'Delete event'}
                        aria-label={`Delete ${ev.title}`}
                        className="text-gray-300 hover:text-red-500 transition-colors p-1 -m-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
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
            <Input
              label="Date *"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              min={new Date().toISOString().split('T')[0]}
            />
            <Input
              label="Time *"
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
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
