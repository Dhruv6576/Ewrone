import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient, getMyContext, resolveUserRole } from '@boxcodex/shared';

/**
 * Single role-aware /dashboard route outside any route group.
 * Performs its own authoritative server-side identity & context check
 * before routing to the appropriate role-specific dashboard.
 */
export default async function DashboardRedirectPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient('owner', cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const { data: context } = await getMyContext(supabase);
  const role = resolveUserRole(context);

  if (role.canAccessMasterOwner || role.isPlatformAdmin) {
    redirect('/master/dashboard');
  } else if (role.canAccessStaffOwner) {
    redirect('/owner/dashboard');
  } else {
    redirect('/login?reason=forbidden');
  }
}
