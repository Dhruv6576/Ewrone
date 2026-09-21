'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  FileText,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  AlertCircle,
  Building2,
  Calendar,
  User,
  Activity,
  Layers,
  Clock,
  Eye,
  EyeOff
} from 'lucide-react';

interface AuditEvent {
  id: string;
  master_owner_id: string;
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

interface TurfOption {
  id: string;
  name: string;
  slug: string;
}

export default function AuditClient() {
  const supabase = createBrowserClient('owner');

  // Capability and venue state
  const [loading, setLoading] = useState(true);
  const [fetchingEvents, setFetchingEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isOwnerOrAdmin, setIsOwnerOrAdmin] = useState(false);
  const [turfs, setTurfs] = useState<TurfOption[]>([]);
  const [selectedTurfId, setSelectedTurfId] = useState<string>(''); // '' means All Turfs (null)

  // Events & Pagination
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [hasMore, setHasMore] = useState(false);

  // Payload collapse state per event ID
  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, boolean>>({});

  // 1. Initial capability resolution and turf discovery
  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const { data: caps, error: capsErr } = await supabase.rpc('get_my_capabilities');
        if (capsErr) throw capsErr;

        const ownerOrAdmin = caps?.is_owner || caps?.is_admin;
        setIsOwnerOrAdmin(ownerOrAdmin);

        if (ownerOrAdmin) {
          // Fetch all turfs for this master owner
          const { data: turfData, error: turfErr } = await supabase
            .from('turfs')
            .select('id, name, slug')
            .eq('master_owner_id', caps.master_owner_id)
            .order('name');

          if (turfErr) throw turfErr;
          setTurfs(turfData || []);
          setSelectedTurfId(''); // Master owner can view all turfs by default
        } else {
          // Staff member: must have audit.read
          const assignedTurfIds: string[] = caps?.turf_ids || [];
          if (assignedTurfIds.length === 0) {
            setTurfs([]);
            setError('No venues assigned to your employee account.');
            return;
          }

          // Probe each assigned turf with get_audit_events to confirm audit.read capability
          const validTurfs: TurfOption[] = [];
          for (const turfId of assignedTurfIds) {
            const { error: probeErr } = await supabase.rpc('get_audit_events', {
              p_turf_id: turfId,
              p_limit: 1,
              p_offset: 0
            });
            if (!probeErr) {
              // Fetch name for this turf
              const { data: tRow } = await supabase
                .from('turfs')
                .select('id, name, slug')
                .eq('id', turfId)
                .single();
              if (tRow) validTurfs.push(tRow);
            }
          }

          setTurfs(validTurfs);
          if (validTurfs.length > 0) {
            setSelectedTurfId(validTurfs[0].id); // Default to first authorized turf
          } else {
            setError('Your employee profile does not possess audit.read capability on any assigned venues.');
          }
        }
      } catch (err: unknown) {
        console.error('Audit initialization error:', err);
        setError(extractDatabaseError(err, 'Failed to initialize audit events'));
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  // 2. Fetch audit events based on selected turf and pagination
  const fetchAuditEvents = useCallback(async () => {
    setFetchingEvents(true);
    setError(null);
    try {
      const p_turf_id = selectedTurfId ? selectedTurfId : null;
      const p_offset = (page - 1) * pageSize;
      const p_limit = pageSize + 1; // Fetch 1 extra to determine hasMore deterministically

      const { data, error: rpcErr } = await supabase.rpc('get_audit_events', {
        p_turf_id,
        p_limit,
        p_offset
      });

      if (rpcErr) throw rpcErr;

      const results = (data || []) as AuditEvent[];
      if (results.length > pageSize) {
        setHasMore(true);
        setEvents(results.slice(0, pageSize));
      } else {
        setHasMore(false);
        setEvents(results);
      }
    } catch (err: unknown) {
      console.error('Failed to fetch audit events:', err);
      setError(extractDatabaseError(err, 'Failed to fetch audit events'));
      setEvents([]);
    } finally {
      setFetchingEvents(false);
    }
  }, [selectedTurfId, page, pageSize]);

  useEffect(() => {
    if (!loading && (isOwnerOrAdmin || selectedTurfId)) {
      fetchAuditEvents();
    }
  }, [fetchAuditEvents, loading, isOwnerOrAdmin, selectedTurfId]);

  const togglePayload = (id: string) => {
    setExpandedPayloads(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleTurfChange = (newTurfId: string) => {
    setSelectedTurfId(newTurfId);
    setPage(1); // Reset to page 1 on filter change
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            <FileText className="w-6 h-6 text-emerald-400" />
            Audit Trail & Event Log
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Immutable log of business actions, pricing updates, and venue schedule overrides.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchAuditEvents()}
            disabled={fetchingEvents}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 hover:border-slate-700 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${fetchingEvents ? 'animate-spin text-emerald-400' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter and Controls Toolbar */}
      <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <Filter className="w-3.5 h-3.5 text-emerald-400" />
            Scope Filter:
          </div>

          <select
            value={selectedTurfId}
            onChange={(e) => handleTurfChange(e.target.value)}
            disabled={loading || (!isOwnerOrAdmin && turfs.length <= 1)}
            className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500 transition-all disabled:opacity-50"
          >
            {isOwnerOrAdmin && (
              <option value="">All Venues (Tenant-wide)</option>
            )}
            {turfs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Per Page:</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        {/* Current Filter Status Badge */}
        <div className="text-xs text-slate-400 flex items-center gap-2">
          <span>Showing page {page}</span>
          <span className="text-slate-600">•</span>
          <span className="font-mono text-emerald-400">{events.length}</span>
          <span>events rendered</span>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/30 flex items-start gap-3 text-red-400">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-semibold text-sm mb-0.5">Audit Query Notice</p>
            <p className="text-slate-300">{error}</p>
          </div>
        </div>
      )}

      {/* Events Table / List */}
      <div className="rounded-2xl bg-slate-950/40 border border-slate-800/80 overflow-hidden">
        {loading || fetchingEvents ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
            <span className="text-xs font-medium">Querying authoritative audit trail...</span>
          </div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
            <Layers className="w-8 h-8 text-slate-600" />
            <p className="text-sm font-semibold text-slate-300">No audit events found</p>
            <p className="text-xs text-slate-500 max-w-sm">
              There are no recorded business actions for the selected venue filter and pagination range.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {events.map((evt) => {
              const isExpanded = expandedPayloads[evt.id] || false;
              const hasPayload = evt.before_data !== null || evt.after_data !== null;

              return (
                <div key={evt.id} className="p-4 sm:p-5 hover:bg-slate-900/30 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-2">
                    {/* Primary metadata row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-emerald-950/70 text-emerald-400 border border-emerald-500/30">
                        {evt.action}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300">
                        {evt.actor_type}
                      </span>
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        on <span className="font-semibold text-slate-200">{evt.entity_type}</span>
                        {evt.entity_id && (
                          <span className="font-mono text-[10px] text-slate-500 bg-slate-900 px-1 rounded">
                            {evt.entity_id.substring(0, 8)}...
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Timestamp */}
                    <div className="text-xs text-slate-500 flex items-center gap-1.5 shrink-0 font-mono">
                      <Clock className="w-3 h-3 text-slate-600" />
                      {new Date(evt.created_at).toLocaleString()}
                    </div>
                  </div>

                  {/* Reason if available */}
                  {evt.reason && (
                    <p className="text-xs text-slate-300 mb-2 pl-0.5">
                      <span className="text-slate-500 font-medium">Reason: </span>
                      {evt.reason}
                    </p>
                  )}

                  {/* Actor ID & Turf details */}
                  <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 mb-3 pl-0.5">
                    {evt.actor_user_id && (
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        Actor ID: <span className="font-mono text-slate-400">{evt.actor_user_id}</span>
                      </span>
                    )}
                    {evt.turf_id && (
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3" />
                        Turf ID: <span className="font-mono text-slate-400">{evt.turf_id.substring(0, 8)}...</span>
                      </span>
                    )}
                  </div>

                  {/* Collapsible Payload Inspection */}
                  {hasPayload && (
                    <div className="pt-2">
                      <button
                        onClick={() => togglePayload(evt.id)}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-400 font-medium transition-colors"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            Hide Payload Diffs
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            Inspect Payload (before / after data)
                          </>
                        )}
                      </button>

                      {isExpanded && (
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-900">
                          {/* Before Data */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Before Data
                            </span>
                            <pre className="text-[11px] font-mono p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 overflow-x-auto max-h-56 leading-relaxed">
                              {evt.before_data !== null
                                ? JSON.stringify(evt.before_data, null, 2)
                                : '<null>'}
                            </pre>
                          </div>

                          {/* After Data */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                              After Data
                            </span>
                            <pre className="text-[11px] font-mono p-3 rounded-xl bg-slate-950 border border-slate-800 text-emerald-300/90 overflow-x-auto max-h-56 leading-relaxed">
                              {evt.after_data !== null
                                ? JSON.stringify(evt.after_data, null, 2)
                                : '<null>'}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Bar */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between gap-4">
          <div className="text-xs text-slate-400 font-medium">
            Page <span className="text-white font-bold">{page}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || fetchingEvents}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 disabled:opacity-40 disabled:pointer-events-none transition-all"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>

            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore || fetchingEvents}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 disabled:opacity-40 disabled:pointer-events-none transition-all"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
