'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import { formatINR } from '@/lib/utils';
import { 
  Building2, 
  CalendarCheck, 
  IndianRupee, 
  Percent, 
  TrendingUp, 
  AlertCircle 
} from 'lucide-react';

interface DashboardTurf {
  turf_id: string;
  turf_name: string;
  approval_status: string;
  bookings_count: number;
  gross_minor: number;
  net_minor: number;
}

interface DashboardSummary {
  total_bookings: number;
  gross_booking_minor: number;
  commission_minor: number;
  net_owner_minor: number;
  confirmed_bookings: number;
  cancelled_bookings: number;
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
}

interface DashboardData {
  turfs: DashboardTurf[];
  summary: DashboardSummary;
  start_date: string;
  end_date: string;
  master_owner_id: string;
}

export default function MasterOwnerDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const supabase = createBrowserClient('owner');
        const { data: context } = await supabase.rpc('get_my_context');
        const masterOwnerId = context?.master_owner_accounts?.[0]?.id;

        if (!masterOwnerId) {
          throw new Error('No master owner account associated with session');
        }

        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

        const { data: dash, error: dashErr } = await supabase.rpc('get_owner_dashboard', {
          p_master_owner_id: masterOwnerId,
          p_start_date: start,
          p_end_date: end,
        });

        if (dashErr) throw dashErr;
        setData(dash as DashboardData);
      } catch (err: unknown) {
        setError(extractDatabaseError(err, 'Failed to load dashboard'));
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  if (loading) {
    return <div className="text-xs text-slate-400">Loading portfolio analytics...</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  const turfCount = data?.turfs?.length ?? 0;
  const totalBookings = data?.summary?.total_bookings ?? 0;
  const grossRevenue = data?.summary?.gross_booking_minor ?? 0;
  const netSettlement = data?.summary?.net_owner_minor ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Portfolio Executive Dashboard</h1>
        <p className="text-xs text-slate-400 mt-1">
          High-level operational performance and financial settlements across all venues.
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Total Venues</span>
            <Building2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-slate-100">{turfCount}</p>
          <p className="text-[11px] text-emerald-400 mt-1">Active Arenas in Portfolio</p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Monthly Bookings</span>
            <CalendarCheck className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-2xl font-bold text-slate-100">{totalBookings}</p>
          <p className="text-[11px] text-slate-400 mt-1">Confirmed player reservations</p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Gross Revenue</span>
            <IndianRupee className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-slate-100">{formatINR(grossRevenue)}</p>
          <p className="text-[11px] text-slate-400 mt-1">Platform gross transaction volume</p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">Net Settlement</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400">{formatINR(netSettlement)}</p>
          <p className="text-[11px] text-slate-400 mt-1">After platform commissions</p>
        </div>
      </div>

      {/* Venue Breakdown */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <h2 className="text-sm font-bold text-slate-100 mb-4">Venue Performance Overview</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-3 font-semibold">Venue Name</th>
                <th className="pb-3 font-semibold">Status</th>
                <th className="pb-3 font-semibold text-right">Bookings</th>
                <th className="pb-3 font-semibold text-right">Gross Revenue</th>
                <th className="pb-3 font-semibold text-right">Net Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {data?.turfs && data.turfs.length > 0 ? (
                data.turfs.map((t) => (
                  <tr key={t.turf_id} className="hover:bg-slate-800/20">
                    <td className="py-3 font-medium text-slate-200">{t.turf_name}</td>
                    <td className="py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-500/10 text-emerald-400">
                        {t.approval_status}
                      </span>
                    </td>
                    <td className="py-3 text-right text-slate-300">{t.bookings_count ?? 0}</td>
                    <td className="py-3 text-right font-medium text-slate-200">
                      {formatINR(t.gross_minor ?? 0)}
                    </td>
                    <td className="py-3 text-right font-medium text-emerald-400">
                      {formatINR(t.net_minor ?? 0)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-500">
                    No venues found in portfolio.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
