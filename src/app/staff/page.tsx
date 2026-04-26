'use client';

// /staff (root) — single-purpose router. We hit /api/staff/attendance
// once to figure out the staff member's role (which is implicit in
// the response — both endpoints share requireStaff() which knows the
// role) and forward to the appropriate sub-page.
//
// Why this indirection: when a staff member signs in, the post-
// login redirect goes to /dashboard, the proxy bounces them to
// /staff, and from here we route to /staff/security or
// /staff/housekeeping. Doing the role lookup in one central place
// keeps the proxy simple (it doesn't need to know staff_role).
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

export default function StaffRootPage() {
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
      // Read the staff_role straight from staff_profiles — RLS
      // grants the staff member a SELECT on their own row.
      const { data } = await supabase
        .from('staff_profiles')
        .select('staff_role, is_active')
        .eq('id', user.id)
        .maybeSingle();

      if (cancelled) return;

      if (!data || !data.is_active) {
        // Either they're deactivated or somehow have role=staff
        // on profiles but no staff_profiles row. Sign them out
        // back to login with an explanatory query param.
        await supabase.auth.signOut();
        router.replace('/auth/login?reason=staff_inactive');
        return;
      }

      router.replace(
        data.staff_role === 'security' ? '/staff/security' : '/staff/housekeeping',
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F5F5]">
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <Loader2 className="animate-spin" size={16} />
        Loading…
      </div>
    </div>
  );
}
