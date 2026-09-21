'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  Wallet,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  RotateCcw,
  Building,
  CreditCard
} from 'lucide-react';

interface PayoutItem {
  id: string;
  master_owner_id: string;
  business_name: string;
  financial_account_id: string;
  provider: string;
  provider_account_id: string;
  masked_bank_label: string;
  currency: string;
  amount_minor: number;
  status: 'pending' | 'processing' | 'settled' | 'failed';
  provider_settlement_id: string | null;
  idempotency_key: string;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  settled_at: string | null;
  total_count: number;
}

export default function AdminPayoutsPage() {
  const [activeTab, setActiveTab] = useState<'payouts' | 'refunds'>('payouts');
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const [totalCount, setTotalCount] = useState(0);

  // Settle Modal state
  const [activePayout, setActivePayout] = useState<PayoutItem | null>(null);
  const [settlementId, setSettlementId] = useState('');
  const [settleLoading, setSettleLoading] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settleSuccess, setSettleSuccess] = useState<string | null>(null);

  // Refund Form state
  const [refundPaymentId, setRefundPaymentId] = useState('');
  const [refundAmountRupees, setRefundAmountRupees] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundSuccess, setRefundSuccess] = useState<string | null>(null);

  const fetchPayouts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createBrowserClient('admin');
      const { data, error: rpcErr } = await supabase.rpc('admin_get_payouts', {
        p_status: statusFilter === 'all' ? null : statusFilter,
        p_limit: pageSize,
        p_offset: page * pageSize
      });

      if (rpcErr) throw rpcErr;

      const items = (data || []) as PayoutItem[];
      setPayouts(items);
      setTotalCount(items.length > 0 ? Number(items[0].total_count) : 0);
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to fetch payouts'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    if (activeTab === 'payouts') {
      fetchPayouts();
    }
  }, [activeTab, fetchPayouts]);

  const handleSettleSubmit = async () => {
    if (!activePayout) return;
    setSettleLoading(true);
    setSettleError(null);
    setSettleSuccess(null);
    try {
      const supabase = createBrowserClient('admin');
      const provId = settlementId.trim() || `set_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const { error: rpcErr } = await supabase.rpc('settle_owner_payout', {
        p_payout_id: activePayout.id,
        p_provider_settlement_id: provId
      });

      if (rpcErr) throw rpcErr;

      setSettleSuccess(`Payout settled successfully with reference: ${provId}`);
      setActivePayout(null);
      setSettlementId('');
      await fetchPayouts();
    } catch (err: unknown) {
      setSettleError(extractDatabaseError(err, 'Failed to settle payout'));
    } finally {
      setSettleLoading(false);
    }
  };

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRefundLoading(true);
    setRefundError(null);
    setRefundSuccess(null);
    try {
      const amountRupees = parseFloat(refundAmountRupees);
      if (isNaN(amountRupees) || amountRupees <= 0) {
        throw new Error('Please enter a valid positive refund amount');
      }
      const amountMinor = Math.round(amountRupees * 100);

      const supabase = createBrowserClient('admin');
      const { data, error: rpcErr } = await supabase.rpc('request_refund', {
        p_payment_id: refundPaymentId.trim(),
        p_amount_minor: amountMinor,
        p_reason: refundReason.trim() || 'Administrative refund initiated via platform admin'
      });

      if (rpcErr) throw rpcErr;

      setRefundSuccess(`Refund issued successfully: ${JSON.stringify(data)}`);
      setRefundPaymentId('');
      setRefundAmountRupees('');
      setRefundReason('');
    } catch (err: any) {
      setRefundError(err.message || 'Failed to issue refund');
    } finally {
      setRefundLoading(false);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'settled':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" /> Settled
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3.5 h-3.5" /> Pending Settlement
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <Wallet className="w-6 h-6 text-emerald-400" />
            Payout Release & Refunds
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Authorize and settle owner payouts, or issue administrative player refunds.
          </p>
        </div>
      </div>

      {/* Main Tab Switcher */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => setActiveTab('payouts')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'payouts'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ArrowUpRight className="w-4 h-4" />
          Owner Payouts Queue
        </button>
        <button
          onClick={() => setActiveTab('refunds')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'refunds'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          Issue Administrative Refund
        </button>
      </div>

      {settleSuccess && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{settleSuccess}</span>
        </div>
      )}

      {/* TAB 1: Payouts Queue */}
      {activeTab === 'payouts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 overflow-x-auto">
              {['all', 'pending', 'settled', 'failed'].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setStatusFilter(s);
                    setPage(0);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
                    statusFilter === s
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {s === 'all' ? 'All Payouts' : s}
                </button>
              ))}
            </div>
            <button
              onClick={() => fetchPayouts()}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-xs font-medium transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="glass-panel rounded-2xl border border-slate-800/80 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-900/40 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                    <th className="p-4">Master Owner</th>
                    <th className="p-4">Account / Bank</th>
                    <th className="p-4">Amount</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Created / Settled</th>
                    <th className="p-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-sm">
                  {loading && payouts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-500" />
                        Loading payouts...
                      </td>
                    </tr>
                  ) : payouts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500">
                        No owner payouts recorded in the system.
                      </td>
                    </tr>
                  ) : (
                    payouts.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-900/40 transition-colors">
                        <td className="p-4">
                          <div className="font-semibold text-white flex items-center gap-1.5">
                            <Building className="w-3.5 h-3.5 text-slate-400" />
                            {p.business_name}
                          </div>
                          <div className="text-[11px] text-slate-600 font-mono mt-0.5">{p.id}</div>
                        </td>
                        <td className="p-4">
                          <div className="text-slate-200 text-xs flex items-center gap-1.5">
                            <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                            {p.masked_bank_label || p.provider_account_id || 'Primary Account'}
                          </div>
                          <div className="text-[11px] text-slate-500 uppercase">{p.provider || 'razorpay'}</div>
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-white text-base">
                            ₹{(p.amount_minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-[11px] text-slate-500">{p.currency}</div>
                        </td>
                        <td className="p-4">{statusBadge(p.status)}</td>
                        <td className="p-4 text-xs text-slate-400">
                          <div>Created: {new Date(p.created_at).toLocaleDateString()}</div>
                          {p.settled_at && (
                            <div className="text-emerald-400/80 mt-0.5">
                              Settled: {new Date(p.settled_at).toLocaleDateString()}
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          {p.status === 'pending' ? (
                            <button
                              onClick={() => {
                                setActivePayout(p);
                                setSettlementId('');
                                setSettleError(null);
                              }}
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold transition-colors"
                            >
                              Settle Payout
                            </button>
                          ) : (
                            <span className="text-xs text-slate-600 font-mono">
                              {p.provider_settlement_id || 'Settled'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="p-4 border-t border-slate-800/80 bg-slate-900/30 flex items-center justify-between text-xs text-slate-400">
              <div>
                Showing <span className="text-slate-200 font-semibold">{payouts.length > 0 ? page * pageSize + 1 : 0}</span> to{' '}
                <span className="text-slate-200 font-semibold">{Math.min((page + 1) * pageSize, totalCount)}</span> of{' '}
                <span className="text-slate-200 font-semibold">{totalCount}</span> payouts
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 transition-colors text-slate-300"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 font-medium text-slate-300">Page {page + 1}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={(page + 1) * pageSize >= totalCount}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 transition-colors text-slate-300"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Administrative Refund Form */}
      {activeTab === 'refunds' && (
        <div className="max-w-2xl glass-panel rounded-2xl border border-slate-800/80 p-6 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-emerald-400" />
              Administrative Player Refund
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Directly invoke <code className="text-emerald-400 font-mono">public.request_refund</code> with root platform administrator authorization.
            </p>
          </div>

          {refundError && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{refundError}</span>
            </div>
          )}

          {refundSuccess && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-3">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span className="font-mono break-all">{refundSuccess}</span>
            </div>
          )}

          <form onSubmit={handleRefundSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">Payment UUID</label>
              <input
                type="text"
                required
                value={refundPaymentId}
                onChange={(e) => setRefundPaymentId(e.target.value)}
                placeholder="e.g. 11111111-2222-3333-4444-555555555555"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">Refund Amount (₹ INR)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={refundAmountRupees}
                onChange={(e) => setRefundAmountRupees(e.target.value)}
                placeholder="e.g. 1500.00"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">Reason for Refund</label>
              <textarea
                required
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="State the administrative reason (e.g., Weather cancellation, platform dispute resolution)..."
                rows={3}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={refundLoading}
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 text-xs font-bold transition-colors flex items-center justify-center gap-2"
            >
              {refundLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
              Issue Refund via PostgREST RPC
            </button>
          </form>
        </div>
      )}

      {/* Settle Payout Modal */}
      {activePayout && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full glass-panel rounded-2xl border border-slate-800 p-6 space-y-5 shadow-2xl">
            <div>
              <h3 className="text-lg font-bold text-white">Settle Owner Payout</h3>
              <p className="text-xs text-slate-400 mt-1">
                Settling payout of <span className="text-white font-bold">₹{(activePayout.amount_minor / 100).toFixed(2)}</span> for {activePayout.business_name}.
              </p>
            </div>

            {settleError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {settleError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Provider Settlement Reference ID
                </label>
                <input
                  type="text"
                  value={settlementId}
                  onChange={(e) => setSettlementId(e.target.value)}
                  placeholder="e.g. set_rzp_99881122 or leave blank to autogenerate"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setActivePayout(null)}
                disabled={settleLoading}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSettleSubmit}
                disabled={settleLoading}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold transition-colors flex items-center gap-2"
              >
                {settleLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Confirm Settlement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
