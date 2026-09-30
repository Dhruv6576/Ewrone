'use client';

import { useState, useEffect } from 'react';
import { User, LogOut, ChevronDown, CalendarDays, Clock } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import NotificationBell from './NotificationBell';
import { createBrowserClient } from '@boxcodex/shared';

interface TopHeaderProps {
  userEmail: string;
  userName?: string;
}

export default function TopHeader({ userEmail, userName }: TopHeaderProps) {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSignOut = async () => {
    const supabase = createBrowserClient('owner');
    await supabase.auth.signOut({ scope: 'local' });
    window.location.href = '/login';
  };

  return (
    <header className="sticky top-0 z-40 h-16 bg-white/70 dark:bg-[#0A0A0A]/70 backdrop-blur-xl border-b border-neutral-200/50 dark:border-neutral-800/50 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
      {/* Left: Live Date & Clock */}
      <div className="flex-1 max-w-md hidden sm:block">
        <div className="flex items-center gap-4 text-sm font-medium">
          {time ? (
            <>
              <div className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
                <CalendarDays className="w-4 h-4 text-primary" />
                <span>
                  {time.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-neutral-300 dark:bg-neutral-700"></div>
              <div className="flex items-center gap-2 text-neutral-900 dark:text-white font-bold tracking-tight">
                <Clock className="w-4 h-4 text-primary" />
                <span className="w-20">
                  {time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </span>
              </div>
            </>
          ) : (
            <div className="animate-pulse flex items-center gap-4">
              <div className="h-5 w-32 bg-neutral-200 dark:bg-neutral-800 rounded"></div>
              <div className="h-5 w-20 bg-neutral-200 dark:bg-neutral-800 rounded"></div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Actions & Profile */}
      <div className="flex items-center gap-2 sm:gap-3 ml-auto">
        <ThemeToggle />
        <NotificationBell />

        {/* Divider */}
        <div className="w-px h-6 bg-neutral-200 dark:bg-neutral-800 mx-1"></div>

        {/* Profile Dropdown */}
        <div
          className="relative"
          onMouseEnter={() => setIsProfileOpen(true)}
          onMouseLeave={() => setIsProfileOpen(false)}
        >
          <button className="flex items-center gap-2 p-1 pl-1.5 pr-3 bg-neutral-50 dark:bg-neutral-900 rounded-full border border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors">
            <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
          </button>

          {/* Hover Menu Menu */}
          <div className={`absolute right-0 mt-2 w-64 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-xl transition-all duration-200 origin-top-right ${isProfileOpen ? 'opacity-100 scale-100 visible' : 'opacity-0 scale-95 invisible'}`}>
            <div className="p-4 border-b border-neutral-100 dark:border-neutral-800">
              <p className="font-bold text-neutral-900 dark:text-white truncate">{userName || 'Venue Owner'}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5">{userEmail}</p>
            </div>
            <div className="p-2">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
