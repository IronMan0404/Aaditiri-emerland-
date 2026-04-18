import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Handles the email-confirmation / magic-link redirect from Supabase.
//
// Supabase SSR uses the PKCE flow by default, so the link in the email lands
// here as `/auth/callback?code=<one-time-code>`. We exchange the code for a
// session cookie and then send the user on to /auth/pending (admin still has
// to approve them before they can reach /dashboard).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/auth/pending';

  // Vercel sits behind a proxy; honour the forwarded host so the final
  // redirect doesn't bounce the user back to an internal URL.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  const baseUrl =
    process.env.NODE_ENV === 'development' || !forwardedHost
      ? origin
      : `${forwardedProto}://${forwardedHost}`;

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/auth/login?error=missing_code`);
  }

  const response = NextResponse.redirect(`${baseUrl}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${baseUrl}/auth/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return response;
}
