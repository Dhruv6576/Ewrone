'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createBrowserClient, type MasterOwnerAccount } from '@boxcodex/shared';
import { 
  LayoutDashboard, 
  MapPin, 
  PlusCircle, 
  Users, 
  Wallet, 
  LogOut, 
  Menu, 
  X, 
  ShieldCheck,
  ArrowRightLeft
} from 'lucide-react';
import { TenantSwitcher } from '@/components/TenantSwitcher';
import { NotificationBell } from '@/components/NotificationBell';

interface MasterOwnerSidebarProps {
  accounts: MasterOwnerAccount[];
  userEmail: string;
  displayName: string;
  canAccessStaff?: boolean;
}

export function MasterOwnerSidebar({
  accounts,
  userEmail,
  displayName,
  canAccessStaff = false,
}: MasterOwnerSidebarProps) {
  const pathname = usePathname();
  const [activeTenantId, setActiveTenantId] = useState<string>(accounts[0]?.id || '');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSignOut = async () => {
    const supabase = createBrowserClient('owner');
    await supabase.auth.signOut({ scope: 'local' });
    window.location.href = '/login';
  };

  const navItems = [
    { href: '/master/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/master/turfs', label: 'Turf Portfolio', icon: MapPin },
    { href: '/master/turfs/new', label: 'Onboard Venue', icon: PlusCircle },
    { href: '/master/team', label: 'Staff & Invites', icon: Users },
    { href: '/master/payouts', label: 'Payouts & Statements', icon: Wallet },
  ];

  return (
    <>
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <span className="font-bold text-sm tracking-wide">BOX CODEX</span>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 text-slate-400 hover:text-slate-100"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-slate-800 flex flex-col transition-transform duration-200 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Brand */}
        <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-wide text-white block">BOX CODEX</span>
              <span className="text-[10px] text-emerald-400 font-semibold tracking-wider uppercase block">
                Business Console
              </span>
            </div>
          </div>
        </div>

        {/* Tenant Switcher */}
        <div className="p-3 border-b border-slate-800/60">
          <TenantSwitcher
            accounts={accounts}
            activeId={activeTenantId}
            onSelect={setActiveTenantId}
          />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/master/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20 shadow-sm shadow-emerald-950/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Dual-Hat Workspace Switcher */}
        {canAccessStaff && (
          <div className="px-3 py-2 border-t border-slate-800/60">
            <Link
              href="/owner/dashboard"
              className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-amber-300 bg-amber-950/30 border border-amber-500/30 hover:bg-amber-950/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>Venue Operations</span>
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">
                Switch
              </span>
            </Link>
          </div>
        )}

        {/* User Profile / Logout Footer */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-900/40">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{displayName}</p>
              <p className="text-[10px] text-slate-400 truncate">{userEmail}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign Out"
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
