'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserClient, extractDatabaseError, resolveUserRole } from '@boxcodex/shared';
import { Building2, Lock, Mail, ArrowRight, AlertCircle, AlertTriangle, ExternalLink, ShieldCheck } from 'lucide-react';

function OwnerLoginForm() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');
  const redirectParam = searchParams.get('redirect');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If redirected due to forbidden access, ensure local session is purged from storage
    if (reason === 'forbidden') {
      const supabase = createBrowserClient('owner');
      supabase.auth.signOut({ scope: 'local' }).catch(console.error);
    }
  }, [reason]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createBrowserClient('owner');
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) throw signInError;

      // Authoritative role resolution for role-aware landing
      const { data: context, error: ctxErr } = await supabase.rpc('get_my_context');
      if (ctxErr) throw ctxErr;

      const role = resolveUserRole(context);

      // Unaffiliated check: Purge session if neither Master Owner nor Staff
      if (!role.canAccessMasterOwner && !role.canAccessStaffOwner && !role.isPlatformAdmin) {
        await supabase.auth.signOut({ scope: 'local' });
        setError('Access Refused: This account does not possess Master Owner or active Staff privileges.');
        setLoading(false);
        return;
      }

      // Check ?redirect= if within user's allowed permission group
      if (redirectParam) {
        if (redirectParam.startsWith('/master') && (role.canAccessMasterOwner || role.isPlatformAdmin)) {
          window.location.href = redirectParam;
          return;
        }
        if (
          redirectParam.startsWith('/owner') &&
          (role.canAccessStaffOwner || role.canAccessMasterOwner || role.isPlatformAdmin)
        ) {
          window.location.href = redirectParam;
          return;
        }
        if (redirectParam.startsWith('/invite')) {
          window.location.href = redirectParam;
          return;
        }
        if (redirectParam === '/dashboard') {
          window.location.href =
            role.canAccessMasterOwner || role.isPlatformAdmin ? '/master/dashboard' : '/owner/dashboard';
          return;
        }
      }

      // Default Role-Aware Landing
      if (role.canAccessMasterOwner || role.isPlatformAdmin) {
        window.location.href = '/master/dashboard';
      } else {
        window.location.href = '/owner/dashboard';
      }
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Authentication failed'));
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md w-full glass-panel rounded-2xl p-8 border border-emerald-500/20 shadow-2xl bg-slate-950/80">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/40">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Business Console</h1>
          <p className="text-xs text-emerald-400 font-medium tracking-wide uppercase">
            Master Owner & Arena Operations
          </p>
        </div>
      </div>

      {reason === 'forbidden' && (
        <div className="mb-5 p-3.5 rounded-xl bg-amber-950/50 border border-amber-500/40 text-xs text-amber-200">
          <div className="font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            Access Refused
          </div>
          Your account lacks authorized business privileges. Any active session was cleared. Please sign in with an authorized Master Owner or active Staff account.
        </div>
      )}

      {error && (
        <div className="mb-5 p-3.5 rounded-xl bg-red-950/50 border border-red-500/30 flex items-start gap-2.5 text-xs text-red-300">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Business Email
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@arena.internal"
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
          ) : (
            <>
              <span>Sign In to Console</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 pt-5 border-t border-slate-800/80 flex flex-col items-center gap-3">
        <a
          href={process.env.NEXT_PUBLIC_PLAYER_URL || 'http://localhost:3000'}
          className="text-xs text-slate-400 hover:text-emerald-400 transition-colors flex items-center gap-1.5"
        >
          <span>Return to Player Portal (Port 3000)</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

export default function OwnerLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#070a12]">
      <Suspense fallback={<div className="text-xs text-slate-400">Loading console...</div>}>
        <OwnerLoginForm />
      </Suspense>
    </div>
  );
}
