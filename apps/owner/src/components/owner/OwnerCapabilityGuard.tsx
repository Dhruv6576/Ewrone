import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers, cookies } from 'next/headers';
import { createServerClient } from '@boxcodex/shared';
import { ShieldAlert } from 'lucide-react';

interface OwnerCapabilityGuardProps {
  children: React.ReactNode;
  owner?: boolean;
  anyCapability?: string[];
}

export async function OwnerCapabilityGuard({
  children,
  owner,
  anyCapability,
}: OwnerCapabilityGuardProps) {
  const cookieStore = await cookies();
  const supabase = createServerClient('owner', cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const headerList = await headers();
    const pathname = headerList.get('x-pathname') || '/dashboard';
    redirect(`/login?redirect=${encodeURIComponent(pathname)}`);
  }

  const { data: caps, error: capsErr } = await supabase.rpc('get_my_capabilities');

  if (capsErr || !caps) {
    return renderCapabilityDenied({
      email: user.email,
      requirement: owner ? 'requires owner access' : anyCapability ? `requires one of: ${anyCapability.join(', ')}` : 'requires active capabilities',
      capabilities: [],
    });
  }

  const isOwner = caps.is_owner || caps.is_admin;
  const userCapabilities: string[] = caps.capabilities || [];

  // If owner is required, only owners or platform admins pass
  if (owner && !isOwner) {
    return renderCapabilityDenied({
      email: user.email,
      requirement: 'requires owner access',
      capabilities: userCapabilities,
    });
  }

  // If anyCapability is specified, caller must be owner/admin OR have at least one matching capability
  if (anyCapability && anyCapability.length > 0) {
    const hasCap = isOwner || anyCapability.some((c) => userCapabilities.includes(c));
    if (!hasCap) {
      return renderCapabilityDenied({
        email: user.email,
        requirement: `requires one of: ${anyCapability.join(', ')}`,
        capabilities: userCapabilities,
      });
    }
  }

  return <>{children}</>;
}

function renderCapabilityDenied({
  email,
  requirement,
  capabilities,
}: {
  email?: string;
  requirement: string;
  capabilities: string[];
}) {
  return (
    <div className="min-h-[80vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full glass-panel rounded-2xl p-8 border border-amber-500/20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-5 text-amber-400">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Access Restricted</h2>
        <p className="text-sm text-slate-300 mb-5 leading-relaxed">
          Your account ({email || 'unknown'}) lacks permission for this area.
        </p>

        <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-left text-xs space-y-2.5 mb-6">
          <div className="flex items-start justify-between gap-2">
            <span className="text-slate-400 font-medium shrink-0">Unmet requirement:</span>
            <span className="text-amber-400 font-semibold text-right">{requirement}</span>
          </div>
          <div className="pt-2 border-t border-slate-800/80">
            <span className="text-slate-400 font-medium block mb-1">Your capabilities:</span>
            <span className="text-slate-200 font-mono text-[11px] break-all bg-slate-900 px-2 py-1 rounded-lg block">
              {capabilities.length > 0 ? capabilities.join(', ') : 'none'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard"
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            Return to Dashboard
          </Link>
          <a
            href={process.env.NEXT_PUBLIC_PLAYER_URL || 'http://localhost:3000'}
            className="w-full py-2 px-4 rounded-xl text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors text-center"
          >
            Return to Player Portal (Port 3000)
          </a>
        </div>
      </div>
    </div>
  );
}
