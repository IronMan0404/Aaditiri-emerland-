'use client';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import AuthShell from '@/components/layout/AuthShell';
import TelegramConnect from '@/components/notifications/TelegramConnect';

export default function PendingPage() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-2xl">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
            <span className="text-3xl">⏳</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Approval Pending</h2>
          <p className="text-gray-600 text-sm mb-1">
            Your account has been created successfully!
          </p>
          <p className="text-gray-500 text-xs mb-4 leading-snug">
            Please wait while an admin reviews and approves your registration. You will be
            notified once access is granted.
          </p>
        </div>

        {/*
         * Optional Telegram pairing while the user waits for admin approval.
         *
         * Why surface this here: pairing now (rather than after approval)
         * means (a) the approval push lands in the resident's Telegram DM
         * the instant an admin clicks Approve, (b) password resets work
         * via Telegram from day one, and (c) the resident has something
         * useful to do while they wait. The pairing endpoint accepts
         * unapproved auth users specifically to enable this flow.
         */}
        <div className="bg-[#F5F8FF] border border-[#26A5E4]/30 rounded-xl p-3 mb-4">
          <p className="text-xs text-[#26A5E4] font-semibold uppercase tracking-wider mb-2">
            Recommended · Optional
          </p>
          <p className="text-xs text-gray-600 leading-snug mb-3">
            Connect Telegram now and you&apos;ll get the approval notification instantly,
            plus instant password resets if you ever forget your password.
          </p>
          <TelegramConnect />
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-left">
          <p className="text-xs text-amber-700 font-semibold mb-1">What happens next?</p>
          <ul className="text-xs text-amber-600 space-y-1">
            <li>• Admin reviews your registration</li>
            <li>• You receive access to the community app</li>
            <li>• This usually takes 24–48 hours</li>
          </ul>
        </div>

        <Button variant="secondary" onClick={handleSignOut} className="w-full">
          Sign Out
        </Button>
      </div>
    </AuthShell>
  );
}
