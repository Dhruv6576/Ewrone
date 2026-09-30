import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@boxcodex/shared';

/**
 * Next.js Proxy for Player Portal (apps/player)
 * Refreshes auth session cookies ONLY when an auth cookie is present.
 * Skips prefetch and anonymous requests for maximum speed and instant navigation.
 */
export async function proxy(request: NextRequest) {
  // 1. Skip prefetch and RSC prefetch requests immediately
  if (
    request.headers.get('next-router-prefetch') ||
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('sec-purpose') === 'prefetch'
  ) {
    return NextResponse.next();
  }

  // 2. Fast-path: Never block public catalog, landing, or venue routes with remote auth checks
  const pathname = request.nextUrl.pathname;
  const isPublicRoute =
    pathname === '/' ||
    pathname.startsWith('/explore') ||
    pathname.startsWith('/turfs') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/images');

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // 3. Only touch auth on protected routes (/my-bookings, /book, etc.) if an auth cookie exists
  const allCookies = request.cookies.getAll();
  const hasAuthCookie = allCookies.some(
    (c) => c.name.startsWith('sb-') && c.name.includes('auth-token')
  );

  if (!hasAuthCookie) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  try {
    const supabase = createServerClient('player', {
      getAll() {
        return request.cookies.getAll();
      },
      set(name, value, options) {
        request.cookies.set(name, value);
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set(name, value, options);
      },
    });

    // Touch/refresh player session for logged-in users on protected routes
    await supabase.auth.getUser();
  } catch (e) {
    // Non-blocking: continue if auth refresh fails
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|images|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
