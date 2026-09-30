'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createBrowserClient, getMyContext } from '@boxcodex/shared';
import { ShieldCheck, Trophy, Calendar, User, LogOut, ChevronRight } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';

export default function Navbar() {
  const [user, setUser] = useState<any>(null);
  const [context, setContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createBrowserClient('player');

  useEffect(() => {
    async function loadUser() {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);

      if (session?.user) {
        // Query authoritative caller context from get_my_context RPC
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

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-emerald-500/20 group-hover:scale-105 transition-transform">
            <Trophy className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <div className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              BOX CODEX
            </div>
            <div className="text-[10px] tracking-widest text-emerald-400 font-semibold uppercase -mt-1">
              Player Arena Network
            </div>
          </div>
        </Link>

        {/* Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          <Link href="/" className="hover:text-emerald-400 transition-colors">
            Explore Turfs
          </Link>
          <Link href="/my-bookings" className="hover:text-emerald-400 transition-colors flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-emerald-400" />
            My Bookings
          </Link>
          
          {/* Out-of-portal navigation links if caller has elevated roles */}
          {Boolean(context?.master_owner_accounts?.length || context?.employee_memberships?.length) && (
            <a
              href={(process.env.NEXT_PUBLIC_OWNER_URL || 'http://localhost:3001') + '/dashboard'}
              className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-900/60 transition-colors flex items-center gap-1"
            >
              Business Console
              <ChevronRight className="w-3 h-3" />
            </a>
          )}

          {context?.is_platform_admin && (
            <a
              href={(process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3003') + '/admin/turfs'}
              className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-950/60 text-blue-300 border border-blue-500/30 hover:bg-blue-900/60 transition-colors flex items-center gap-1"
            >
              <ShieldCheck className="w-3 h-3 text-blue-400" />
              Admin
            </a>
          )}
        </nav>

        {/* Auth CTA */}
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="w-20 h-8 rounded-lg bg-slate-800/60 animate-pulse" />
          ) : user ? (
            <div className="flex items-center gap-3">
              <NotificationBell />
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-semibold text-slate-200">
                  {context?.profile?.display_name || user.email?.split('@')[0] || 'Player'}
                </span>
                <span className="text-[10px] text-emerald-400 font-mono">Verified Player</span>
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out of local player session"
                className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-red-400 hover:border-red-900/50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-950 bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-300 hover:to-emerald-400 transition-all shadow-md shadow-emerald-500/20 flex items-center gap-1.5 active:scale-95"
            >
              <User className="w-3.5 h-3.5" />
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
