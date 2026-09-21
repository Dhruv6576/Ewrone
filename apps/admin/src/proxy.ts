import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, getMyContext, resolveUserRole } from '@boxcodex/shared';

/**
 * Next.js 16 Proxy Convention for Platform Admin Portal (apps/admin)
 * Enforces fail-closed access at the edge/proxy layer before layout execution:
 * - Anonymous callers: browser document requests redirect to /login; API/curl requests receive HTTP 403.
 * - Authenticated callers: must have is_platform_admin === true; otherwise receive literal HTTP 403.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/admin')) {
    let response = NextResponse.next({
      request: {
        headers: request.headers,
      },
    });

    const supabase = createServerClient('admin', {
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
        'HTTP 403 Forbidden: Anonymous access is strictly prohibited on Platform Admin.',
        {
          status: 403,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }
      );
    }

    // 2. Fail-closed for Authenticated callers lacking platform admin status
    const { data: context } = await getMyContext(supabase);
    const role = resolveUserRole(context);

    if (!role.isPlatformAdmin) {
      if (isHtmlRequest) {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('reason', 'forbidden');
        const redirectRes = NextResponse.redirect(loginUrl);
        // Clear local administrative cookie immediately in HTTP response header
        redirectRes.cookies.set('sb-boxcodex-admin-auth-token', '', { maxAge: 0, path: '/' });
        return redirectRes;
      }

      return new NextResponse(
        `HTTP 403 Forbidden: Access Refused: Account (${user.email}) lacks platform administration privileges.`,
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
  matcher: ['/admin/:path*'],
};
