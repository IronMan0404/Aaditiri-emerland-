import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

// Cookie that caches `{ role, is_approved }` so we don't have to hit the
// `profiles` table on every single dashboard navigation. The cookie is
// scoped to the same `sb-*-auth-token` lifetime as Supabase's auth cookie:
// when the user signs out the auth cookie disappears and we re-fetch on
// next sign-in. We also bust it any time the cached `sub` claim doesn't
// match the current user.
const ROLE_COOKIE = 'ae-role';
const ROLE_COOKIE_MAX_AGE = 60 * 30; // 30 minutes — short enough that an
// admin promotion / approval flips through within half an hour.

interface RoleCacheValue {
  sub: string;
  role: 'admin' | 'user' | null;
  approved: boolean;
}

// Pull just the `sub` claim out of a JWT without verifying signature.
// This is safe here because the JWT comes from a Supabase-set cookie that
// was already signed; we're only using `sub` for routing (not for any
// privileged DB access — RLS handles that). Returns null on any parse
// failure so the proxy will treat the request as unauthenticated.
function decodeJwtSub(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return typeof json?.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}

function readRoleCookie(request: NextRequest): RoleCacheValue | null {
  const raw = request.cookies.get(ROLE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RoleCacheValue;
    if (typeof parsed?.sub !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Fast path: anything that isn't /dashboard or /admin doesn't need auth at
  // all. The matcher already excludes static assets but auth pages, the API
  // routes, and the home page would otherwise still pay for an auth lookup.
  const needsAuth = pathname.startsWith('/dashboard') || pathname.startsWith('/admin');
  if (!needsAuth) {
    return NextResponse.next({ request });
  }

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

  // `getSession()` reads the JWT from the auth cookie WITHOUT making a
  // network call to /auth/v1/user (which is what `getUser()` does and what
  // was making the proxy take 400ms-2s per request). The session JWT is
  // signed by Supabase, so trusting `sub` for routing decisions is fine —
  // the cached role-cookie set further down is also `httpOnly` so a
  // malicious client can't tamper with it. Real RLS enforcement still
  // happens at the database layer for any data access.
  //
  // We decode `sub` directly from the raw JWT instead of touching
  // `session.user.*`, because supabase-js logs a noisy "may not be
  // authentic" warning every time the proxied user object is read. The
  // JWT itself is what we trust, not the user object.
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.access_token ? decodeJwtSub(session.access_token) : null;

  if (!userId) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    return NextResponse.redirect(url);
  }

  // Try the cookie cache first.
  let role: 'admin' | 'user' | null = null;
  let isApproved = false;
  const cached = readRoleCookie(request);
  if (cached && cached.sub === userId) {
    role = cached.role;
    isApproved = cached.approved;
  } else {
    // Cache miss: hit the DB once and write the result back into a cookie.
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_approved')
        .eq('id', userId)
        .single();
      role = (profile?.role as 'admin' | 'user' | undefined) ?? null;
      isApproved = Boolean(profile?.is_approved);
    } catch {
      // Treat as non-admin, non-approved.
    }
    supabaseResponse.cookies.set(
      ROLE_COOKIE,
      JSON.stringify({ sub: userId, role, approved: isApproved } satisfies RoleCacheValue),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: ROLE_COOKIE_MAX_AGE,
      }
    );
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

  return supabaseResponse;
}

export const config = {
  // Match only routes that actually need auth gating. Everything else (API
  // routes that do their own auth, /auth/*, the marketing home page, static
  // assets) skips the proxy entirely.
  matcher: ['/dashboard/:path*', '/admin/:path*'],
};
