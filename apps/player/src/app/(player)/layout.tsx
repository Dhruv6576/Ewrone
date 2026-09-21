import { cookies } from 'next/headers';
import { createServerClient, getMyContext, resolveUserRole } from '@boxcodex/shared';
import Navbar from '@/components/Navbar';

export default async function PlayerPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const supabase = createServerClient('player', cookieStore);

  // Authoritative server-side identity & context resolution
  const { data: { user } } = await supabase.auth.getUser();
  const { data: context } = await getMyContext(supabase);
  const role = resolveUserRole(context);

  // Permissive gate per approved specification:
  // - Anonymous visitors allowed (canAccessPlayer is true)
  // - ANY authenticated user admitted (player, staff, master owner, admin)
  // - Context resolved on server as explicit policy enforcement seam
  if (!role.canAccessPlayer) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
