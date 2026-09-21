import { cookies } from 'next/headers';
import { createServerClient } from '@boxcodex/shared';
import TurfCard from '@/components/TurfCard';
import { Trophy, Search, ShieldCheck, Zap, Sparkles, MapPin } from 'lucide-react';

export const revalidate = 0; // Fresh availability on reload

export default async function HomePage() {
  const cookieStore = await cookies();
  const supabase = createServerClient('player', cookieStore);

  // Query approved turfs with resources and active pricing rules from database
  const { data: rawTurfs, error } = await supabase
    .from('turfs')
    .select(`
      id, name, slug, city, address_text, description, timezone,
      resources (
        id, name, booking_increment_minutes,
        pricing_rules (amount_per_increment_minor, active)
      )
    `)
    .eq('approval_status', 'approved')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  // Calculate live dynamic minimum hourly price per turf
  const turfs = (rawTurfs || []).map((t: any) => {
    let minHourlyMinor: number | undefined = undefined;
    for (const res of t.resources || []) {
      const incMinutes = res.booking_increment_minutes || 60;
      const multiplier = 60 / incMinutes;
      for (const rule of res.pricing_rules || []) {
        if (rule.active && rule.amount_per_increment_minor) {
          const hourlyMinor = Number(rule.amount_per_increment_minor) * multiplier;
          if (minHourlyMinor === undefined || hourlyMinor < minHourlyMinor) {
            minHourlyMinor = hourlyMinor;
          }
        }
      }
    }
    return {
      ...t,
      resourcesCount: t.resources?.length || 1,
      startingPriceMinor: minHourlyMinor,
    };
  });

  return (
    <div className="flex-1 pb-16">
      {/* Hero Header */}
      <section className="relative pt-12 pb-14 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto overflow-hidden">
        {/* Ambient Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-gradient-to-r from-emerald-500/10 to-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="text-center relative z-10 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs font-semibold mb-5 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Zero Double-Booking Guarantee with Database Exclusion Locks</span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Premier Turf Arenas & Box Cricket{' '}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500 bg-clip-text text-transparent">
              Booked in Real-Time
            </span>
          </h1>

          <p className="mt-4 text-base sm:text-lg text-slate-300">
            Check live court availability, hold your game time with an active countdown, and confirm your booking instantly via Razorpay.
          </p>

          {/* Stats Bar */}
          <div className="grid grid-cols-3 gap-4 max-w-xl mx-auto mt-8 pt-6 border-t border-slate-800/80 text-left">
            <div>
              <div className="text-xl sm:text-2xl font-black text-white">{turfs.length}</div>
              <div className="text-xs text-slate-400 font-medium">Approved Venues</div>
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-black text-emerald-400">100%</div>
              <div className="text-xs text-slate-400 font-medium">Instant Lock</div>
            </div>
            <div>
              <div className="text-xl sm:text-2xl font-black text-blue-400">₹0</div>
              <div className="text-xs text-slate-400 font-medium">Hidden Fees</div>
            </div>
          </div>
        </div>
      </section>

      {/* Turf Catalog Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <Trophy className="w-6 h-6 text-emerald-400" />
              Available Turf Arenas
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Select a venue to view resource courts, operating hours, and live time slots
            </p>
          </div>

          {/* City Quick Filter Badges */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500 text-slate-950 shadow-sm">
              All Cities ({turfs?.length || 0})
            </span>
            <span className="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700 transition-colors cursor-pointer">
              Bengaluru
            </span>
            <span className="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700 transition-colors cursor-pointer">
              Ahmedabad
            </span>
          </div>
        </div>

        {/* Turf Grid */}
        {error ? (
          <div className="p-8 rounded-2xl bg-red-950/40 border border-red-500/30 text-center text-red-300 text-sm">
            Failed to load venues: {error.message}
          </div>
        ) : !turfs || turfs.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <Trophy className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <div className="text-lg font-bold text-white">No active venues found</div>
            <p className="text-sm text-slate-400 mt-1">
              New turf listings are currently undergoing review.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {turfs.map((turf) => (
              <TurfCard key={turf.id} turf={turf} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
