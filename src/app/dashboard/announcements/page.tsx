'use client';
import { useEffect, useState } from 'react';
import { Plus, Pin, PinOff, Trash2, Megaphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { format } from 'date-fns';
import type { Announcement } from '@/types';

export default function AnnouncementsPage() {
  const { profile, isAdmin } = useAuth();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', is_pinned: false });
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  const fetch = async () => {
    const { data } = await supabase.from('announcements').select('*, profiles(full_name)').order('is_pinned', { ascending: false }).order('created_at', { ascending: false });
    if (data) setItems(data);
    setLoading(false);
  };
  useEffect(() => { fetch(); }, []);

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.content) { toast.error('Title and content required'); return; }
    setSaving(true);
    const { data: inserted, error } = await supabase
      .from('announcements')
      .insert({ ...form, created_by: profile?.id })
      .select('id')
      .single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Announcement posted!');
    setOpen(false);
    setForm({ title: '', content: '', is_pinned: false });
    fetch();

    // Fire-and-forget multi-channel fan-out. The row is already
    // visible in-app via the local fetch() above; push + Telegram
    // are best-effort.
    if (inserted?.id) {
      try {
        await globalThis.fetch('/api/push/announcement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ announcementId: inserted.id }),
        });
      } catch {
        // Channels are best-effort; in-app is authoritative.
      }
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this announcement?')) return;
    await supabase.from('announcements').delete().eq('id', id);
    toast.success('Deleted');
    fetch();
  }

  // Optimistic pin/unpin: flip the flag locally first so the row jumps
  // to / from the top instantly, then reconcile with the server. If the
  // RLS UPDATE fails (e.g. policy not yet applied on a stale DB) we
  // roll back and surface the real error so it can be debugged.
  async function handleTogglePin(a: Announcement) {
    const next = !a.is_pinned;
    setItems((prev) =>
      [...prev.map((x) => (x.id === a.id ? { ...x, is_pinned: next } : x))]
        .sort((p, q) => {
          if (p.is_pinned !== q.is_pinned) return p.is_pinned ? -1 : 1;
          return q.created_at.localeCompare(p.created_at);
        })
    );
    const { error } = await supabase
      .from('announcements')
      .update({ is_pinned: next })
      .eq('id', a.id);
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
            <Megaphone size={22} className="text-[#1B5E20]" />
            <h1 className="text-2xl font-bold text-gray-900">Announcements</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">Society-wide updates from your management team.</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setOpen(true)} size="sm" className="flex-shrink-0">
            <Plus size={16} className="mr-1" />New
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <Megaphone className="mx-auto text-gray-300 mb-3" size={36} />
          <p className="text-sm text-gray-500">No announcements yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} className={`bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow ${a.is_pinned ? 'border-l-4 border-l-yellow-400' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {a.is_pinned && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-600 mb-1"><Pin size={10} />Pinned</span>}
                  <h3 className="font-semibold text-gray-900">{a.title}</h3>
                  <p className="text-sm text-gray-600 mt-1 leading-relaxed whitespace-pre-wrap">{a.content}</p>
                  <div className="flex items-center gap-3 mt-3 text-xs">
                    <span className="text-[#1B5E20] font-semibold">{(a.profiles as any)?.full_name || 'Admin'}</span>
                    <span className="text-gray-400">{format(new Date(a.created_at), 'dd MMM yyyy')}</span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <button
                      type="button"
                      onClick={() => handleTogglePin(a)}
                      className={`transition-colors p-1 -m-1 ${
                        a.is_pinned
                          ? 'text-amber-500 hover:text-amber-600'
                          : 'text-gray-300 hover:text-amber-500'
                      }`}
                      title={a.is_pinned ? 'Unpin announcement' : 'Pin announcement to the top'}
                      aria-label={a.is_pinned ? 'Unpin announcement' : 'Pin announcement'}
                    >
                      {a.is_pinned ? <PinOff size={16} /> : <Pin size={16} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors p-1 -m-1"
                      aria-label="Delete announcement"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New Announcement">
        <form onSubmit={handlePost} className="space-y-4">
          <Input label="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Announcement title" />
          <Textarea label="Content *" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={5} placeholder="Write your announcement..." />
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.is_pinned} onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })} className="w-4 h-4 accent-[#1B5E20]" />
            <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><Pin size={14} />Pin this announcement</span>
          </label>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Post</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
