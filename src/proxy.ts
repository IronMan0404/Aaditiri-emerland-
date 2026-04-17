import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    }
  );

  const { pathname } = request.nextUrl;
  const { data: { user } } = await supabase.auth.getUser();

  const needsAuth = pathname.startsWith('/dashboard') || pathname.startsWith('/admin');

  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    return NextResponse.redirect(url);
  }

  if (user && needsAuth) {
    let role: string | null = null;
    let isApproved = false;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_approved')
        .eq('id', user.id)
        .single();
      role = profile?.role ?? null;
      isApproved = Boolean(profile?.is_approved);
    } catch {
      // fall through — treat as non-admin, non-approved
    }

    if (pathname.startsWith('/admin') && role !== 'admin') {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith('/dashboard') && role !== 'admin' && !isApproved) {
      const url = request.nextUrl.clone();
      url.pathname = '/auth/pending';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
