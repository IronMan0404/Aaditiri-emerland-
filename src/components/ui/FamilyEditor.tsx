'use client';
import { useState } from 'react';
import { Plus, Trash2, Loader2, User } from 'lucide-react';
import toast from 'react-hot-toast';
import type { FamilyMember, FamilyRelation, Gender } from '@/types';
import { createClient } from '@/lib/supabase';

/**
 * Editable list of a resident's family members. Two modes:
 *
 *   - **Persistent mode** (`userId` provided): every add/remove writes
 *     straight to Supabase against the `family_members` table. Use this
 *     on the profile page and the admin edit modal.
 *
 *   - **Draft mode** (`userId` omitted): the component only manages local
 *     state and calls `onChange` with the current draft list. The parent is
 *     responsible for persisting on submit. Use this in the registration
 *     form where the user_id doesn't exist yet.
 *
 * Mirrors the VehiclesEditor pattern.
 */

const RELATION_OPTIONS: { value: FamilyRelation; label: string }[] = [
  { value: 'spouse',   label: 'Spouse' },
  { value: 'son',      label: 'Son' },
  { value: 'daughter', label: 'Daughter' },
  { value: 'parent',   label: 'Parent' },
  { value: 'sibling',  label: 'Sibling' },
  { value: 'other',    label: 'Other' },
];

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male',   label: 'M' },
  { value: 'female', label: 'F' },
  { value: 'other',  label: 'Other' },
];

export type FamilyMemberDraft = Pick<
  FamilyMember,
  'full_name' | 'relation' | 'gender' | 'age' | 'phone'
> & { id?: string };

interface Props {
  members: FamilyMemberDraft[];
  onChange: (next: FamilyMemberDraft[]) => void;
  /** When provided, mutations are written immediately. */
  userId?: string;
  disabled?: boolean;
}

const RELATION_LABEL: Record<FamilyRelation, string> = Object.fromEntries(
  RELATION_OPTIONS.map((r) => [r.value, r.label]),
) as Record<FamilyRelation, string>;

export default function FamilyEditor({ members, onChange, userId, disabled }: Props) {
  const supabase = createClient();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FamilyMemberDraft>({
    full_name: '',
    relation: 'spouse',
    gender: null,
    age: null,
    phone: null,
  });

  function resetDraft() {
    setDraft({ full_name: '', relation: 'spouse', gender: null, age: null, phone: null });
  }

  async function handleAdd() {
    const full_name = draft.full_name.trim();
    if (!full_name) { toast.error('Enter a name'); return; }
    if (full_name.length < 2) { toast.error('Name looks too short'); return; }
    if (draft.age != null && (draft.age < 0 || draft.age > 120)) {
      toast.error('Age must be between 0 and 120'); return;
    }

    const payload = {
      full_name,
      relation: draft.relation,
      gender: draft.gender ?? null,
      age: draft.age ?? null,
      phone: draft.phone?.trim() || null,
    };

    if (userId) {
      setAdding(true);
      const { data, error } = await supabase
        .from('family_members')
        .insert({ user_id: userId, ...payload })
        .select('id, full_name, relation, gender, age, phone')
        .single();
      setAdding(false);
      if (error) { toast.error(error.message); return; }
      onChange([...members, data as FamilyMemberDraft]);
    } else {
      onChange([...members, payload]);
    }
    resetDraft();
  }

  async function handleRemove(target: FamilyMemberDraft, index: number) {
    if (userId && target.id) {
      setBusyId(target.id);
      const { error } = await supabase.from('family_members').delete().eq('id', target.id);
      setBusyId(null);
      if (error) { toast.error(error.message); return; }
    }
    onChange(members.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      {members.length === 0 && (
        <p className="text-xs text-gray-400 italic">No family members added yet.</p>
      )}

      {members.map((m, i) => {
        const rowBusy = busyId === m.id;
        return (
          <div key={m.id ?? i} className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
            <User size={16} className="text-[#1B5E20] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{m.full_name}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {RELATION_LABEL[m.relation]}
                {m.age != null && ` · ${m.age} yrs`}
                {m.gender && ` · ${m.gender === 'male' ? 'M' : m.gender === 'female' ? 'F' : 'Other'}`}
                {m.phone && ` · ${m.phone}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleRemove(m, i)}
              disabled={disabled || rowBusy}
              aria-label={`Remove ${m.full_name}`}
              title={`Remove ${m.full_name}`}
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
          value={draft.full_name}
          onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
          placeholder="Full name"
          aria-label="New family member name"
          disabled={disabled || adding}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20] focus:border-transparent disabled:opacity-50"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={draft.relation}
            onChange={(e) => setDraft({ ...draft, relation: e.target.value as FamilyRelation })}
            disabled={disabled || adding}
            aria-label="Relation"
            className="text-sm bg-white border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
          >
            {RELATION_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <select
            value={draft.gender ?? ''}
            onChange={(e) => setDraft({ ...draft, gender: (e.target.value || null) as Gender | null })}
            disabled={disabled || adding}
            aria-label="Gender"
            className="text-sm bg-white border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-[#1B5E20]"
          >
            <option value="">Gender (opt.)</option>
            {GENDER_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            min={0}
            max={120}
            value={draft.age ?? ''}
            onChange={(e) => setDraft({ ...draft, age: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="Age (optional)"
            aria-label="Age"
            disabled={disabled || adding}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20] disabled:opacity-50"
          />
          <input
            type="tel"
            value={draft.phone ?? ''}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder="Phone (optional)"
            aria-label="Phone"
            disabled={disabled || adding}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20] disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || adding || !draft.full_name.trim()}
          className="inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-[#1B5E20] text-white text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-40"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add Family Member
        </button>
      </div>
    </div>
  );
}
