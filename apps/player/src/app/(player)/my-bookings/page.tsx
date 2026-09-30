'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@boxcodex/shared';
import { formatINR, formatDate, formatTimeRange } from '@/lib/utils';
import { Calendar, MapPin, ArrowUpRight, User, Clock, CheckCircle2, ShieldCheck, RefreshCw } from 'lucide-react';
import { getConfirmedBookingsList } from '@/lib/bookings-store';

export default function MyBookingsPage() {
  const supabase = createBrowserClient('player');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);

  const loadUserAndBookings = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setLoading(false);
      return;
    }

    setUser(session.user);

    // Query player bookings
    const { data: bList } = await supabase
      .from('bookings')
      .select(`
        id, reference_code, status, starts_at, ends_at, confirmed_at, total_minor,
        resource:resources (
          name,
          turf:turfs (name, city, slug)
        )
      `)
      .eq('player_user_id', session.user.id)
      .order('created_at', { ascending: false });

    // Strictly show ONLY confirmed bookings (merging DB records with verified payments)
    const confirmedList = getConfirmedBookingsList(bList, session.user.id);
    setBookings(confirmedList);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadUserAndBookings();

    // 1. Reactive event listeners for instantaneous same-window and cross-tab sync
    const handleLocalConfirmed = () => {
      loadUserAndBookings();
    };

    window.addEventListener('ewrone-booking-confirmed', handleLocalConfirmed);
    window.addEventListener('storage', handleLocalConfirmed);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('ewrone_bookings_channel');
      bc.onmessage = () => {
        loadUserAndBookings();
      };
    }

    // 2. Subscribe to realtime updates on bookings table
    const channel = supabase
      .channel('my-bookings-channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
        },
        () => {
          loadUserAndBookings();
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener('ewrone-booking-confirmed', handleLocalConfirmed);
      window.removeEventListener('storage', handleLocalConfirmed);
      if (bc) bc.close();
      supabase.removeChannel(channel);
    };
  }, [loadUserAndBookings, supabase]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-slate-800 rounded-lg" />
          <div className="h-4 w-72 bg-slate-800/60 rounded" />
          <div className="h-32 bg-slate-900 rounded-2xl border border-slate-800 mt-8" />
          <div className="h-32 bg-slate-900 rounded-2xl border border-slate-800" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="p-8 rounded-3xl bg-[#0a0e14] border border-slate-800/80 shadow-2xl">
          <div className="w-12 h-12 rounded-2xl bg-[#00df81]/10 border border-[#00df81]/30 text-[#00df81] flex items-center justify-center mx-auto mb-4">
            <User className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-white font-display">Sign In to View Bookings</h1>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed font-sans-ui">
            Log in to view your confirmed game passes, match references, and payment receipts.
          </p>
          <Link
            href="/login?redirect=/my-bookings"
            className="inline-flex items-center gap-2 mt-6 px-6 py-2.5 rounded-md text-xs font-black tracking-wider uppercase text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all shadow-md shadow-[#00df81]/25"
          >
            <span>SIGN IN</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 transition-colors duration-200">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2 font-display">
            <Calendar className="w-7 h-7 text-[#00df81]" />
            Booking History
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-sans-ui">
            Confirmed match reservations and digital entrance gate passes
          </p>
        </div>

        <Link
          href="/explore"
          className="px-5 py-2.5 rounded-md text-xs font-black uppercase tracking-wider text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all shadow-md shadow-[#00df81]/25 flex items-center gap-1.5 cursor-pointer font-display"
        >
          <span>BOOK A TURF</span>
          <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
        </Link>
      </div>

      {bookings.length === 0 ? (
        <div className="p-12 rounded-3xl text-center bg-[#0a0e14] border border-slate-800/80 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-[#00df81]/10 border border-[#00df81]/30 text-[#00df81] flex items-center justify-center mx-auto mb-4">
            <Clock className="w-7 h-7 text-[#00df81]" />
          </div>
          <h3 className="text-lg font-bold text-white font-display">No Confirmed Bookings Yet</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto font-sans-ui">
            Only reservations confirmed by advance or full payment appear here. Explore available pitches across the arena network.
          </p>
          <Link
            href="/explore"
            className="inline-flex items-center gap-2 mt-6 px-6 py-2.5 rounded-md text-xs font-black uppercase tracking-wider text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all shadow-md shadow-[#00df81]/25 font-display"
          >
            <span>BROWSE VENUES</span>
            <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking: any) => (
            <div
              key={booking.id}
              className="p-6 rounded-2xl bg-[#0a0e14] border border-slate-800/80 hover:border-[#00df81]/50 transition-all group shadow-md"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono text-xs font-bold text-[#00df81] bg-[#00df81]/10 px-2.5 py-0.5 rounded-full border border-[#00df81]/30">
                      {booking.reference_code}
                    </span>
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#00df81]/15 text-[#00df81] border border-[#00df81]/30 uppercase font-bold tracking-wider flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 stroke-[2.5]" />
                      CONFIRMED
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-white group-hover:text-[#00df81] transition-colors font-display">
                    {booking.turf?.name || 'Box Cricket Arena'}
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-slate-400 font-sans-ui flex-wrap">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-[#00df81]" />
                      {booking.turf?.city || 'Bengaluru'}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="flex items-center gap-1 font-medium text-slate-300">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {formatDate(booking.starts_at)} ({formatTimeRange(booking.starts_at, booking.ends_at)})
                    </span>
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-800/80 gap-2">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500 uppercase font-medium">Slot Amount</div>
                    <div className="text-base font-black text-white font-display">
                      {formatINR(booking.total_minor)}
                    </div>
                  </div>
                  <Link
                    href={`/bookings/${booking.id}`}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all flex items-center gap-1 cursor-pointer font-display shadow-sm shadow-[#00df81]/20"
                  >
                    <span>View Pass</span>
                    <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
