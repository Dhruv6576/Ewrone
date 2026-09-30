import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@boxcodex/shared';

/**
 * Next.js 16 Proxy Convention for Player Portal (apps/player)
 * Refreshes auth session cookies for player callers without blocking anonymous browsing.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

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

  // Touch/refresh player session if token present; never blocks anonymous callers
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
