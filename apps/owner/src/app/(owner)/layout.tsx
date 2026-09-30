import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient, getMyContext, resolveUserRole } from '@boxcodex/shared';
import {
  LayoutDashboard,
  Building2,
  Calendar,
  Ticket,
  BadgePercent,
  Wallet,
  Users,
  FileText,
  ChevronRight,
  ExternalLink,
  ShieldAlert,
  LogOut,
} from 'lucide-react';
import TopHeader from '@/components/TopHeader';
import OwnerSidebar from '@/components/OwnerSidebar';

interface OwnerLayoutProps {
  children: React.ReactNode;
}

export default async function OwnerLayout({ children }: OwnerLayoutProps) {
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

  // Fetch live profile name
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', user.id)
    .single();
  
  const displayName = profile?.display_name || user.user_metadata?.full_name;

  // 2. Staff Gate: Must possess active employee membership, master owner account, or platform admin
  if (!role.canAccessStaffOwner && !role.canAccessMasterOwner && !role.isPlatformAdmin) {
    redirect('/login?reason=forbidden');
  }

  // Authoritative capability query
  const { data: caps } = await supabase.rpc('get_my_capabilities');
  const userCapabilities: string[] = caps?.capabilities || [];

  return (
    <div className="min-h-screen md:h-screen md:overflow-hidden flex flex-col md:flex-row bg-[var(--background)] text-[var(--foreground)] transition-colors duration-300">
        <OwnerSidebar
          userCapabilities={userCapabilities}
          canAccessMasterOwner={role.canAccessMasterOwner}
          isPlatformAdmin={role.isPlatformAdmin}
          roleTitle={role.canAccessMasterOwner ? 'Master Owner' : 'Staff'}
        />

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 overflow-y-auto relative z-10">
        <TopHeader userEmail={user.email || ''} userName={displayName} />
        <div className="p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
