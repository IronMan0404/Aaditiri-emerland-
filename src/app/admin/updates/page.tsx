'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { format } from 'date-fns';
import type { Update } from '@/types';

const CATEGORIES = ['General', 'Maintenance', 'Security', 'Finance', 'Social', 'Infrastructure'];
const CAT_COLORS: Record<string, string> = { General: 'bg-blue-100 text-blue-700', Maintenance: 'bg-orange-100 text-orange-700', Security: 'bg-red-100 text-red-700', Finance: 'bg-green-100 text-green-700', Social: 'bg-purple-100 text-purple-700', Infrastructure: 'bg-amber-100 text-amber-700' };

export default function UpdatesPage() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Update[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', category: 'General' });
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  const fetch = async () => {
    const { data } = await supabase.from('updates').select('*').order('created_at', { ascending: false });
    if (data) setItems(data);
    setLoading(false);
  };
  useEffect(() => { fetch(); }, []);

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.content) { toast.error('Title and content required'); return; }
    setSaving(true);
    const { error } = await supabase.from('updates').insert({ ...form, created_by: profile?.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Update posted!');
    setOpen(false);
    setForm({ title: '', content: '', category: 'General' });
    fetch();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this update?')) return;
    await supabase.from('updates').delete().eq('id', id);
    toast.success('Deleted');
    fetch();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Community Updates</h1>
        <Button onClick={() => setOpen(true)} size="sm"><Plus size={16} />Post Update</Button>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : items.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No updates posted</p>
      ) : (
        <div className="space-y-3">
          {items.map((u) => (
            <div key={u.id} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${CAT_COLORS[u.category] || 'bg-gray-100 text-gray-600'}`}>{u.category}</span>
                  </div>
                  <h3 className="font-bold text-gray-900">{u.title}</h3>
                  <p className="text-sm text-gray-600 mt-1 leading-relaxed">{u.content}</p>
                  <p className="text-xs text-gray-400 mt-2">{format(new Date(u.created_at), 'dd MMM yyyy')}</p>
                </div>
                <button onClick={() => handleDelete(u.id)} className="text-gray-300 hover:text-red-500 transition-colors mt-1"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Post Community Update">
        <form onSubmit={handlePost} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Category</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button key={cat} type="button" onClick={() => setForm({ ...form, category: cat })} className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${form.category === cat ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white text-gray-700 border-gray-200 hover:border-[#1B5E20]'}`}>{cat}</button>
              ))}
            </div>
          </div>
          <Input label="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label="Content *" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={5} />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Post</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
