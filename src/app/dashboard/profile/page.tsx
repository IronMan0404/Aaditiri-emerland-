'use client';
import { useState } from 'react';
import { Camera, LogOut, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function ProfilePage() {
  const { profile, isAdmin, refetchProfile } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ full_name: profile?.full_name || '', phone: profile?.phone || '', flat_number: profile?.flat_number || '', vehicle_number: profile?.vehicle_number || '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name) { toast.error('Name is required'); return; }
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ full_name: form.full_name, phone: form.phone, flat_number: form.flat_number, vehicle_number: form.vehicle_number }).eq('id', profile?.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Profile updated!');
    refetchProfile?.();
    setEditOpen(false);
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    const path = `avatars/${profile.id}.${file.name.split('.').pop()}`;
    await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', profile.id);
    toast.success('Avatar updated!');
    refetchProfile?.();
    setUploading(false);
  }

  async function handleResetPassword() {
    if (!profile?.email) return;
    if (!confirm('Send a password reset email?')) return;
    await supabase.auth.resetPasswordForEmail(profile.email);
    toast.success('Password reset email sent!');
  }

  async function handleSignOut() {
    if (!confirm('Sign out?')) return;
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  const initials = (profile?.full_name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="max-w-md mx-auto px-4 py-6">
      {/* Profile Header */}
      <div className="bg-[#1B5E20] rounded-2xl p-6 text-white text-center mb-4">
        <div className="relative inline-block mb-3">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="avatar" className="w-20 h-20 rounded-full object-cover border-3 border-white" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold">{initials}</div>
          )}
          <label className="absolute bottom-0 right-0 w-7 h-7 bg-[#0A3D02] rounded-full flex items-center justify-center cursor-pointer border-2 border-white">
            <Camera size={13} />
            <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} disabled={uploading} />
          </label>
        </div>
        <h2 className="text-xl font-bold">{profile?.full_name}</h2>
        <p className="text-white/70 text-sm">{profile?.email}</p>
        <div className="flex items-center justify-center gap-2 mt-2">
          {profile?.flat_number && <span className="bg-white/20 px-3 py-1 rounded-full text-xs">Flat {profile.flat_number}</span>}
          {isAdmin && <span className="bg-yellow-400 text-[#1B5E20] px-3 py-1 rounded-full text-xs font-bold">ADMIN</span>}
        </div>
      </div>

      {/* Info */}
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3 mb-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Account Info</h3>
        {[
          { label: 'Full Name', value: profile?.full_name },
          { label: 'Email', value: profile?.email },
          { label: 'Phone', value: profile?.phone || '—' },
          { label: 'Flat Number', value: profile?.flat_number || '—' },
          { label: 'Vehicle Number', value: profile?.vehicle_number || '—' },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
            <span className="text-sm text-gray-500">{label}</span>
            <span className="text-sm font-semibold text-gray-900">{value}</span>
          </div>
        ))}
        <Button variant="outline" onClick={() => { setForm({ full_name: profile?.full_name || '', phone: profile?.phone || '', flat_number: profile?.flat_number || '', vehicle_number: profile?.vehicle_number || '' }); setEditOpen(true); }} className="w-full mt-2">Edit Profile</Button>
      </div>

      {/* Actions */}
      <div className="bg-white rounded-2xl p-4 shadow-sm space-y-2">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Security</h3>
        <button onClick={handleResetPassword} className="flex items-center gap-3 w-full py-2.5 text-sm text-gray-700 hover:text-gray-900 transition-colors">
          <Lock size={16} className="text-gray-400" />Reset Password
        </button>
        <button onClick={handleSignOut} className="flex items-center gap-3 w-full py-2.5 text-sm text-red-600 hover:text-red-700 transition-colors border-t pt-3">
          <LogOut size={16} />Sign Out
        </button>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Profile">
        <form onSubmit={handleSave} className="space-y-4">
          <Input label="Full Name *" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <Input label="Phone Number" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Flat Number" value={form.flat_number} onChange={(e) => setForm({ ...form, flat_number: e.target.value })} placeholder="e.g. A-201" />
          <Input label="Vehicle Number" value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} placeholder="e.g. TS09AB1234" />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
