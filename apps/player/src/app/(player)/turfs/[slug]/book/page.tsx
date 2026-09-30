import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@boxcodex/shared';
import SlotPicker from '@/components/SlotPicker';
import { ChevronLeft, MapPin, ShieldCheck, Clock, Calendar, Sparkles } from 'lucide-react';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ resource?: string }>;
}

export const revalidate = 60;

export default async function TurfSlotBookingPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { resource: initialResourceId } = await searchParams;

  if (slug === 'live-rzp-turf-1789761873594') {
    redirect('/turfs/the-dugout-indiranagar/book');
  }

  const supabase = createServerClient('player', { getAll: () => [] });

  // 1. Query turf details and active bookable resources in a single roundtrip
  const { data: turf, error: turfErr } = await supabase
    .from('turfs')
    .select(`
      id, name, slug, city, address_text, description, timezone, approval_status,
      resources (id, name, booking_increment_minutes, minimum_duration_minutes, active)
    `)
    .eq('slug', slug)
    .single();

  if (turfErr || !turf || turf.approval_status !== 'approved') {
    notFound();
  }

  // 2. Extract active bookable resources
  const resources = ((turf.resources as any[]) || [])
    .filter((r) => r.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!resources || resources.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="glass-panel p-8 rounded-2xl border border-slate-800 bg-slate-900/60">
          <h2 className="text-xl font-bold text-white">No active courts available</h2>
          <p className="text-sm text-slate-400 mt-2">
            This venue has no bookable resources published at the moment.
          </p>
          <Link href={`/turfs/${turf.slug}`} className="inline-block mt-4 text-xs font-semibold text-lime-400 hover:underline">
            ← Back to Venue Overview
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-colors duration-200 text-slate-900 dark:text-white">
      {/* Back to Turf Detail Link */}
      <Link
        href={`/turfs/${turf.slug}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#00df81] dark:text-slate-400 dark:hover:text-[#00df81] transition-colors mb-6 group cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to Venue Details
      </Link>

      {/* Booking Header Banner */}
      <div className="rounded-3xl p-6 sm:p-7 mb-8 border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0c1017] relative overflow-hidden shadow-xl shadow-slate-200/50 dark:shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#00df81]/10 text-[#00df81] border border-[#00df81]/30 flex items-center gap-1.5 shadow-xs">
                <ShieldCheck className="w-3.5 h-3.5 text-[#00df81]" />
                Verified Arena
              </span>
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#00df81]" />
                {turf.city}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Book Slot &bull; {turf.name}
            </h1>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-xl">
              {turf.address_text || `${turf.name}, ${turf.city}`}
            </p>
          </div>

          <div className="shrink-0 flex sm:flex-col items-center sm:items-end justify-between gap-2 border-t sm:border-t-0 border-slate-200 dark:border-slate-800 pt-3 sm:pt-0">
            <span className="text-xs text-slate-500 dark:text-slate-400">Available Courts</span>
            <span className="text-sm font-bold text-[#00df81] bg-[#00df81]/10 border border-[#00df81]/30 px-3 py-1 rounded-xl shadow-xs">
              {resources.length} {resources.length === 1 ? 'Pitch' : 'Pitches'} Active
            </span>
          </div>
        </div>
      </div>

      {/* Dedicated Slot Picker Panel */}
      <div className="rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800/90 bg-white dark:bg-[#0c1017] shadow-xl shadow-slate-200/50 dark:shadow-2xl">
        <div className="flex items-center justify-between pb-6 mb-6 border-b border-slate-200/80 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#00df81]/10 border border-[#00df81]/30 flex items-center justify-center text-[#00df81]">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Select Court & Time Slot</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Choose date, court and lock your slot with instant confirmation</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-[11px] font-semibold text-[#00df81] bg-[#00df81]/10 border border-[#00df81]/30 px-3 py-1.5 rounded-full">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Instant Hold Guarantee</span>
          </div>
        </div>

        <SlotPicker turf={turf} resources={resources} initialResourceId={initialResourceId} />
      </div>
    </div>
  );
}
