'use client';
import { useEffect, useState } from 'react';
import { Radio, Plus, Trash2, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { format } from 'date-fns';
import type { Broadcast } from '@/types';

export default function BroadcastsPage() {
  const { profile, isAdmin } = useAuth();
  const [items, setItems] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', message: '' });
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  const fetch = async () => {
    const { data } = await supabase.from('broadcasts').select('*, profiles(full_name)').order('created_at', { ascending: false });
    if (data) setItems(data);
    setLoading(false);
  };
  useEffect(() => { fetch(); }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.message) { toast.error('Title and message required'); return; }
    setSaving(true);
    const { data: inserted, error } = await supabase
      .from('broadcasts')
      .insert({ ...form, created_by: profile?.id })
      .select('id')
      .single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Broadcast sent to all residents!');
    setOpen(false);
    setForm({ title: '', message: '' });
    fetch();

    // Fire-and-forget push fan-out. The DB row is the source of truth — if
    // push happens to be unconfigured (no VAPID env vars yet) the API just
    // returns `skipped: 'not_configured'` and we silently move on.
    if (inserted?.id) {
      try {
        const res = await globalThis.fetch('/api/push/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ broadcastId: inserted.id }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          sent?: number; skipped?: string;
        };
        if (res.ok && typeof payload.sent === 'number' && payload.sent > 0) {
          toast.success(`Pushed to ${payload.sent} device${payload.sent === 1 ? '' : 's'}`);
        }
      } catch {
        // Push is best-effort; users still see the broadcast in-app.
      }
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this broadcast?')) return;
    await supabase.from('broadcasts').delete().eq('id', id);
    toast.success('Deleted');
    fetch();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Broadcasts</h1>
        {isAdmin && <Button onClick={() => setOpen(true)} size="sm"><Plus size={16} />Send Broadcast</Button>}
      </div>

      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5">
        <Info size={16} className="text-blue-500 shrink-0" />
        <p className="text-xs text-blue-700">Community-wide messages from the admin team</p>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No broadcasts yet</p>
      ) : (
        <div className="space-y-3">
          {items.map((b) => (
            <div key={b.id} className="bg-white rounded-xl p-4 shadow-sm border-l-4 border-[#1B5E20]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 bg-[#1B5E20] rounded-full flex items-center justify-center"><Radio size={14} className="text-white" /></div>
                    <h3 className="font-bold text-gray-900">{b.title}</h3>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{b.message}</p>
                  <div className="flex gap-3 mt-2">
                    <span className="text-xs text-[#1B5E20] font-semibold">{(b.profiles as any)?.full_name || 'Admin'}</span>
                    <span className="text-xs text-gray-400">{format(new Date(b.created_at), 'dd MMM yyyy, HH:mm')}</span>
                  </div>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleDelete(b.id)}
                    aria-label={`Delete broadcast ${b.title}`}
                    className="text-gray-300 hover:text-red-500 transition-colors mt-1"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Send Community Broadcast">
        <p className="text-sm text-gray-500 mb-4">This message will be visible to all community members.</p>
        <form onSubmit={handleSend} className="space-y-4">
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label="Message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={6} placeholder="Type your broadcast message..." />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Send to All</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
