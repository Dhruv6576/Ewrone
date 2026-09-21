import { cookies } from 'next/headers';
import Link from 'next/link';
import { createServerClient } from '@boxcodex/shared';
import { formatINR, formatDate, formatTimeRange } from '@/lib/utils';
import { Calendar, MapPin, Trophy, ArrowRight, User, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';

export const revalidate = 0;

export default async function MyBookingsPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient('player', cookieStore);

  const { data: { user } } = await supabase.auth.getUser();

  // 1. Anonymous State: Require authentication
  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="glass-panel p-8 rounded-3xl border border-slate-800">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center mx-auto mb-4">
            <User className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-white">Sign In to View Bookings</h1>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Log in to view your confirmed game passes, match references, and payment receipts.
          </p>
          <Link
            href="/login?redirect=/my-bookings"
            className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-all shadow-md shadow-emerald-500/20"
          >
            <span>Sign In</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  // 2. Authenticated State: Query player's bookings
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, reference_code, status, starts_at, ends_at, confirmed_at, total_minor,
      resource:resources (
        name,
        turf:turfs (name, city, slug)
      )
    `)
    .eq('player_user_id', user.id)
    .order('created_at', { ascending: false });

  const bookings = (data || []).map((b: any) => ({
    ...b,
    turf: Array.isArray(b.resource?.turf) ? b.resource.turf[0] : b.resource?.turf,
  }));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2">
            <Calendar className="w-7 h-7 text-emerald-400" />
            My Bookings
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Review your upcoming match slots, gate passes, and reservation history
          </p>
        </div>

        <Link
          href="/"
          className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-all shadow-md shadow-emerald-500/20 flex items-center gap-1.5"
        >
          <span>Book Court</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {bookings.length === 0 ? (
        <div className="glass-panel p-12 rounded-3xl text-center border border-slate-800">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 text-slate-500 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-white">No Reservations Yet</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            You haven't made any turf reservations yet. Explore available pitches across the arena network.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-all shadow-md shadow-emerald-500/20"
          >
            <span>Browse Venues</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking: any) => (
            <div
              key={booking.id}
              className="glass-panel p-6 rounded-2xl border border-slate-800 hover:border-slate-700 transition-all group"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                      {booking.reference_code}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-900 text-slate-300 border border-slate-800 uppercase font-semibold">
                      {booking.status}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                    {booking.turf?.name || 'Arena Pitch'}
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      {booking.turf?.city || 'Local Venue'}
                    </span>
                    <span className="flex items-center gap-1 font-medium text-slate-300">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      {formatDate(booking.starts_at)} ({formatTimeRange(booking.starts_at, booking.ends_at)})
                    </span>
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-800/80">
                  <div className="text-sm font-black text-white">
                    {formatINR(booking.total_minor)}
                  </div>
                  <Link
                    href={`/bookings/${booking.id}`}
                    className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 mt-1"
                  >
                    <span>View Pass</span>
                    <ArrowRight className="w-3 h-3" />
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
