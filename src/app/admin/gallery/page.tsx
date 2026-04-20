'use client';
import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { format } from 'date-fns';
import { safeImageUrl } from '@/lib/safe-url';
import type { Photo } from '@/types';

export default function AdminGalleryPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<Photo | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const supabase = createClient();

  const fetchPhotos = async () => {
    const { data } = await supabase
      .from('photos')
      .select('*, profiles(full_name, flat_number)')
      .order('created_at', { ascending: false });
    if (data) setPhotos(data);
    setLoading(false);
  };

  useEffect(() => { fetchPhotos(); }, []);

  async function handleDelete(photo: Photo) {
    if (!confirm('Delete this photo permanently?')) return;
    setDeleting(photo.id);
    const pathMatch = photo.url.match(/photos\/(.+)$/);
    if (pathMatch) {
      await supabase.storage.from('photos').remove([decodeURIComponent(pathMatch[1])]);
    }
    const { error } = await supabase.from('photos').delete().eq('id', photo.id);
    setDeleting(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Photo deleted');
    setViewer(null);
    fetchPhotos();
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Gallery Management</h1>
        <span className="text-sm text-gray-500">{photos.length} photos</span>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-1">{[...Array(9)].map((_, i) => <div key={i} className="aspect-square bg-gray-100 rounded-lg animate-pulse" />)}</div>
      ) : photos.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No photos yet</p>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 gap-1">
          {photos.map((p) => {
            const src = safeImageUrl(p.url);
            if (!src) return null;
            return (
              <button key={p.id} onClick={() => setViewer(p)} className="aspect-square relative overflow-hidden rounded-lg group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={encodeURI(src)} alt={p.caption || ''} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <Trash2 size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {(() => {
        if (!viewer) return null;
        const safeViewerUrl = safeImageUrl(viewer.url);
        if (!safeViewerUrl) return null;
        return (
        <div className="fixed inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-4" onClick={() => setViewer(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setViewer(null)}><X size={28} /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={encodeURI(safeViewerUrl)} alt={viewer.caption || ''} className="max-w-full max-h-[70vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          {viewer.caption && <p className="text-white/80 text-sm mt-3">{viewer.caption}</p>}
          <p className="text-white/50 text-xs mt-1">
            by {(viewer.profiles as any)?.full_name}
            {(viewer.profiles as any)?.flat_number ? ` · Flat ${(viewer.profiles as any).flat_number}` : ''}
            {' · '}{format(new Date(viewer.created_at), 'dd MMM yyyy')}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(viewer); }}
            disabled={deleting === viewer.id}
            className="mt-4 flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          >
            <Trash2 size={16} />
            {deleting === viewer.id ? 'Deleting...' : 'Delete Photo'}
          </button>
        </div>
        );
      })()}
    </div>
  );
}
