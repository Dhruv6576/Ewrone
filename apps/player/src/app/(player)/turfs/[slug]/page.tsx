import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@boxcodex/shared';
import TurfDetailView, { SportItem } from '@/components/TurfDetailView';
import { formatINR, resolveImageUrl } from '@/lib/utils';

interface Props {
  params: Promise<{ slug: string }>;
}

export const revalidate = 60;

export default async function TurfDetailPage({ params }: Props) {
  const { slug } = await params;

  // Legacy slug redirect
  if (slug === 'live-rzp-turf-1789761873594') {
    redirect('/turfs/the-dugout-indiranagar');
  }

  const supabase = createServerClient('player', { getAll: () => [] });

  // 1. Query turf details with photos, settings, resources, pricing rules, and operating hours in a single roundtrip
  const { data: turf, error: turfErr } = await supabase
    .from('turfs')
    .select(`
      id, name, slug, city, address_text, description, timezone, approval_status,
      turf_photos (id, storage_path, sort_order, published),
      turf_booking_settings (advance_fixed_per_slot_minor, advance_basis_points),
      resources (
        id, name, booking_increment_minutes, minimum_duration_minutes, active,
        pricing_rules (resource_id, amount_per_increment_minor, active),
        operating_hours (opens_at, closes_at)
      )
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

  if (resources.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="glass-panel p-8 rounded-2xl border border-slate-800 bg-[#0c1017]">
          <h2 className="text-xl font-bold text-white">No active courts available</h2>
          <p className="text-sm text-slate-400 mt-2">
            This venue has no bookable resources published at the moment.
          </p>
          <Link href="/explore" className="inline-block mt-4 text-xs font-semibold text-[#00df81] hover:underline">
            ← Browse other turfs
          </Link>
        </div>
      </div>
    );
  }

  // 3. Extract pricing rules and operating hours directly from nested resource payload (zero extra roundtrips)
  const allPricingRules = resources.flatMap((r) => r.pricing_rules || [])
    .filter((rule: any) => rule.active && rule.amount_per_increment_minor)
    .sort((a: any, b: any) => Number(a.amount_per_increment_minor) - Number(b.amount_per_increment_minor));

  const allHours = resources.flatMap((r) => r.operating_hours || []);

  let openingHoursText = 'Open 24/7';
  if (allHours.length > 0) {
    const firstHours = allHours[0];
    const opens = firstHours.opens_at ? firstHours.opens_at.slice(0, 5) : '06:00';
    const closes = firstHours.closes_at ? firstHours.closes_at.slice(0, 5) : '23:00';
    if (opens === '00:00' && (closes === '23:59' || closes === '24:00' || closes === '00:00')) {
      openingHoursText = 'Open 24/7';
    } else {
      openingHoursText = `${opens} - ${closes}`;
    }
  }

  // Calculate base price & advance
  let basePriceFormatted = '₹1,500.00';
  let advanceText: string | undefined = undefined;

  if (allPricingRules.length > 0 && allPricingRules[0].amount_per_increment_minor) {
    const firstRule = allPricingRules[0];
    const firstRes = resources.find((r) => r.id === firstRule.resource_id);
    const incMins = firstRes?.booking_increment_minutes || 60;
    const multiplier = incMins === 30 ? 2 : 1;
    const hourlyMinor = Number(firstRule.amount_per_increment_minor) * multiplier;
    basePriceFormatted = formatINR(hourlyMinor);

    const rawSettings = Array.isArray(turf.turf_booking_settings)
      ? turf.turf_booking_settings[0]
      : turf.turf_booking_settings;

    if (rawSettings) {
      if (rawSettings.advance_fixed_per_slot_minor != null && Number(rawSettings.advance_fixed_per_slot_minor) > 0) {
        const fixedSlot = Number(rawSettings.advance_fixed_per_slot_minor);
        const hourlyAdvance = fixedSlot * multiplier;
        advanceText = `Advance: ${formatINR(hourlyAdvance)}/hr`;
      } else if (rawSettings.advance_basis_points != null && Number(rawSettings.advance_basis_points) < 10000) {
        const advMinor = Math.round((hourlyMinor * Number(rawSettings.advance_basis_points)) / 10000);
        advanceText = `Advance: ${formatINR(advMinor)}/hr`;
      } else {
        advanceText = `Full Online: ${formatINR(hourlyMinor)}/hr`;
      }
    }
  }

  // Construct sports list
  const sports: SportItem[] = [
    {
      id: 'box_cricket',
      name: 'Box Cricket',
      courtCount: resources.length,
      formattedPrice: basePriceFormatted,
      advanceText,
      resourceId: resources[0]?.id,
    },
  ];

  // Resolve owner photo
  let primaryImageUrl: string | undefined = undefined;
  if (turf.turf_photos && Array.isArray(turf.turf_photos) && turf.turf_photos.length > 0) {
    const publishedPhotos = turf.turf_photos
      .filter((p: any) => p.published !== false && p.storage_path)
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    if (publishedPhotos.length > 0) {
      primaryImageUrl = resolveImageUrl(publishedPhotos[0].storage_path) || undefined;
    }
  }

  // Amenities
  const amenities = ['Floodlights', 'Parking', 'Seating', 'Drinking Water', 'Washroom'];

  return (
    <TurfDetailView
      turf={turf}
      sports={sports}
      amenities={amenities}
      openingHoursText={openingHoursText}
      imageUrl={primaryImageUrl || '/images/night-cricket-ground.jpg'}
      advanceText={advanceText}
    />
  );
}
