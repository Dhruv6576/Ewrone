import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient, getMyContext, resolveUserRole } from '@boxcodex/shared';
import { AdminSidebar } from '@/components/AdminSidebar';

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const supabase = createServerClient('admin', cookieStore);

  // Authoritative server-side identity & role verification
  const { data: { user } } = await supabase.auth.getUser();
  const { data: context } = await getMyContext(supabase);
  const role = resolveUserRole(context);

  // 1. Fail-closed defense-in-depth for Anonymous callers
  if (!user) {
    redirect('/login');
  }

  // 2. Fail-closed defense-in-depth for authenticated callers lacking platform admin privileges
  if (!role.isPlatformAdmin) {
    redirect('/login?reason=forbidden');
  }

  // 3. Authorized root administrator
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <AdminSidebar userEmail={user.email || 'Admin'} />
      <main className="flex-1 p-6 md:p-10 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
