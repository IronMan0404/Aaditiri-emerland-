'use client';
import { useState } from 'react';
import { Plus, Trash2, Loader2, PawPrint } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Pet, PetSpecies } from '@/types';
import { createClient } from '@/lib/supabase';

/**
 * Editable list of a resident's pets. Two modes:
 *
 *   - **Persistent mode** (`userId` provided): every add/remove/toggle
 *     writes straight to Supabase against the `pets` table.
 *   - **Draft mode** (`userId` omitted): managed in local state only;
 *     parent persists on submit (used by registration form).
 */

const SPECIES_OPTIONS: { value: PetSpecies; label: string; emoji: string }[] = [
  { value: 'dog',   label: 'Dog',   emoji: '🐕' },
  { value: 'cat',   label: 'Cat',   emoji: '🐈' },
  { value: 'bird',  label: 'Bird',  emoji: '🐦' },
  { value: 'other', label: 'Other', emoji: '🐾' },
];

const SPECIES_LABEL: Record<PetSpecies, string> = Object.fromEntries(
  SPECIES_OPTIONS.map((s) => [s.value, `${s.emoji} ${s.label}`]),
) as Record<PetSpecies, string>;

export type PetDraft = Pick<Pet, 'name' | 'species' | 'vaccinated'> & { id?: string };

interface Props {
  pets: PetDraft[];
  onChange: (next: PetDraft[]) => void;
  /** When provided, mutations are written immediately. */
  userId?: string;
  disabled?: boolean;
}

export default function PetsEditor({ pets, onChange, userId, disabled }: Props) {
  const supabase = createClient();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PetDraft>({ name: '', species: 'dog', vaccinated: false });

  function resetDraft() {
    setDraft({ name: '', species: 'dog', vaccinated: false });
  }

  async function handleAdd() {
    const name = draft.name.trim();
    if (!name) { toast.error('Enter a pet name'); return; }

    const payload = { name, species: draft.species, vaccinated: draft.vaccinated };

    if (userId) {
      setAdding(true);
      const { data, error } = await supabase
        .from('pets')
        .insert({ user_id: userId, ...payload })
        .select('id, name, species, vaccinated')
        .single();
      setAdding(false);
      if (error) { toast.error(error.message); return; }
      onChange([...pets, data as PetDraft]);
    } else {
      onChange([...pets, payload]);
    }
    resetDraft();
  }

  async function handleRemove(target: PetDraft, index: number) {
    if (userId && target.id) {
      setBusyId(target.id);
      const { error } = await supabase.from('pets').delete().eq('id', target.id);
      setBusyId(null);
      if (error) { toast.error(error.message); return; }
    }
    onChange(pets.filter((_, i) => i !== index));
  }

  async function handleToggleVaccinated(target: PetDraft, index: number) {
    const next = !target.vaccinated;
    if (userId && target.id) {
      setBusyId(target.id);
      const { error } = await supabase.from('pets').update({ vaccinated: next }).eq('id', target.id);
      setBusyId(null);
      if (error) { toast.error(error.message); return; }
    }
    const list = pets.slice();
    list[index] = { ...target, vaccinated: next };
    onChange(list);
  }

  return (
    <div className="space-y-2">
      {pets.length === 0 && (
        <p className="text-xs text-gray-400 italic">No pets added yet.</p>
      )}

      {pets.map((p, i) => {
        const rowBusy = busyId === p.id;
        return (
          <div key={p.id ?? i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
            <PawPrint size={16} className="text-[#1B5E20] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{SPECIES_LABEL[p.species]}</p>
            </div>
            <button
              type="button"
              onClick={() => handleToggleVaccinated(p, i)}
              disabled={disabled || rowBusy}
              aria-label={`Vaccinated: ${p.vaccinated ? 'yes' : 'no'}`}
              title="Toggle vaccinated"
              className={`text-[10px] font-bold px-2 py-1 rounded-full transition-colors ${
                p.vaccinated
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
              } disabled:opacity-40`}
            >
              {p.vaccinated ? 'VACCINATED' : 'NOT VACC.'}
            </button>
            <button
              type="button"
              onClick={() => handleRemove(p, i)}
              disabled={disabled || rowBusy}
              aria-label={`Remove ${p.name}`}
              title={`Remove ${p.name}`}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
            >
              {rowBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
        );
      })}

      {/* Add new */}
      <div className="border border-dashed border-gray-300 rounded-xl p-3 space-y-2 bg-white">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Pet name (e.g. Bruno)"
          aria-label="New pet name"
          disabled={disabled || adding}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent disabled:opacity-50"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={draft.species}
            onChange={(e) => setDraft({ ...draft, species: e.target.value as PetSpecies })}
            disabled={disabled || adding}
            aria-label="Species"
            className="text-sm bg-white border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
          >
            {SPECIES_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.emoji} {s.label}</option>
            ))}
          </select>
          <label className="flex items-center justify-center gap-2 text-sm text-gray-700 border border-gray-300 rounded-lg px-2 py-2 bg-white cursor-pointer select-none">
            <input
              type="checkbox"
              checked={draft.vaccinated}
              onChange={(e) => setDraft({ ...draft, vaccinated: e.target.checked })}
              disabled={disabled || adding}
              className="accent-[#1B5E20]"
            />
            Vaccinated
          </label>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || adding || !draft.name.trim()}
          className="inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-[#1B5E20] text-white text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-40"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add Pet
        </button>
      </div>
    </div>
  );
}
