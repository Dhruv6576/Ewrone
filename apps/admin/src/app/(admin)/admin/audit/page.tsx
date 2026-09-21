'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  FileText,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Clock,
  User,
  Shield,
  Tag,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface AuditEvent {
  id: string;
  master_owner_id: string | null;
  turf_id: string | null;
  actor_user_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_data: any;
  after_data: any;
  reason: string | null;
  created_at: string;
}

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 15;
  const [hasMore, setHasMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchAuditEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createBrowserClient('admin');
      // Unfiltered system-wide audit trail: p_turf_id => null
      const { data, error: rpcErr } = await supabase.rpc('get_audit_events', {
        p_turf_id: null,
        p_limit: pageSize + 1,
        p_offset: page * pageSize
      });

      if (rpcErr) throw rpcErr;

      const items = (data || []) as AuditEvent[];
      if (items.length > pageSize) {
        setHasMore(true);
        setEvents(items.slice(0, pageSize));
      } else {
        setHasMore(false);
        setEvents(items);
      }
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to fetch platform audit log'));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchAuditEvents();
  }, [fetchAuditEvents]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <FileText className="w-6 h-6 text-emerald-400" />
            Platform-Wide Audit Trail
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Authoritative, append-only chronological record of all administrative, configuration, and transactional events across tenants.
          </p>
        </div>
        <button
          onClick={() => fetchAuditEvents()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 text-sm font-medium transition-colors self-start"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh Log
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Audit Events Table */}
      <div className="glass-panel rounded-2xl border border-slate-800/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-900/40 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                <th className="p-4">Timestamp</th>
                <th className="p-4">Action</th>
                <th className="p-4">Entity</th>
                <th className="p-4">Actor</th>
                <th className="p-4">Scope (Owner / Turf)</th>
                <th className="p-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm font-mono">
              {loading && events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500 font-sans">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-500" />
                    Loading platform audit log...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500 font-sans">
                    No audit records found in the platform ledger.
                  </td>
                </tr>
              ) : (
                events.map((ev) => {
                  const isExpanded = expandedId === ev.id;
                  return (
                    <tr key={ev.id} className="hover:bg-slate-900/40 transition-colors group">
                      <td className="p-4 text-xs text-slate-400 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-sans">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          {new Date(ev.created_at).toLocaleDateString()}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {new Date(ev.created_at).toLocaleTimeString()}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-xs font-semibold border border-emerald-500/20">
                          {ev.action}
                        </span>
                        {ev.reason && (
                          <div className="text-[11px] text-slate-400 mt-1 font-sans line-clamp-1">
                            {ev.reason}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-xs">
                        <div className="text-white font-sans font-medium">{ev.entity_type}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[120px]">{ev.entity_id || '—'}</div>
                      </td>
                      <td className="p-4 text-xs">
                        <div className="flex items-center gap-1.5 font-sans capitalize text-slate-300">
                          {ev.actor_type === 'user' ? <User className="w-3.5 h-3.5 text-slate-400" /> : <Shield className="w-3.5 h-3.5 text-emerald-400" />}
                          {ev.actor_type}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[120px]">{ev.actor_user_id || 'System'}</div>
                      </td>
                      <td className="p-4 text-xs text-slate-400">
                        <div>MO: {ev.master_owner_id ? ev.master_owner_id.substring(0, 8) + '...' : 'Global'}</div>
                        <div className="text-slate-500 mt-0.5">Turf: {ev.turf_id ? ev.turf_id.substring(0, 8) + '...' : 'None'}</div>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => toggleExpand(ev.id)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-sans transition-colors inline-flex items-center gap-1"
                        >
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          Payload
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Expanded Payload Section */}
        {expandedId && (
          <div className="p-4 border-t border-slate-800 bg-slate-950/80">
            {(() => {
              const selected = events.find((e) => e.id === expandedId);
              if (!selected) return null;
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">
                      Before State
                    </div>
                    <pre className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 overflow-x-auto max-h-48 font-mono">
                      {JSON.stringify(selected.before_data, null, 2) || 'null'}
                    </pre>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">
                      After State / Payload
                    </div>
                    <pre className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-emerald-400/90 overflow-x-auto max-h-48 font-mono">
                      {JSON.stringify(selected.after_data, null, 2) || 'null'}
                    </pre>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-900/30 flex items-center justify-between text-xs text-slate-400 font-sans">
          <div>
            Showing records {page * pageSize + 1} to {page * pageSize + events.length}
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
              disabled={!hasMore}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 transition-colors text-slate-300"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
