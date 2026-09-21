'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  TrendingUp,
  Calendar,
  CreditCard,
  Building2,
  ArrowUpRight,
  AlertCircle,
  RefreshCw,
  PlusCircle,
  CheckCircle2,
  Clock
} from 'lucide-react';

interface OwnerDashboardData {
  master_owner_id: string;
  start_date: string;
  end_date: string;
  summary: {
    total_bookings: number;
    confirmed_bookings: number;
    cancelled_bookings: number;
    gross_booking_minor: number;
    commission_minor: number;
    net_owner_minor: number;
    source_breakdown: {
      online: {
        bookings_count: number;
        gross_minor: number;
        commission_minor: number;
        net_payout_eligible_minor: number;
      };
      walkin: {
        bookings_count: number;
        gross_minor: number;
        commission_minor: number;
        net_retained_minor: number;
      };
    };
  };
  turfs: Array<{
    turf_id: string;
    turf_name: string;
    approval_status: string;
    bookings_count: number;
    gross_minor: number;
    net_minor: number;
  }>;
}

export default function OwnerDashboardPage() {
  const [data, setData] = useState<OwnerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [masterOwnerId, setMasterOwnerId] = useState<string | null>(null);

  const supabase = createBrowserClient('owner');

  async function fetchDashboard(ownerId: string) {
    setLoading(true);
    setError(null);
    try {
      // Call public.get_owner_dashboard with trailing 30 days
      const { data: resData, error: rpcErr } = await supabase.rpc('get_owner_dashboard', {
        p_master_owner_id: ownerId,
      });

      if (rpcErr) throw rpcErr;

      setData(resData as OwnerDashboardData);
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'An unexpected error occurred while loading dashboard.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      const { data: caps, error: capsErr } = await supabase.rpc('get_my_capabilities');
      if (capsErr || !caps?.master_owner_id) {
        setError(extractDatabaseError(capsErr, 'No Master Owner account associated with this user.'));
        setLoading(false);
        return;
      }

      setMasterOwnerId(caps.master_owner_id);
      fetchDashboard(caps.master_owner_id);
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-slate-800 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-slate-800/60 rounded-2xl" />
          ))}
        </div>
        <div className="h-64 bg-slate-800/40 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel rounded-2xl p-8 border border-red-500/20 text-center max-w-lg mx-auto my-12">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4 text-red-400">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Failed to Load Dashboard</h3>
        <p className="text-sm text-slate-400 mb-6 font-mono break-all">{error}</p>
        <button
          onClick={() => masterOwnerId && fetchDashboard(masterOwnerId)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  // Read metrics strictly from summary object
  const { summary, turfs } = data;
  const isZeroTurfs = turfs.length === 0;
  const isZeroBookings = summary.total_bookings === 0;

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Executive Dashboard
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Reporting period: <span className="text-slate-300 font-medium">{data.start_date}</span> to{' '}
            <span className="text-slate-300 font-medium">{data.end_date}</span> (trailing 30 days)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => masterOwnerId && fetchDashboard(masterOwnerId)}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Refresh metrics"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <Link
            href="/owner/turfs"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors shadow-lg shadow-emerald-500/20"
          >
            <PlusCircle className="w-4 h-4" />
            Add Venue
          </Link>
        </div>
      </div>

      {/* Primary KPI Metrics (All read from summary) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Bookings */}
        <div className="glass-panel p-5 rounded-2xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Bookings</span>
            <Calendar className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-black text-white">
            {summary.total_bookings}
          </div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-2">
            <span className="text-emerald-400 font-medium">{summary.confirmed_bookings} confirmed</span>
            <span>•</span>
            <span className="text-red-400 font-medium">{summary.cancelled_bookings} cancelled</span>
          </div>
        </div>

        {/* Gross Booking Value */}
        <div className="glass-panel p-5 rounded-2xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Gross Booking Value</span>
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-3xl font-black text-white">
            ₹{(summary.gross_booking_minor / 100).toLocaleString('en-IN')}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Combined revenue across all channels
          </p>
        </div>

        {/* Platform Commission */}
        <div className="glass-panel p-5 rounded-2xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Platform Commission</span>
            <CreditCard className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-3xl font-black text-white">
            ₹{(summary.commission_minor / 100).toLocaleString('en-IN')}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Calculated per booking policy snapshot
          </p>
        </div>

        {/* Net Owner Revenue */}
        <div className="glass-panel p-5 rounded-2xl border-emerald-500/30">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Net Owner Revenue</span>
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-3xl font-black text-emerald-400">
            ₹{(summary.net_owner_minor / 100).toLocaleString('en-IN')}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Retained revenue after commissions & refunds
          </p>
        </div>
      </div>

      {/* Channel Breakdown: Online vs Walk-in (Asymmetric Keys) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Online Bookings */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
              Online Platform Bookings
            </h3>
            <span className="text-xs text-slate-400">
              {summary.source_breakdown.online.bookings_count} bookings
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Gross</span>
              <span className="text-base font-bold text-white">
                ₹{(summary.source_breakdown.online.gross_minor / 100).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Commission</span>
              <span className="text-base font-bold text-slate-300">
                ₹{(summary.source_breakdown.online.commission_minor / 100).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30">
              <span className="text-[10px] text-blue-300 uppercase tracking-wider block">Net Payout Eligible</span>
              <span className="text-base font-bold text-blue-400">
                ₹{(summary.source_breakdown.online.net_payout_eligible_minor / 100).toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        </div>

        {/* Walk-in Bookings */}
        <div className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              Counter Walk-in Bookings
            </h3>
            <span className="text-xs text-slate-400">
              {summary.source_breakdown.walkin.bookings_count} bookings
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Gross Collected</span>
              <span className="text-base font-bold text-white">
                ₹{(summary.source_breakdown.walkin.gross_minor / 100).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Commission</span>
              <span className="text-base font-bold text-slate-300">
                ₹{(summary.source_breakdown.walkin.commission_minor / 100).toLocaleString('en-IN')}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30">
              <span className="text-[10px] text-emerald-300 uppercase tracking-wider block">Net Retained</span>
              <span className="text-base font-bold text-emerald-400">
                ₹{(summary.source_breakdown.walkin.net_retained_minor / 100).toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Turfs Performance Table or Explicit Zero-Turf Empty State */}
      <div className="glass-panel rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Managed Turfs Performance</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Breakdown of bookings and net revenue across registered venues
            </p>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-900 border border-slate-800 text-slate-300">
            {turfs.length} {turfs.length === 1 ? 'Venue' : 'Venues'}
          </span>
        </div>

        {isZeroTurfs ? (
          /* Explicit Zero-Turf Empty State */
          <div className="py-12 text-center max-w-md mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4 text-emerald-400">
              <Building2 className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">No turfs registered yet</h3>
            <p className="text-sm text-slate-400 mb-6 leading-relaxed">
              Onboard your first turf to start receiving online and walk-in bookings with automated double-booking protection.
            </p>
            <Link
              href="/owner/turfs"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors shadow-lg shadow-emerald-500/20"
            >
              <PlusCircle className="w-4 h-4" />
              Onboard Turf
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs text-slate-400 uppercase bg-slate-950/60 border-b border-slate-800/80">
                <tr>
                  <th className="py-3 px-4">Venue Name</th>
                  <th className="py-3 px-4">Approval Status</th>
                  <th className="py-3 px-4 text-right">Bookings</th>
                  <th className="py-3 px-4 text-right">Gross Revenue</th>
                  <th className="py-3 px-4 text-right">Net Revenue</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {turfs.map((t) => (
                  <tr key={t.turf_id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-white">
                      {t.turf_name}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        t.approval_status === 'approved'
                          ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30'
                          : t.approval_status === 'pending'
                          ? 'bg-yellow-950/60 text-yellow-400 border-yellow-500/30'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}>
                        {t.approval_status === 'approved' && <CheckCircle2 className="w-3 h-3" />}
                        {t.approval_status === 'pending' && <Clock className="w-3 h-3" />}
                        {t.approval_status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-medium">
                      {t.bookings_count}
                    </td>
                    <td className="py-3.5 px-4 text-right font-medium text-slate-200">
                      ₹{(t.gross_minor / 100).toLocaleString('en-IN')}
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-emerald-400">
                      ₹{(t.net_minor / 100).toLocaleString('en-IN')}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        href={`/turfs/${t.turf_id}`}
                        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                      >
                        View
                        <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {isZeroBookings && (
              <div className="text-center py-6 text-xs text-slate-500 border-t border-slate-800/40">
                Zero bookings recorded in this period across all registered venues.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
