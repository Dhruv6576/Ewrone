'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@boxcodex/shared';
import { formatINR, formatDate, formatTimeRange } from '@/lib/utils';
import { recordConfirmedPayment } from '@/lib/bookings-store';
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
  const searchParams = useSearchParams();
  const paymentId = searchParams.get('payment_id');
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
          id, reference_code, status, starts_at, ends_at, confirmed_at, player_user_id, resource_id,
          total_minor, required_online_minor, currency,
          resource:resources (
            id,
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

        // If paymentId query param is present or status is confirmed, persist to central store immediately
        if (paymentId || data.status === 'confirmed') {
          recordConfirmedPayment({
            bookingId: data.id,
            paymentId: paymentId || 'Captured Online',
            referenceCode: data.reference_code,
            resourceId: data.resource_id || resData?.id,
            resourceName: resData?.name,
            turfName: turfData?.name,
            turfCity: turfData?.city,
            turfSlug: turfData?.slug,
            startsAt: data.starts_at,
            endsAt: data.ends_at,
            totalMinor: data.total_minor,
            requiredOnlineMinor: data.required_online_minor,
            playerUserId: data.player_user_id,
          });
        }
      }
      setLoading(false);
    }

    loadBooking();
  }, [bookingId, paymentId, supabase]);

  // Realtime subscription & background polling to sync confirmed status seamlessly
  useEffect(() => {
    if (!bookingId || booking?.status === 'confirmed') return;

    const channel = supabase
      .channel(`booking-pass-${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bookings',
          filter: `id=eq.${bookingId}`,
        },
        (payload: any) => {
          if (payload.new) {
            setBooking((prev: any) => (prev ? { ...prev, ...payload.new } : prev));
          }
        }
      )
      .subscribe();

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('bookings')
        .select('status, confirmed_at')
        .eq('id', bookingId)
        .single();

      if (data?.status === 'confirmed') {
        setBooking((prev: any) => (prev ? { ...prev, ...data } : prev));
        clearInterval(interval);
      }
    }, 2000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [bookingId, booking?.status, supabase]);

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

  const isConfirmed = booking.status === 'confirmed' || Boolean(paymentId);
  const isCancelled = booking.status === 'cancelled';

  const totalMinor = booking.total_minor || 0;
  const advancePaidMinor = booking.required_online_minor ?? totalMinor;
  const balanceDueMinor = Math.max(0, totalMinor - advancePaidMinor);
  const isAdvancePayment = advancePaidMinor > 0 && advancePaidMinor < totalMinor;

  return (
    <div className="max-w-xl mx-auto px-4 py-12 transition-colors duration-200">
      {/* Success banner if confirmed */}
      {isConfirmed && (
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 mb-3 shadow-lg shadow-emerald-500/10">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            Booking Confirmed!
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Your court is locked. Show this pass at the turf entrance upon arrival.
          </p>
          {paymentId && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold bg-[#00df81]/10 text-[#00df81] border border-[#00df81]/30">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Payment Captured: {paymentId}</span>
            </div>
          )}
        </div>
      )}

      {isCancelled && (
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 mb-3">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            Booking Cancelled
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            This reservation has been cancelled. Any eligible refund is processed to your original payment method.
          </p>

          {cancellationData && (
            <div className="mt-4 p-4 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 max-w-md mx-auto text-left shadow-lg">
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2">
                Policy Refund Breakdown
              </div>
              <div className="flex justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">Applicable Tier</span>
                <span className="font-bold text-slate-900 dark:text-white">{cancellationData.refund_percent}% Refund</span>
              </div>
              <div className="flex justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">Refund Credited</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatINR(cancellationData.refund_amount_minor)}</span>
              </div>
              <div className="flex justify-between text-xs py-1.5">
                <span className="text-slate-500 dark:text-slate-400">Retained Revenue</span>
                <span className="font-bold text-slate-800 dark:text-slate-300">{formatINR(cancellationData.retained_revenue_minor)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Digital Ticket Pass Card */}
      <div className="rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-2xl relative bg-white dark:bg-[#0c1017]">
        {/* Top Header of Ticket */}
        <div className="bg-gradient-to-r from-slate-900 via-[#0c1017] to-slate-900 dark:from-[#080b0e] dark:via-[#0c1017] dark:to-[#080b0e] p-6 border-b border-[#00df81]/30 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-md bg-gradient-to-br from-[#00df81] to-[#00b4d8] flex items-center justify-center shadow-md shadow-[#00df81]/20">
                <svg className="w-5 h-5 text-slate-950" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z"/>
                </svg>
              </div>
              <span className="font-black text-sm tracking-wider text-white">EWRONE PASS</span>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider backdrop-blur-xs ${
                isConfirmed
                  ? 'bg-[#00df81]/20 text-[#00df81] border border-[#00df81]/40'
                  : 'bg-red-500/20 text-red-200 border border-red-500/40'
              }`}
            >
              {isConfirmed ? 'CONFIRMED' : booking.status}
            </span>
          </div>

          <div className="mt-6">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-[#00df81]">
              Verified Booking Reference
            </div>
            <div className="font-mono text-2xl sm:text-3xl font-black text-white tracking-wider mt-0.5">
              {booking.reference_code}
            </div>
          </div>
        </div>

        {/* Ticket Details Body */}
        <div className="p-6 space-y-5 bg-white dark:bg-[#0c1017]">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Turf Arena</div>
            <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">{booking.turf.name}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-1">
              <MapPin className="w-3.5 h-3.5 text-[#00df81] shrink-0" />
              <span>{booking.turf.address_text}, {booking.turf.city}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800/80">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Court / Pitch</div>
              <div className="text-sm font-bold text-[#00df81] mt-0.5">{booking.resource.name}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Date</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{formatDate(booking.starts_at)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Match Time</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                {formatTimeRange(booking.starts_at, booking.ends_at)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {isAdvancePayment ? 'Advance Paid' : 'Amount Paid'}
              </div>
              <div className="text-sm font-bold text-[#00df81] mt-0.5">
                {formatINR(advancePaidMinor)}
              </div>
            </div>

            {isAdvancePayment && (
              <>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Balance at Venue</div>
                  <div className="text-sm font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                    {formatINR(balanceDueMinor)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Total Slot Price</div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                    {formatINR(totalMinor)}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Stylized QR Code Check-In Box */}
          <div className="p-5 rounded-2xl bg-slate-50 dark:bg-[#080b0e] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 mt-6">
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <QrCode className="w-4 h-4 text-[#00df81]" />
                Staff Gate Check-In
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-[200px]">
                Present this digital QR code to the venue operator for verification.
              </div>
            </div>
            <div className="w-16 h-16 rounded-xl bg-white p-2 flex items-center justify-center shrink-0 shadow-md border border-slate-200">
              <div className="w-full h-full border-2 border-dashed border-slate-950 flex items-center justify-center">
                <QrCode className="w-10 h-10 text-slate-950" />
              </div>
            </div>
          </div>
        </div>

        {/* Ticket Perforated Divider */}
        <div className="relative flex items-center justify-between px-2 bg-white dark:bg-[#0c1017]">
          <div className="w-5 h-5 -ml-3 rounded-full bg-[#f8fafc] dark:bg-[#080b0e] border-r border-slate-200 dark:border-slate-800" />
          <div className="flex-1 border-b border-dashed border-slate-200 dark:border-slate-800 mx-2" />
          <div className="w-5 h-5 -mr-3 rounded-full bg-[#f8fafc] dark:bg-[#080b0e] border-l border-slate-200 dark:border-slate-800" />
        </div>

        {/* Bottom Actions */}
        <div className="p-6 bg-slate-50/80 dark:bg-[#0c1017] border-t border-slate-100 dark:border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Link
            href="/my-bookings"
            className="w-full sm:w-auto px-4 py-2.5 rounded-md text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 dark:text-slate-300 dark:bg-[#080b0e] dark:hover:bg-[#131d27] dark:border-slate-800 transition-colors text-center shadow-xs cursor-pointer"
          >
            All Bookings
          </Link>

          {isConfirmed && (
            <button
              disabled={cancelling}
              onClick={handleCancel}
              className="w-full sm:w-auto px-4 py-2.5 rounded-md text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 dark:text-red-400 dark:hover:bg-red-950/50 dark:border-red-500/20 transition-colors cursor-pointer"
            >
              {cancelling ? 'Cancelling...' : 'Cancel Booking'}
            </button>
          )}

          <Link
            href="/"
            className="w-full sm:w-auto px-5 py-2.5 rounded-md text-xs font-black uppercase tracking-wider text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all text-center flex items-center justify-center gap-1.5 shadow-md shadow-[#00df81]/25 cursor-pointer"
          >
            <span>BOOK A TURF</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
