'use client';
import { useState } from 'react';
import { Plus, Trash2, Loader2, User, Mail, CheckCircle2, Clock, Copy, X } from 'lucide-react';
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
 * In persistent mode, each row also exposes an "Invite to login" button
 * that creates a family_invitations row + emails the magic link. Once
 * the invitee accepts, the family_members row's `account_profile_id`
 * lights up and the row badge flips from "Display only" to "Has login".
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
> & {
  id?: string;
  email?: string | null;
  account_profile_id?: string | null;
  invitation_id?: string | null;
};

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
  // The "send an email invite right away" toggle on the new-row form.
  // Defaults off so casual entries (e.g. "I have 2 kids") don't push
  // anyone an email by surprise.
  const [draftInvite, setDraftInvite] = useState(false);
  const [draftEmail, setDraftEmail] = useState('');
  // After a successful invite (new or existing row) we surface the
  // accept URL inline so the inviter can copy/share it on WhatsApp
  // even if email delivery quietly failed.
  const [inviteResult, setInviteResult] = useState<{
    rowId?: string;
    name: string;
    email: string;
    url: string;
    emailed: boolean;
  } | null>(null);
  // Inline "ask for email" state for the existing-row invite flow.
  // We open a small input row directly under the family member rather
  // than firing window.prompt() — the latter is jarring on mobile and
  // doesn't validate well.
  const [inviteEmailFor, setInviteEmailFor] = useState<{ id: string; email: string } | null>(null);

  function resetDraft() {
    setDraft({ full_name: '', relation: 'spouse', gender: null, age: null, phone: null });
    setDraftInvite(false);
    setDraftEmail('');
  }

  // Shared validator used by add + invite flows.
  function validateBasics(name: string, age: number | null | undefined): string | null {
    if (!name) return 'Enter a name';
    if (name.length < 2) return 'Name looks too short';
    if (age != null && (age < 0 || age > 120)) return 'Age must be between 0 and 120';
    return null;
  }

  async function handleAdd() {
    const full_name = draft.full_name.trim();
    const err = validateBasics(full_name, draft.age);
    if (err) { toast.error(err); return; }

    // If the inviter ticked "Send invite", run the invite endpoint —
    // it creates BOTH the family_members row and the invitation in one
    // round-trip. Otherwise we just insert a plain display row.
    if (draftInvite) {
      const email = draftEmail.trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast.error('Enter a valid email to send the invite'); return;
      }
      setAdding(true);
      const r = await fetch('/api/family/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invitee_name: full_name,
          invitee_email: email,
          relation: draft.relation,
        }),
      });
      const j = await r.json();
      setAdding(false);
      if (!r.ok) { toast.error(j.error ?? 'Failed to send invite'); return; }
      if (j.email_status === 'sent') toast.success('Invite emailed!');
      else if (j.email_status === 'failed') toast.error('Email send failed — copy the backup link below.');
      else toast.success('Invite created — share the link below.');
      setInviteResult({
        name: full_name,
        email,
        url: j.accept_url ?? '',
        emailed: j.email_status === 'sent',
      });
      // The invite endpoint already inserted the family_members row;
      // re-fetch from Supabase so the parent picks it up with all the
      // new linkage columns populated.
      if (userId) {
        const { data } = await supabase
          .from('family_members')
          .select('id, full_name, relation, gender, age, phone, email, account_profile_id, invitation_id')
          .eq('user_id', userId)
          .order('created_at');
        if (data) onChange(data as FamilyMemberDraft[]);
      }
      resetDraft();
      return;
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
        .select('id, full_name, relation, gender, age, phone, email, account_profile_id, invitation_id')
        .single();
      setAdding(false);
      if (error) { toast.error(error.message); return; }
      onChange([...members, data as FamilyMemberDraft]);
    } else {
      onChange([...members, payload]);
    }
    resetDraft();
  }

  // Existing-row invite. Opens an inline email input under the row;
  // handleInviteExistingSubmit does the actual fetch.
  function handleInviteExisting(target: FamilyMemberDraft) {
    if (!target.id || !userId) return;
    setInviteEmailFor({ id: target.id, email: target.email ?? '' });
  }

  async function handleInviteExistingSubmit(target: FamilyMemberDraft, rawEmail: string) {
    if (!target.id || !userId) return;
    const email = rawEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Enter a valid email'); return; }

    setBusyId(target.id);
    const r = await fetch('/api/family/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        invitee_name: target.full_name,
        invitee_email: email,
        relation: target.relation,
        family_member_id: target.id,
      }),
    });
    const j = await r.json();
    setBusyId(null);
    if (!r.ok) { toast.error(j.error ?? 'Failed to send invite'); return; }
    // Three-way distinction: emailed OK, email failed, email not configured.
    if (j.email_status === 'sent') toast.success('Invite emailed!');
    else if (j.email_status === 'failed') toast.error('Email send failed — copy the backup link below.');
    else toast.success('Invite created — share the link below.');
    setInviteEmailFor(null);
    setInviteResult({
      rowId: target.id,
      name: target.full_name,
      email,
      url: j.accept_url ?? '',
      emailed: j.email_status === 'sent',
    });
    // Refresh the row list so the new invitation_id + email show up.
    const { data } = await supabase
      .from('family_members')
      .select('id, full_name, relation, gender, age, phone, email, account_profile_id, invitation_id')
      .eq('user_id', userId)
      .order('created_at');
    if (data) onChange(data as FamilyMemberDraft[]);
  }

  async function handleRevokeInvite(target: FamilyMemberDraft) {
    if (!target.invitation_id || !userId) return;
    if (!confirm(`Revoke pending invite for ${target.full_name}?`)) return;
    setBusyId(target.id ?? null);
    const r = await fetch(`/api/family/invitations/${target.invitation_id}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    setBusyId(null);
    if (!r.ok) { toast.error(j.error ?? 'Failed to revoke'); return; }
    toast.success('Invite revoked');
    const { data } = await supabase
      .from('family_members')
      .select('id, full_name, relation, gender, age, phone, email, account_profile_id, invitation_id')
      .eq('user_id', userId)
      .order('created_at');
    if (data) onChange(data as FamilyMemberDraft[]);
  }

  async function handleRemoveAccount(target: FamilyMemberDraft) {
    if (!target.account_profile_id) return;
    if (!confirm(`Remove ${target.full_name}'s login access? They will no longer be able to sign in. Their entry stays here as display-only.`)) return;
    setBusyId(target.id ?? null);
    const r = await fetch(`/api/family/members/${target.account_profile_id}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    setBusyId(null);
    if (!r.ok) { toast.error(j.error ?? 'Failed to remove access'); return; }
    toast.success('Login access removed');
    if (!userId) return;
    const { data } = await supabase
      .from('family_members')
      .select('id, full_name, relation, gender, age, phone, email, account_profile_id, invitation_id')
      .eq('user_id', userId)
      .order('created_at');
    if (data) onChange(data as FamilyMemberDraft[]);
  }

  async function handleRemove(target: FamilyMemberDraft, index: number) {
    // If this row has an attached login account, deleting just the
    // family_members row would leave an orphan auth account behind.
    // Force the user to revoke access first.
    if (target.account_profile_id) {
      toast.error('Remove login access first, then delete the entry.');
      return;
    }
    if (userId && target.id) {
      setBusyId(target.id);
      const { error } = await supabase.from('family_members').delete().eq('id', target.id);
      setBusyId(null);
      if (error) { toast.error(error.message); return; }
    }
    onChange(members.filter((_, i) => i !== index));
  }

  async function copyInviteUrl() {
    if (!inviteResult?.url) return;
    await navigator.clipboard.writeText(inviteResult.url);
    toast.success('Link copied');
  }

  // Whether the persistent-mode invite controls should render. Draft
  // mode (no userId) hides them — the resident hasn't been created
  // yet, so there's no "from" to send invites from.
  const inviteEnabled = !!userId;

  return (
    <div className="space-y-2">
      {members.length === 0 && (
        <p className="text-xs text-gray-400 italic">No family members added yet.</p>
      )}

      {members.map((m, i) => {
        const rowBusy = busyId === m.id;
        const hasAccount = !!m.account_profile_id;
        const hasPending = !hasAccount && !!m.invitation_id;
        const canInvite = inviteEnabled && !hasAccount && !hasPending;
        const isPromptingEmail = m.id && inviteEmailFor?.id === m.id;
        return (
          <div key={m.id ?? i} className="bg-gray-50 border border-gray-200 rounded-xl">
          <div className="flex items-start gap-2 px-3 py-2">
            <User size={16} className="text-[#1B5E20] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-gray-900 truncate">{m.full_name}</p>
                {hasAccount && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                    <CheckCircle2 size={10} /> Has login
                  </span>
                )}
                {hasPending && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">
                    <Clock size={10} /> Invite pending
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {RELATION_LABEL[m.relation]}
                {m.age != null && ` · ${m.age} yrs`}
                {m.gender && ` · ${m.gender === 'male' ? 'M' : m.gender === 'female' ? 'F' : 'Other'}`}
                {m.phone && ` · ${m.phone}`}
                {m.email && ` · ${m.email}`}
              </p>
            </div>
            {canInvite && (
              <button
                type="button"
                onClick={() => handleInviteExisting(m)}
                disabled={disabled || rowBusy}
                aria-label={`Invite ${m.full_name} to login`}
                title="Invite to log in"
                className="p-1.5 rounded-lg text-[#1B5E20] hover:bg-green-50 transition-colors disabled:opacity-40"
              >
                {rowBusy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              </button>
            )}
            {hasPending && (
              <button
                type="button"
                onClick={() => handleRevokeInvite(m)}
                disabled={disabled || rowBusy}
                aria-label={`Revoke invite for ${m.full_name}`}
                title="Revoke pending invite"
                className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-40"
              >
                {rowBusy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              </button>
            )}
            {hasAccount && (
              <button
                type="button"
                onClick={() => handleRemoveAccount(m)}
                disabled={disabled || rowBusy}
                aria-label={`Remove ${m.full_name}'s login access`}
                title="Remove login access (keeps entry as display-only)"
                className="p-1.5 rounded-lg text-orange-600 hover:bg-orange-50 transition-colors disabled:opacity-40"
              >
                {rowBusy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleRemove(m, i)}
              disabled={disabled || rowBusy || hasAccount}
              aria-label={`Remove ${m.full_name}`}
              title={hasAccount ? 'Remove login access first' : `Remove ${m.full_name}`}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
            >
              {rowBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
          {isPromptingEmail && inviteEmailFor && (
            <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-200">
              <p className="text-[11px] text-gray-600">
                Email address to send {m.full_name}&apos;s invite to:
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  value={inviteEmailFor.email}
                  onChange={(e) => setInviteEmailFor({ id: inviteEmailFor.id, email: e.target.value })}
                  placeholder="e.g. priya@example.com"
                  aria-label={`Email for ${m.full_name}`}
                  disabled={rowBusy}
                  autoFocus
                  className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20] disabled:opacity-50"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleInviteExistingSubmit(m, inviteEmailFor.email)}
                    disabled={rowBusy || !inviteEmailFor.email.trim()}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 bg-[#1B5E20] text-white text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
                  >
                    {rowBusy ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                    Send
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteEmailFor(null)}
                    disabled={rowBusy}
                    className="px-3 py-2 text-xs font-semibold text-gray-600 rounded-lg hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>
        );
      })}

      {/* Inline result of the most recent invite. Stays on screen
          until dismissed so a slow phone user has time to copy the
          fallback link if email failed. */}
      {inviteResult && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs text-amber-900">
              <strong>{inviteResult.name}</strong> ({inviteResult.email}) —{' '}
              {inviteResult.emailed
                ? 'invite emailed. Share the backup link below if needed.'
                : 'email not configured. Share this link via WhatsApp / SMS:'}
            </div>
            <button
              type="button"
              onClick={() => setInviteResult(null)}
              aria-label="Dismiss invite link"
              className="text-amber-700 hover:text-amber-900 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
          {inviteResult.url && (
            <>
              <div className="bg-white border border-amber-200 rounded-lg p-2 text-[11px] break-all font-mono text-gray-700">
                {inviteResult.url}
              </div>
              <button
                type="button"
                onClick={copyInviteUrl}
                className="inline-flex items-center gap-1 bg-[#1B5E20] text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
              >
                <Copy size={12} /> Copy link
              </button>
            </>
          )}
        </div>
      )}

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
        {inviteEnabled && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={draftInvite}
                onChange={(e) => setDraftInvite(e.target.checked)}
                disabled={disabled || adding}
                className="rounded text-[#1B5E20] focus:ring-[#1B5E20]"
              />
              <Mail size={12} className="text-[#1B5E20]" />
              Also email a login invite (no admin approval needed)
            </label>
            {draftInvite && (
              <input
                type="email"
                value={draftEmail}
                onChange={(e) => setDraftEmail(e.target.value)}
                placeholder="Email address (e.g. priya@example.com)"
                aria-label="Family member email"
                disabled={disabled || adding}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1B5E20] disabled:opacity-50"
              />
            )}
          </div>
        )}
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || adding || !draft.full_name.trim()}
          className="inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-[#1B5E20] text-white text-sm font-semibold hover:bg-[#2E7D32] transition-colors disabled:opacity-40"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {draftInvite ? 'Add & send invite' : 'Add Family Member'}
        </button>
      </div>
    </div>
  );
}
