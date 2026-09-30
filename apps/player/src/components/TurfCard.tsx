import Link from 'next/link';
import { MapPin, ShieldCheck, Sparkles, Clock, ArrowUpRight } from 'lucide-react';
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
}

export default function TurfCard({ turf }: { turf: TurfProps }) {
  return (
    <div className="glass-panel glass-panel-hover rounded-2xl p-5 flex flex-col justify-between group relative overflow-hidden">
      {/* Decorative gradient highlight */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all pointer-events-none" />

      <div>
        {/* Header Tags */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/70 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            Verified Arena
          </span>
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-slate-500" />
            {turf.city}
          </span>
        </div>

        {/* Turf Name */}
        <h3 className="font-bold text-lg text-white group-hover:text-emerald-300 transition-colors tracking-tight line-clamp-1">
          {turf.name}
        </h3>

        {/* Address */}
        <p className="text-xs text-slate-400 mt-1 line-clamp-1">
          {turf.address_text || 'Stadium Road, Prime Sports Enclave'}
        </p>

        {/* Amenities / Feature Pills */}
        <div className="flex flex-wrap gap-1.5 mt-3.5">
          <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            Box Cricket
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            Floodlights
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            Free Parking
          </span>
        </div>
      </div>

      {/* Bottom Footer & CTA */}
      <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between">
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Starting from</div>
          {turf.startingPriceMinor ? (
            <div className="text-sm font-bold text-emerald-400">
              {formatINR(turf.startingPriceMinor)}{' '}
              <span className="text-[10px] text-slate-400 font-normal">/ hour</span>
            </div>
          ) : (
            <div className="text-xs font-medium text-slate-500 italic">
              Pricing unavailable
            </div>
          )}
        </div>

        <Link
          href={`/turfs/${turf.slug}`}
          className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-all flex items-center gap-1 group-hover:shadow-md group-hover:shadow-emerald-500/20 active:scale-95"
        >
          <span>Select Slots</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
