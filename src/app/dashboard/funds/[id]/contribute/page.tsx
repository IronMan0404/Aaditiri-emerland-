'use client';
import { useEffect, useState } from 'react';
import { use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Upload, Check, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import { createClient } from '@/lib/supabase';
import { formatINR } from '@/lib/money';
import { Input, Textarea } from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import type { CommunityFund, ContributionMethod } from '@/types/funds';

export default function ContributePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const { profile, mounted } = useAuth();
  const supabase = createClient();

  const [fund, setFund] = useState<CommunityFund | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ContributionMethod>('upi');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isInKind, setIsInKind] = useState(false);
  const [inKindDesc, setInKindDesc] = useState('');
  const [inKindValue, setInKindValue] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!mounted) return;
    fetch(`/api/funds/${id}`)
      .then((r) => r.json())
      .then((j) => {
        setFund(j.fund);
        if (j.fund?.suggested_per_flat) setAmount(String(j.fund.suggested_per_flat / 100));
      });
  }, [id, mounted]);

  async function handleScreenshot(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large (max 5 MB).');
      return;
    }
    setUploading(true);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `contributions/${profile.id}/${Date.now()}.${ext}`;
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
    setScreenshotUrl(data.publicUrl);
    toast.success('Screenshot uploaded');
  }

  async function submit() {
    if (!fund) return;
    if (!isInKind) {
      const n = Number(amount);
      if (!n || n <= 0) {
        toast.error('Enter a valid amount');
        return;
      }
    } else {
      if (!inKindDesc.trim()) {
        toast.error('Describe what you contributed');
        return;
      }
      const v = Number(inKindValue);
      if (!v || v <= 0) {
        toast.error('Enter your best estimate of the value');
        return;
      }
    }
    setSubmitting(true);
    // For in-kind: amount holds the estimated rupee value (in rupees here;
    // the API converts to paise). The DB trigger aggregates in-kind into
    // total_in_kind_value, NOT into total_collected.
    const res = await fetch(`/api/funds/${id}/contributions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: isInKind ? Number(inKindValue) : Number(amount),
        method: isInKind ? 'in_kind' : method,
        reference_number: reference.trim() || undefined,
        contribution_date: date,
        notes: notes.trim() || undefined,
        screenshot_url: screenshotUrl || undefined,
        is_anonymous: isAnonymous,
        is_in_kind: isInKind,
        in_kind_description: isInKind ? inKindDesc.trim() : undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? 'Failed to submit');
      return;
    }
    toast.success('Reported! Treasurer will verify within 1–2 days.');
    router.push(`/dashboard/funds/${id}`);
  }

  if (!fund) {
    return <div className="max-w-2xl mx-auto p-6 text-gray-400 text-sm">Loading...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6">
      <Link
        href={`/dashboard/funds/${id}`}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3"
      >
        <ArrowLeft size={16} /> Back to fund
      </Link>

      <header className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Report contribution</h1>
        <p className="text-sm text-gray-600 mt-1">
          For: <span className="font-semibold">{fund.name}</span>
          {fund.suggested_per_flat ? (
            <span className="text-gray-500"> · suggested {formatINR(fund.suggested_per_flat)}/flat</span>
          ) : null}
        </p>
      </header>

      {/* Step 1: how to pay */}
      <section className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-5 text-sm text-blue-900">
        <p className="font-semibold mb-2">Step 1 — Pay</p>
        <p>
          Pay through your usual UPI app (PhonePe, GPay, BHIM) or hand over cash to the
          collecting committee member. Then come back here to report it.
        </p>
        <p className="text-xs mt-2 text-blue-800">
          Tip: keep a screenshot of the UPI confirmation to upload below.
        </p>
      </section>

      {/* Step 2: report */}
      <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-gray-900 mb-2">Step 2 — Report it</p>
        </div>

        {/* In-kind toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isInKind}
            onChange={(e) => setIsInKind(e.target.checked)}
            className="w-4 h-4 rounded text-[#1B5E20]"
          />
          <span className="text-sm text-gray-800">This is an in-kind contribution (items, services, food)</span>
        </label>

        {!isInKind ? (
          <Input
            label="Amount paid (₹) *"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            inputMode="decimal"
          />
        ) : (
          <>
            <Textarea
              label="What did you contribute? *"
              value={inKindDesc}
              onChange={(e) => setInKindDesc(e.target.value)}
              placeholder="e.g. 5 kg sweets, 20 chairs, sound system for 4 hours"
              rows={2}
            />
            <Input
              label="Estimated value (₹) *"
              type="number"
              value={inKindValue}
              onChange={(e) => setInKindValue(e.target.value)}
              placeholder="Best guess — used for transparency, not added to cash collected"
              inputMode="decimal"
            />
            <p className="text-xs text-gray-500 -mt-2">
              In-kind value is shown on the ledger separately from cash. It does not count as money collected.
            </p>
          </>
        )}

        {!isInKind && (
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Payment method *</label>
            <div className="grid grid-cols-3 gap-2">
              {(['upi', 'cash', 'cheque', 'neft', 'imps', 'other'] as ContributionMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`py-2 rounded-xl text-xs font-semibold uppercase border transition-colors ${
                    method === m
                      ? 'bg-[#1B5E20] text-white border-[#1B5E20]'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isInKind && (
          <Input
            label={method === 'cash' ? 'Reference (optional)' : 'Reference / UTR / Cheque #'}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={method === 'upi' ? '232145679876' : ''}
          />
        )}

        <Input
          label="Date *"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
        />

        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. Paid via PhonePe to the society UPI"
        />

        {!isInKind && (
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Screenshot (optional)</label>
            <label className="flex items-center justify-center gap-2 px-3 py-3 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-600 cursor-pointer hover:border-[#1B5E20] hover:text-[#1B5E20]">
              {uploading ? (
                <><Loader2 className="animate-spin" size={16} /> Uploading...</>
              ) : screenshotUrl ? (
                <><Check size={16} className="text-emerald-600" /> Uploaded — tap to replace</>
              ) : (
                <><Upload size={16} /> Choose photo</>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleScreenshot}
              />
            </label>
            {screenshotUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={screenshotUrl} alt="Payment screenshot" className="mt-2 max-h-32 rounded-lg border border-gray-200" />
            )}
          </div>
        )}

        <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-gray-100">
          <input
            type="checkbox"
            checked={isAnonymous}
            onChange={(e) => setIsAnonymous(e.target.checked)}
            className="w-4 h-4 rounded text-[#1B5E20] mt-0.5"
          />
          <span className="text-sm text-gray-700">
            Hide my name publicly (will show as &ldquo;Anonymous&rdquo; — admin still sees you for verification)
          </span>
        </label>

        <Button onClick={submit} loading={submitting} className="w-full">
          Submit
        </Button>
      </section>
    </div>
  );
}
