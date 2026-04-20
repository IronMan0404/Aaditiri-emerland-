'use client';
import { useEffect, useState, useRef } from 'react';
import { Camera, X, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Image from 'next/image';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { format } from 'date-fns';
import { safeImageUrl } from '@/lib/safe-url';
import type { Photo } from '@/types';

export default function GalleryPage() {
  const { profile, isAdmin } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<Photo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const fetch = async () => {
    const { data } = await supabase.from('photos').select('*, profiles(full_name)').order('created_at', { ascending: false });
    if (data) setPhotos(data);
    setLoading(false);
  };
  useEffect(() => { fetch(); }, []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelected(file);
    setPreview(URL.createObjectURL(file));
    setOpen(true);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !profile) return;
    setUploading(true);
    try {
      const ext = selected.name.split('.').pop();
      const path = `${profile.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('photos').upload(path, selected, { upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path);
      await supabase.from('photos').insert({ user_id: profile.id, url: publicUrl, caption: caption.trim() });
      toast.success('Photo shared!');
      setOpen(false);
      setSelected(null);
      setPreview(null);
      setCaption('');
      fetch();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(photo: Photo) {
    if (!confirm('Delete this photo?')) return;
    setDeleting(true);
    const pathMatch = photo.url.match(/photos\/(.+)$/);
    if (pathMatch) {
      await supabase.storage.from('photos').remove([decodeURIComponent(pathMatch[1])]);
    }
    const { error } = await supabase.from('photos').delete().eq('id', photo.id);
    setDeleting(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Photo deleted');
    setViewer(null);
    fetch();
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Gallery</h1>
        <Button onClick={() => fileRef.current?.click()} size="sm"><Camera size={16} />Add Photo</Button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-1">{[...Array(9)].map((_, i) => <div key={i} className="aspect-square bg-gray-100 rounded-lg animate-pulse" />)}</div>
      ) : photos.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No photos yet. Share the first one!</p>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 gap-1">
          {photos.map((p) => {
            const src = safeImageUrl(p.url);
            if (!src) return null;
            return (
            <button key={p.id} onClick={() => setViewer(p)} className="aspect-square relative overflow-hidden rounded-lg group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={encodeURI(src)} alt={p.caption || ''} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
              {p.caption && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-white text-xs line-clamp-1">{p.caption}</p>
                </div>
              )}
            </button>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      <Modal open={open} onClose={() => { setOpen(false); setSelected(null); setPreview(null); }} title="Share Photo">
        <form onSubmit={handleUpload} className="space-y-4">
          {(() => {
            const safePreview = safeImageUrl(preview);
            return safePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={encodeURI(safePreview)} alt="preview" className="w-full h-48 object-cover rounded-xl" />
            ) : null;
          })()}
          <Input label="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption..." />
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => { setOpen(false); setSelected(null); setPreview(null); }} className="flex-1">Cancel</Button>
            <Button type="submit" loading={uploading} className="flex-1">Upload</Button>
          </div>
        </form>
      </Modal>

      {/* Viewer */}
      {(() => {
        if (!viewer) return null;
        const safeViewerUrl = safeImageUrl(viewer.url);
        if (!safeViewerUrl) return null;
        return (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-4" onClick={() => setViewer(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setViewer(null)}><X size={28} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={encodeURI(safeViewerUrl)} alt={viewer.caption || ''} className="max-w-full max-h-[75vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          {viewer.caption && <p className="text-white/80 text-sm mt-3">{viewer.caption}</p>}
          <p className="text-white/50 text-xs mt-1">by {(viewer.profiles as any)?.full_name} · {format(new Date(viewer.created_at), 'dd MMM yyyy')}</p>
          {(isAdmin || viewer.user_id === profile?.id) && (
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(viewer); }}
              disabled={deleting}
              className="mt-3 flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <Trash2 size={16} />
              {deleting ? 'Deleting...' : 'Delete Photo'}
            </button>
          )}
        </div>
        );
      })()}
    </div>
  );
}
