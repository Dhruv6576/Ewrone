import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient, getMyContext, resolveUserRole } from '@boxcodex/shared';
import { MasterOwnerSidebar } from '@/components/MasterOwnerSidebar';
import { NotificationBell } from '@/components/NotificationBell';

export default async function MasterOwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const supabase = createServerClient('owner', cookieStore);

  // Authoritative server-side identity & context resolution
  const { data: { user } } = await supabase.auth.getUser();
  const { data: context } = await getMyContext(supabase);
  const role = resolveUserRole(context);

  // 1. Fail-closed defense-in-depth for Anonymous callers
  if (!user) {
    redirect('/login');
  }

  // 2. Master Owner Gate: Must hold active master owner account or platform admin
  if (!role.canAccessMasterOwner && !role.isPlatformAdmin) {
    redirect('/login?reason=forbidden');
  }

  const accounts = context?.master_owner_accounts || [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row">
      <MasterOwnerSidebar
        accounts={accounts}
        userEmail={user.email || ''}
        displayName={context?.profile?.display_name || user.email || 'Master Owner'}
        canAccessStaff={role.canAccessStaffOwner}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="hidden md:flex items-center justify-between px-8 py-4 bg-slate-900/50 border-b border-slate-800 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Master Owner Administration</span>
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 p-6 md:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
