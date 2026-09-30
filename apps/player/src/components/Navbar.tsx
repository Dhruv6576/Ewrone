'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createBrowserClient, getMyContext } from '@boxcodex/shared';
import { ShieldCheck, Trophy, Calendar, User, LogOut, ChevronRight, CheckCircle2, ArrowUpRight } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';
import ThemeToggle from '@/components/ThemeToggle';

export default function Navbar() {
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [context, setContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isScrolled, setIsScrolled] = useState(false);
  const supabase = createBrowserClient('player');

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    async function loadUser() {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);

      if (session?.user) {
        const { data } = await getMyContext(supabase);
        setContext(data);
      }
      setLoading(false);
    }

    loadUser();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user || null);
      if (session?.user) {
        const { data } = await getMyContext(supabase);
        setContext(data);
      } else {
        setContext(null);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    window.location.href = '/';
  };

  const displayName = context?.profile?.display_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'Live Player';
  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'LP';

  const isTransparent = !isScrolled && pathname === '/';

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled
            ? 'border-b border-slate-200 dark:border-white/10 bg-white/95 dark:bg-[#0c0f12]/95 backdrop-blur-xl shadow-md'
            : 'border-b border-transparent bg-transparent shadow-none'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-2.5 sm:gap-3 group">
            <img
              src="/logo.png"
              alt="EWRONE Logo"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-contain drop-shadow-md group-hover:scale-105 transition-transform shrink-0"
            />
            <div>
              <div
                className={`font-black text-lg tracking-wider leading-none uppercase font-display transition-colors ${
                  isTransparent
                    ? 'text-white'
                    : 'text-slate-900 dark:text-white'
                }`}
              >
                EWRONE
              </div>
              <div
                className={`text-[8px] tracking-[0.2em] font-semibold uppercase mt-0.5 font-display transition-colors ${
                  isTransparent
                    ? 'text-slate-300'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                FIND IT. BOOK IT. PLAY IT.
              </div>
            </div>
          </Link>

          {/* Navigation Links: Home, Explore Turfs, How It Works, Why Us, Reviews, My Bookings */}
          <nav className="hidden md:flex items-center gap-7 text-xs font-semibold">
            <Link
              href="/"
              className={`transition-colors ${
                pathname === '/'
                  ? 'text-white font-bold relative pb-1 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#00df81]'
                  : isTransparent
                  ? 'text-slate-200 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Home
            </Link>

            <Link
              href="/explore"
              className={`transition-colors ${
                pathname === '/explore'
                  ? 'text-slate-900 dark:text-white font-bold relative pb-1 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#00df81]'
                  : isTransparent
                  ? 'text-slate-200 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Explore Turfs
            </Link>

            <Link
              href="/#how-it-works"
              className={`transition-colors ${
                isTransparent
                  ? 'text-slate-200 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              How It Works
            </Link>

            <Link
              href="/#why-us"
              className={`transition-colors ${
                isTransparent
                  ? 'text-slate-200 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Why Us
            </Link>

            <Link
              href="/#reviews"
              className={`transition-colors ${
                isTransparent
                  ? 'text-slate-200 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              Reviews
            </Link>

            <Link
              href={user ? "/my-bookings" : "/login?redirect=/my-bookings"}
              className={`transition-colors ${
                pathname === '/my-bookings'
                  ? 'text-slate-900 dark:text-white font-bold relative pb-1 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#00df81]'
                  : isTransparent
                  ? 'text-slate-200 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              My Bookings
            </Link>

            {/* Business Console link if user is owner / staff */}
            {Boolean(context?.master_owner_accounts?.length || context?.employee_memberships?.length) && (
              <a
                href={(process.env.NEXT_PUBLIC_OWNER_URL || 'http://localhost:3001') + '/dashboard'}
                className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-[#00df81] border border-emerald-300 dark:border-emerald-500/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors flex items-center gap-1"
              >
                Business Console
                <ChevronRight className="w-3 h-3" />
              </a>
            )}

            {/* Admin link if user is platform admin */}
            {context?.is_platform_admin && (
              <a
                href={(process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3003') + '/admin/turfs'}
                className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-500/30 hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors flex items-center gap-1"
              >
                <ShieldCheck className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                Admin
              </a>
            )}
          </nav>

          {/* Right Actions: Theme Toggle + Notifications + User Avatar + BOOK A TURF CTA */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Light / Dark Mode Toggle Pill Switch */}
            <ThemeToggle />

            {/* Notification Bell */}
            <NotificationBell />

            {loading ? (
              <div className="w-24 h-8 rounded-md bg-slate-200 dark:bg-slate-800/60 animate-pulse" />
            ) : user ? (
              <div className="flex items-center gap-3">
                {/* User Avatar Badge - clickable to /account */}
                <Link
                  href="/account"
                  title="My Account & Profile"
                  className={`flex items-center gap-2 p-1.5 -m-1.5 rounded-xl transition-all cursor-pointer group ${
                    isTransparent
                      ? 'hover:bg-white/10'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="w-7 h-7 rounded-full bg-white text-slate-950 font-black text-xs flex items-center justify-center shadow-sm group-hover:ring-2 group-hover:ring-[#00df81] transition-all">
                    {initials}
                  </div>
                  <div className="hidden sm:flex flex-col text-left">
                    <span
                      className={`text-xs font-bold leading-tight transition-colors group-hover:text-[#00df81] ${
                        isTransparent
                          ? 'text-white'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {displayName}
                    </span>
                    <span
                      className={`text-[10px] flex items-center gap-1 font-medium transition-colors ${
                        isTransparent
                          ? 'text-slate-300'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <CheckCircle2 className="w-2.5 h-2.5 text-[#00df81]" />
                      Verified Player
                    </span>
                  </div>
                </Link>

                {/* Logout Icon */}
                <button
                  onClick={handleSignOut}
                  title="Sign out"
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    isTransparent
                      ? 'text-slate-300 hover:text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <LogOut className="w-4 h-4" />
                </button>

                {/* BOOK A TURF Button */}
                <Link
                  href="/explore"
                  className="px-4 py-2 rounded-md text-xs font-black uppercase tracking-wider text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all flex items-center gap-1.5 shadow-md shadow-[#00df81]/25 active:scale-95 cursor-pointer"
                >
                  <span>BOOK A TURF</span>
                  <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* Profile / Account Icon for quick access */}
                <Link
                  href="/login?redirect=/account"
                  title="My Account"
                  className={`p-2 rounded-lg transition-colors cursor-pointer flex items-center justify-center ${
                    isTransparent
                      ? 'text-slate-300 hover:text-white hover:bg-white/10'
                      : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <User className="w-4 h-4" />
                </Link>
                <Link
                  href="/login"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    isTransparent
                      ? 'text-white hover:text-[#00df81]'
                      : 'text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  Login
                </Link>
                <Link
                  href="/explore"
                  className="px-4 py-2 rounded-md text-xs font-black uppercase tracking-wider text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all flex items-center gap-1.5 shadow-md shadow-[#00df81]/25 active:scale-95 cursor-pointer"
                >
                  <span>BOOK A TURF</span>
                  <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Spacer for non-home pages so content is not obscured by fixed navbar */}
      {pathname !== '/' && <div className="h-16 shrink-0" aria-hidden="true" />}
    </>
  );
}
