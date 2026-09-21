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
import NotificationBell from '@/components/NotificationBell';

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

  // 2. Staff Gate: Must possess active employee membership, master owner account, or platform admin
  if (!role.canAccessStaffOwner && !role.canAccessMasterOwner && !role.isPlatformAdmin) {
    redirect('/login?reason=forbidden');
  }

  // Authoritative capability query
  const { data: caps } = await supabase.rpc('get_my_capabilities');
  const userCapabilities: string[] = caps?.capabilities || [];

  // Navigation items dynamically derived from authoritative RPC guards
  const navItems = [
    {
      label: 'Dashboard',
      href: '/owner/dashboard',
      icon: LayoutDashboard,
      visible: true,
    },
    {
      label: 'Venues & Turfs',
      href: '/owner/turfs',
      icon: Building2,
      visible: userCapabilities.includes('listing.edit') || userCapabilities.includes('turf.read') || role.canAccessMasterOwner || role.isPlatformAdmin,
    },
    {
      label: 'Bookings & Walk-ins',
      href: '/owner/bookings',
      icon: Ticket,
      visible: userCapabilities.includes('bookings.read') || userCapabilities.includes('bookings.create_walkin') || role.canAccessMasterOwner || role.isPlatformAdmin,
    },
    {
      label: 'Calendar & Slots',
      href: '/owner/calendar',
      icon: Calendar,
      visible: userCapabilities.includes('calendar.read') || userCapabilities.includes('slots.block') || role.canAccessMasterOwner || role.isPlatformAdmin,
    },
    {
      label: 'Pricing Rules',
      href: '/owner/pricing',
      icon: BadgePercent,
      visible: userCapabilities.includes('pricing.read') || userCapabilities.includes('pricing.edit') || role.canAccessMasterOwner || role.isPlatformAdmin,
    },
    {
      label: 'Audit Trail',
      href: '/owner/audit',
      icon: FileText,
      visible: userCapabilities.includes('audit.read') || role.canAccessMasterOwner || role.isPlatformAdmin,
    },
  ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#070a12] text-slate-100">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-slate-950/80 border-r border-slate-800/80 flex flex-col shrink-0">
        {/* Tenant Business Card */}
        <div className="p-5 border-b border-slate-800/80">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              {role.canAccessMasterOwner ? 'Master Owner' : 'Staff Member'}
            </span>
            <div className="flex items-center gap-2">
              <NotificationBell />
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                active
              </span>
            </div>
          </div>
          <h3 className="font-bold text-base text-white tracking-tight truncate">
            {context?.master_owner_accounts?.[0]?.business_name || context?.employee_memberships?.[0]?.business_name || 'Arena Operations'}
          </h3>
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {user.email}
          </p>
        </div>

        {/* Dynamic Navigation Links */}
        <nav className="p-3 space-y-1 flex-1">
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-all group"
                >
                  <Icon className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition-colors" />
                  <span className="flex-1">{item.label}</span>
                </Link>
              );
            })}
        </nav>

        {/* Dual-Hat Workspace Switcher */}
        {role.canAccessMasterOwner && (
          <div className="p-3 border-t border-slate-800/60">
            <Link
              href="/master/dashboard"
              className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-emerald-300 bg-emerald-950/30 border border-emerald-500/30 hover:bg-emerald-950/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <LayoutDashboard className="w-3.5 h-3.5" />
                Master Owner Admin
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded">
                Switch
              </span>
            </Link>
          </div>
        )}

        {/* Footer / Switch Portal */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 space-y-2">
          <a
            href={process.env.NEXT_PUBLIC_PLAYER_URL || 'http://localhost:3000'}
            className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
          >
            <span className="flex items-center gap-2">
              <ExternalLink className="w-3.5 h-3.5" />
              Player Catalog (Port 3000)
            </span>
            <ChevronRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
