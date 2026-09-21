'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import HoldTimer from '@/components/HoldTimer';
import { formatINR, formatDate, formatTimeRange } from '@/lib/utils';
import { ShieldCheck, ArrowLeft, CreditCard, Sparkles, CheckCircle2, AlertCircle, Trophy, Clock } from 'lucide-react';

declare global {
  interface Window {
    Razorpay: any;
  }
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      return reject(new Error('Window is not defined'));
    }
    if ((window as any).Razorpay) {
      return resolve();
    }
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (e) =>
        reject(new Error(`Failed to load Razorpay SDK from checkout.razorpay.com: ${e}`))
      );
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (err) =>
      reject(new Error(`Failed to load Razorpay SDK from https://checkout.razorpay.com/v1/checkout.js: ${err}`));
    document.body.appendChild(script);
  });
}

export default function BookingReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const bookingId = resolvedParams.id;
  const router = useRouter();
  const supabase = createBrowserClient('player');

  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paymentDoneAwaitingWebhook, setPaymentDoneAwaitingWebhook] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  // 1. Fetch booking details
  useEffect(() => {
    async function fetchBooking() {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id, reference_code, status, starts_at, ends_at, hold_expires_at,
          total_minor, required_online_minor, currency,
          resource:resources (
            name,
            turf:turfs (name, city, address_text, slug)
          )
        `)
        .eq('id', bookingId)
        .single();

      if (error || !data) {
        console.error('[BookingReviewPage] fetchBooking error from Supabase/PostgREST:', error);
        setFetchError('Booking reservation not found or access denied.');
        setLoading(false);
        return;
      }

      if (data.status === 'confirmed') {
        router.push(`/bookings/${data.id}`);
        return;
      }

      if (data.status === 'expired') {
        setIsExpired(true);
      }

      const resData = data.resource as any;
      const turfData = Array.isArray(resData?.turf) ? resData.turf[0] : resData?.turf;
      setBooking({
        ...data,
        turf: turfData,
      });
      setLoading(false);
    }

    fetchBooking();
  }, [bookingId, router, supabase]);

  // 2. Realtime listener & polling for confirmation
  useEffect(() => {
    if (!bookingId) return;

    // Realtime channel
    const channel = supabase
      .channel(`booking-confirmation-${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bookings',
          filter: `id=eq.${bookingId}`,
        },
        (payload: any) => {
          if (payload.new?.status === 'confirmed') {
            router.push(`/bookings/${bookingId}`);
          }
          if (payload.new?.status === 'expired') {
            setIsExpired(true);
          }
        }
      )
      .subscribe();

    // Polling fallback every 2 seconds
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('bookings')
        .select('status')
        .eq('id', bookingId)
        .single();

      if (data?.status === 'confirmed') {
        clearInterval(interval);
        router.push(`/bookings/${bookingId}`);
      }
      if (data?.status === 'expired') {
        setIsExpired(true);
      }
    }, 2000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [bookingId, router, supabase]);

  // 3. Trigger Live Razorpay Checkout
  const handleLaunchRazorpay = async () => {
    if (isExpired || (booking?.hold_expires_at && new Date(booking.hold_expires_at).getTime() <= Date.now())) {
      setIsExpired(true);
      setPaymentError('Hold deadline has passed. This slot has been released back to public inventory.');
      return;
    }

    setPaymentError(null);
    setPaying(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const functionsUrl = process.env.NEXT_PUBLIC_FUNCTIONS_URL || 'http://127.0.0.1:54321/functions/v1';

      // Call Edge Function: checkout
      const res = await fetch(`${functionsUrl}/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          booking_id: booking.id,
          idempotency_key: `checkout_${booking.id}`,
        }),
      });

      const orderData = await res.json();
      if (!res.ok) {
        throw new Error(orderData.message || orderData.error || 'Failed to initialize checkout order');
      }

      const { provider_order_id, amount_minor, key_id } = orderData;

      // Ensure Razorpay SDK is loaded dynamically on demand
      await loadRazorpayScript();

      if (!window.Razorpay) {
        throw new Error('Razorpay SDK failed to initialize in window object after script load.');
      }

      const activeKey = key_id || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
      if (!activeKey) {
        throw new Error('Razorpay Key ID is not configured (missing key_id and NEXT_PUBLIC_RAZORPAY_KEY_ID)');
      }

      // Launch Razorpay standard checkout modal
      const options = {
        key: activeKey,
        amount: amount_minor,
        currency: 'INR',
        name: 'Box Codex',
        description: `Booking ${booking.reference_code} at ${booking.turf.name}`,
        order_id: provider_order_id,
        prefill: {
          name: session?.user.user_metadata?.name || 'Live Player',
          email: session?.user.email || 'player@example.com',
          contact: '+919999988888',
        },
        theme: {
          color: '#10b981',
        },
        handler: function () {
          // Razorpay payment completed in browser
          setPaymentDoneAwaitingWebhook(true);
        },
        modal: {
          ondismiss: function () {
            setPaying(false);
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err: unknown) {
      console.error('Checkout error:', err);
      setPaymentError(extractDatabaseError(err, 'Payment initiation failed'));
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Loading reservation details...</span>
        </div>
      </div>
    );
  }

  if (fetchError || !booking) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="glass-panel p-8 rounded-2xl">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white">Reservation Error</h2>
          <p className="text-xs text-slate-400 mt-2">{fetchError || 'Reservation not found'}</p>
          <Link href="/" className="inline-block mt-5 text-xs font-semibold text-emerald-400 hover:underline">
            ← Return to Venues
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      {/* Back button */}
      <Link
        href={`/turfs/${booking.turf.slug}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-400 transition-colors mb-6 group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to Slot Selection
      </Link>

      {/* Main Review Card */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 relative overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Payment Error Alert Banner */}
        {paymentError && (
          <div className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-start gap-3 animate-in fade-in duration-200">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">
              <div className="font-bold text-red-300">Payment Error</div>
              <div className="text-red-400/90 mt-1">{paymentError}</div>
            </div>
            <button
              onClick={() => setPaymentError(null)}
              className="text-xs text-red-400 hover:text-red-300 underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-5 mb-6">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Reservation Hold Review
            </div>
            <h1 className="text-2xl font-black text-white mt-1">
              Confirm & Pay for Your Court
            </h1>
          </div>
          <div className="px-3 py-1 rounded-xl bg-slate-900 border border-slate-800 text-right">
            <div className="text-[10px] text-slate-500 font-semibold uppercase">Booking Ref</div>
            <div className="font-mono text-xs font-bold text-slate-200">{booking.reference_code}</div>
          </div>
        </div>

        {/* Live Hold Countdown Timer */}
        <div className="mb-6">
          <HoldTimer
            expiresAt={booking.hold_expires_at}
            onExpire={() => setIsExpired(true)}
          />
        </div>

        {/* Booking Details Breakdown */}
        <div className="space-y-4 mb-8">
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs text-slate-400">Turf Venue</div>
              <div className="text-base font-bold text-white mt-0.5">{booking.turf.name}</div>
              <div className="text-xs text-slate-400 mt-0.5">{booking.turf.address_text}</div>
            </div>
            <div className="sm:text-right">
              <div className="text-xs text-slate-400">Court / Ground</div>
              <div className="text-sm font-semibold text-emerald-400 mt-0.5">{booking.resource.name}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="text-xs text-slate-400">Scheduled Date</div>
              <div className="text-sm font-bold text-white mt-1">{formatDate(booking.starts_at)}</div>
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="text-xs text-slate-400">Time Interval (60 Mins)</div>
              <div className="text-sm font-bold text-white mt-1">
                {formatTimeRange(booking.starts_at, booking.ends_at)}
              </div>
            </div>
          </div>
        </div>

        {/* Pricing Summary */}
        <div className="p-5 rounded-2xl bg-emerald-950/20 border border-emerald-500/20 mb-6">
          <div className="flex items-center justify-between text-xs text-slate-300 pb-2.5 border-b border-emerald-500/10">
            <span>Court Rental Fee (Includes Lights & Turf)</span>
            <span className="font-semibold text-white">{formatINR(booking.total_minor)}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400 py-2 border-b border-emerald-500/10">
            <span>Convenience & Gateway Fee</span>
            <span className="text-emerald-400 font-medium">FREE (₹0)</span>
          </div>
          <div className="flex items-center justify-between pt-3">
            <div>
              <div className="text-sm font-bold text-white">Total Amount Due</div>
              <div className="text-[10px] text-slate-400">Advance online payment</div>
            </div>
            <div className="text-2xl font-black text-emerald-400">
              {formatINR(booking.total_minor)}
            </div>
          </div>
        </div>


        {/* Payment Done / Awaiting Webhook Notification */}
        {paymentDoneAwaitingWebhook && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin shrink-0" />
            <div>
              <div className="font-bold">Payment captured successfully!</div>
              <div className="text-slate-400 text-[11px] mt-0.5">
                Reconciling with database ledger via webhook... Redirecting you to your digital pass.
              </div>
            </div>
          </div>
        )}

        {/* Action Button */}
        {isExpired ? (
          <div className="text-center py-2">
            <Link
              href={`/turfs/${booking.turf.slug}`}
              className="inline-block w-full py-3.5 px-6 rounded-xl text-xs font-bold text-slate-950 bg-slate-300 hover:bg-white transition-all shadow-md"
            >
              Hold Expired — Pick Another Slot
            </Link>
          </div>
        ) : (
          <button
            disabled={paying || paymentDoneAwaitingWebhook}
            onClick={handleLaunchRazorpay}
            className="w-full py-4 px-6 rounded-2xl text-sm font-bold text-slate-950 bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 hover:from-emerald-300 hover:to-emerald-400 transition-all shadow-xl shadow-emerald-500/25 active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2.5"
          >
            {paying ? (
              <>
                <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                <span>Opening Razorpay Secure Gateway...</span>
              </>
            ) : (
              <>
                <CreditCard className="w-5 h-5" />
                <span>Pay {formatINR(booking.total_minor)} with UPI / Card</span>
              </>
            )}
          </button>
        )}

        {/* Guarantee Footer */}
        <div className="mt-5 text-center text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Encrypted 256-bit checkout • Instant booking confirmation pass</span>
        </div>
      </div>
    </div>
  );
}
