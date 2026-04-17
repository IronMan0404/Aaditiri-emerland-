'use client';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import Button from '@/components/ui/Button';

export default function PendingPage() {
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/auth/login');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1B5E20] to-[#2E7D32] p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl p-8 shadow-2xl text-center">
        <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <span className="text-4xl">⏳</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-3">Approval Pending</h2>
        <p className="text-gray-600 text-sm mb-2">
          Your account has been created successfully!
        </p>
        <p className="text-gray-500 text-sm mb-6">
          Please wait while an admin reviews and approves your registration. You will be notified once access is granted.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6 text-left">
          <p className="text-xs text-amber-700 font-semibold mb-1">What happens next?</p>
          <ul className="text-xs text-amber-600 space-y-1">
            <li>• Admin reviews your registration</li>
            <li>• You receive access to the community app</li>
            <li>• This usually takes 24–48 hours</li>
          </ul>
        </div>
        <Button variant="secondary" onClick={handleSignOut} className="w-full">Sign Out</Button>
      </div>
    </div>
  );
}
