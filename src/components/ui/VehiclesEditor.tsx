'use client';
import { useState } from 'react';
import { Car, Bike, Plus, Trash2, MoreHorizontal, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Vehicle, VehicleType } from '@/types';
import { createClient } from '@/lib/supabase';

/**
 * Editable list of a resident's vehicles. Two modes:
 *
 *   - **Persistent mode** (`userId` provided): every add/remove/type-change
 *     writes straight to Supabase against the `vehicles` table. Use this on
 *     the profile page and the admin edit modal.
 *
 *   - **Draft mode** (`userId` omitted): the component only manages local
 *     state and calls `onChange` with the current draft list. The parent is
 *     responsible for persisting on submit. Use this in the registration form
 *     where the user_id doesn't exist yet.
 *
 * The parent always gets fresh state via `onChange` so it can re-render
 * counts / summaries elsewhere.
 */

const TYPE_META: Record<VehicleType, { label: string; icon: typeof Car }> = {
  car:   { label: 'Car',   icon: Car },
  bike:  { label: 'Bike',  icon: Bike },
  other: { label: 'Other', icon: MoreHorizontal },
};
const TYPE_OPTIONS: VehicleType[] = ['car', 'bike', 'other'];

export type VehicleDraft = Pick<Vehicle, 'number' | 'type'> & { id?: string };

interface Props {
  /** Existing vehicles. In persistent mode these are full Vehicle rows; in draft mode they are drafts. */
  vehicles: VehicleDraft[];
  onChange: (next: VehicleDraft[]) => void;
  /** When provided, mutations are written to the `vehicles` table for this user immediately. */
  userId?: string;
  disabled?: boolean;
}

function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, '').trim();
}

export default function VehiclesEditor({ vehicles, onChange, userId, disabled }: Props) {
  const supabase = createClient();
  const [newNumber, setNewNumber] = useState('');
  const [newType, setNewType] = useState<VehicleType>('car');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    const number = normalizePlate(newNumber);
    if (!number) { toast.error('Enter a vehicle number'); return; }
    if (number.length < 4) { toast.error('Vehicle number looks too short'); return; }
    if (vehicles.some((v) => normalizePlate(v.number) === number)) {
      toast.error('Already added'); return;
    }

    if (userId) {
      setAdding(true);
      const { data, error } = await supabase
        .from('vehicles')
        .insert({ user_id: userId, number, type: newType })
        .select('id, number, type')
        .single();
      setAdding(false);
      if (error) { toast.error(error.message); return; }
      onChange([...vehicles, { id: data!.id, number: data!.number, type: data!.type as VehicleType }]);
    } else {
      onChange([...vehicles, { number, type: newType }]);
    }
    setNewNumber('');
    setNewType('car');
  }

  async function handleRemove(target: VehicleDraft, index: number) {
    if (userId && target.id) {
      setBusyId(target.id);
      const { error } = await supabase.from('vehicles').delete().eq('id', target.id);
      setBusyId(null);
      if (error) { toast.error(error.message); return; }
    }
    onChange(vehicles.filter((_, i) => i !== index));
  }

  async function handleTypeChange(target: VehicleDraft, index: number, nextType: VehicleType) {
    if (userId && target.id) {
      setBusyId(target.id);
      const { error } = await supabase.from('vehicles').update({ type: nextType }).eq('id', target.id);
      setBusyId(null);
      if (error) { toast.error(error.message); return; }
    }
    const next = vehicles.slice();
    next[index] = { ...target, type: nextType };
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {vehicles.length === 0 && (
        <p className="text-xs text-gray-400 italic">No vehicles added yet.</p>
      )}

      {vehicles.map((v, i) => {
        const Icon = TYPE_META[v.type].icon;
        const rowBusy = busyId === v.id;
        return (
          <div key={v.id ?? i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
            <Icon size={16} className="text-[#1B5E20] shrink-0" />
            <span className="text-sm font-semibold text-gray-900 font-mono tracking-wide flex-1 truncate">{v.number}</span>
            <select
              value={v.type}
              disabled={disabled || rowBusy}
              onChange={(e) => handleTypeChange(v, i, e.target.value as VehicleType)}
              aria-label={`Type for ${v.number}`}
              className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{TYPE_META[t].label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => handleRemove(v, i)}
              disabled={disabled || rowBusy}
              aria-label={`Remove ${v.number}`}
              title={`Remove ${v.number}`}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
            >
              {rowBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-2 pt-1">
        <input
          type="text"
          value={newNumber}
          onChange={(e) => setNewNumber(e.target.value)}
          placeholder="TS09AB1234"
          aria-label="New vehicle number"
          disabled={disabled || adding}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-xl text-sm font-mono uppercase tracking-wide bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent disabled:opacity-50"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        />
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value as VehicleType)}
          disabled={disabled || adding}
          aria-label="Type for new vehicle"
          className="text-sm bg-white border border-gray-300 rounded-xl px-2 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{TYPE_META[t].label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || adding || !newNumber.trim()}
          aria-label="Add vehicle"
          title="Add vehicle"
          className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-[#1B5E20] text-white hover:bg-[#2E7D32] transition-colors disabled:opacity-40"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={16} />}
        </button>
      </div>
    </div>
  );
}
