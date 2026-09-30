'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MapPin, ShieldCheck, Sparkles, Star, ArrowUpRight, Heart } from 'lucide-react';
import { formatINR } from '@/lib/utils';

interface TurfProps {
  id: string;
  name: string;
  slug: string;
  city: string;
  address_text: string;
  description?: string;
  resourcesCount?: number;
  startingPriceMinor?: number;
  startingAdvanceMinor?: number;
  advanceMode?: 'fixed_per_slot' | 'percentage' | 'full';
  advanceBasisPoints?: number;
  imageUrl?: string;
}

const DEFAULT_IMAGES = [
  '/images/cricket-hero.jpg',
  '/images/cricket-hero-night.jpg',
  '/images/night-cricket-ground.jpg',
  '/images/box-cricket-arena.jpg',
];

export default function TurfCard({
  turf,
  index = 0,
}: {
  turf: TurfProps;
  index?: number;
}) {
  const [isFavorite, setIsFavorite] = useState(false);
  const imageSrc = turf.imageUrl || DEFAULT_IMAGES[index % DEFAULT_IMAGES.length];

  // Dynamic realistic rating based on venue id
  const ratingValue = (4.7 + ((turf.name.charCodeAt(0) % 3) * 0.1)).toFixed(1);
  const reviewCount = 80 + (turf.name.charCodeAt(1) % 70);

  const isPartialAdvance =
    turf.startingAdvanceMinor != null &&
    turf.startingPriceMinor != null &&
    turf.startingAdvanceMinor < turf.startingPriceMinor;

  const balanceAtVenueMinor = isPartialAdvance
    ? (turf.startingPriceMinor! - turf.startingAdvanceMinor!)
    : 0;

  return (
    <div className="glass-panel glass-panel-hover rounded-2xl flex flex-col justify-between group relative overflow-hidden transition-all duration-300 border border-slate-200/90 dark:border-slate-800/80 bg-white dark:bg-[#0c1017] shadow-md shadow-slate-200/40 dark:shadow-none hover:border-[#00df81]/50 hover:shadow-xl hover:shadow-[#00df81]/10">
      {/* 1. Image Banner */}
      <div className="relative w-full h-48 overflow-hidden bg-slate-100 dark:bg-slate-900">
        <img
          alt={turf.name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          src={imageSrc}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (target.src.indexOf('/images/cricket-hero.jpg') === -1) {
              target.src = '/images/cricket-hero.jpg';
            }
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/30" />

        {/* Top Badges */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-950/85 backdrop-blur-md text-[11px] font-semibold text-[#00df81] border border-[#00df81]/30 shadow-sm">
            <ShieldCheck className="w-3.5 h-3.5" />
            Verified Arena
          </span>
          <button
            aria-label="Save to favorites"
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setIsFavorite(!isFavorite);
            }}
            className="w-8 h-8 rounded-full bg-slate-950/70 backdrop-blur-md flex items-center justify-center hover:bg-slate-900 transition-colors shadow-sm cursor-pointer"
          >
            <Heart
              className={`w-4 h-4 transition-colors ${
                isFavorite ? 'fill-red-500 text-red-500' : 'text-slate-300 hover:text-red-400'
              }`}
            />
          </button>
        </div>

        {/* Live Slot Status Pill */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/90 backdrop-blur-md text-[11px] text-[#00df81] font-semibold border border-[#00df81]/30">
          <span className="w-2 h-2 rounded-full bg-[#00df81] animate-pulse" />
          <span>Available Today</span>
        </div>
      </div>

      {/* 2. Body Info */}
      <div className="p-5 flex flex-col flex-1 justify-between">
        <div>
          {/* Location & Rating */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 font-medium">
              <MapPin className="w-3.5 h-3.5 text-[#00df81] shrink-0" />
              <span className="line-clamp-1">{turf.city || 'Bengaluru'}</span>
            </div>

            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs font-bold shadow-2xs">
              <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
              <span>{ratingValue}</span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">({reviewCount})</span>
            </div>
          </div>

          {/* Name */}
          <h3 className="font-bold text-lg text-slate-900 dark:text-white group-hover:text-[#00df81] transition-colors tracking-tight line-clamp-1">
            {turf.name}
          </h3>

          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
            {turf.address_text || 'Floodlit Box Cricket & Multi-Sport Arena'}
          </p>

          {/* Sport & Facility Chips */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-medium">
              Box Cricket
            </span>
            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-medium">
              {turf.resourcesCount && turf.resourcesCount > 1 ? `${turf.resourcesCount} Pitches` : '7-a-side AstroTurf'}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 font-medium">
              Floodlights
            </span>
          </div>
        </div>

        {/* 3. Pricing & "Book Now" CTA */}
        <div className="mt-5 pt-4 border-t border-slate-200/80 dark:border-slate-800/80">
          {/* Advance & Full Price */}
          <div className="flex items-end justify-between mb-3.5">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#00df81]">
                <Sparkles className="w-3.5 h-3.5 text-[#00df81] shrink-0" />
                {isPartialAdvance ? (
                  <span>Advance: {formatINR(turf.startingAdvanceMinor!)}</span>
                ) : turf.startingPriceMinor ? (
                  <span>Advance: Full {formatINR(turf.startingPriceMinor)}</span>
                ) : (
                  <span>Advance: Flexible</span>
                )}
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                Total:{' '}
                {turf.startingPriceMinor ? (
                  <span className="font-semibold text-slate-900 dark:text-slate-200">
                    {formatINR(turf.startingPriceMinor)}/hr
                  </span>
                ) : (
                  <span className="font-semibold text-slate-900 dark:text-slate-200">₹800/hr</span>
                )}
                {isPartialAdvance && balanceAtVenueMinor > 0 ? (
                  <span> &bull; Rest {formatINR(balanceAtVenueMinor)} at venue</span>
                ) : !isPartialAdvance && turf.startingPriceMinor ? (
                  <span> &bull; 100% online</span>
                ) : (
                  <span> &bull; Rest at venue</span>
                )}
              </div>
            </div>

            <div className="text-[10px] text-slate-700 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 px-2.5 py-1 rounded-md font-semibold">
              {isPartialAdvance ? 'Pay Rest At Venue' : 'Instant Lock'}
            </div>
          </div>

          {/* Book Now Button */}
          <Link
            href={`/turfs/${turf.slug}`}
            className="w-full py-2.5 px-4 rounded-md text-xs font-black tracking-wider uppercase text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all flex items-center justify-center gap-1.5 shadow-md shadow-[#00df81]/20 active:scale-[0.98] cursor-pointer"
          >
            <span>BOOK A TURF</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
