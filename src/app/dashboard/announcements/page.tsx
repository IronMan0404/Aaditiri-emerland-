'use client';
import { useEffect, useState } from 'react';
import { Plus, Pin, Trash2 } from 'lucide-react';
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
    const { error } = await supabase.from('announcements').insert({ ...form, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Announcement posted!');
    setOpen(false);
    setForm({ title: '', content: '', is_pinned: false });
    fetch();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this announcement?')) return;
    await supabase.from('announcements').delete().eq('id', id);
    toast.success('Deleted');
    fetch();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Announcements</h1>
        {isAdmin && <Button onClick={() => setOpen(true)} size="sm"><Plus size={16} />New</Button>}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No announcements yet</p>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} className={`bg-white rounded-xl p-4 shadow-sm ${a.is_pinned ? 'border-l-4 border-yellow-400' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  {a.is_pinned && <span className="flex items-center gap-1 text-xs text-amber-600 font-bold mb-1"><Pin size={10} />Pinned</span>}
                  <h3 className="font-bold text-gray-900">{a.title}</h3>
                  <p className="text-sm text-gray-600 mt-1 leading-relaxed">{a.content}</p>
                  <div className="flex items-center gap-3 mt-3">
                    <span className="text-xs text-[#1B5E20] font-semibold">{(a.profiles as any)?.full_name || 'Admin'}</span>
                    <span className="text-xs text-gray-400">{format(new Date(a.created_at), 'dd MMM yyyy')}</span>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={() => handleDelete(a.id)} className="text-gray-300 hover:text-red-500 transition-colors mt-1">
                    <Trash2 size={16} />
                  </button>
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
