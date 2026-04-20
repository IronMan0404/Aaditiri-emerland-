'use client';
import { use as usePromise } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import { Input, Textarea } from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { paiseToRupees } from '@/lib/money';
import type { CommunityFund, FundCategory, FundVisibility, FundStatus } from '@/types/funds';

export default function EditFundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const { isAdmin, mounted } = useAuth();

  const [categories, setCategories] = useState<FundCategory[]>([]);
  const [fund, setFund] = useState<CommunityFund | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [target, setTarget] = useState('');
  const [perFlat, setPerFlat] = useState('');
  const [deadline, setDeadline] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [visibility, setVisibility] = useState<FundVisibility>('all_residents');
  const [status, setStatus] = useState<FundStatus>('collecting');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!mounted || !isAdmin) return;
    let cancelled = false;
    (async () => {
      const [fJ, cJ] = await Promise.all([
        fetch(`/api/funds/${id}`).then((r) => r.json()),
        fetch('/api/funds/categories').then((r) => r.json()),
      ]);
      if (cancelled) return;
      const f = fJ.fund as CommunityFund | null;
      setFund(f);
      setCategories(cJ.categories ?? []);
      if (f) {
        setName(f.name);
        setCategoryId(f.category_id);
        setDescription(f.description ?? '');
        setPurpose(f.purpose ?? '');
        setTarget(f.target_amount ? String(paiseToRupees(f.target_amount)) : '');
        setPerFlat(f.suggested_per_flat ? String(paiseToRupees(f.suggested_per_flat)) : '');
        setDeadline(f.collection_deadline ?? '');
        setEventDate(f.event_date ?? '');
        setVisibility(f.visibility);
        setStatus(f.status);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isAdmin, mounted]);

  async function submit() {
    if (!name.trim()) { toast.error('Name required'); return; }
    setSubmitting(true);
    const res = await fetch(`/api/admin/funds/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        category_id: categoryId,
        description: description.trim(),
        purpose: purpose.trim(),
        target_amount: target ? Number(target) : null,
        suggested_per_flat: perFlat ? Number(perFlat) : null,
        collection_deadline: deadline || null,
        event_date: eventDate || null,
        visibility,
        status,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed'); return;
    }
    toast.success('Saved');
    router.push(`/admin/funds/${id}`);
  }

  if (mounted && !isAdmin) {
    return <div className="max-w-2xl mx-auto p-6 text-sm text-gray-500">Admin access required.</div>;
  }
  if (!fund) {
    return <div className="max-w-2xl mx-auto p-6 text-gray-400 text-sm">Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={`/admin/funds/${id}`} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft size={16} /> Back to fund
      </Link>

      <header className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Edit fund</h1>
      </header>

      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
        <Input label="Name *" value={name} onChange={(e) => setName(e.target.value)} />

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Category *</label>
          <div className="grid grid-cols-3 gap-2">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={`p-2 rounded-xl border text-xs font-medium text-center ${
                  categoryId === c.id ? 'bg-[#1B5E20] text-white border-[#1B5E20]' : 'bg-white border-gray-200'
                }`}
              >
                <div className="text-base">{c.icon}</div>
                <div className="text-[10px] mt-1 leading-tight">{c.name}</div>
              </button>
            ))}
          </div>
        </div>

        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        <Textarea label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} />

        <div className="grid grid-cols-2 gap-3">
          <Input label="Target (₹)" type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
          <Input label="Suggested per flat (₹)" type="number" value={perFlat} onChange={(e) => setPerFlat(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Collection deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <Input label="Event date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Visibility</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as FundVisibility)}
            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white">
            <option value="all_residents">All residents (public)</option>
            <option value="committee_only">Admin only (hidden)</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1 block">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as FundStatus)}
            className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm bg-white">
            <option value="collecting">Collecting</option>
            <option value="spending">Spending</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <p className="text-[11px] text-gray-500 mt-1">
            To close (with surplus handling), use the Close button on the fund page.
          </p>
        </div>

        <Button onClick={submit} loading={submitting} className="w-full">Save changes</Button>
      </div>
    </div>
  );
}
