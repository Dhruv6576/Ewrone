import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, getMyContext, resolveUserRole } from '@boxcodex/shared';

/**
 * Next.js 16 Proxy Convention for Unified Business Console (apps/owner)
 * Enforces fail-closed access at the edge/proxy layer before layout execution:
 * - Matcher: ['/master/:path*', '/owner/:path*', '/dashboard']
 * - Anonymous callers: HTML document requests redirect to /login; API/curl requests receive HTTP 401.
 * - Authenticated callers:
 *   - /master/*: requires isMasterOwner or isPlatformAdmin
 *   - /owner/*: requires isStaffOwner, isMasterOwner, or isPlatformAdmin
 *   - /dashboard: requires isStaffOwner, isMasterOwner, or isPlatformAdmin
 *   Unauthorized requests receive HTTP 403 (or redirect to /login?reason=forbidden with local session cleared).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isMasterPath = pathname.startsWith('/master');
  const isOwnerPath = pathname.startsWith('/owner');
  const isDashboardPath = pathname === '/dashboard' || pathname.startsWith('/dashboard/');

  if (isMasterPath || isOwnerPath || isDashboardPath) {
    let response = NextResponse.next({
      request: {
        headers: request.headers,
      },
    });

    const supabase = createServerClient('owner', {
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

    const { data: { user } } = await supabase.auth.getUser();
    const isHtmlRequest = request.headers.get('accept')?.includes('text/html');

    // 1. Fail-closed for Anonymous callers
    if (!user) {
      if (isHtmlRequest) {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('redirect', pathname);
        return NextResponse.redirect(loginUrl);
      }

      return new NextResponse(
        'HTTP 401 Unauthorized: Authentication required for Business Console.',
        {
          status: 401,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }
      );
    }

    // 2. Resolve authoritative roles
    const { data: context } = await getMyContext(supabase);
    const role = resolveUserRole(context);

    // 3. Fail-closed role checks
    let isAllowed = false;

    if (isMasterPath) {
      isAllowed = role.canAccessMasterOwner || role.isPlatformAdmin;
    } else if (isOwnerPath || isDashboardPath) {
      isAllowed = role.canAccessStaffOwner || role.canAccessMasterOwner || role.isPlatformAdmin;
    }

    if (!isAllowed) {
      if (isHtmlRequest) {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('reason', 'forbidden');
        const redirectRes = NextResponse.redirect(loginUrl);
        // Clear local session cookie immediately in HTTP response header
        redirectRes.cookies.set('sb-boxcodex-owner-auth-token', '', { maxAge: 0, path: '/' });
        return redirectRes;
      }

      return new NextResponse(
        `HTTP 403 Forbidden: Access Refused: Account (${user.email}) lacks required privileges.`,
        {
          status: 403,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }
      );
    }

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/master/:path*', '/owner/:path*', '/dashboard'],
};
