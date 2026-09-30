import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerClient } from '@boxcodex/shared';
import SlotPicker from '@/components/SlotPicker';
import { MapPin, ShieldCheck, ChevronLeft, Clock, Sparkles, Trophy } from 'lucide-react';

interface Props {
  params: Promise<{ slug: string }>;
}

export const revalidate = 0;

export default async function TurfDetailPage({ params }: Props) {
  const { slug } = await params;

  // Legacy slug redirect
  if (slug === 'live-rzp-turf-1789761873594') {
    redirect('/turfs/the-dugout-indiranagar');
  }

  const cookieStore = await cookies();
  const supabase = createServerClient('player', cookieStore);

  // 1. Query turf details
  const { data: turf, error: turfErr } = await supabase
    .from('turfs')
    .select('id, name, slug, city, address_text, description, timezone, approval_status')
    .eq('slug', slug)
    .single();

  if (turfErr || !turf || turf.approval_status !== 'approved') {
    notFound();
  }

  // 2. Query bookable resources for this turf
  const { data: resources, error: resErr } = await supabase
    .from('resources')
    .select('id, name, booking_increment_minutes, minimum_duration_minutes')
    .eq('turf_id', turf.id)
    .eq('active', true)
    .order('name', { ascending: true });

  if (resErr || !resources || resources.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="glass-panel p-8 rounded-2xl">
          <h2 className="text-xl font-bold text-white">No active courts available</h2>
          <p className="text-sm text-slate-400 mt-2">
            This venue has no bookable resources published at the moment.
          </p>
          <Link href="/" className="inline-block mt-4 text-xs font-semibold text-emerald-400 hover:underline">
            ← Browse other turfs
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-400 transition-colors mb-6 group"
      >
        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to Venues
      </Link>

      {/* Turf Overview Card */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 mb-8 relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Verified Arena
              </span>
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-500" />
                {turf.city}
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              {turf.name}
            </h1>

            <p className="text-sm text-slate-300 mt-2 max-w-2xl">
              {turf.description || 'Premier box cricket and multi-sport turf equipped with high-intensity floodlights, professional turf surface, and dedicated dugouts.'}
            </p>

            <div className="text-xs text-slate-400 mt-3 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{turf.address_text || 'Stadium Road, Prime Sports Enclave'}</span>
            </div>
          </div>

          {/* Quick Info Badges */}
          <div className="flex md:flex-col gap-2 shrink-0">
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center min-w-[120px]">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Active Courts</div>
              <div className="text-base font-bold text-emerald-400 mt-0.5">{resources.length} Pitches</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center min-w-[120px]">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Operating Hours</div>
              <div className="text-xs font-bold text-white mt-0.5">06:00 AM - 11:00 PM</div>
            </div>
          </div>
        </div>

        {/* Amenity Pills */}
        <div className="flex flex-wrap gap-2 mt-6 pt-5 border-t border-slate-800/80">
          <span className="px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-300">
            🏏 Box Cricket Pitch
          </span>
          <span className="px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-300">
            💡 Stadium Floodlights
          </span>
          <span className="px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-300">
            🚗 Player Parking
          </span>
          <span className="px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-300">
            🚿 Changing Rooms
          </span>
        </div>
      </div>

      {/* Interactive Slot Picker Section */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8">
        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          <Clock className="w-5 h-5 text-emerald-400" />
          Choose Court & Time Slot
        </h2>

        <SlotPicker turf={turf} resources={resources} />
      </div>
    </div>
  );
}
