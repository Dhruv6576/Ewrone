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
  ArrowRightLeft,
  ChevronLeft
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
  const [isCollapsed, setIsCollapsed] = useState(false);

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
      <div className="md:hidden flex items-center justify-between p-4 bg-neutral-900 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-neutral-200" />
          <span className="font-bold text-sm tracking-wide">BOX CODEX</span>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 text-neutral-400 hover:text-neutral-100"
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
        className={`fixed md:static inset-y-0 left-0 z-50 bg-neutral-950 border-r border-neutral-800 flex flex-col transition-all duration-300 ease-in-out ${isCollapsed ? 'w-20' : 'w-64'
          } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        {/* Collapse Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="group absolute -right-3.5 top-6 bg-neutral-800 border border-neutral-700 rounded-full p-1.5 text-neutral-400 hover:text-[#1DB954] hover:border-[#1DB954] hover:bg-neutral-900 hover:shadow-[0_0_15px_-3px_rgba(29,185,84,0.4)] z-50 hidden md:flex items-center justify-center transition-all duration-300 shadow-md"
        >
          <ChevronLeft className={`w-4 h-4 transition-transform duration-300 group-hover:text-[#1DB954] ${isCollapsed ? 'rotate-180' : ''}`} />
        </button>

        {/* Brand */}
        <div className={`p-5 border-b border-neutral-800/80 flex items-center ${isCollapsed ? 'justify-center px-2' : 'justify-between'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 flex-shrink-0 rounded-lg bg-neutral-900 dark:bg-white/10 border border-neutral-900 dark:border-white/30 flex items-center justify-center text-neutral-200">
              <ShieldCheck className="w-5 h-5" />
            </div>
            {!isCollapsed && (
              <div className="min-w-0 transition-opacity duration-300">
                <span className="font-bold text-sm tracking-wide text-white block truncate">BOX CODEX</span>
                <span className="text-[10px] text-neutral-200 font-semibold tracking-wider uppercase block truncate">
                  Business Console
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Tenant Switcher */}
        {!isCollapsed && (
          <div className="p-3 border-b border-neutral-800/60 transition-opacity duration-300">
            <TenantSwitcher
              accounts={accounts}
              activeId={activeTenantId}
              onSelect={setActiveTenantId}
            />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto overflow-x-hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/master/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                title={isCollapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all group ${isActive
                    ? 'bg-neutral-900 dark:bg-white/10 text-neutral-200 font-semibold border border-neutral-900 dark:border-white/20 shadow-sm shadow-neutral-950/50'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60'
                  } ${isCollapsed ? 'justify-center' : ''}`}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${isActive ? 'text-neutral-200' : 'text-neutral-500 group-hover:text-neutral-300'}`} />
                {!isCollapsed && (
                  <span className="truncate transition-opacity duration-300">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Dual-Hat Workspace Switcher */}
        {canAccessStaff && (
          <div className={`px-3 py-2 border-t border-neutral-800/60 ${isCollapsed ? 'flex justify-center' : ''}`}>
            <Link
              href="/owner/dashboard"
              title={isCollapsed ? "Switch to Venue Operations" : undefined}
              className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-amber-300 bg-amber-950/30 border border-amber-500/30 hover:bg-amber-950/50 transition-colors ${isCollapsed ? 'justify-center p-2' : ''}`}
            >
              <div className="flex items-center gap-2">
                <ArrowRightLeft className={`flex-shrink-0 ${isCollapsed ? 'w-5 h-5' : 'w-3.5 h-3.5'}`} />
                {!isCollapsed && <span className="truncate">Venue Operations</span>}
              </div>
              {!isCollapsed && (
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded flex-shrink-0">
                  Switch
                </span>
              )}
            </Link>
          </div>
        )}

        {/* User Profile / Logout Footer */}
        <div className={`p-3 border-t border-neutral-800/80 bg-neutral-900/40 ${isCollapsed ? 'flex flex-col items-center gap-3' : ''}`}>
          <div className={`flex items-center justify-between gap-2 px-2 py-1.5 ${isCollapsed ? 'flex-col justify-center' : ''}`}>
            {!isCollapsed && (
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{displayName}</p>
                <p className="text-[10px] text-neutral-400 truncate">{userEmail}</p>
              </div>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign Out"
              className="p-2 text-neutral-400 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors flex-shrink-0"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

