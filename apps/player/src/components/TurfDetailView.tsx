'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Clock,
  Share2,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';

export interface SportItem {
  id: string;
  name: string;
  courtCount: number;
  formattedPrice: string;
  advanceText?: string;
  resourceId?: string;
}

export interface TurfDetailProps {
  turf: {
    id: string;
    name: string;
    slug: string;
    city: string;
    address_text: string;
    description?: string;
    timezone?: string;
    latitude?: number;
    longitude?: number;
  };
  sports: SportItem[];
  amenities: string[];
  openingHoursText?: string;
  imageUrl?: string;
  advanceText?: string;
}

function CricketBatBallIcon({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >


      <path d="M19 3l2 2-2 2-2-2z" />
      <path d="M17 5l-2.5 2.5" />
      <path d="M14.5 7.5l-9 9a3 3 0 0 0 4 4l9-9-4-4z" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M4.5 16.5a2.5 2.5 0 0 1 3 3" strokeWidth="1.2" />
    </svg>
  );
}

export default function TurfDetailView({
  turf,
  sports,
  amenities,
  openingHoursText = 'Open 24/7',
  imageUrl,
  advanceText,
}: TurfDetailProps) {
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const [distanceText] = useState('0 km away');

  const fullAddress = `${turf.address_text ? `${turf.address_text}, ` : ''}${turf.city}`;
  const mapSearchQuery = encodeURIComponent(`${turf.name} ${turf.address_text || ''} ${turf.city}`);
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapSearchQuery}`;

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(`${turf.name}, ${fullAddress}`);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (e) {
      console.error('Failed to copy address:', e);
    }
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: turf.name,
          text: `Check out ${turf.name} in ${turf.city}!`,
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        setCopiedShare(true);
        setTimeout(() => setCopiedShare(false), 2000);
      }
    } catch (e) {
      console.error('Error sharing:', e);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-900 dark:text-white">
      {/* Top Breadcrumb */}
      <Link
        href="/explore"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#00df81] dark:text-slate-400 dark:hover:text-[#00df81] transition-colors mb-6 group cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to Venues
      </Link>

      {/* Main Grid: Left Details & Right Location Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Photo, Title, Badge, About, Sports, Amenities */}
        <div className="lg:col-span-8 flex flex-col">
          {/* 1. Large Turf Photo */}
          <div className="relative w-full aspect-[16/9] max-h-[460px] rounded-3xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 shadow-2xl">
            <img
              src={imageUrl || '/images/night-cricket-ground.jpg'}
              alt={turf.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/images/night-cricket-ground.jpg';
              }}
            />
          </div>

          {/* 2. Venue Title, Share Icon, Opening Hours */}
          <div className="mt-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {turf.name}
              </h1>

              {/* Opening Hours Badge */}
              <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-slate-100 dark:bg-[#0c1017] border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 mt-3 shadow-xs">
                <Clock className="w-4 h-4 text-[#00df81]" />
                <span className="text-slate-500 dark:text-slate-400 font-semibold uppercase text-[11px] tracking-wider">
                  OPENING FROM:
                </span>
                <span className="font-bold text-slate-900 dark:text-white">{openingHoursText}</span>
              </div>
            </div>

            {/* Circular Share Button */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={handleShare}
                aria-label="Share venue"
                className="w-11 h-11 rounded-full bg-white dark:bg-[#0c1017] border border-slate-200 dark:border-[#00df81]/40 flex items-center justify-center text-slate-700 dark:text-[#00df81] hover:bg-slate-100 dark:hover:bg-[#00df81]/10 transition-all shadow-md active:scale-95 cursor-pointer"
                title="Share venue"
              >
                <Share2 className="w-5 h-5" />
              </button>
              {copiedShare && (
                <div className="absolute -bottom-8 right-0 text-[10px] bg-slate-900 text-[#00df81] px-2.5 py-1 rounded-md border border-[#00df81]/30 whitespace-nowrap shadow-xl">
                  Link copied!
                </div>
              )}
            </div>
          </div>

          {/* 3. About Venue */}
          <div className="mt-10">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">About Venue</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-3xl">
              {turf.description || 'Its an open cricket ground and famous for tournament'}
            </p>
          </div>

          {/* 4. Available Sports */}
          <div className="mt-10">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Available Sports</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {sports.map((sport) => (
                <div
                  key={sport.id}
                  className="rounded-2xl bg-white dark:bg-[#0c1017] border border-slate-200 dark:border-slate-800/80 p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-[#00df81]/40 transition-all shadow-md shadow-slate-200/50 dark:shadow-lg group"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-[#080b0e] border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 group-hover:text-[#00df81] transition-colors">
                      <CricketBatBallIcon className="w-7 h-7" />
                    </div>
                    <Link
                      href={`/turfs/${turf.slug}/book${sport.resourceId ? `?resource=${sport.resourceId}` : ''}`}
                      className="px-3.5 py-1 rounded-full bg-[#00df81]/10 border border-[#00df81]/30 text-[#00df81] text-xs font-bold hover:bg-[#00df81]/20 transition-colors flex items-center gap-1 shadow-xs cursor-pointer"
                    >
                      <span>Book</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{sport.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold tracking-wider uppercase mt-1">
                      {sport.courtCount} {sport.courtCount === 1 ? 'COURT' : 'COURTS'}
                    </p>
                  </div>

                  <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="text-[10px] text-slate-500 font-bold tracking-wider uppercase">
                      BASE PRICE
                    </div>
                    <div className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5">
                      {sport.formattedPrice}/hr
                    </div>
                    {sport.advanceText && (
                      <div className="text-xs font-semibold text-[#00df81] mt-1 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-[#00df81]" />
                        <span>{sport.advanceText}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Amenities */}
          <div className="mt-10">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Amenities</h2>
            <div className="flex flex-wrap gap-3">
              {amenities.map((amenity, idx) => (
                <div
                  key={idx}
                  className="px-6 py-2.5 rounded-full bg-white dark:bg-[#0c1017] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-medium hover:border-slate-300 dark:hover:border-[#00df81]/30 transition-colors shadow-xs"
                >
                  {amenity}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Location Card & Book Slot CTA Button */}
        <div className="lg:col-span-4 lg:sticky lg:top-24">
          <div className="rounded-3xl bg-white dark:bg-[#0c1017] border border-slate-200 dark:border-slate-800/90 p-6 space-y-4 shadow-xl shadow-slate-200/50 dark:shadow-2xl">
            {/* Header: Location icon, title, copy icon */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-[#00df81]" />
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Location</h2>
              </div>
              <button
                type="button"
                onClick={handleCopyAddress}
                aria-label="Copy address"
                className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                title="Copy Address"
              >
                {copiedAddress ? (
                  <Check className="w-4 h-4 text-[#00df81]" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Venue name & City */}
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {turf.name} | {turf.city}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                {turf.address_text || `${turf.name}, ${turf.city}`}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 font-medium">
                {distanceText}
              </div>
            </div>

            {/* Map Preview with View Map Pill */}
            <div className="relative rounded-2xl overflow-hidden h-48 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800/90 group">
              <iframe
                title="Venue Location Map"
                src={`https://maps.google.com/maps?q=${mapSearchQuery}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
                className="w-full h-full border-0 filter brightness-95 dark:brightness-90 contrast-105 pointer-events-none"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent pointer-events-none" />

              {/* View Map Overlay Button */}
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-slate-950/85 hover:bg-slate-900 border border-slate-700/80 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg backdrop-blur-md transition-all group-hover:scale-105"
              >
                <span>View Map</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Advance Highlight Pill */}
            {advanceText && (
              <div className="p-3 rounded-2xl bg-[#00df81]/10 border border-[#00df81]/30 text-xs flex items-center justify-between">
                <span className="text-slate-700 dark:text-slate-300 font-medium flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#00df81]" />
                  <span>Advance required:</span>
                </span>
                <span className="font-bold text-[#00df81]">{advanceText}</span>
              </div>
            )}

            {/* Book Slot CTA Button */}
            <Link
              href={`/turfs/${turf.slug}/book`}
              className="w-full py-3.5 rounded-md bg-[#00df81] hover:bg-[#00c974] text-slate-950 font-black uppercase tracking-wider text-xs transition-all duration-200 shadow-lg shadow-[#00df81]/25 active:scale-[0.99] flex items-center justify-center gap-1.5 cursor-pointer text-center"
            >
              <span>BOOK A TURF</span>
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
