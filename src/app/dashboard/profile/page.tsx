'use client';
import { useEffect, useState } from 'react';
import { Camera, LogOut, Lock, MessageCircle, Car, Users, PawPrint } from 'lucide-react';
import toast from 'react-hot-toast';
import { createClient } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import VehiclesEditor, { type VehicleDraft } from '@/components/ui/VehiclesEditor';
import FamilyEditor, { type FamilyMemberDraft } from '@/components/ui/FamilyEditor';
import PetsEditor, { type PetDraft } from '@/components/ui/PetsEditor';
import TelegramConnect from '@/components/notifications/TelegramConnect';
import { safeImageUrl } from '@/lib/safe-url';

export default function ProfilePage() {
  const { profile, isAdmin, refetchProfile } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ full_name: profile?.full_name || '', phone: profile?.phone || '', flat_number: profile?.flat_number || '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleDraft[]>([]);
  const [family, setFamily] = useState<FamilyMemberDraft[]>([]);
  const [pets, setPets] = useState<PetDraft[]>([]);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    (async () => {
      const [{ data: vehiclesData }, { data: familyData }, { data: petsData }] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, number, type')
          .eq('user_id', profile.id)
          .order('created_at'),
        supabase
          .from('family_members')
          .select('id, full_name, relation, gender, age, phone, email, account_profile_id, invitation_id')
          .eq('user_id', profile.id)
          .order('created_at'),
        supabase
          .from('pets')
          .select('id, name, species, vaccinated')
          .eq('user_id', profile.id)
          .order('created_at'),
      ]);
      if (cancelled) return;
      if (vehiclesData) setVehicles(vehiclesData as VehicleDraft[]);
      if (familyData) setFamily(familyData as FamilyMemberDraft[]);
      if (petsData) setPets(petsData as PetDraft[]);
    })();
    return () => { cancelled = true; };
  }, [profile?.id, supabase]);

  const whatsappOptIn = profile?.whatsapp_opt_in !== false;

  async function toggleWhatsAppOptIn() {
    if (!profile) return;
    setWhatsappSaving(true);
    const next = !whatsappOptIn;
    const { error } = await supabase
      .from('profiles')
      .update({ whatsapp_opt_in: next })
      .eq('id', profile.id);
    setWhatsappSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(next ? 'WhatsApp notifications turned on' : 'WhatsApp notifications turned off');
    refetchProfile?.();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name) { toast.error('Name is required'); return; }
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ full_name: form.full_name, phone: form.phone, flat_number: form.flat_number }).eq('id', profile?.id);
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
  const safeAvatar = safeImageUrl(profile?.avatar_url);

  return (
    <div className="max-w-md mx-auto px-4 py-6">
      {/* Profile Header */}
      <div className="bg-[#1B5E20] rounded-2xl p-6 text-white text-center mb-4">
        <div className="relative inline-block mb-3">
          {safeAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={encodeURI(safeAvatar)} alt="avatar" className="w-20 h-20 rounded-full object-cover border-3 border-white" />
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
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
            <span className="text-sm text-gray-500">{label}</span>
            <span className="text-sm font-semibold text-gray-900">{value}</span>
          </div>
        ))}
        <Button variant="outline" onClick={() => { setForm({ full_name: profile?.full_name || '', phone: profile?.phone || '', flat_number: profile?.flat_number || '' }); setEditOpen(true); }} className="w-full mt-2">Edit Profile</Button>
      </div>

      {/* Vehicles */}
      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <Car size={12} />Vehicles
          </h3>
          <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
            {vehicles.length}
          </span>
        </div>
        <VehiclesEditor vehicles={vehicles} onChange={setVehicles} userId={profile?.id} />
      </div>

      {/* Family Members */}
      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <Users size={12} />Family Members
          </h3>
          <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
            {family.length}
          </span>
        </div>
        <FamilyEditor members={family} onChange={setFamily} userId={profile?.id} />
      </div>

      {/* Pets */}
      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <PawPrint size={12} />Pets
          </h3>
          <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
            {pets.length}
          </span>
        </div>
        <PetsEditor pets={pets} onChange={setPets} userId={profile?.id} />
      </div>

      {/* Notifications */}
      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Notifications</h3>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <MessageCircle size={16} className="text-[#25D366] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">WhatsApp from Aaditri Bot</p>
              <p className="text-xs text-gray-500 leading-snug mt-0.5">
                Admin broadcasts sent to <span className="font-medium text-gray-700">{profile?.phone || 'your phone'}</span>.
                {!profile?.phone && ' Add a phone number above to receive them.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            onClick={toggleWhatsAppOptIn}
            disabled={whatsappSaving}
            aria-checked={whatsappOptIn}
            aria-label={whatsappOptIn ? 'Turn off WhatsApp notifications' : 'Turn on WhatsApp notifications'}
            title={whatsappOptIn ? 'Turn off WhatsApp notifications' : 'Turn on WhatsApp notifications'}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${whatsappOptIn ? 'bg-[#1B5E20]' : 'bg-gray-300'} disabled:opacity-50`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${whatsappOptIn ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100">
          <TelegramConnect />
        </div>
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
          <p className="text-xs text-gray-400 -mt-1">Vehicles are managed in the &ldquo;Vehicles&rdquo; section above.</p>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" loading={saving} className="flex-1">Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
