import { Suspense } from 'react';
import { createServerClient } from '@boxcodex/shared';
import ExploreCatalog from '@/components/ExploreCatalog';
import { Sparkles, ShieldCheck } from 'lucide-react';
import { resolveImageUrl } from '@/lib/utils';

export const revalidate = 60;

export const metadata = {
  title: 'Explore Cricket Turfs & Arenas | EWRONE',
  description: 'Discover verified floodlit box cricket arenas in Bengaluru. Filter by area, price, distance, and ratings. Instant real-time slot lock with owner advance pricing.',
};

export default async function ExplorePage() {
  const supabase = createServerClient('player', { getAll: () => [] });

  // Query approved turfs with resources, active pricing rules, booking settings, and uploaded photos
  const { data: rawTurfs, error } = await supabase
    .from('turfs')
    .select(`
      id, name, slug, city, address_text, description, timezone,
      resources (
        id, name, booking_increment_minutes,
        pricing_rules (amount_per_increment_minor, active)
      ),
      turf_booking_settings (
        advance_fixed_per_slot_minor,
        advance_basis_points
      ),
      turf_photos (
        id, storage_path, sort_order, published
      )
    `)
    .eq('approval_status', 'approved')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  // Calculate live dynamic minimum hourly price, advance price, and resolve owner photos per turf
  const turfs = (rawTurfs || []).map((t: any) => {
    let minHourlyMinor: number | undefined = undefined;
    let minIncrementMinutes = 60;

    for (const res of t.resources || []) {
      const incMinutes = res.booking_increment_minutes || 60;
      const multiplier = 60 / incMinutes;
      for (const rule of res.pricing_rules || []) {
        if (rule.active && rule.amount_per_increment_minor) {
          const hourlyMinor = Number(rule.amount_per_increment_minor) * multiplier;
          if (minHourlyMinor === undefined || hourlyMinor < minHourlyMinor) {
            minHourlyMinor = hourlyMinor;
            minIncrementMinutes = incMinutes;
          }
        }
      }
    }

    // Owner advance configuration
    const rawSettings = Array.isArray(t.turf_booking_settings)
      ? t.turf_booking_settings[0]
      : t.turf_booking_settings;

    let advanceMode: 'fixed_per_slot' | 'percentage' | 'full' = 'full';
    let startingAdvanceMinor: number | undefined = undefined;
    let advanceBasisPoints: number = 10000;

    if (rawSettings) {
      if (rawSettings.advance_fixed_per_slot_minor != null && Number(rawSettings.advance_fixed_per_slot_minor) > 0) {
        advanceMode = 'fixed_per_slot';
        const fixedPerSlot = Number(rawSettings.advance_fixed_per_slot_minor);
        const slotsPerHour = Math.max(1, Math.round(60 / minIncrementMinutes));
        const calculatedHourlyAdvance = fixedPerSlot * slotsPerHour;
        startingAdvanceMinor = minHourlyMinor !== undefined
          ? Math.min(calculatedHourlyAdvance, minHourlyMinor)
          : calculatedHourlyAdvance;
      } else if (rawSettings.advance_basis_points != null) {
        advanceBasisPoints = Number(rawSettings.advance_basis_points);
        if (advanceBasisPoints < 10000) {
          advanceMode = 'percentage';
          if (minHourlyMinor !== undefined) {
            startingAdvanceMinor = Math.round((minHourlyMinor * advanceBasisPoints) / 10000);
          }
        } else {
          advanceMode = 'full';
          startingAdvanceMinor = minHourlyMinor;
        }
      }
    } else {
      advanceMode = 'full';
      startingAdvanceMinor = minHourlyMinor;
    }

    // Owner-uploaded box photo from database
    let primaryImageUrl: string | undefined = undefined;
    if (t.turf_photos && Array.isArray(t.turf_photos) && t.turf_photos.length > 0) {
      const publishedPhotos = t.turf_photos
        .filter((p: any) => p.published !== false && p.storage_path)
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      if (publishedPhotos.length > 0) {
        primaryImageUrl = resolveImageUrl(publishedPhotos[0].storage_path) || undefined;
      }
    }

    return {
      ...t,
      resourcesCount: t.resources?.length || 1,
      startingPriceMinor: minHourlyMinor,
      startingAdvanceMinor,
      advanceMode,
      advanceBasisPoints,
      imageUrl: primaryImageUrl,
    };
  });

  return (
    <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#00df81]/10 text-[#00df81] border border-[#00df81]/30 mb-2 shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-[#00df81]" />
            <span>Real-Time Arena Network</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Explore Cricket Arenas
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            Choose your preferred box cricket pitch, lock your slot with owner-configured advance payment, and pay the rest at venue.
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0c1017] border border-slate-200 dark:border-slate-800 px-3.5 py-2 rounded-xl shadow-xs">
            <ShieldCheck className="w-4 h-4 text-[#00df81]" />
            <span>Zero Double-Bookings</span>
          </div>
        </div>
      </div>

      <Suspense fallback={<div className="w-full h-96 glass-panel rounded-3xl animate-pulse" />}>
        <ExploreCatalog initialTurfs={turfs} />
      </Suspense>
    </div>
  );
}
