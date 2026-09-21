'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createBrowserClient } from '@boxcodex/shared';
import {
  Shield,
  Building2,
  Wallet,
  FileText,
  Percent,
  ChevronRight,
  LogOut,
  ExternalLink
} from 'lucide-react';

interface AdminSidebarProps {
  userEmail: string;
}

export function AdminSidebar({ userEmail }: AdminSidebarProps) {
  const pathname = usePathname();

  const handleSignOut = async () => {
    const supabase = createBrowserClient('admin');
    await supabase.auth.signOut({ scope: 'local' });
    window.location.href = '/login';
  };

  const navItems = [
    {
      label: 'Turf Approvals',
      href: '/admin/turfs',
      icon: Building2,
      description: 'Review pending & draft listings',
    },
    {
      label: 'Payouts & Refunds',
      href: '/admin/payouts',
      icon: Wallet,
      description: 'Settle payouts & manage refunds',
    },
    {
      label: 'Platform Audit',
      href: '/admin/audit',
      icon: FileText,
      description: 'System-wide immutable trail',
    },
    {
      label: 'Tenants & Commissions',
      href: '/admin/tenants',
      icon: Percent,
      description: 'Tenants & commission rules',
    },
  ];

  return (
    <aside className="w-full md:w-72 bg-slate-900/60 border-r border-slate-800/80 p-5 flex flex-col justify-between backdrop-blur-xl">
      <div className="space-y-6">
        {/* Platform Admin Header */}
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shadow-lg shadow-blue-950/20">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-blue-400 tracking-wider uppercase">Platform Admin</div>
            <div className="text-base font-bold text-white tracking-tight">BoxCodex Core</div>
          </div>
        </div>

        <div className="h-px bg-slate-800/60 w-full" />

        {/* Navigation Links */}
        <nav className="space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all group ${
                  isActive
                    ? 'bg-blue-600/20 text-white border border-blue-500/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-blue-400'}`} />
                  <div>
                    <div className="text-sm font-semibold">{item.label}</div>
                    <div className="text-[11px] text-slate-500">{item.description}</div>
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 transition-colors ${isActive ? 'text-blue-400' : 'text-slate-600 group-hover:text-slate-300'}`} />
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer / Context */}
      <div className="pt-6 border-t border-slate-800/60 mt-6 space-y-4">
        <div className="px-3 py-2.5 rounded-xl bg-slate-900/80 border border-slate-800/60">
          <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Signed in as</div>
          <div className="text-xs font-semibold text-slate-200 truncate mt-0.5">{userEmail}</div>
          <div className="inline-flex items-center gap-1.5 mt-2 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 text-[10px] font-semibold border border-blue-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Root Administrator
          </div>
        </div>

        <button
          onClick={handleSignOut}
          className="w-full py-2 px-3 rounded-lg bg-slate-800/40 hover:bg-red-950/40 text-slate-400 hover:text-red-400 text-xs font-semibold transition-colors flex items-center justify-center gap-2 border border-transparent hover:border-red-500/20"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out of Admin Session
        </button>

        <div className="flex flex-col gap-1.5 text-xs text-slate-400 pt-2">
          <a
            href={process.env.NEXT_PUBLIC_PLAYER_URL || 'http://localhost:3000'}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-800/40 hover:text-slate-200 transition-colors"
          >
            <span>Player Portal (Port 3000)</span>
            <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
          </a>
        </div>
      </div>
    </aside>
  );
}
