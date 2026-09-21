'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  BadgePercent,
  Clock,
  Calendar as CalendarIcon,
  Building2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
  Plus,
  ShieldAlert,
  Layers,
  Info,
  Banknote,
  Edit2,
  Power,
  Calculator,
  ChevronDown
} from 'lucide-react';

export interface TurfItem {
  id: string;
  name: string;
  slug: string;
  city: string;
  timezone: string;
}

export interface ResourceItem {
  id: string;
  turf_id: string;
  name: string;
  active: boolean;
  booking_increment_minutes: number;
  minimum_duration_minutes: number;
  maximum_duration_minutes: number;
}

export interface PricingRule {
  id: string;
  master_owner_id: string;
  turf_id: string;
  resource_id: string;
  priority: number;
  valid_from: string;
  valid_until: string | null;
  iso_weekdays: number[];
  starts_local: string;
  ends_local: string;
  amount_per_increment_minor: number;
  currency: string;
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface QuoteResult {
  total_minor: number;
  currency: string;
  duration_minutes: number;
  pricing_snapshot?: {
    increments_count: number;
    increment_minutes: number;
    increments: Array<{
      starts_at: string;
      ends_at: string;
      amount_minor: number;
      rule_id: string;
      priority: number;
    }>;
  };
}

// B5 exact error mapping with prefix-before-colon rule
export function mapPricingError(err: unknown): string {
  if (!err) return 'An unexpected error occurred';
  const errObj = err as { message?: string; code?: string; details?: string };
  const rawMessage = typeof err === 'string' ? err : errObj.message || '';
  const prefix = rawMessage.includes(':') ? rawMessage.split(':')[0].trim() : rawMessage.trim();
  const detail = rawMessage.includes(':') ? rawMessage.substring(rawMessage.indexOf(':') + 1).trim() : '';

  switch (prefix) {
    case 'INVALID_TIME_RANGE':
      return detail || 'ends_local must be strictly after starts_local';
    case 'INVALID_DATE_RANGE':
      return detail || 'valid_until must be on or after valid_from';
    case 'INVALID_AMOUNT':
      return detail || 'amount_per_increment_minor cannot be negative';
    case 'ISO_WEEKDAYS_REQUIRED':
      return detail || 'At least one ISO weekday must be specified';
    case 'PRICING_RULE_OVERLAP':
      return detail
        ? `PRICING_RULE_OVERLAP: ${detail}`
        : 'An active rule with this priority already covers this time window. Adjust priority or time range.';
    case 'RESOURCE_NOT_FOUND':
    case 'RULE_NOT_FOUND':
    case 'RESOURCE_MISMATCH':
    case 'VENUE_ARCHIVED':
    case 'PERMISSION_DENIED':
    case 'AUTH_REQUIRED':
    case 'VERSION_CONFLICT':
      return rawMessage;
    default:
      if (errObj.code === '40900') return rawMessage;
      return rawMessage || 'Pricing operation failed';
  }
}

const ISO_DAY_NAMES: { [key: number]: string } = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun'
};

function formatCurrency(amountMinor: number, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amountMinor / 100);
}

function normalizeTimeString(timeStr: string): string {
  if (!timeStr) return '00:00:00';
  const parts = timeStr.split(':');
  const hh = parts[0]?.padStart(2, '0') || '00';
  const mm = parts[1]?.padStart(2, '0') || '00';
  const ss = parts[2]?.padStart(2, '0') || '00';
  return `${hh}:${mm}:${ss}`;
}

export default function PricingClient() {
  const supabase = useMemo(() => createBrowserClient('owner'), []);

  // Capabilities & Auth
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loadingCaps, setLoadingCaps] = useState(true);

  // Venues & Resources (Court selection)
  const [turfs, setTurfs] = useState<TurfItem[]>([]);
  const [selectedTurfId, setSelectedTurfId] = useState<string>('');
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');

  // Pricing Rules
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [filterActiveOnly, setFilterActiveOnly] = useState(false);

  // Notifications & Errors
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modal State for Rule Upsert
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const [submittingRule, setSubmittingRule] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Form Fields
  const [formValidFrom, setFormValidFrom] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [formValidUntil, setFormValidUntil] = useState<string>('');
  const [formIsoWeekdays, setFormIsoWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [formStartsLocal, setFormStartsLocal] = useState<string>('06:00');
  const [formEndsLocal, setFormEndsLocal] = useState<string>('23:59');
  const [formAmountMajor, setFormAmountMajor] = useState<string>('1500');
  const [formPriority, setFormPriority] = useState<number>(0);
  const [formActive, setFormActive] = useState<boolean>(true);

  // Quote Simulator / Verifier State
  const [simDate, setSimDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [simStartTime, setSimStartTime] = useState<string>('10:00');
  const [simDurationMinutes, setSimDurationMinutes] = useState<number>(60);
  const [simQuote, setSimQuote] = useState<QuoteResult | null>(null);
  const [simulatingQuote, setSimulatingQuote] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  // Gating mirror: B3 requirement
  const canRead = isOwner || capabilities.includes('pricing.read');
  const canEdit = isOwner || capabilities.includes('pricing.edit');

  const selectedTurf = useMemo(
    () => turfs.find(t => t.id === selectedTurfId),
    [turfs, selectedTurfId]
  );

  const selectedResource = useMemo(
    () => resources.find(r => r.id === selectedResourceId),
    [resources, selectedResourceId]
  );

  // Toast timer
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // 1. Initial Load: Capabilities & Turfs
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        setLoadingCaps(true);
        const { data: capsData, error: capsErr } = await supabase.rpc('get_my_capabilities');
        if (cancelled) return;
        if (capsErr) throw capsErr;

        const capsList = capsData?.capabilities || [];
        setCapabilities(capsList);
        setIsOwner(Boolean(capsData?.is_owner || capsData?.is_admin));

        let query = supabase
          .from('turfs')
          .select('id, name, slug, city, timezone')
          .is('archived_at', null)
          .order('name');

        if (capsData?.master_owner_id) {
          query = query.eq('master_owner_id', capsData.master_owner_id);
        }

        const { data: turfData, error: turfErr } = await query;
        if (cancelled) return;
        if (turfErr) throw turfErr;

        const fetchedTurfs = (turfData as TurfItem[]) || [];
        setTurfs(fetchedTurfs);
        if (fetchedTurfs.length > 0) {
          setSelectedTurfId(fetchedTurfs[0].id);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setGeneralError(extractDatabaseError(err, 'Failed to initialize context'));
        }
      } finally {
        if (!cancelled) {
          setLoadingCaps(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // 2. Fetch Resources for Selected Turf
  useEffect(() => {
    if (!selectedTurfId) {
      setResources([]);
      setSelectedResourceId('');
      return;
    }

    let cancelled = false;
    async function loadResources() {
      try {
        const { data, error } = await supabase
          .from('resources')
          .select('id, turf_id, name, active, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes')
          .eq('turf_id', selectedTurfId)
          .order('name');

        if (cancelled) return;
        if (error) throw error;

        const resList = (data as ResourceItem[]) || [];
        setResources(resList);
        if (resList.length > 0) {
          setSelectedResourceId(resList[0].id);
        } else {
          setSelectedResourceId('');
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setGeneralError(extractDatabaseError(err, 'Failed to load court resources'));
        }
      }
    }

    loadResources();
    return () => {
      cancelled = true;
    };
  }, [selectedTurfId, supabase]);

  // 3. PostgREST Read of public.pricing_rules for Selected Resource
  // Gated on canRead (B3: "when canRead is false render an explicit 'Access Restricted' notice instead of issuing a query")
  const loadRules = useCallback(async () => {
    if (!selectedResourceId || !canRead) {
      setRules([]);
      return;
    }

    try {
      setLoadingRules(true);
      setGeneralError(null);

      let query = supabase
        .from('pricing_rules')
        .select('*')
        .eq('resource_id', selectedResourceId)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (filterActiveOnly) {
        query = query.eq('active', true);
      }

      const { data, error } = await query;
      if (error) throw error;

      setRules((data as PricingRule[]) || []);
    } catch (err: unknown) {
      const msg = mapPricingError(err);
      setGeneralError(msg);
    } finally {
      setLoadingRules(false);
    }
  }, [selectedResourceId, canRead, filterActiveOnly, supabase]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // Open Add Rule Modal
  const handleOpenAdd = () => {
    setEditingRule(null);
    setFormValidFrom(new Date().toISOString().split('T')[0]);
    setFormValidUntil('');
    setFormIsoWeekdays([1, 2, 3, 4, 5, 6, 7]);
    setFormStartsLocal('06:00');
    setFormEndsLocal('23:59');
    setFormAmountMajor('1500');
    setFormPriority(0);
    setFormActive(true);
    setModalError(null);
    setModalOpen(true);
  };

  // Open Edit Rule Modal (with rule.version pre-loaded for optimistic locking)
  const handleOpenEdit = (rule: PricingRule) => {
    setEditingRule(rule);
    setFormValidFrom(rule.valid_from);
    setFormValidUntil(rule.valid_until || '');
    setFormIsoWeekdays(rule.iso_weekdays || [1, 2, 3, 4, 5, 6, 7]);
    setFormStartsLocal(rule.starts_local.substring(0, 5));
    setFormEndsLocal(rule.ends_local.substring(0, 5));
    setFormAmountMajor((rule.amount_per_increment_minor / 100).toString());
    setFormPriority(rule.priority);
    setFormActive(rule.active);
    setModalError(null);
    setModalOpen(true);
  };

  // Submit Upsert (Create or Update)
  const handleSubmitRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedResourceId) return;

    try {
      setSubmittingRule(true);
      setModalError(null);

      const parsedMajor = parseFloat(formAmountMajor);
      if (isNaN(parsedMajor) || parsedMajor < 0) {
        setModalError('amount_per_increment_minor cannot be negative');
        setSubmittingRule(false);
        return;
      }
      const amountMinor = Math.round(parsedMajor * 100);

      if (formIsoWeekdays.length === 0) {
        setModalError('At least one ISO weekday must be specified');
        setSubmittingRule(false);
        return;
      }

      const startsFormatted = normalizeTimeString(formStartsLocal);
      const endsFormatted = normalizeTimeString(formEndsLocal);

      // Optimistic concurrency (B6): send rule.version as p_expected_version
      const expectedVersion = editingRule ? editingRule.version : null;

      const { data, error } = await supabase.rpc('upsert_pricing_rule', {
        p_rule_id: editingRule ? editingRule.id : null,
        p_resource_id: editingRule ? editingRule.resource_id : selectedResourceId,
        p_valid_from: formValidFrom,
        p_valid_until: formValidUntil.trim() ? formValidUntil.trim() : null,
        p_iso_weekdays: formIsoWeekdays,
        p_starts_local: startsFormatted,
        p_ends_local: endsFormatted,
        p_amount_per_increment_minor: amountMinor,
        p_priority: formPriority,
        p_active: formActive,
        p_expected_version: expectedVersion
      });

      if (error) {
        // On 40900 surface the server message verbatim then re-fetch (B6)
        if (error.code === '40900' || error.message?.includes('VERSION_CONFLICT')) {
          setModalError(error.message);
          await loadRules();
          return;
        }
        throw error;
      }

      setToastMessage(editingRule ? 'Pricing rule updated successfully' : 'New pricing rule created');
      setModalOpen(false);
      await loadRules();
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string };
      if (errObj?.code === '40900' || errObj?.message?.includes('VERSION_CONFLICT')) {
        setModalError(errObj.message || 'VERSION_CONFLICT');
        await loadRules();
      } else {
        setModalError(mapPricingError(err));
      }
    } finally {
      setSubmittingRule(false);
    }
  };

  // Toggle active / inactive rule (B1: Deactivation is p_active := false via p_rule_id)
  const handleToggleActive = async (rule: PricingRule) => {
    try {
      setGeneralError(null);
      const newActive = !rule.active;

      const { error } = await supabase.rpc('upsert_pricing_rule', {
        p_rule_id: rule.id,
        p_resource_id: rule.resource_id,
        p_valid_from: rule.valid_from,
        p_valid_until: rule.valid_until,
        p_iso_weekdays: rule.iso_weekdays,
        p_starts_local: rule.starts_local,
        p_ends_local: rule.ends_local,
        p_amount_per_increment_minor: rule.amount_per_increment_minor,
        p_priority: rule.priority,
        p_active: newActive,
        p_expected_version: rule.version
      });

      if (error) {
        if (error.code === '40900' || error.message?.includes('VERSION_CONFLICT')) {
          setGeneralError(error.message);
          await loadRules();
          return;
        }
        throw error;
      }

      setToastMessage(`Rule ${newActive ? 'activated' : 'deactivated'} successfully`);
      await loadRules();
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string };
      if (errObj?.code === '40900' || errObj?.message?.includes('VERSION_CONFLICT')) {
        setGeneralError(errObj.message || 'VERSION_CONFLICT');
        await loadRules();
      } else {
        setGeneralError(mapPricingError(err));
      }
    }
  };

  // Weekday selection toggles
  const toggleWeekday = (day: number) => {
    if (formIsoWeekdays.includes(day)) {
      setFormIsoWeekdays(formIsoWeekdays.filter(d => d !== day));
    } else {
      setFormIsoWeekdays([...formIsoWeekdays, day].sort());
    }
  };

  // Simulate / Verify Quote (B7 Live Proof & Calculation Verification)
  const handleSimulateQuote = async () => {
    if (!selectedResourceId) return;
    try {
      setSimulatingQuote(true);
      setSimError(null);

      // Local to UTC calculation using venue timezone
      const tz = selectedTurf?.timezone || 'Asia/Kolkata';
      const [y, m, d] = simDate.split('-').map(Number);
      const [hh, mm] = simStartTime.split(':').map(Number);

      const approxStart = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
      const tzDate = new Date(approxStart.toLocaleString('en-US', { timeZone: tz }));
      const utcDate = new Date(approxStart.toLocaleString('en-US', { timeZone: 'UTC' }));
      const offsetMs = tzDate.getTime() - utcDate.getTime();

      const startUtc = new Date(approxStart.getTime() - offsetMs);
      const endUtc = new Date(startUtc.getTime() + simDurationMinutes * 60 * 1000);

      const { data, error } = await supabase.rpc('quote_booking', {
        p_resource_id: selectedResourceId,
        p_starts_at: startUtc.toISOString(),
        p_ends_at: endUtc.toISOString()
      });

      if (error) throw error;
      setSimQuote(data as QuoteResult);
    } catch (err: unknown) {
      setSimError(mapPricingError(err));
      setSimQuote(null);
    } finally {
      setSimulatingQuote(false);
    }
  };

  const renderedRuleCount = rules.length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <BadgePercent className="w-6 h-6 text-emerald-400" />
            Pricing & Rate Rules
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Configure court-specific baseline rates, priority tiers, day-of-week rates, and peak hour pricing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => loadRules()}
            disabled={loadingRules || !canRead}
            className="p-2.5 bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl border border-slate-800 transition-colors disabled:opacity-50"
            title="Refresh Rules"
          >
            <RefreshCw className={`w-4 h-4 ${loadingRules ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          {canEdit && (
            <button
              onClick={handleOpenAdd}
              disabled={!selectedResourceId}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add Pricing Rule
            </button>
          )}
        </div>
      </div>

      {/* Global Toast / Error Alert */}
      {toastMessage && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm flex items-center gap-3 animate-in fade-in duration-200">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {generalError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-sm flex items-start gap-3 animate-in fade-in duration-200">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">{generalError}</p>
          </div>
          <button onClick={() => setGeneralError(null)} className="text-rose-400 hover:text-rose-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Selector Bar: Venue then Court (Resource) - B2 Requirement */}
      <div className="p-5 bg-slate-900/60 border border-slate-800/80 rounded-2xl space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Venue Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-emerald-400" />
              Select Venue
            </label>
            <select
              value={selectedTurfId}
              onChange={e => setSelectedTurfId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-emerald-500/50 transition-colors"
            >
              {turfs.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.city})
                </option>
              ))}
            </select>
          </div>

          {/* Court (Resource) Selector - Rules are per-RESOURCE (B2) */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              Select Court / Resource
            </label>
            <select
              value={selectedResourceId}
              onChange={e => setSelectedResourceId(e.target.value)}
              disabled={resources.length === 0}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-50"
            >
              {resources.length === 0 ? (
                <option value="">No courts configured</option>
              ) : (
                resources.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.booking_increment_minutes}m increment)
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Active Filter & Summary */}
          <div className="flex items-end gap-3">
            <button
              onClick={() => setFilterActiveOnly(!filterActiveOnly)}
              className={`px-4 py-2.5 text-xs font-semibold rounded-xl border transition-colors flex items-center gap-2 ${
                filterActiveOnly
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              <span>{filterActiveOnly ? 'Showing Active Rules' : 'Showing All Rules'}</span>
            </button>
            <span className="text-xs text-slate-500 pb-3">
              {renderedRuleCount} rule{renderedRuleCount === 1 ? '' : 's'} found
            </span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {!canRead ? (
        /* B3: Explicit missing capability state instead of empty list */
        <div className="p-8 bg-slate-900/60 border border-slate-800 rounded-2xl text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white">Access Restricted</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Your account lacks the <code className="text-amber-300 font-mono">pricing.read</code> capability for this venue.
            Viewing pricing rules is restricted.
          </p>
        </div>
      ) : loadingRules ? (
        <div className="p-12 text-center text-slate-500 flex items-center justify-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
          <span>Loading pricing rules...</span>
        </div>
      ) : rules.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/40 border border-slate-800/80 rounded-2xl space-y-3">
          <BadgePercent className="w-8 h-8 text-slate-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-300">No Pricing Rules Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No active pricing rules are configured for this court. Use &ldquo;Add Pricing Rule&rdquo; above to set baseline rates.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-900/60">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/60 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-4">Priority</th>
                  <th className="py-3.5 px-4">Rate / Inc</th>
                  <th className="py-3.5 px-4">Time Window</th>
                  <th className="py-3.5 px-4">Days of Week</th>
                  <th className="py-3.5 px-4">Date Range</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Ver</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rules.map(rule => {
                  const rateFormatted = formatCurrency(rule.amount_per_increment_minor, rule.currency);
                  const incMinutes = selectedResource?.booking_increment_minutes || 60;
                  return (
                    <tr key={rule.id} className="hover:bg-slate-800/30 transition-colors">
                      {/* Priority */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                            rule.priority > 0
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          P{rule.priority}
                        </span>
                      </td>

                      {/* Rate */}
                      <td className="py-3.5 px-4 font-semibold text-white">
                        <div>
                          <span>{rateFormatted}</span>
                          <span className="text-xs text-slate-500 font-normal ml-1">/ {incMinutes}m</span>
                        </div>
                      </td>

                      {/* Time Window */}
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-300">
                        {rule.starts_local.substring(0, 5)} – {rule.ends_local.substring(0, 5)}
                      </td>

                      {/* Days */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5, 6, 7].map(dayNum => {
                            const isIncluded = rule.iso_weekdays?.includes(dayNum);
                            return (
                              <span
                                key={dayNum}
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  isIncluded
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : 'text-slate-600 bg-slate-900/60'
                                }`}
                              >
                                {ISO_DAY_NAMES[dayNum]}
                              </span>
                            );
                          })}
                        </div>
                      </td>

                      {/* Date Range */}
                      <td className="py-3.5 px-4 text-xs text-slate-400">
                        <div>From: <span className="text-slate-300">{rule.valid_from}</span></div>
                        <div>Until: <span className="text-slate-300">{rule.valid_until || 'Indefinite'}</span></div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                            rule.active
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-slate-800/80 text-slate-500 border border-slate-700/50'
                          }`}
                        >
                          {rule.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Version (B6 Concurrency) */}
                      <td className="py-3.5 px-4 text-xs text-slate-500 font-mono">
                        v{rule.version}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        {canEdit ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => handleOpenEdit(rule)}
                              className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors"
                              title="Edit Rule"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleToggleActive(rule)}
                              className={`p-1.5 rounded-lg transition-colors ${
                                rule.active
                                  ? 'text-rose-400 hover:bg-rose-500/10'
                                  : 'text-emerald-400 hover:bg-emerald-500/10'
                              }`}
                              title={rule.active ? 'Deactivate Rule' : 'Activate Rule'}
                            >
                              <Power className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-600">Read only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Interactive Quote Simulator / Verification Panel (B7 Live Proof) */}
      <div className="p-6 bg-slate-900/60 border border-slate-800/80 rounded-2xl space-y-4">
        <div className="flex items-center gap-2.5">
          <Calculator className="w-5 h-5 text-emerald-400" />
          <h2 className="text-base font-bold text-white">Live Rate Simulator & Invariant Check</h2>
        </div>
        <p className="text-xs text-slate-400">
          Simulate authoritative server quotes against the live pricing rules for court &ldquo;{selectedResource?.name || 'Selected Court'}&rdquo;.
          Verifies that UI rate calculations equal <code className="text-emerald-300 font-mono">quote_booking()</code>&apos;s total minor units exactly.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Date
            </label>
            <input
              type="date"
              value={simDate}
              onChange={e => setSimDate(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Start Time
            </label>
            <input
              type="time"
              value={simStartTime}
              onChange={e => setSimStartTime(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Duration (Minutes)
            </label>
            <select
              value={simDurationMinutes}
              onChange={e => setSimDurationMinutes(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3 py-2"
            >
              <option value={60}>60 minutes (1 hour)</option>
              <option value={90}>90 minutes (1.5 hours)</option>
              <option value={120}>120 minutes (2 hours)</option>
              <option value={180}>180 minutes (3 hours)</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSimulateQuote}
              disabled={simulatingQuote || !selectedResourceId}
              className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 text-emerald-400 text-sm font-semibold rounded-xl transition-colors border border-slate-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {simulatingQuote ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              <span>Quote Window</span>
            </button>
          </div>
        </div>

        {simError && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{simError}</span>
          </div>
        )}

        {simQuote && (
          <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400">Server Quote Total:</span>
                <div className="text-xl font-bold text-emerald-400 font-mono">
                  {formatCurrency(simQuote.total_minor, simQuote.currency)}
                  <span className="text-xs text-slate-500 font-normal ml-2">
                    ({simQuote.total_minor} {simQuote.currency} minor units)
                  </span>
                </div>
              </div>
              <div className="text-right text-xs text-slate-400">
                <div>Duration: <span className="text-white font-semibold">{simQuote.duration_minutes}m</span></div>
                <div>Increments: <span className="text-white font-semibold">{simQuote.pricing_snapshot?.increments_count || 1}</span></div>
              </div>
            </div>

            {simQuote.pricing_snapshot?.increments && simQuote.pricing_snapshot.increments.length > 0 && (
              <div className="pt-2 border-t border-slate-800 text-xs space-y-1">
                <span className="text-slate-500 font-medium block">Increment Breakdown:</span>
                {simQuote.pricing_snapshot.increments.map((inc, i) => (
                  <div key={i} className="flex justify-between text-slate-300 font-mono text-[11px]">
                    <span>Slot {i + 1} (Priority {inc.priority}):</span>
                    <span>{formatCurrency(inc.amount_minor, simQuote.currency)} ({inc.amount_minor} minor)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Upsert Pricing Rule Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-5 p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <BadgePercent className="w-5 h-5 text-emerald-400" />
                {editingRule ? 'Edit Pricing Rule' : 'Create Pricing Rule'}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitRule} className="space-y-4">
              {/* Target Court Display */}
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs">
                <span className="text-slate-500">Configuring Court: </span>
                <span className="text-slate-200 font-semibold">{selectedResource?.name}</span>
                <span className="text-slate-500 ml-2">({selectedTurf?.name})</span>
              </div>

              {/* Rate per Increment (INR) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Rate per Increment (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={formAmountMajor}
                    onChange={e => setFormAmountMajor(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500/50"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Minor units: {Math.round((parseFloat(formAmountMajor) || 0) * 100)}
                  </span>
                </div>

                {/* Priority */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Rule Priority
                  </label>
                  <input
                    type="number"
                    value={formPriority}
                    onChange={e => setFormPriority(parseInt(e.target.value, 10) || 0)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500/50"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Higher priority overrides baseline (0 = base)
                  </span>
                </div>
              </div>

              {/* Time Window */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Starts Local Time
                  </label>
                  <input
                    type="time"
                    value={formStartsLocal}
                    onChange={e => setFormStartsLocal(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Ends Local Time
                  </label>
                  <input
                    type="time"
                    value={formEndsLocal}
                    onChange={e => setFormEndsLocal(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>

              {/* Date Range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Valid From Date
                  </label>
                  <input
                    type="date"
                    value={formValidFrom}
                    onChange={e => setFormValidFrom(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Valid Until (Optional)
                  </label>
                  <input
                    type="date"
                    value={formValidUntil}
                    onChange={e => setFormValidUntil(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>

              {/* ISO Weekdays Selector */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Active Weekdays
                  </label>
                  <div className="flex items-center gap-2 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setFormIsoWeekdays([1, 2, 3, 4, 5, 6, 7])}
                      className="text-emerald-400 hover:underline"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormIsoWeekdays([1, 2, 3, 4, 5])}
                      className="text-slate-400 hover:underline"
                    >
                      Mon-Fri
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormIsoWeekdays([6, 7])}
                      className="text-slate-400 hover:underline"
                    >
                      Sat-Sun
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {[1, 2, 3, 4, 5, 6, 7].map(dayNum => {
                    const isSelected = formIsoWeekdays.includes(dayNum);
                    return (
                      <button
                        key={dayNum}
                        type="button"
                        onClick={() => toggleWeekday(dayNum)}
                        className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                            : 'bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300'
                        }`}
                      >
                        {ISO_DAY_NAMES[dayNum]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <div>
                  <span className="text-xs font-semibold text-slate-200 block">Rule Status</span>
                  <span className="text-[11px] text-slate-500">Active rules are applied during booking quotation</span>
                </div>
                <button
                  type="button"
                  onClick={() => setFormActive(!formActive)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    formActive
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {formActive ? 'Active' : 'Inactive'}
                </button>
              </div>

              {/* Concurrency Info (B6) */}
              {editingRule && (
                <div className="text-[11px] text-slate-500">
                  Target Rule Version: <span className="font-mono text-slate-400">v{editingRule.version}</span>
                  {' '}(Optimistic lock will enforce conflict detection)
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingRule}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center gap-2"
                >
                  {submittingRule && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingRule ? 'Save Rule Changes' : 'Create Pricing Rule'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
