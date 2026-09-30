'use client';

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
} from 'lucide-react';

interface OwnerSidebarNavProps {
  userCapabilities: string[];
  canAccessMasterOwner: boolean;
  isPlatformAdmin: boolean;
}

export default function OwnerSidebarNav({
  userCapabilities,
  canAccessMasterOwner,
  isPlatformAdmin,
}: OwnerSidebarNavProps) {
  const pathname = usePathname();

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
    <nav className="p-3 space-y-1 flex-1">
      {navItems
        .filter((item) => item.visible)
        .map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative overflow-hidden flex items-center gap-3 px-3 py-2.5 rounded-xl text-base font-normal transition-all group border ${isActive
                  ? 'bg-neutral-100 text-neutral-900 dark:text-primary border-neutral-300 shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-neutral-900 dark:bg-black dark:border-primary/20 dark:before:bg-primary'
                  : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/50 border-transparent hover:border-neutral-200 dark:text-neutral-400 dark:hover:text-primary dark:hover:bg-black dark:hover:border-primary/20 dark:hover:shadow-lg dark:hover:shadow-primary/10'
                }`}
            >
              <Icon
                className={`w-4 h-4 transition-colors ${isActive ? 'text-neutral-900 dark:text-primary' : 'text-neutral-400 group-hover:text-neutral-900 dark:text-neutral-500 dark:group-hover:text-primary'
                  }`}
              />
              <span className="flex-1">{item.label}</span>
            </Link>
          );
        })}
    </nav>
  );
}
