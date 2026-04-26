'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, CheckCircle2, Copy, ExternalLink, X } from 'lucide-react';
import toast from 'react-hot-toast';

// ============================================================
// Resident-facing "Connect Telegram" widget for /dashboard/profile.
//
// State machine:
//
//   loading               first poll on mount
//      │
//      ├── linked         show "Linked as @username" + Disconnect
//      │
//      └── unlinked
//             │
//             ├── pending        a code is outstanding (in DB):
//             │                    show deep-link, copy-code,
//             │                    "I've connected" button. Polls
//             │                    GET every 4s; flips to `linked`
//             │                    when the bot consumes the code.
//             │
//             └── idle           show "Connect Telegram" button.
//
// All state lives server-side; this component is a thin shell over
// /api/telegram/pair.
// ============================================================

interface PendingPairing {
  code: string;
  deepLink: string;
  expiresAt: string;
}

interface PairStatus {
  linked: boolean;
  username?: string | null;
  firstName?: string | null;
  linkedAt?: string;
  pending?: PendingPairing;
}

export default function TelegramConnect() {
  const [status, setStatus] = useState<PairStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = useCallback(async (silent = false): Promise<PairStatus | null> => {
    try {
      const res = await fetch('/api/telegram/pair', { method: 'GET', cache: 'no-store' });
      if (!res.ok) {
        if (!silent) {
          // 503 = bot not configured server-side; treat as a soft
          // "feature off" signal rather than an error toast.
          if (res.status === 503) {
            setStatus({ linked: false });
            return { linked: false };
          }
          toast.error('Could not load Telegram status.');
        }
        return null;
      }
      const json = (await res.json()) as PairStatus;
      setStatus(json);
      return json;
    } catch {
      if (!silent) toast.error('Network error loading Telegram status.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll every 4s while a pairing code is pending. Stops when the
  // user pairs (linked = true) or loses the pending code (expired).
  useEffect(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    if (status?.pending && !status.linked) {
      pollTimer.current = setTimeout(() => {
        fetchStatus(true);
      }, 4000);
    }
    return () => {
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [status, fetchStatus]);

  async function startPairing() {
    setBusy(true);
    try {
      const res = await fetch('/api/telegram/pair', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.message ?? 'Could not start pairing. Try again in a minute.');
        return;
      }
      setStatus({
        linked: false,
        pending: {
          code: json.code,
          deepLink: json.deepLink,
          expiresAt: json.expiresAt,
        },
      });
      // Open Telegram in a new tab so the user is one tap away
      // from the bot. On mobile this opens the Telegram app
      // directly (t.me redirects to tg://).
      window.open(json.deepLink, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Network error starting pairing.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelPairing() {
    // We don't have a "cancel pending code" endpoint; starting a
    // new pairing invalidates the old one server-side, and a code
    // expires after 15 min anyway. So "cancel" just hides the UI
    // until the next poll catches up.
    setStatus({ linked: false });
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this Telegram account? You will stop receiving notifications there.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/telegram/pair', { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Could not disconnect. Try again in a minute.');
        return;
      }
      toast.success('Disconnected from Telegram.');
      setStatus({ linked: false });
    } catch {
      toast.error('Network error disconnecting.');
    } finally {
      setBusy(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard
      .writeText(code)
      .then(() => toast.success('Code copied'))
      .catch(() => toast.error('Could not copy code'));
  }

  // ---- Rendering ---------------------------------------------------

  if (loading || !status) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Send size={16} className="text-[#26A5E4] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">Telegram</p>
            <p className="text-xs text-gray-500 leading-snug mt-0.5">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  if (status.linked) {
    const handle = status.username ? `@${status.username}` : status.firstName || 'your Telegram';
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <CheckCircle2 size={16} className="text-[#1B5E20] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">Telegram connected</p>
            <p className="text-xs text-gray-500 leading-snug mt-0.5">
              Notifications go to <span className="font-medium text-gray-700">{handle}</span>.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50 shrink-0"
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (status.pending) {
    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Send size={16} className="text-[#26A5E4] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">Finish pairing in Telegram</p>
              <p className="text-xs text-gray-500 leading-snug mt-0.5">
                Tap the link below, then send <span className="font-mono text-gray-700">/start</span> to the bot.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={cancelPairing}
            aria-label="Cancel"
            className="text-gray-400 hover:text-gray-600 shrink-0"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={status.pending.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#26A5E4] text-white text-xs font-semibold hover:bg-[#1f8fc7]"
          >
            <ExternalLink size={12} /> Open Telegram
          </a>
          <button
            type="button"
            onClick={() => status.pending && copyCode(status.pending.code)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Copy size={12} /> Copy code
          </button>
          <code className="text-[11px] font-mono text-gray-500 truncate">{status.pending.code}</code>
        </div>
        <p className="text-[11px] text-gray-400">
          Code expires in 15 minutes. We&apos;ll detect the pairing automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2 min-w-0">
        <Send size={16} className="text-[#26A5E4] mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800">Telegram</p>
          <p className="text-xs text-gray-500 leading-snug mt-0.5">
            Get society notifications, plus admin approve/reject buttons, on Telegram.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={startPairing}
        disabled={busy}
        className="px-3 py-1.5 rounded-lg bg-[#1B5E20] text-white text-xs font-semibold hover:bg-[#164a1a] disabled:opacity-50 shrink-0"
      >
        Connect
      </button>
    </div>
  );
}
