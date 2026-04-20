'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { Input, Textarea } from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import type { FundCategory, FundVisibility } from '@/types/funds';

export default function NewFundPage() {
  const router = useRouter();
  const { isAdmin, mounted, profile } = useAuth();
  const supabase = createClient();

  const [categories, setCategories] = useState<FundCategory[]>([]);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [target, setTarget] = useState('');
  const [perFlat, setPerFlat] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingBalanceNote, setOpeningBalanceNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [visibility, setVisibility] = useState<FundVisibility>('all_residents');
  const [coverUrl, setCoverUrl] = useState('');
  const [notify, setNotify] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    setCategoriesLoading(true);
    fetch('/api/funds/categories')
      .then(async (r) => {
        if (!r.ok) {
          // Most common cause: migration `20260424_community_funds.sql`
          // hasn't been applied to the connected Supabase project, so the
          // `fund_categories` table doesn't exist. Surface that explicitly
          // so the admin doesn't hit a confusing empty form.
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `categories request failed (${r.status})`);
        }
        return r.json();
      })
      .then((j) => {
        setCategories(j.categories ?? []);
        if (j.categories?.length > 0) setCategoryId(j.categories[0].id);
        setCategoriesError(null);
      })
      .catch((e: Error) => setCategoriesError(e.message))
      .finally(() => setCategoriesLoading(false));
  }, [isAdmin, mounted]);

  async function handleCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Cover image too large (max 5 MB).');
      return;
    }
    setUploading(true);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `covers/${profile.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('funds').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });
    setUploading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const { data } = supabase.storage.from('funds').getPublicUrl(path);
    setCoverUrl(data.publicUrl);
    toast.success('Cover uploaded');
  }

  async function submit() {
    if (!name.trim()) { toast.error('Name required'); return; }
    if (!categoryId) { toast.error('Category required'); return; }
    const opening = openingBalance ? Number(openingBalance) : 0;
    if (opening < 0 || Number.isNaN(opening)) {
      toast.error('Opening balance must be a positive number');
      return;
    }
    setSubmitting(true);
    const res = await fetch('/api/admin/funds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        category_id: categoryId,
        description: description.trim() || undefined,
        purpose: purpose.trim() || undefined,
        target_amount: target ? Number(target) : undefined,
        suggested_per_flat: perFlat ? Number(perFlat) : undefined,
        collection_deadline: deadline || undefined,
        event_date: eventDate || undefined,
        visibility,
        cover_image_url: coverUrl || undefined,
        notify,
        opening_balance: opening > 0 ? opening : undefined,
        opening_balance_note: opening > 0 ? (openingBalanceNote.trim() || undefined) : undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed to create fund');
      return;
    }
    const j = await res.json();
    toast.success('Fund created.');
    router.push(`/admin/funds/${j.fund.id}`);
  }

  if (mounted && !isAdmin) {
    return <div className="max-w-3xl mx-auto p-6 text-sm text-gray-500">Admin access required.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/admin/funds" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft size={16} /> Back to admin
      </Link>

      <header className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Create new fund</h1>
        <p className="text-sm text-gray-500 mt-1">A named pot of money for a specific community purpose.</p>
      </header>

      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
        <Input
          label="Fund name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Diwali 2026, Softener AMC Q4"
        />

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Category *</label>
          {categoriesLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
              <Loader2 className="animate-spin" size={14} /> Loading categories...
            </div>
          ) : categoriesError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5">
                <AlertTriangle size={14} /> Could not load categories
              </p>
              <p className="text-xs text-red-700 mt-1">{categoriesError}</p>
              <p className="text-xs text-red-700 mt-2">
                Most likely cause: the migration{' '}
                <code className="bg-red-100 px-1 rounded">supabase/migrations/20260424_community_funds.sql</code>{' '}
                hasn&apos;t been applied yet. Run <code className="bg-red-100 px-1 rounded">npx supabase db push</code>
                {' '}(or apply it via the Supabase SQL editor) and refresh.
              </p>
            </div>
          ) : categories.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              No active categories yet. Seed them by re-running the funds migration, or add a row to{' '}
              <code className="bg-amber-100 px-1 rounded">fund_categories</code> in the Supabase dashboard.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  className={`p-2 rounded-xl border text-xs font-medium text-center transition-all ${
                    categoryId === c.id
                      ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                      : 'bg-white text-gray-800 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <div className="text-base">{c.icon}</div>
                  <div className="text-[10px] mt-1 leading-tight">{c.name}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <Textarea
          label="Short description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="One-line summary residents will see in the list."
        />

        <Textarea
          label="Purpose / what it covers"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          rows={3}
          placeholder="More detail — what is this money for, who decided, etc."
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Target (₹)"
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="50000"
          />
          <Input
            label="Suggested per flat (₹)"
            type="number"
            value={perFlat}
            onChange={(e) => setPerFlat(e.target.value)}
            placeholder="500"
          />
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
          <div>
            <label className="text-sm font-medium text-gray-700">Opening balance (₹)</label>
            <p className="text-xs text-gray-500 mt-0.5">
              Money already in hand on day one — e.g. ₹5,000 carried over from
              last year&apos;s closed Diwali fund, or cash already collected
              before this fund existed. Counted in the fund&apos;s collected
              total and shown on the ledger as <span className="font-semibold">Opening balance</span>.
            </p>
          </div>
          <Input
            type="number"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            placeholder="0"
          />
          {openingBalance && Number(openingBalance) > 0 && (
            <Textarea
              label="What is this opening balance? (recommended)"
              value={openingBalanceNote}
              onChange={(e) => setOpeningBalanceNote(e.target.value)}
              rows={2}
              placeholder="e.g. ₹5,000 carried over from Diwali 2025 surplus (committee meeting on 12-Jan-2026)."
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Collection deadline"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
          <Input
            label="Event date"
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Visibility</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setVisibility('all_residents')}
              className={`p-3 rounded-xl border text-left transition-all ${
                visibility === 'all_residents' ? 'border-[#1B5E20] bg-emerald-50' : 'border-gray-200 bg-white'
              }`}
            >
              <p className="text-sm font-bold text-gray-900">🌍 All residents</p>
              <p className="text-xs text-gray-500">Public on the balance sheet.</p>
            </button>
            <button
              type="button"
              onClick={() => setVisibility('committee_only')}
              className={`p-3 rounded-xl border text-left transition-all ${
                visibility === 'committee_only' ? 'border-[#1B5E20] bg-emerald-50' : 'border-gray-200 bg-white'
              }`}
            >
              <p className="text-sm font-bold text-gray-900">🛡️ Admin only</p>
              <p className="text-xs text-gray-500">Hidden from residents.</p>
            </button>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Cover image (optional)</label>
          <label className="flex items-center justify-center gap-2 px-3 py-3 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-600 cursor-pointer hover:border-[#1B5E20]">
            {uploading ? <><Loader2 className="animate-spin" size={16} /> Uploading...</>
              : coverUrl ? <>✓ Uploaded — tap to replace</>
              : <><Upload size={16} /> Choose image</>}
            <input type="file" accept="image/*" className="hidden" onChange={handleCover} />
          </label>
        </div>

        <label className="flex items-start gap-2 cursor-pointer pt-3 border-t border-gray-100">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="w-4 h-4 rounded text-[#1B5E20] mt-0.5"
          />
          <span className="text-sm text-gray-700">Push notify all residents on creation</span>
        </label>

        <Button onClick={submit} loading={submitting} className="w-full">
          Create fund
        </Button>
      </div>
    </div>
  );
}
