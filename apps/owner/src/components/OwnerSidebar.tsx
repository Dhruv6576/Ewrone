'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  Calendar,
  History,
  BadgePercent,
  FileText,
  Users,
  Wallet,
  Settings,
  ChevronLeft
} from 'lucide-react';

interface OwnerSidebarProps {
  userCapabilities: string[];
  canAccessMasterOwner: boolean;
  isPlatformAdmin: boolean;
  roleTitle: string;
}

export default function OwnerSidebar({
  userCapabilities,
  canAccessMasterOwner,
  isPlatformAdmin,
  roleTitle
}: OwnerSidebarProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

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
      visible:
        userCapabilities.includes('listing.edit') ||
        userCapabilities.includes('turf.read') ||
        canAccessMasterOwner ||
        isPlatformAdmin,
    },
    {
      label: 'Booking History',
      href: '/owner/bookings',
      icon: History,
      visible:
        userCapabilities.includes('bookings.read') ||
        userCapabilities.includes('bookings.create_walkin') ||
        canAccessMasterOwner ||
        isPlatformAdmin,
    },
    {
      label: 'Calendar & Slots',
      href: '/owner/calendar',
      icon: Calendar,
      visible:
        userCapabilities.includes('calendar.read') ||
        userCapabilities.includes('slots.block') ||
        canAccessMasterOwner ||
        isPlatformAdmin,
    },
    {
      label: 'Pricing Rules',
      href: '/owner/pricing',
      icon: BadgePercent,
      visible:
        userCapabilities.includes('pricing.read') ||
        userCapabilities.includes('pricing.edit') ||
        canAccessMasterOwner ||
        isPlatformAdmin,
    },
    {
      label: 'Staff & Invites',
      href: '/owner/team',
      icon: Users,
      visible: canAccessMasterOwner || isPlatformAdmin,
    },
    {
      label: 'Payouts & Statements',
      href: '/owner/payouts',
      icon: Wallet,
      visible: canAccessMasterOwner || isPlatformAdmin,
    },
    {
      label: 'Audit Trail',
      href: '/owner/audit',
      icon: FileText,
      visible:
        userCapabilities.includes('audit.read') ||
        canAccessMasterOwner ||
        isPlatformAdmin,
    },
    {
      label: 'Profile Settings',
      href: '/owner/settings',
      icon: Settings,
      visible: true,
    },
  ];

  return (
    <aside
      className={`relative w-full ${isCollapsed ? 'md:w-20' : 'md:w-64'} bg-white dark:bg-neutral-900 border-r border-neutral-300 dark:border-neutral-800 flex flex-col shrink-0 z-50 transition-all duration-300 ease-in-out`}
    >
      <div className={`flex items-center h-16 ${isCollapsed ? 'justify-center px-2' : 'justify-between px-6'} border-b border-neutral-200 dark:border-neutral-800`}>
        {!isCollapsed && (
          <span className="text-[15px] font-black uppercase tracking-wider text-neutral-900 dark:text-white truncate">
            {roleTitle}
          </span>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`group w-8 h-8 flex items-center justify-center flex-shrink-0 border border-neutral-300 dark:border-neutral-700 bg-transparent transition-all duration-300 hidden md:flex ${
            isCollapsed 
              ? 'mx-auto rounded-full hover:rounded-l-lg hover:rounded-r-full' 
              : 'rounded-full hover:rounded-r-lg hover:rounded-l-full'
          } hover:border-[#1DB954] dark:hover:border-[#1DB954] hover:shadow-[0_0_15px_-3px_rgba(29,185,84,0.4)] hover:bg-transparent`}
        >
          <ChevronLeft 
            className={`w-4 h-4 text-neutral-500 dark:text-neutral-400 group-hover:text-[#1DB954] dark:group-hover:text-[#1DB954] transition-transform duration-300 ${isCollapsed ? 'rotate-180' : 'rotate-0'}`} 
          />
        </button>
      </div>

      <nav className="p-3 space-y-1 flex-1 overflow-y-auto overflow-x-hidden">
        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                title={isCollapsed ? item.label : undefined}
                className={`relative overflow-hidden flex items-center transition-all group border ${
                  isCollapsed ? 'w-11 h-11 mx-auto justify-center rounded-xl p-0' : 'w-full gap-3 px-3 py-2.5 rounded-xl'
                } text-base font-normal ${isActive
                    ? 'bg-neutral-100 text-neutral-900 dark:text-primary border-neutral-300 shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-neutral-900 dark:bg-black dark:border-primary/20 dark:before:bg-primary'
                    : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/50 border-transparent hover:border-neutral-200 dark:text-neutral-400 dark:hover:text-primary dark:hover:bg-black dark:hover:border-primary/20 dark:hover:shadow-lg dark:hover:shadow-primary/10'
                  }`}
              >
                <Icon
                  className={`w-5 h-5 flex-shrink-0 transition-colors ${isActive ? 'text-neutral-900 dark:text-primary' : 'text-neutral-400 group-hover:text-neutral-900 dark:text-neutral-500 dark:group-hover:text-primary'
                    }`}
                />
                {!isCollapsed && (
                  <span className="flex-1 truncate transition-opacity duration-300">{item.label}</span>
                )}
              </Link>
            );
          })}
      </nav>
    </aside>
  );
}
