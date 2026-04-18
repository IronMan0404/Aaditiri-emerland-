'use client';
import { useEffect, useState } from 'react';
import { Download, Bell, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

// Chrome's install-prompt event isn't typed in lib.dom yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const INSTALL_DISMISS_KEY = 'ae:install-dismissed-at';
const NOTIF_DISMISS_KEY = 'ae:notif-dismissed-at';
// Re-prompt after a week if the user dismisses without accepting.
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function recentlyDismissed(key: string): boolean {
  if (typeof window === 'undefined') return false;
  const raw = window.localStorage.getItem(key);
  if (!raw) return false;
  const ts = Number.parseInt(raw, 10);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < DISMISS_COOLDOWN_MS;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari uses navigator.standalone, which isn't in lib.dom.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
}

// Two-stage UX:
//   1. "Install Aaditri Emerland" banner (or iOS instructions) — shows once
//      installation is possible AND the user hasn't recently dismissed it.
//   2. "Enable notifications" banner — shows once the install banner is out
//      of the way (either dismissed, accepted, or never applicable on iOS),
//      to ask for Notification.permission with a real user gesture so push
//      subscription can succeed.
export default function InstallPrompt() {
  const { profile, mounted } = useAuth();
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [showNotif, setShowNotif] = useState(false);

  useEffect(() => {
    if (!mounted || !profile?.id) return;

    const standalone = isStandalone();

    // Install prompt logic
    if (!standalone) {
      if (isIOS()) {
        if (!recentlyDismissed(INSTALL_DISMISS_KEY)) setShowIOSHint(true);
      } else {
        const handler = (e: Event) => {
          // Stop Chrome from showing its built-in mini-infobar so we can show
          // our own branded banner instead.
          e.preventDefault();
          if (recentlyDismissed(INSTALL_DISMISS_KEY)) return;
          setInstallEvt(e as BeforeInstallPromptEvent);
          setShowInstall(true);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
      }
    }
  }, [mounted, profile?.id]);

  useEffect(() => {
    if (!mounted || !profile?.id) return;
    if (showInstall || showIOSHint) return;
    if (typeof window === 'undefined') return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
    if (Notification.permission !== 'default') return;
    if (recentlyDismissed(NOTIF_DISMISS_KEY)) return;
    setShowNotif(true);
  }, [mounted, profile?.id, showInstall, showIOSHint]);

  async function handleInstall() {
    if (!installEvt) return;
    await installEvt.prompt();
    const choice = await installEvt.userChoice;
    if (choice.outcome === 'dismissed') {
      window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    }
    setInstallEvt(null);
    setShowInstall(false);
  }

  function dismissInstall() {
    window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    setShowInstall(false);
    setShowIOSHint(false);
  }

  async function handleEnableNotifs() {
    try {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        window.localStorage.setItem(NOTIF_DISMISS_KEY, String(Date.now()));
      }
      // PushSubscriber sees `Notification.permission === 'granted'` on its
      // next mount and finishes the subscribe + persist flow.
    } finally {
      setShowNotif(false);
    }
  }

  function dismissNotifs() {
    window.localStorage.setItem(NOTIF_DISMISS_KEY, String(Date.now()));
    setShowNotif(false);
  }

  if (!mounted || !profile?.id) return null;

  if (showInstall && installEvt) {
    return (
      <Banner
        icon={<Download size={18} />}
        title="Install Aaditri Emerland"
        body="Add it to your home screen for one-tap access and push alerts."
        primary={{ label: 'Install', onClick: handleInstall }}
        onDismiss={dismissInstall}
      />
    );
  }

  if (showIOSHint) {
    return (
      <Banner
        icon={<Download size={18} />}
        title="Add to Home Screen"
        body="Tap Share, then 'Add to Home Screen' to get push alerts."
        onDismiss={dismissInstall}
      />
    );
  }

  if (showNotif) {
    return (
      <Banner
        icon={<Bell size={18} />}
        title="Stay in the loop"
        body="Get pushed when admins post a broadcast or 24 hrs before an event."
        primary={{ label: 'Enable', onClick: handleEnableNotifs }}
        onDismiss={dismissNotifs}
      />
    );
  }

  return null;
}

interface BannerProps {
  icon: React.ReactNode;
  title: string;
  body: string;
  primary?: { label: string; onClick: () => void };
  onDismiss: () => void;
}

function Banner({ icon, title, body, primary, onDismiss }: BannerProps) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed left-3 right-3 bottom-20 md:bottom-4 md:left-auto md:right-4 md:max-w-sm z-[55] bg-white rounded-2xl shadow-xl border border-gray-200 p-4 flex items-start gap-3"
    >
      <span className="w-9 h-9 rounded-xl bg-[#1B5E20] text-white flex items-center justify-center shrink-0">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{body}</p>
        {primary && (
          <button
            type="button"
            onClick={primary.onClick}
            className="mt-2 inline-flex items-center px-3 py-1.5 rounded-lg bg-[#1B5E20] text-white text-xs font-semibold hover:bg-[#164d1a]"
          >
            {primary.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-gray-400 hover:text-gray-600 p-1"
      >
        <X size={14} />
      </button>
    </div>
  );
}
