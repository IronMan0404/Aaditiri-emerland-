'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import StaffHome from '@/components/staff/StaffHome';
import { Loader2 } from 'lucide-react';

// /staff/housekeeping — see /staff/security/page.tsx for the
// shared rationale.

export default function StaffHousekeepingPage() {
  const [name, setName] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/auth/login');
        return;
      }
      const { data } = await supabase
        .from('staff_profiles')
        .select('full_name, staff_role, is_active')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (!data || !data.is_active) {
        await supabase.auth.signOut();
        router.replace('/auth/login?reason=staff_inactive');
        return;
      }
      if (data.staff_role !== 'housekeeping') {
        router.replace('/staff/security');
        return;
      }
      setName(data.full_name);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!name) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm gap-2">
        <Loader2 className="animate-spin" size={16} /> Loading…
      </div>
    );
  }

  return <StaffHome role="housekeeping" staffName={name} />;
}
