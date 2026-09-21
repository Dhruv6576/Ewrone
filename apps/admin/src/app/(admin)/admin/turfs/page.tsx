'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  Building2,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  Clock,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  MapPin,
  Mail,
  Store
} from 'lucide-react';

interface TurfQueueItem {
  id: string;
  master_owner_id: string;
  business_name: string;
  owner_email: string;
  name: string;
  slug: string;
  city: string;
  address_text: string;
  approval_status: 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended';
  created_at: string;
  updated_at: string;
  total_count: number;
}

export default function AdminTurfQueuePage() {
  const [turfs, setTurfs] = useState<TurfQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const [totalCount, setTotalCount] = useState(0);

  // Review Modal state
  const [activeTurf, setActiveTurf] = useState<TurfQueueItem | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected' | 'suspended'>('approved');
  const [reason, setReason] = useState('');

  const fetchTurfs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createBrowserClient('admin');
      const { data, error: rpcErr } = await supabase.rpc('admin_get_turf_queue', {
        p_status: statusFilter === 'all' ? null : statusFilter,
        p_limit: pageSize,
        p_offset: page * pageSize
      });

      if (rpcErr) throw rpcErr;

      const items = (data || []) as TurfQueueItem[];
      setTurfs(items);
      setTotalCount(items.length > 0 ? Number(items[0].total_count) : 0);
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to fetch turf approval queue'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    fetchTurfs();
  }, [fetchTurfs]);

  const handleReviewSubmit = async () => {
    if (!activeTurf) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const supabase = createBrowserClient('admin');
      const { error: rpcErr } = await supabase.rpc('admin_review_turf', {
        p_turf_id: activeTurf.id,
        p_decision: decision,
        p_reason: reason.trim() || `Administrative ${decision} by platform admin`
      });

      if (rpcErr) throw rpcErr;

      setActiveTurf(null);
      setReason('');
      await fetchTurfs();
    } catch (err: unknown) {
      setActionError(extractDatabaseError(err, 'Failed to execute turf review decision'));
    } finally {
      setActionLoading(false);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" /> Approved
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock className="w-3.5 h-3.5" /> Pending Review
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3.5 h-3.5" /> Rejected
          </span>
        );
      case 'suspended':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <AlertOctagon className="w-3.5 h-3.5" /> Suspended
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            Draft
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
            <Building2 className="w-6 h-6 text-emerald-400" />
            Turf Approval Queue
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Review, approve, reject, and suspend venue listings across all platform tenants.
          </p>
        </div>
        <button
          onClick={() => fetchTurfs()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-sm font-medium transition-colors self-start"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh Queue
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-800/80">
        {['all', 'pending', 'approved', 'rejected', 'suspended', 'draft'].map((status) => (
          <button
            key={status}
            onClick={() => {
              setStatusFilter(status);
              setPage(0);
            }}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all whitespace-nowrap ${
              statusFilter === status
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
            }`}
          >
            {status === 'all' ? 'All Venues' : status}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Table / List */}
      <div className="glass-panel rounded-2xl border border-slate-800/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-900/40 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                <th className="p-4">Venue & City</th>
                <th className="p-4">Master Owner & Email</th>
                <th className="p-4">Status</th>
                <th className="p-4">Created / Updated</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm">
              {loading && turfs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-500" />
                    Loading turf approval queue...
                  </td>
                </tr>
              ) : turfs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    No venues found matching the selected filter ({statusFilter}).
                  </td>
                </tr>
              ) : (
                turfs.map((turf) => (
                  <tr key={turf.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="p-4">
                      <div className="font-semibold text-white">{turf.name}</div>
                      <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <MapPin className="w-3 h-3 text-slate-500" />
                        {turf.city || 'Unspecified'} {turf.address_text ? `• ${turf.address_text}` : ''}
                      </div>
                      <div className="text-[11px] text-slate-600 font-mono mt-0.5">{turf.id}</div>
                    </td>
                    <td className="p-4">
                      <div className="font-medium text-slate-200 flex items-center gap-1.5">
                        <Store className="w-3.5 h-3.5 text-slate-400" />
                        {turf.business_name}
                      </div>
                      <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <Mail className="w-3 h-3 text-slate-500" />
                        {turf.owner_email || 'No email attached'}
                      </div>
                    </td>
                    <td className="p-4">{statusBadge(turf.approval_status)}</td>
                    <td className="p-4 text-xs text-slate-400">
                      <div>Created: {new Date(turf.created_at).toLocaleDateString()}</div>
                      <div className="text-slate-500 mt-0.5">Updated: {new Date(turf.updated_at).toLocaleTimeString()}</div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {turf.approval_status !== 'approved' && (
                          <button
                            onClick={() => {
                              setActiveTurf(turf);
                              setDecision('approved');
                              setReason('');
                              setActionError(null);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold transition-colors"
                          >
                            Approve
                          </button>
                        )}
                        {turf.approval_status === 'pending' && (
                          <button
                            onClick={() => {
                              setActiveTurf(turf);
                              setDecision('rejected');
                              setReason('');
                              setActionError(null);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold transition-colors"
                          >
                            Reject
                          </button>
                        )}
                        {turf.approval_status === 'approved' && (
                          <button
                            onClick={() => {
                              setActiveTurf(turf);
                              setDecision('suspended');
                              setReason('');
                              setActionError(null);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/20 text-xs font-semibold transition-colors"
                          >
                            Suspend
                          </button>
                        )}
                      </div>
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
            Showing <span className="text-slate-200 font-semibold">{turfs.length > 0 ? page * pageSize + 1 : 0}</span> to{' '}
            <span className="text-slate-200 font-semibold">{Math.min((page + 1) * pageSize, totalCount)}</span> of{' '}
            <span className="text-slate-200 font-semibold">{totalCount}</span> venues
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

      {/* Review Modal */}
      {activeTurf && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full glass-panel rounded-2xl border border-slate-800 p-6 space-y-5 shadow-2xl">
            <div>
              <h3 className="text-lg font-bold text-white capitalize">
                {decision} Venue Listing
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Executing state transition for &quot;{activeTurf.name}&quot; owned by {activeTurf.business_name}.
              </p>
            </div>

            {actionError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {actionError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">Decision Target</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['approved', 'rejected', 'suspended'] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDecision(d)}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold capitalize border transition-all ${
                        decision === d
                          ? d === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : d === 'rejected'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Reason / Audit Log Note
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="State the reason for this administrative review decision..."
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setActiveTurf(null)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReviewSubmit}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold transition-colors flex items-center gap-2"
              >
                {actionLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Confirm Decision
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
