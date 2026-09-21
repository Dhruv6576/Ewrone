'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@boxcodex/shared';
import { formatINR, formatDate, formatTimeRange } from '@/lib/utils';
import {
  CheckCircle2,
  Calendar,
  Clock,
  MapPin,
  QrCode,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  Download,
  Share2,
  Trophy,
} from 'lucide-react';

export default function BookingConfirmedPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const bookingId = resolvedParams.id;
  const router = useRouter();
  const supabase = createBrowserClient('player');

  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellationData, setCancellationData] = useState<{
    refund_percent: number;
    refund_amount_minor: number;
    retained_revenue_minor: number;
  } | null>(null);

  useEffect(() => {
    async function loadBooking() {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id, reference_code, status, starts_at, ends_at, confirmed_at,
          total_minor, required_online_minor, currency,
          resource:resources (
            name,
            turf:turfs (name, city, address_text, slug)
          )
        `)
        .eq('id', bookingId)
        .single();

      if (error || !data) {
        console.error('[BookingConfirmedPage] loadBooking error from Supabase/PostgREST:', error);
        setError('Booking not found or permission denied');
      } else {
        const resData = data.resource as any;
        const turfData = Array.isArray(resData?.turf) ? resData.turf[0] : resData?.turf;
        setBooking({
          ...data,
          turf: turfData,
        });
      }
      setLoading(false);
    }

    loadBooking();
  }, [bookingId, supabase]);

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this booking? Refund will be processed based on cancellation policy.')) {
      return;
    }

    setCancelling(true);
    try {
      const { data, error: cancelErr } = await supabase.rpc('cancel_booking', {
        p_booking_id: booking.id,
        p_reason: 'Cancelled by player via Web Portal',
      });

      if (cancelErr) throw cancelErr;

      setCancellationData({
        refund_percent: data.refund_percent ?? 100,
        refund_amount_minor: data.refund_amount_minor ?? booking.total_minor,
        retained_revenue_minor: data.retained_revenue_minor ?? 0,
      });

      // Reload state
      const { data: updated, error: reloadErr } = await supabase
        .from('bookings')
        .select(`
          id, reference_code, status, starts_at, ends_at, confirmed_at,
          total_minor, required_online_minor, currency,
          resource:resources (
            name,
            turf:turfs (name, city, address_text, slug)
          )
        `)
        .eq('id', bookingId)
        .single();

      if (reloadErr) {
        console.error('[BookingConfirmedPage] reload error after cancel:', reloadErr);
      } else if (updated) {
        const resData = updated.resource as any;
        const turfData = Array.isArray(resData?.turf) ? resData.turf[0] : resData?.turf;
        setBooking({
          ...updated,
          turf: turfData,
        });
      }
    } catch (err: any) {
      alert(err.message || 'Failed to cancel booking');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Loading your digital pass...</span>
        </div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="glass-panel p-8 rounded-2xl">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white">Booking Pass Error</h2>
          <p className="text-xs text-slate-400 mt-2">{error}</p>
          <Link href="/" className="inline-block mt-5 text-xs font-semibold text-emerald-400 hover:underline">
            ← Return to Home
          </Link>
        </div>
      </div>
    );
  }

  const isConfirmed = booking.status === 'confirmed';
  const isCancelled = booking.status === 'cancelled';

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      {/* Success banner if confirmed */}
      {isConfirmed && (
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 mb-3 shadow-lg shadow-emerald-500/10">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Booking Confirmed!
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Your court is locked. Show this pass at the turf entrance upon arrival.
          </p>
        </div>
      )}

      {isCancelled && (
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 mb-3">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Booking Cancelled
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            This reservation has been cancelled. Any eligible refund is processed to your original payment method.
          </p>

          {cancellationData && (
            <div className="mt-4 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 max-w-md mx-auto text-left shadow-lg">
              <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
                Policy Refund Breakdown
              </div>
              <div className="flex justify-between text-xs py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Applicable Tier</span>
                <span className="font-bold text-white">{cancellationData.refund_percent}% Refund</span>
              </div>
              <div className="flex justify-between text-xs py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Refund Credited</span>
                <span className="font-bold text-emerald-400">{formatINR(cancellationData.refund_amount_minor)}</span>
              </div>
              <div className="flex justify-between text-xs py-1.5">
                <span className="text-slate-400">Retained Revenue</span>
                <span className="font-bold text-slate-300">{formatINR(cancellationData.retained_revenue_minor)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Digital Ticket Pass Card */}
      <div className="glass-panel rounded-3xl overflow-hidden border border-slate-700/80 shadow-2xl relative">
        {/* Top Header of Ticket */}
        <div className="bg-gradient-to-r from-emerald-950/80 to-slate-900/90 p-6 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center text-slate-950 font-black">
                <Trophy className="w-4 h-4" />
              </div>
              <span className="font-bold text-sm tracking-wider text-white">BOX CODEX PASS</span>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                isConfirmed
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-red-500/20 text-red-400 border border-red-500/40'
              }`}
            >
              {booking.status}
            </span>
          </div>

          <div className="mt-6">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-emerald-400">
              Verified Booking Reference
            </div>
            <div className="font-mono text-2xl sm:text-3xl font-black text-white tracking-wider mt-0.5">
              {booking.reference_code}
            </div>
          </div>
        </div>

        {/* Ticket Details Body */}
        <div className="p-6 space-y-5 bg-slate-950/40">
          <div>
            <div className="text-xs text-slate-400">Turf Arena</div>
            <div className="text-lg font-bold text-white mt-0.5">{booking.turf.name}</div>
            <div className="text-xs text-slate-400 flex items-center gap-1 mt-1">
              <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>{booking.turf.address_text}, {booking.turf.city}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-800/80">
            <div>
              <div className="text-xs text-slate-400">Court / Pitch</div>
              <div className="text-sm font-semibold text-emerald-400 mt-0.5">{booking.resource.name}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Date</div>
              <div className="text-sm font-semibold text-white mt-0.5">{formatDate(booking.starts_at)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Match Time</div>
              <div className="text-sm font-semibold text-white mt-0.5">
                {formatTimeRange(booking.starts_at, booking.ends_at)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Amount Paid</div>
              <div className="text-sm font-bold text-emerald-400 mt-0.5">
                {formatINR(booking.total_minor)}
              </div>
            </div>
          </div>

          {/* Stylized QR Code Check-In Box */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-4 mt-6">
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <QrCode className="w-4 h-4 text-emerald-400" />
                Staff Gate Check-In
              </div>
              <div className="text-[11px] text-slate-400 mt-1 max-w-[200px]">
                Present this digital QR code to the venue operator for verification.
              </div>
            </div>
            <div className="w-16 h-16 rounded-xl bg-white p-2 flex items-center justify-center shrink-0 shadow-md">
              <div className="w-full h-full border-2 border-dashed border-slate-950 flex items-center justify-center">
                <QrCode className="w-10 h-10 text-slate-950" />
              </div>
            </div>
          </div>
        </div>

        {/* Ticket Perforated Divider */}
        <div className="relative flex items-center justify-between px-2 bg-slate-950/40">
          <div className="w-5 h-5 -ml-3 rounded-full bg-[#070a12] border-r border-slate-800" />
          <div className="flex-1 border-b border-dashed border-slate-800 mx-2" />
          <div className="w-5 h-5 -mr-3 rounded-full bg-[#070a12] border-l border-slate-800" />
        </div>

        {/* Bottom Actions */}
        <div className="p-6 bg-slate-950/70 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Link
            href="/my-bookings"
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors text-center"
          >
            All Bookings
          </Link>

          {isConfirmed && (
            <button
              disabled={cancelling}
              onClick={handleCancel}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-950/50 border border-red-500/20 transition-colors"
            >
              {cancelling ? 'Cancelling...' : 'Cancel Booking'}
            </button>
          )}

          <Link
            href="/"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 transition-all text-center flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20"
          >
            <span>Book Another Court</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
