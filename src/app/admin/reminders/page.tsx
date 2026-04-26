'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  Plus,
  Send,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Calendar,
  Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import type { ScheduledReminder, ScheduledReminderStatus } from '@/types';

// Admin: scheduled reminders. Three tabs (Pending / Sent / Cancelled);
// failed rows surface in a callout at the top of Pending so an admin
// can fire-now-retry without scrolling.
//
// Drift warning: the daily cron at 03:30 UTC (= 09:00 IST) is the
// only thing that fires these. The UI deliberately shows date-only
// (no time-of-day picker) and explains that the reminder lands at
// "the next ~09:00 IST after this date". If we let admins pick a
// time, they'd be surprised when it didn't fire at that minute.

type TabId = 'pending' | 'sent' | 'cancelled';

const TABS: { id: TabId; label: string; status: ScheduledReminderStatus }[] = [
  { id: 'pending', label: 'Upcoming', status: 'pending' },
  { id: 'sent', label: 'Sent', status: 'sent' },
  { id: 'cancelled', label: 'Cancelled', status: 'cancelled' },
];

interface FormState {
  title: string;
  body: string;
  fire_on: string;
  // Repeating mode: when true the modal exposes the send_until
  // picker. When false we send `send_until: null` to the API
  // (single-fire). We intentionally keep the toggle in form state
  // — not derived from `send_until` length — so an admin can flip
  // off "repeating", remember the date, and flip it back on
  // without re-typing.
  repeating: boolean;
  send_until: string;
}

function todayIst(): string {
  // Same trick the cron uses — explicit IST offset rather than
  // relying on the user's TZ.
  const offsetMs = (5 * 60 + 30) * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
}

function tomorrowIst(): string {
  const offsetMs = (5 * 60 + 30) * 60 * 1000;
  return new Date(Date.now() + offsetMs + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

// 60 days = the API hard cap. We mirror it here so the
// HTML date-picker's `max=` attribute forms a soft fence; the
// API's check is the real guard.
const MAX_REPEAT_DAYS = 60;

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const f = new Date(fromIso + 'T00:00:00Z').getTime();
  const t = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((t - f) / (24 * 60 * 60 * 1000));
}

function emptyForm(): FormState {
  const tomorrow = tomorrowIst();
  return {
    title: '',
    body: '',
    fire_on: tomorrow,
    repeating: false,
    send_until: tomorrow,
  };
}

export default function AdminRemindersPage() {
  const [tab, setTab] = useState<TabId>('pending');
  const [reminders, setReminders] = useState<ScheduledReminder[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<ScheduledReminder | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/reminders', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load reminders');
      setReminders((data.reminders ?? []) as ScheduledReminder[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Failed rows live with the rest in the table — we surface them at
  // the top of the Pending tab as an alert because they need admin
  // attention. Treating them as a "sub-tab" of Pending keeps the
  // top-level UI simple.
  const failed = useMemo(() => reminders.filter((r) => r.status === 'failed'), [reminders]);
  const filtered = useMemo(() => {
    const status = TABS.find((t) => t.id === tab)?.status ?? 'pending';
    return reminders.filter((r) => r.status === status);
  }, [reminders, tab]);

  function openCreate() {
    setForm(emptyForm());
    setEditing(null);
    setShowCreate(true);
  }

  function openEdit(r: ScheduledReminder) {
    setForm({
      title: r.title,
      body: r.body,
      fire_on: r.fire_on,
      repeating: r.send_until !== null,
      // If the row was single-fire, seed the picker with fire_on so
      // toggling repeating-on doesn't leave an empty / stale value.
      send_until: r.send_until ?? r.fire_on,
    });
    setEditing(r);
    setShowCreate(true);
  }

  function closeModal() {
    setShowCreate(false);
    setEditing(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const title = form.title.trim();
    const body = form.body.trim();
    const fireOn = form.fire_on.trim();
    const sendUntil = form.repeating ? form.send_until.trim() : null;

    if (!title) return toast.error('Title is required');
    if (!body) return toast.error('Body is required');
    if (!fireOn) return toast.error('Pick a fire date');
    if (form.repeating) {
      if (!sendUntil) return toast.error('Pick a "send until" date');
      if (sendUntil < fireOn)
        return toast.error('"Send until" cannot be before the start date');
      const span = daysBetweenIso(fireOn, sendUntil);
      if (span > MAX_REPEAT_DAYS)
        return toast.error(
          `Repeating window is ${span} days; max ${MAX_REPEAT_DAYS}.`,
        );
    }
    if (fireOn < todayIst()) {
      const ok = confirm(
        'Start date is in the past — the reminder will fire on the next cron run. Continue?',
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const url = editing
        ? `/api/admin/reminders/${editing.id}`
        : '/api/admin/reminders';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          body,
          fire_on: fireOn,
          send_until: sendUntil,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      toast.success(editing ? 'Reminder updated' : 'Reminder scheduled');
      closeModal();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function cancelReminder(r: ScheduledReminder) {
    if (!confirm(`Cancel "${r.title}"? It will not be sent.`)) return;
    try {
      const res = await fetch(`/api/admin/reminders/${r.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Cancel failed');
      toast.success('Reminder cancelled');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed');
    }
  }

  async function fireNow(r: ScheduledReminder) {
    const tail =
      r.send_until !== null && r.status === 'pending'
        ? ' This will ALSO end the daily schedule — remaining days will not fire automatically.'
        : '';
    if (
      !confirm(
        `Send "${r.title}" right now to every resident? This bypasses the schedule.${tail}`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/admin/reminders/${r.id}/fire-now`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Dispatch failed');
      toast.success('Reminder sent');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dispatch failed');
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#1B5E20] rounded-xl flex items-center justify-center">
            <AlarmClock size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Scheduled Reminders</h1>
            <p className="text-sm text-gray-500">
              Society-wide push + Telegram, fired by the daily 09:00 IST cron.
            </p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} />
          New
        </Button>
      </div>

      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
        <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 leading-relaxed">
          Reminders are picked up <strong>once a day at 09:00 IST</strong>. A
          reminder dated today (or any past date) fires on the next 09:00 IST
          run — they don&rsquo;t fire at a specific time of day. Pick{' '}
          <strong>Send daily through</strong> a later date to repeat the same
          reminder for several mornings (max {MAX_REPEAT_DAYS} days). For
          time-sensitive notices, use <strong>Send now</strong> from the row
          menu, or post a Broadcast/Announcement directly.
        </p>
      </div>

      {failed.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-600" />
            <h2 className="text-sm font-bold text-red-800">
              {failed.length} reminder{failed.length === 1 ? '' : 's'} failed to dispatch
            </h2>
          </div>
          <ul className="space-y-2">
            {failed.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-red-900 truncate">{r.title}</p>
                  <p className="text-xs text-red-700 truncate" title={r.error_message ?? ''}>
                    {r.error_message ?? 'Unknown error'}
                  </p>
                </div>
                <button
                  onClick={() => fireNow(r)}
                  className="text-xs font-semibold text-red-700 hover:text-red-900 whitespace-nowrap"
                >
                  Retry
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
        {TABS.map((t) => {
          const count = reminders.filter((r) => r.status === t.status).length;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 text-sm font-medium rounded-lg py-2 transition-colors ${
                active
                  ? 'bg-white text-[#1B5E20] shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className="ml-1.5 text-xs text-gray-400">({count})</span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-500">
          {tab === 'pending'
            ? 'No upcoming reminders. Tap New to schedule one.'
            : tab === 'sent'
              ? 'No reminders have been sent yet.'
              : 'No cancelled reminders.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => (
            <ReminderRow
              key={r.id}
              reminder={r}
              onEdit={openEdit}
              onCancel={cancelReminder}
              onFireNow={fireNow}
            />
          ))}
        </ul>
      )}

      {showCreate && (
        <Modal
          editing={!!editing}
          form={form}
          setForm={setForm}
          onClose={closeModal}
          onSubmit={submit}
          saving={saving}
        />
      )}
    </div>
  );
}

function ReminderRow({
  reminder,
  onEdit,
  onCancel,
  onFireNow,
}: {
  reminder: ScheduledReminder;
  onEdit: (r: ScheduledReminder) => void;
  onCancel: (r: ScheduledReminder) => void;
  onFireNow: (r: ScheduledReminder) => void;
}) {
  const isPending = reminder.status === 'pending';
  const isSent = reminder.status === 'sent';
  const isCancelled = reminder.status === 'cancelled';

  let fireLabel = '';
  try {
    fireLabel = format(parseISO(reminder.fire_on), 'EEE, dd MMM yyyy');
  } catch {
    fireLabel = reminder.fire_on;
  }
  // For repeating reminders we render a date range instead of a
  // single date. Falls back gracefully if either ISO is malformed.
  const isRepeating = reminder.send_until !== null;
  let scheduleLabel = fireLabel;
  if (isRepeating) {
    let endLabel = reminder.send_until!;
    try {
      endLabel = format(parseISO(reminder.send_until!), 'dd MMM yyyy');
    } catch {
      // keep the raw ISO
    }
    let startShort = reminder.fire_on;
    try {
      startShort = format(parseISO(reminder.fire_on), 'dd MMM');
    } catch {
      // keep the raw ISO
    }
    scheduleLabel = `${startShort} → ${endLabel}`;
  }
  const sentRel = reminder.sent_at
    ? formatDistanceToNow(parseISO(reminder.sent_at), { addSuffix: true })
    : null;

  return (
    <li className="bg-white rounded-2xl shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 truncate">{reminder.title}</p>
          <p className="text-sm text-gray-600 mt-1 line-clamp-3 whitespace-pre-wrap">
            {reminder.body}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Calendar size={12} />
              {scheduleLabel}
            </span>
            {isRepeating && isPending && (
              <span className="inline-flex items-center gap-1 text-[#1B5E20] bg-emerald-50 px-1.5 py-0.5 rounded-md">
                <Clock size={11} />
                Daily · fired {reminder.fired_count}×
                {reminder.last_fired_on && (
                  <span className="text-gray-500">
                    {' '}· last {(() => {
                      try {
                        return format(parseISO(reminder.last_fired_on), 'dd MMM');
                      } catch {
                        return reminder.last_fired_on;
                      }
                    })()}
                  </span>
                )}
              </span>
            )}
            {isSent && sentRel && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 size={12} />
                Sent {sentRel}
                {reminder.fired_count > 1 && ` · ${reminder.fired_count}×`}
              </span>
            )}
            {isCancelled && (
              <span className="inline-flex items-center gap-1 text-gray-500">
                <XCircle size={12} />
                Cancelled
              </span>
            )}
            {!isRepeating && !isSent && !isCancelled && reminder.fired_count > 1 && (
              <span className="inline-flex items-center gap-1 text-gray-500">
                <Clock size={12} />
                Fired {reminder.fired_count}×
              </span>
            )}
          </div>
        </div>
        {isPending && (
          <div className="flex flex-col gap-1.5 shrink-0">
            <button
              onClick={() => onFireNow(reminder)}
              className="text-xs font-medium text-[#1B5E20] hover:text-[#0d3d10] inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-emerald-50"
              title="Send right now, bypassing the schedule"
            >
              <Send size={12} />
              Send now
            </button>
            <button
              onClick={() => onEdit(reminder)}
              className="text-xs font-medium text-gray-700 hover:text-gray-900 inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-gray-100"
            >
              <Pencil size={12} />
              Edit
            </button>
            <button
              onClick={() => onCancel(reminder)}
              className="text-xs font-medium text-red-600 hover:text-red-800 inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-red-50"
            >
              <Trash2 size={12} />
              Cancel
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function Modal({
  editing,
  form,
  setForm,
  onClose,
  onSubmit,
  saving,
}: {
  editing: boolean;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {editing ? 'Edit reminder' : 'New reminder'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
            aria-label="Close"
          >
            <XCircle size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Input
            label="Title"
            value={form.title}
            onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
            maxLength={120}
            placeholder="e.g. Society vote tomorrow"
          />

          <Textarea
            label="Message"
            value={form.body}
            onChange={(e) => setForm((s) => ({ ...s, body: e.target.value }))}
            rows={5}
            maxLength={1500}
            placeholder="What should residents see?"
          />

          <Input
            label={form.repeating ? 'Start date' : 'Fire date'}
            type="date"
            value={form.fire_on}
            onChange={(e) =>
              setForm((s) => {
                const newFireOn = e.target.value;
                // If the start date moves past send_until,
                // pull send_until forward to match. Keeps the
                // form internally consistent without yelling at
                // the admin mid-typing.
                const newSendUntil =
                  s.repeating && s.send_until && s.send_until < newFireOn
                    ? newFireOn
                    : s.send_until;
                return { ...s, fire_on: newFireOn, send_until: newSendUntil };
              })
            }
            min={todayIst()}
          />

          {/* Repeating toggle. Single click swaps the body of the
              date section between a single-line note and a second
              date picker. */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.repeating}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  repeating: e.target.checked,
                  // When opting in, default the end date to fire_on
                  // (i.e. just one day) if it's older than fire_on.
                  send_until:
                    e.target.checked && s.send_until < s.fire_on
                      ? s.fire_on
                      : s.send_until,
                }))
              }
            />
            <span className="text-sm text-gray-700">
              Send daily through an end date
              <span className="block text-xs text-gray-500">
                Same reminder fires every morning at 09:00 IST until the end
                date. Useful for nag campaigns (vote-closing reminders, dues
                deadlines).
              </span>
            </span>
          </label>

          {form.repeating ? (
            <>
              <Input
                label="Send daily through"
                type="date"
                value={form.send_until}
                onChange={(e) =>
                  setForm((s) => ({ ...s, send_until: e.target.value }))
                }
                min={form.fire_on}
                max={addDaysIso(form.fire_on, MAX_REPEAT_DAYS)}
              />
              <p className="text-xs text-gray-500 -mt-2">
                Will fire {Math.max(1, daysBetweenIso(form.fire_on, form.send_until) + 1)}× —
                once each morning from {form.fire_on} through {form.send_until}.
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500 -mt-2">
              Reminder will be sent at the next 09:00 IST on or after this date.
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <Button type="submit" loading={saving}>
            {editing ? 'Save changes' : 'Schedule'}
          </Button>
        </div>
      </form>
    </div>
  );
}
