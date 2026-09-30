'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import { Trophy, Mail, Lock, Sparkles, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect') || '/explore';

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const supabase = createBrowserClient('player');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const { error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: displayName || email.split('@')[0],
            },
          },
        });
        if (signUpErr) throw signUpErr;
        setSuccessMsg('Account created successfully! Signing you in...');
      }

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInErr) throw signInErr;

      window.location.href = redirectUrl;
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Authentication failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Password123!');
    setError(null);
    setLoading(true);

    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: demoEmail,
        password: 'Password123!',
      });

      if (signInErr) throw signInErr;

      window.location.href = redirectUrl;
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Demo sign in failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 transition-colors duration-200">
      <div className="w-full max-w-md">
        {/* Card Header */}
        <div className="text-center mb-8">
          <img
            src="/logo.png"
            alt="EWRONE Logo"
            className="w-16 h-16 rounded-2xl shadow-xl shadow-[#00df81]/25 mb-4 object-contain mx-auto"
          />
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            {isSignUp ? 'Create your Player Profile' : 'Sign in to EWRONE'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            Book premier sports turfs, hold slots with live countdown, and pay seamlessly.
          </p>
        </div>

        {/* Auth Card */}
        <div className="rounded-3xl p-6 sm:p-8 relative overflow-hidden bg-white dark:bg-[#0c1017] border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-2xl">
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-5 p-3.5 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 text-[#00df81] text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#00df81] shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Full Name / Nickname
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Virat K."
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 hover:bg-white focus:bg-white dark:bg-[#080b0e] border border-slate-200 dark:border-slate-700/80 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:border-[#00df81] focus:ring-1 focus:ring-[#00df81] transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  placeholder="player@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-50 hover:bg-white focus:bg-white dark:bg-[#080b0e] border border-slate-200 dark:border-slate-700/80 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:border-[#00df81] focus:ring-1 focus:ring-[#00df81] transition-all"
                />
                <Mail className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-3" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-50 hover:bg-white focus:bg-white dark:bg-[#080b0e] border border-slate-200 dark:border-slate-700/80 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:border-[#00df81] focus:ring-1 focus:ring-[#00df81] transition-all"
                />
                <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-3" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-md text-xs font-black uppercase tracking-wider text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all shadow-lg shadow-[#00df81]/25 active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2 mt-2 cursor-pointer"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>{isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Switch Sign in / Sign up */}
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-[#00df81] dark:hover:text-[#00df81] transition-colors cursor-pointer"
            >
              {isSignUp
                ? 'Already have an account? Sign in'
                : "Don't have an account? Create one"}
            </button>
          </div>

          {/* Quick Demo Logins for Instant Testing */}
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              1-Click Demo Accounts
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleDemoLogin('live_player@example.com')}
                className="px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 dark:bg-[#080b0e] dark:hover:bg-[#131d27] dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium text-left transition-all cursor-pointer shadow-xs"
              >
                <div className="font-bold text-[#00df81]">Live Player</div>
                <div className="text-[10px] text-slate-500">Booking customer</div>
              </button>
              <button
                type="button"
                onClick={() => handleDemoLogin('demo_owner@boxcodex.internal')}
                className="px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 dark:bg-[#080b0e] dark:hover:bg-[#131d27] dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium text-left transition-all cursor-pointer shadow-xs"
              >
                <div className="font-semibold text-blue-600 dark:text-blue-400">Turf Owner</div>
                <div className="text-[10px] text-slate-500 truncate">demo_owner@ewrone.internal</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <LoginForm />
    </Suspense>
  );
}
