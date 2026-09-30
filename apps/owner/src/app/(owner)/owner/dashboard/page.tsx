'use client';

import { useEffect, useState, useRef } from 'react';
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
  Clock,
  ChevronDown,
  IndianRupee,
  Users
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';

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
  const [trialInfo, setTrialInfo] = useState<{ start: string; end: string; remaining: number } | null>(null);
  const [ownerName, setOwnerName] = useState<string>('');
  const [dateRange, setDateRange] = useState<'7days' | '15days' | '30days' | '3months' | 'till_now'>('30days');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isOnlineDropdownOpen, setIsOnlineDropdownOpen] = useState(false);
  const [isWalkinDropdownOpen, setIsWalkinDropdownOpen] = useState(false);
  const [pitchCounts, setPitchCounts] = useState<Record<string, number>>({});
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const onlineDropdownRef = useRef<HTMLDivElement>(null);
  const walkinDropdownRef = useRef<HTMLDivElement>(null);

  // Memoize the supabase client so fast-refresh doesn't destroy the active session
  const [supabase] = useState(() => createBrowserClient('owner'));

  async function fetchDashboard(ownerId: string, range: '7days' | '15days' | '30days' | '3months' | 'till_now' = dateRange) {
    setLoading(true);
    setError(null);
    try {
      const today = new Date();
      let p_start_date: string | undefined = undefined;
      const p_end_date = today.toISOString().split('T')[0];

      if (range === '7days') {
        const past = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        p_start_date = past.toISOString().split('T')[0];
      } else if (range === '15days') {
        const past = new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000);
        p_start_date = past.toISOString().split('T')[0];
      } else if (range === '30days') {
        const past = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        p_start_date = past.toISOString().split('T')[0];
      } else if (range === '3months') {
        const past = new Date();
        past.setMonth(today.getMonth() - 3);
        p_start_date = past.toISOString().split('T')[0];
      } else if (range === 'till_now') {
        p_start_date = '2000-01-01';
      }

      const { data: resData, error: rpcErr } = await supabase.rpc('get_owner_dashboard', {
        p_master_owner_id: ownerId,
        p_start_date,
        p_end_date
      });

      if (rpcErr) throw rpcErr;

      // Fetch pitch counts to display in the Managed Turfs table
      const { data: pitches } = await supabase.from('pitches').select('turf_id');
      const counts: Record<string, number> = {};
      if (pitches) {
        pitches.forEach(p => {
          counts[p.turf_id] = (counts[p.turf_id] || 0) + 1;
        });
      }
      setPitchCounts(counts);

      setData(resData as OwnerDashboardData);
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'An unexpected error occurred while loading dashboard.'));
    } finally {
      setLoading(false);
    }
  }

  const handleRangeChange = (newRange: '7days' | '15days' | '30days' | '3months' | 'till_now') => {
    setDateRange(newRange);
    if (masterOwnerId) {
      fetchDashboard(masterOwnerId, newRange);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsDropdownOpen(false);
      if (onlineDropdownRef.current && !onlineDropdownRef.current.contains(event.target as Node)) setIsOnlineDropdownOpen(false);
      if (walkinDropdownRef.current && !walkinDropdownRef.current.contains(event.target as Node)) setIsWalkinDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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

      const { data: mo } = await supabase.from('master_owners').select('created_at').eq('id', caps.master_owner_id).single();
      if (mo?.created_at) {
        const createdDate = new Date(mo.created_at);
        const endDate = new Date(createdDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        const now = new Date();
        const diffDays = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= 30) {
          setTrialInfo({
            start: createdDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0],
            remaining: diffDays
          });
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { data: profile } = await supabase.from('profiles').select('display_name').eq('user_id', session.user.id).single();
        if (profile?.display_name) {
          const firstName = profile.display_name.trim().split(' ')[0];
          setOwnerName(firstName);
        }
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-neutral-200/50 dark:bg-neutral-800 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-neutral-200/50 dark:bg-neutral-800/60 rounded-2xl" />
          ))}
        </div>
        <div className="h-64 bg-neutral-200/50 dark:bg-neutral-800/40 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel rounded-2xl p-8 border border-red-500/20 text-center max-w-lg mx-auto my-12">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4 text-red-400">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2">Failed to Load Dashboard</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6 font-mono break-all">{error}</p>
        <button
          onClick={() => masterOwnerId && fetchDashboard(masterOwnerId)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-200/50 dark:bg-neutral-800 hover:bg-neutral-700 text-sm font-semibold text-neutral-900 dark:text-white transition-colors"
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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  const formatNiceDate = (dateString: string) => {
    if (!dateString) return '';
    try {
      const d = new Date(dateString);
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
    } catch {
      return dateString;
    }
  };

  return (
    <div className={`space-y-8 transition-opacity duration-300 ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
      {/* Top Header */}
      <div className="relative overflow-hidden bg-white rounded-[2.5rem] shadow-sm border border-neutral-200 min-h-[320px] flex items-center">
        {/* Background Image Container (Full Width) */}
        <div className="absolute inset-0 w-full h-full">
          <img src="/cricket-bg.png" alt="Cricket Dashboard" className="absolute inset-0 w-full h-full object-contain object-right" />
          {/* Subtle green-tinted gradient so text is always perfectly readable on the left */}
          <div className="absolute inset-0 bg-gradient-to-r from-primary/25 from-[15%] via-white/95 via-[50%] to-transparent to-[70%]" />
        </div>

        {/* Content Wrapper */}
        <div className="relative z-10 p-8 pl-4 sm:p-12 sm:pl-6 md:p-16 md:pl-8 w-full max-w-3xl flex flex-col justify-center h-full">
          <h1 className="flex flex-col">
            <span className="text-2xl sm:text-4xl font-light text-black mb-1">
              {greeting}
            </span>
            <span className="block text-3xl sm:text-4xl lg:text-5xl font-serif italic font-bold text-transparent bg-clip-text bg-gradient-to-br from-primary via-green-600 to-emerald-800 drop-shadow-sm leading-tight max-w-[450px] pb-2">
              {ownerName || 'Owner'}
            </span>
          </h1>

          <p className="text-sm sm:text-base text-neutral-600 mt-6 max-w-lg font-medium leading-relaxed">
            {trialInfo ? (
              <>
                Free Trial: <span className="text-neutral-900 font-bold">{formatNiceDate(trialInfo.start)}</span> to{' '}
                <span className="text-neutral-900 font-bold">{formatNiceDate(trialInfo.end)}</span>{' '}
                <span className="text-neutral-900 font-bold">({trialInfo.remaining} days remaining)</span>
              </>
            ) : (
              <>
                Reporting period: <span className="text-neutral-900 font-bold">{formatNiceDate(data.start_date)}</span> to{' '}
                <span className="text-neutral-900 font-bold">{formatNiceDate(data.end_date)}</span>{' '}
                ({
                  dateRange === '7days' ? 'trailing 7 days' :
                    dateRange === '15days' ? 'trailing 15 days' :
                      dateRange === '30days' ? 'trailing 30 days' :
                        dateRange === '3months' ? 'trailing 3 months' : 'all time'
                })
              </>
            )}
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/owner/turfs/new"
              className="inline-flex items-center justify-center gap-3 px-8 py-3.5 rounded-full text-sm font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl active:scale-95 shadow-xl shadow-neutral-900/10"
            >
              Add Venue
            </Link>
            <Link
              href="/owner/team"
              className="inline-flex items-center justify-center gap-3 px-8 py-3.5 rounded-full text-sm font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl active:scale-95 shadow-xl shadow-neutral-900/10"
            >
              Add Staff
            </Link>
          </div>
        </div>
      </div>

      {/* Primary KPI Metrics (All read from summary) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Bookings */}
        <div className={`glass-panel p-5 rounded-2xl transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 dark:hover:shadow-primary/10 hover:-translate-y-1 ${isDropdownOpen ? 'relative z-50' : 'relative z-0'}`}>
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-900 dark:text-white dark:text-neutral-200">Total Bookings</span>

            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-1.5 px-2 py-1 -mr-2 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer border border-transparent hover:border-neutral-200 dark:hover:border-neutral-700"
              >
                <Calendar className="w-4 h-4 text-neutral-900 dark:text-white dark:text-neutral-200" />
                <span className="text-xs font-medium hidden sm:inline-block text-neutral-900 dark:text-white">
                  {dateRange === '7days' && '7 Days'}
                  {dateRange === '15days' && '15 Days'}
                  {dateRange === '30days' && '30 Days'}
                  {dateRange === '3months' && '3 Months'}
                  {dateRange === 'till_now' && 'All Time'}
                </span>
                <ChevronDown className="w-3 h-3 text-neutral-500 opacity-70" />
              </button>

              {isDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-xl z-50 overflow-hidden text-sm">
                    {[
                      { value: '7days', label: 'Last 7 Days' },
                      { value: '15days', label: 'Last 15 Days' },
                      { value: '30days', label: 'Last 30 Days' },
                      { value: '3months', label: 'Last 3 Months' },
                      { value: 'till_now', label: 'Till Now' }
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          handleRangeChange(opt.value as any);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors ${dateRange === opt.value ? 'text-[#1DB954] font-semibold' : 'text-neutral-700 dark:text-neutral-300'
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="text-3xl font-medium text-neutral-900 dark:text-white">
            {summary.total_bookings}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-2 flex items-center gap-2">
            <span className="text-neutral-900 dark:text-white dark:text-neutral-200 font-medium">{summary.confirmed_bookings} confirmed</span>
            <span>•</span>
            <span className="text-red-600 dark:text-red-400 font-medium">{summary.cancelled_bookings} cancelled</span>
          </div>
        </div>

        {/* Gross Booking Value */}
        <div className="glass-panel p-5 rounded-2xl transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 dark:hover:shadow-primary/10 hover:-translate-y-1">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-900 dark:text-white dark:text-neutral-200">Gross Booking Value</span>
            <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-3xl font-medium text-neutral-900 dark:text-white flex items-center">
            <IndianRupee className="w-7 h-7 mr-0.5 -ml-1" strokeWidth={2.5} />
            {(summary.gross_booking_minor / 100).toLocaleString('en-IN')}
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
            Combined revenue across all channels
          </p>
        </div>

        {/* Staff Payroll */}
        <div className="glass-panel p-5 rounded-2xl transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 dark:hover:shadow-primary/10 hover:-translate-y-1">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-900 dark:text-white dark:text-neutral-200">Staff Payroll</span>
            <Users className="w-4 h-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="text-3xl font-medium text-neutral-900 dark:text-white flex items-center">
            <IndianRupee className="w-7 h-7 mr-0.5 -ml-1" strokeWidth={2.5} />
            {(summary.commission_minor / 100).toLocaleString('en-IN')}
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
            Fixed monthly staff compensation
          </p>
        </div>

        {/* Net Owner Revenue */}
        <div className="glass-panel p-5 rounded-2xl border-2 border-neutral-900 shadow-sm shadow-neutral-900/5 dark:border-white/30 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 dark:hover:shadow-primary/10 hover:-translate-y-1">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-900 dark:text-white dark:text-neutral-200">Net Owner Revenue</span>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute top-0 left-0 h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative h-3 w-3 rounded-full bg-green-500"></span>
            </span>
          </div>
          <div className="text-3xl font-medium text-green-600 dark:text-green-500 flex items-center">
            <IndianRupee className="w-7 h-7 mr-0.5 -ml-1" strokeWidth={2.5} />
            {(summary.net_owner_minor / 100).toLocaleString('en-IN')}
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
            Retained revenue after commissions
          </p>
        </div>
      </div>

      {/* Channel Breakdown: Online vs Walk-in (Asymmetric Keys) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Online Bookings */}
          <div className={`glass-panel p-6 rounded-2xl space-y-4 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 dark:hover:shadow-primary/10 hover:-translate-y-1 ${isOnlineDropdownOpen ? 'relative z-50' : 'relative z-0'}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-900 dark:bg-white" />
                Online Platform Bookings
              </h3>

              <div className="relative" ref={onlineDropdownRef}>
                <button
                  onClick={() => setIsOnlineDropdownOpen(!isOnlineDropdownOpen)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/50 dark:bg-white/10 backdrop-blur-md border border-black/10 dark:border-white/20 text-neutral-900 dark:text-white shadow-sm hover:bg-white/80 dark:hover:bg-white/20 transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>
                    {dateRange === '7days' && '7 Days'}
                    {dateRange === '15days' && '15 Days'}
                    {dateRange === '30days' && '30 Days'}
                    {dateRange === '3months' && '3 Months'}
                    {dateRange === 'till_now' && 'All Time'}
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
                </button>

                {isOnlineDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-xl z-50 overflow-hidden text-sm font-normal">
                    {[
                      { value: '7days', label: 'Last 7 Days' },
                      { value: '15days', label: 'Last 15 Days' },
                      { value: '30days', label: 'Last 30 Days' },
                      { value: '3months', label: 'Last 3 Months' },
                      { value: 'till_now', label: 'Till Now' }
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          handleRangeChange(opt.value as any);
                          setIsOnlineDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors ${dateRange === opt.value ? 'text-[#1DB954] font-semibold' : 'text-neutral-700 dark:text-neutral-300'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="p-3 rounded-xl bg-white/40 dark:bg-white/5 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-sm">
                <span className="text-[10px] text-neutral-700 dark:text-neutral-400 uppercase tracking-wider block">Bookings</span>
                <span className="text-base font-bold text-black dark:text-white">
                  {summary.source_breakdown.online.bookings_count}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-white/40 dark:bg-white/5 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-sm">
                <span className="text-[10px] text-neutral-700 dark:text-neutral-400 uppercase tracking-wider block">Net Retained</span>
                <span className="text-base font-black text-green-600 dark:text-green-500 flex items-center">
                  <IndianRupee className="w-4 h-4 mr-0.5 -ml-0.5" strokeWidth={2.5} />
                  {(summary.source_breakdown.online.net_payout_eligible_minor / 100).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </div>

          {/* Walk-in Bookings */}
          <div className={`glass-panel p-6 rounded-2xl space-y-4 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 dark:hover:shadow-primary/10 hover:-translate-y-1 ${isWalkinDropdownOpen ? 'relative z-50' : 'relative z-0'}`}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-neutral-900 dark:text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-neutral-900 dark:bg-white dark:bg-neutral-400" />
                Counter Walk-in Bookings
              </h3>

              <div className="relative" ref={walkinDropdownRef}>
                <button
                  onClick={() => setIsWalkinDropdownOpen(!isWalkinDropdownOpen)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/50 dark:bg-white/10 backdrop-blur-md border border-black/10 dark:border-white/20 text-neutral-900 dark:text-white shadow-sm hover:bg-white/80 dark:hover:bg-white/20 transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>
                    {dateRange === '7days' && '7 Days'}
                    {dateRange === '15days' && '15 Days'}
                    {dateRange === '30days' && '30 Days'}
                    {dateRange === '3months' && '3 Months'}
                    {dateRange === 'till_now' && 'All Time'}
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
                </button>

                {isWalkinDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-xl z-50 overflow-hidden text-sm font-normal">
                    {[
                      { value: '7days', label: 'Last 7 Days' },
                      { value: '15days', label: 'Last 15 Days' },
                      { value: '30days', label: 'Last 30 Days' },
                      { value: '3months', label: 'Last 3 Months' },
                      { value: 'till_now', label: 'Till Now' }
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          handleRangeChange(opt.value as any);
                          setIsWalkinDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors ${dateRange === opt.value ? 'text-[#1DB954] font-semibold' : 'text-neutral-700 dark:text-neutral-300'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="p-3 rounded-xl bg-white/40 dark:bg-white/5 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-sm">
                <span className="text-[10px] text-neutral-700 dark:text-neutral-400 uppercase tracking-wider block">Bookings</span>
                <span className="text-base font-bold text-black dark:text-white">
                  {summary.source_breakdown.walkin.bookings_count}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-white/40 dark:bg-white/5 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-sm">
                <span className="text-[10px] text-neutral-700 dark:text-neutral-400 uppercase tracking-wider block">Net Retained</span>
                <span className="text-base font-black text-green-600 dark:text-green-500 flex items-center">
                  <IndianRupee className="w-4 h-4 mr-0.5 -ml-0.5" strokeWidth={2.5} />
                  {(summary.source_breakdown.walkin.net_retained_minor / 100).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Revenue Summary Graph */}
        <div className="glass-panel no-glow p-6 sm:p-8 rounded-3xl transition-all duration-300 flex flex-col relative overflow-hidden group lg:col-span-3">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between mb-8 gap-4">
            <h3 className="font-bold text-lg text-neutral-900 dark:text-white flex items-center gap-2">
              Net Revenue by Channel
            </h3>
            
            <div className="flex items-center gap-4 sm:gap-6 bg-neutral-100/50 dark:bg-neutral-900/50 px-4 py-2.5 rounded-xl border border-black/5 dark:border-white/5">
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Online Bookings</span>
                <span className="text-sm font-bold text-[#1DB954] mt-0.5">{summary.source_breakdown.online.bookings_count} <span className="text-xs font-medium text-neutral-400">Total</span></span>
              </div>
              
              <div className="h-8 w-px bg-neutral-200 dark:bg-neutral-800"></div>
              
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Walk-in Bookings</span>
                <span className="text-sm font-bold text-neutral-900 dark:text-white mt-0.5">{summary.source_breakdown.walkin.bookings_count} <span className="text-xs font-medium text-neutral-400">Total</span></span>
              </div>
            </div>
          </div>

          <div className="flex-1 w-full h-[160px] min-h-[160px] mt-4 flex items-end">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={[
                  {
                    name: 'Online Platform',
                    revenue: 10000, // Visual override as requested
                  },
                  {
                    name: 'Counter Walk-in',
                    revenue: summary.source_breakdown.walkin.net_retained_minor / 100,
                  }
                ]}
                margin={{ top: -10, right: 30, left: 10, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke="rgba(150,150,150,0.15)" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#888', fontSize: 12 }} tickFormatter={(val) => val.toLocaleString('en-IN')} />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  width={70}
                  tick={({ y, payload }: any) => {
                    const words = payload.value.split(' ');
                    return (
                      <text x={0} y={y} textAnchor="start" fill="#888" fontSize={12} dominantBaseline="central">
                        {words.map((word: string, i: number) => (
                          <tspan x={0} dy={i === 0 ? (words.length > 1 ? -6 : 0) : 14} key={i}>
                            {word}
                          </tspan>
                        ))}
                      </text>
                    );
                  }}
                />
                <Tooltip
                  cursor={false}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length && hoveredBarIndex !== null) {
                      return (
                        <div className="bg-white dark:bg-neutral-900 px-3 py-2 rounded-xl shadow-lg border border-black/5 dark:border-white/10 flex flex-col items-center justify-center min-w-[120px]">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">{payload[0].payload.name}</span>
                          <span className="text-sm font-bold text-neutral-900 dark:text-white flex items-center justify-center">
                            <IndianRupee className="w-3.5 h-3.5 mr-0.5" />
                            {Number(payload[0].value).toLocaleString('en-IN')}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar 
                  dataKey="revenue" 
                  radius={[0, 8, 8, 0]} 
                  barSize={50}
                >
                  {
                    [0, 1].map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        className={index === 0 ? "fill-[#1DB954]" : "fill-neutral-900 dark:fill-white"} 
                        onMouseEnter={() => setHoveredBarIndex(index)}
                        onMouseLeave={() => setHoveredBarIndex(null)}
                      />
                    ))
                  }
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Turfs Performance Table or Explicit Zero-Turf Empty State */}
      <div className="bg-white/75 dark:bg-neutral-900/75 backdrop-blur-md border border-black/10 dark:border-white/10 transition-all duration-300 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-300 dark:border-neutral-800/80 pb-4">
          <div>
            <h2 className="text-lg font-bold text-neutral-900 dark:text-white">Managed Turfs Performance</h2>
            <p className="text-xs text-neutral-600 dark:text-neutral-500 dark:text-neutral-400 mt-0.5">
              Breakdown of bookings and net revenue across registered venues
            </p>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/50 dark:bg-white/10 backdrop-blur-md border border-black/10 dark:border-white/20 text-neutral-900 dark:text-white shadow-sm">
            {turfs.length} {turfs.length === 1 ? 'Venue' : 'Venues'}
          </span>
        </div>

        {isZeroTurfs ? (
          /* Explicit Zero-Turf Empty State */
          <div className="py-12 text-center max-w-md mx-auto">
            <div className="w-14 h-14 rounded-2xl bg-neutral-100 dark:bg-neutral-900 dark:bg-white/10 border border-neutral-300 dark:border-neutral-900 dark:border-white/20 flex items-center justify-center mx-auto mb-4 text-neutral-900 dark:text-white dark:text-neutral-200">
              <Building2 className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2">No turfs registered yet</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-500 dark:text-neutral-400 mb-6 leading-relaxed">
              Onboard your first turf to start receiving online and walk-in bookings with automated double-booking protection.
            </p>
            <Link
              href="/owner/turfs"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-neutral-900 dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-200 text-neutral-950 transition-colors shadow-lg shadow-neutral-900/10"
            >
              <PlusCircle className="w-4 h-4" />
              Onboard Turf
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-neutral-700 dark:text-neutral-700 dark:text-neutral-300">
              <thead className="text-xs text-neutral-600 dark:text-neutral-500 dark:text-neutral-400 uppercase bg-neutral-100/50 dark:bg-neutral-100 dark:bg-neutral-950/60 border-b border-neutral-300 dark:border-neutral-300 dark:border-neutral-800/80">
                <tr>
                  <th className="py-3 px-4">Venue Name</th>
                  <th className="py-3 px-4">Approval Status</th>
                  <th className="py-3 px-4 text-center">Pitches</th>
                  <th className="py-3 px-4 text-right">Bookings</th>
                  <th className="py-3 px-4 text-right">Gross Revenue</th>
                  <th className="py-3 px-4 text-right">Net Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
                {turfs.map((t) => (
                  <tr key={t.turf_id} className="dark:bg-neutral-900/40">
                    <td className="py-3.5 px-4 font-semibold text-neutral-900 dark:text-white">
                      {t.turf_name}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${t.approval_status === 'approved'
                        ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/60 dark:text-green-400 dark:border-green-500/30'
                        : t.approval_status === 'pending'
                          ? 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/60 dark:text-yellow-400 dark:border-yellow-500/30'
                          : 'bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-neutral-200/50 dark:bg-neutral-900 dark:text-neutral-500 dark:text-neutral-400 dark:border-neutral-300 dark:border-neutral-800'
                        }`}>
                        {t.approval_status === 'approved' && <CheckCircle2 className="w-3 h-3" />}
                        {t.approval_status === 'pending' && <Clock className="w-3 h-3" />}
                        {t.approval_status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center font-medium text-neutral-900 dark:text-white">
                      {pitchCounts[t.turf_id] || 0}
                    </td>
                    <td className="py-3.5 px-4 text-right font-medium text-neutral-900 dark:text-white">
                      {t.bookings_count}
                    </td>
                    <td className="py-3.5 px-4 text-right font-medium text-neutral-900 dark:text-white">
                      <div className="flex items-center justify-end">
                        <IndianRupee className="w-3.5 h-3.5 mr-0.5" />
                        {(t.gross_minor / 100).toLocaleString('en-IN')}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-bold text-green-600 dark:text-green-500">
                      <div className="flex items-center justify-end">
                        <IndianRupee className="w-3.5 h-3.5 mr-0.5" />
                        {(t.net_minor / 100).toLocaleString('en-IN')}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {isZeroBookings && (
              <div className="text-center py-6 text-xs text-neutral-500 border-t border-neutral-300 dark:border-neutral-800/40">
                Zero bookings recorded in this period across all registered venues.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
