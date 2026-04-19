'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, CheckCircle2, XCircle, AlertTriangle, Loader2, KeyRound } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

// Admin / security gate scanner for clubhouse passes.
//
// Capability ladder:
//   1. If the browser supports BarcodeDetector + getUserMedia, use the live
//      camera. We poll the video frame ~5x/s and decode QR codes locally.
//   2. Otherwise (most desktop browsers, iOS Safari < 17), fall back to a
//      manual code-entry form. Both call the same /api/admin/clubhouse/passes/validate.
//
// The flow is two-step: first we *check* the pass (so the gate operator
// sees who it belongs to and the time window), then they tap "Admit &
// consume" to flip it to 'used'.

interface ValidationResult {
  ok: boolean;
  consumed?: boolean;
  reason?: string;
  pass?: {
    id: string;
    code: string;
    status: string;
    effective_status: string;
    flat_number: string;
    valid_from: string;
    valid_until: string;
    used_at: string | null;
    issued_to_name: string | null;
    issued_to_email: string | null;
    facility: { id: string; name: string; slug: string } | null;
    warning: string | null;
  };
}

// Minimal subset of the spec'd BarcodeDetector type. We only call detect()
// so the rest can be 'unknown'-typed without losing safety.
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
interface BarcodeDetectorCtor {
  new (init?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
  }
}

export default function ValidatePage() {
  const { profile, mounted } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [scannerSupported, setScannerSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [manualCode, setManualCode] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const lastDecodedRef = useRef<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const supported = Boolean(window.BarcodeDetector && navigator.mediaDevices?.getUserMedia);
    setScannerSupported(supported);
  }, []);

  const stopScanner = useCallback(() => {
    setScanning(false);
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => stopScanner(), [stopScanner]);

  async function checkPass(payload: { token?: string; code?: string }) {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/clubhouse/passes/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as ValidationResult;
      setResult({ ...json, ok: res.ok && json.ok !== false });
      if (!res.ok) {
        toast.error(json.reason ?? `Lookup failed (${res.status})`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function consumePass() {
    if (!result?.pass) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/clubhouse/passes/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: result.pass.code, consume: true }),
      });
      const json = (await res.json().catch(() => ({}))) as ValidationResult;
      setResult({ ...json, ok: res.ok && json.ok !== false });
      if (res.ok && json.consumed) toast.success('Admitted');
      else toast.error(json.reason ?? 'Could not admit');
    } finally {
      setBusy(false);
    }
  }

  async function startScanner() {
    if (!window.BarcodeDetector) {
      toast.error('Camera scanning not supported on this device');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
      lastDecodedRef.current = '';
      setScanning(true);

      pollTimerRef.current = window.setInterval(async () => {
        if (!videoRef.current || !detectorRef.current) return;
        try {
          const codes = await detectorRef.current.detect(videoRef.current);
          if (codes && codes[0]?.rawValue) {
            const value = codes[0].rawValue;
            if (value === lastDecodedRef.current) return; // dedupe rapid frames
            lastDecodedRef.current = value;
            stopScanner();
            checkPass({ token: value });
          }
        } catch {
          // detect() can throw mid-frame on some implementations; ignore.
        }
      }, 200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start camera');
      stopScanner();
    }
  }

  if (!mounted) return null;
  if (!profile || profile.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center text-sm text-gray-500">
        Admin access required.
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/clubhouse" className="text-gray-500 hover:text-gray-800" aria-label="Back to clubhouse admin">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Validate Pass</h1>
          <p className="text-xs text-gray-500 mt-0.5">Scan QR or enter code at the gate</p>
        </div>
      </div>

      {/* Scanner / camera area */}
      <div className="bg-black rounded-2xl overflow-hidden aspect-square relative">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
          aria-label="QR scanner"
        />
        {!scanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-6">
            <Camera size={36} className="mb-2 opacity-80" />
            {scannerSupported === false && (
              <p className="text-xs opacity-80 mb-3">
                Camera scanning isn&apos;t supported on this device. Use the code field below instead.
              </p>
            )}
            {scannerSupported && (
              <Button onClick={startScanner} variant="secondary" className="!bg-white !text-black">
                Start camera
              </Button>
            )}
          </div>
        )}
        {scanning && (
          <button
            type="button"
            onClick={stopScanner}
            className="absolute top-2 right-2 bg-white/90 text-gray-800 text-xs px-2 py-1 rounded font-bold"
          >
            Stop
          </button>
        )}
      </div>

      {/* Manual entry */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!manualCode.trim()) return;
          checkPass({ code: manualCode.trim() });
        }}
        className="bg-white rounded-xl p-4 shadow-sm space-y-2"
      >
        <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
          <KeyRound size={12} className="text-[#1B5E20]" />
          Manual code entry
        </p>
        <Input
          placeholder="AE-XXXXXX"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect="off"
        />
        <Button type="submit" disabled={!manualCode.trim() || busy} className="w-full" size="sm">
          {busy && <Loader2 size={14} className="animate-spin" />}
          Look up pass
        </Button>
      </form>

      {/* Result card */}
      {result && (
        <ResultCard
          result={result}
          busy={busy}
          onConsume={consumePass}
          onClear={() => { setResult(null); setManualCode(''); }}
        />
      )}
    </div>
  );
}

function ResultCard({
  result, busy, onConsume, onClear,
}: {
  result: ValidationResult;
  busy: boolean;
  onConsume: () => void;
  onClear: () => void;
}) {
  if (!result.pass) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-2">
        <XCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-bold text-red-900">Not found</p>
          <p className="text-xs text-red-800 mt-0.5">No pass matches that QR or code.</p>
          <button type="button" onClick={onClear} className="text-xs font-bold underline text-red-900 mt-2">
            Try another
          </button>
        </div>
      </div>
    );
  }

  const p = result.pass;
  const status = p.effective_status;
  const isOk = status === 'active';
  const palette = isOk
    ? 'bg-green-50 border-green-200'
    : status === 'used'
      ? 'bg-blue-50 border-blue-200'
      : 'bg-red-50 border-red-200';
  const Icon = isOk ? CheckCircle2 : status === 'used' ? AlertTriangle : XCircle;
  const iconColor = isOk ? 'text-green-600' : status === 'used' ? 'text-blue-600' : 'text-red-600';

  return (
    <div className={`border rounded-xl p-4 space-y-3 ${palette}`}>
      <div className="flex items-start gap-2">
        <Icon size={20} className={`${iconColor} shrink-0 mt-0.5`} />
        <div className="flex-1">
          <p className="text-sm font-bold capitalize text-gray-900">
            {status.replace(/_/g, ' ')}
            {result.consumed && ' \u00b7 admitted'}
          </p>
          {p.warning && <p className="text-[11px] text-amber-700 mt-0.5">Warning: {p.warning}</p>}
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-gray-500 uppercase tracking-wider text-[10px]">Resident</dt>
          <dd className="font-semibold text-gray-900 truncate">{p.issued_to_name ?? '\u2014'}</dd>
        </div>
        <div>
          <dt className="text-gray-500 uppercase tracking-wider text-[10px]">Flat</dt>
          <dd className="font-semibold text-gray-900">{p.flat_number}</dd>
        </div>
        <div>
          <dt className="text-gray-500 uppercase tracking-wider text-[10px]">Facility</dt>
          <dd className="font-semibold text-gray-900 truncate">{p.facility?.name ?? '\u2014'}</dd>
        </div>
        <div className="col-span-3">
          <dt className="text-gray-500 uppercase tracking-wider text-[10px]">Window</dt>
          <dd className="font-mono text-gray-800" suppressHydrationWarning>
            {format(new Date(p.valid_from), 'dd MMM HH:mm')} → {format(new Date(p.valid_until), 'dd MMM HH:mm')}
          </dd>
        </div>
        <div className="col-span-3">
          <dt className="text-gray-500 uppercase tracking-wider text-[10px]">Code</dt>
          <dd className="font-mono font-bold text-gray-900">{p.code}</dd>
        </div>
      </dl>

      <div className="flex gap-2">
        {isOk && !result.consumed && (
          <Button onClick={onConsume} loading={busy} className="flex-1" size="sm">
            Admit &amp; consume
          </Button>
        )}
        <Button variant="secondary" onClick={onClear} className="flex-1" size="sm">
          {result.consumed ? 'Next pass' : 'Clear'}
        </Button>
      </div>
    </div>
  );
}
