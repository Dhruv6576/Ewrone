'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import { ShieldCheck, AlertCircle, CheckCircle2, ArrowRight, LogIn } from 'lucide-react';

function InviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const supabase = createBrowserClient('owner');

  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function checkAuthAndAccept() {
      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          setAuthenticated(true);
          if (token) {
            setAccepting(true);
            const { error: acceptErr } = await supabase.rpc('accept_employee_invite', {
              p_token: token,
            });

            if (acceptErr) throw acceptErr;

            setSuccess(true);
            setTimeout(() => {
              router.push('/owner/dashboard');
            }, 2000);
          }
        } else {
          setAuthenticated(false);
        }
      } catch (err: unknown) {
        setError(extractDatabaseError(err, 'Failed to accept employee invitation'));
      } finally {
        setLoading(false);
        setAccepting(false);
      }
    }

    checkAuthAndAccept();
  }, [token, router]);

  if (!token) {
    return (
      <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-neutral-100">Invalid Invitation Link</h2>
        <p className="text-xs text-neutral-400">
          This invitation link is missing a valid token. Please check your invitation email or contact your venue administrator.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-semibold transition"
        >
          Return to Login
        </Link>
      </div>
    );
  }

  if (loading || accepting) {
    return (
      <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-neutral-900 dark:bg-white/10 border border-neutral-900 dark:border-white/20 flex items-center justify-center text-neutral-200 mx-auto animate-pulse">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-neutral-100">Processing Invitation</h2>
        <p className="text-xs text-neutral-400">
          {accepting ? 'Claiming your staff access credentials...' : 'Verifying invitation token...'}
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-neutral-900 dark:bg-white/10 border border-neutral-900 dark:border-white/20 flex items-center justify-center text-neutral-200 mx-auto">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-neutral-100">Invitation Accepted!</h2>
        <p className="text-xs text-neutral-400">
          Your staff credentials have been activated. Redirecting you to the operations console...
        </p>
        <Link
          href="/owner/dashboard"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-neutral-600 hover:bg-neutral-900 dark:bg-white text-white rounded-lg text-xs font-semibold transition"
        >
          Go to Operations Console <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-neutral-100">Invitation Error</h2>
        <p className="text-xs text-red-300">{error}</p>
        <div className="pt-2 flex justify-center gap-2">
          <Link
            href="/login"
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-semibold transition"
          >
            Sign In with Another Account
          </Link>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    const loginUrl = `/login?redirect=${encodeURIComponent(`/invite?token=${token}`)}`;
    return (
      <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-neutral-900 dark:bg-white/10 border border-neutral-900 dark:border-white/20 flex items-center justify-center text-neutral-200 mx-auto">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-neutral-100">Staff Invitation Received</h2>
        <p className="text-xs text-neutral-400">
          You have been invited to join Box Codex staff operations. Sign in or create an account to claim your access.
        </p>
        <div className="pt-2">
          <Link
            href={loginUrl}
            className="inline-flex items-center justify-center gap-2 w-full py-2.5 bg-neutral-600 hover:bg-neutral-900 dark:bg-white text-white rounded-lg text-xs font-semibold transition shadow-lg shadow-neutral-950"
          >
            <LogIn className="w-4 h-4" /> Sign In to Accept Invitation
          </Link>
        </div>
      </div>
    );
  }

  return null;
}

export default function InvitePage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
      <Suspense fallback={<div className="text-xs text-neutral-400">Loading invitation...</div>}>
        <InviteContent />
      </Suspense>
    </div>
  );
}
