'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import { Shield, Lock, Mail, ArrowRight, AlertCircle, AlertTriangle, ExternalLink } from 'lucide-react';

function AdminLoginForm() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If redirected due to forbidden access, ensure local session is purged from storage
    if (reason === 'forbidden') {
      const supabase = createBrowserClient('admin');
      supabase.auth.signOut({ scope: 'local' }).catch(console.error);
    }
  }, [reason]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createBrowserClient('admin');
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;

      // Upon login, redirect into the protected admin layout
      window.location.href = '/admin/turfs';
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Authentication failed'));
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md w-full glass-panel rounded-2xl p-8 border border-blue-500/20 shadow-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-lg shadow-blue-950/40">
          <Shield className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Platform Administration</h1>
          <p className="text-xs text-blue-400 font-medium tracking-wide uppercase">Root Operator Portal</p>
        </div>
      </div>

      {reason === 'forbidden' && (
        <div className="mb-5 p-3.5 rounded-xl bg-amber-950/50 border border-amber-500/40 text-xs text-amber-200">
          <div className="font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            Access Refused
          </div>
          Your account lacks platform administration privileges (<code className="text-amber-300 font-mono">private.platform_admins</code>). Any administrative session was cleared. Sign in with a valid root operator account or return to the player portal below.
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
            Admin Email
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@boxcodex.internal"
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Secret Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 cursor-pointer"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <span>Enter Admin Console</span>
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
        <span className="text-[11px] text-slate-600">
          Strict authorization required: <code className="text-slate-500 font-mono">private.platform_admins</code>
        </span>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-950">
      <Suspense fallback={<div className="text-xs text-slate-500">Loading console...</div>}>
        <AdminLoginForm />
      </Suspense>
    </div>
  );
}
