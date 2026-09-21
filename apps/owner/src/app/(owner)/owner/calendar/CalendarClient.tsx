'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  Calendar as CalendarIcon,
  Clock,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Plus,
  Lock,
  Unlock,
  RefreshCw,
  Layers,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Info,
  Building2,
  Sparkles,
  Moon,
  X
} from 'lucide-react';

interface TurfItem {
  id: string;
  name: string;
  slug: string;
  city: string;
  timezone: string;
}

interface ResourceItem {
  id: string;
  turf_id: string;
  name: string;
  active: boolean;
  booking_increment_minutes: number;
  minimum_duration_minutes: number;
  maximum_duration_minutes: number;
  schedule_version: number;
}

interface OperatingHourItem {
  id?: string;
  resource_id: string;
  iso_weekday: number;
  opens_at: string;
  closes_at: string;
  closes_next_day: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
}

interface SlotItem {
  id: string;
  turf_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  published: boolean;
  schedule_version: number;
}

interface InventoryAllocationItem {
  id: string;
  turf_id: string;
  resource_id: string;
  booking_id: string | null;
  kind: 'hold' | 'booking' | 'block';
  starts_at: string;
  ends_at: string;
  reason: string | null;
  released_at: string | null;
  created_at: string;
}

const WEEKDAYS = [
  { iso: 1, name: 'Monday', short: 'Mon' },
  { iso: 2, name: 'Tuesday', short: 'Tue' },
  { iso: 3, name: 'Wednesday', short: 'Wed' },
  { iso: 4, name: 'Thursday', short: 'Thu' },
  { iso: 5, name: 'Friday', short: 'Fri' },
  { iso: 6, name: 'Saturday', short: 'Sat' },
  { iso: 7, name: 'Sunday', short: 'Sun' }
];

function getLocalDayBoundaries(dateStr: string, timeZone: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const approxUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const tzDate = new Date(approxUtc.toLocaleString('en-US', { timeZone }));
  const utcDate = new Date(approxUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = tzDate.getTime() - utcDate.getTime();
  const dayStart = new Date(approxUtc.getTime() - offsetMs);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd, dayStartIso: dayStart.toISOString(), dayEndIso: dayEnd.toISOString() };
}

function zonedLocalToUtc(dateTimeStr: string, timeZone: string) {
  const [datePart, timePart] = dateTimeStr.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = (timePart || '00:00').split(':').map(Number);
  const approxUtc = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const tzDate = new Date(approxUtc.toLocaleString('en-US', { timeZone }));
  const utcDate = new Date(approxUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = tzDate.getTime() - utcDate.getTime();
  return new Date(approxUtc.getTime() - offsetMs).toISOString();
}

function formatLocalTime(isoString: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(isoString));
}

function formatLocalDate(isoString: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  }).format(new Date(isoString));
}

function formatLocalHeaderDate(isoString: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(isoString));
}

export default function CalendarClient() {
  const supabase = useMemo(() => createBrowserClient('owner'), []);

  // Capabilities & User Context
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [loadingCaps, setLoadingCaps] = useState(true);

  // Venues & Resources
  const [turfs, setTurfs] = useState<TurfItem[]>([]);
  const [selectedTurfId, setSelectedTurfId] = useState<string>('');
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');

  // Operating Hours & Versioning
  const [operatingHours, setOperatingHours] = useState<OperatingHourItem[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  // Selected Date & Inventory
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [spilloverSlots, setSpilloverSlots] = useState<SlotItem[]>([]);
  const [allocations, setAllocations] = useState<InventoryAllocationItem[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Modals & Forms
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [hoursForm, setHoursForm] = useState<
    Array<{
      iso_weekday: number;
      enabled: boolean;
      opens_at: string;
      closes_at: string;
      closes_next_day: boolean;
    }>
  >(() =>
    WEEKDAYS.map(w => ({
      iso_weekday: w.iso,
      enabled: true,
      opens_at: '06:00',
      closes_at: '23:00',
      closes_next_day: false
    }))
  );
  const [validFromDate, setValidFromDate] = useState<string>('');
  const [validUntilDate, setValidUntilDate] = useState<string>('');
  const [savingHours, setSavingHours] = useState(false);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursSuccess, setHoursSuccess] = useState<string | null>(null);

  // Block Modal
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockStartTime, setBlockStartTime] = useState<string>('');
  const [blockEndTime, setBlockEndTime] = useState<string>('');
  const [blockReason, setBlockReason] = useState<string>('Routine Court Maintenance');
  const [savingBlock, setSavingBlock] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  // Release Block confirmation
  const [releasingBlockId, setReleasingBlockId] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const canEditListing = capabilities.includes('listing.edit');
  const canBlockSlots = capabilities.includes('slots.block');

  const selectedTurf = useMemo(
    () => turfs.find(t => t.id === selectedTurfId),
    [turfs, selectedTurfId]
  );
  const selectedResource = useMemo(
    () => resources.find(r => r.id === selectedResourceId),
    [resources, selectedResourceId]
  );
  const venueTimezone = selectedTurf?.timezone || 'Asia/Kolkata';

  const { dayStartIso, dayEndIso } = useMemo(() => {
    return getLocalDayBoundaries(selectedDate, venueTimezone);
  }, [selectedDate, venueTimezone]);

  // Toast auto-hide
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // 1. Initial Load: Fetch Capabilities and Turfs
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

        // Fetch accessible turfs
        let query = supabase.from('turfs').select('id, name, slug, city, timezone').is('archived_at', null).order('name');
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
          setGeneralError(extractDatabaseError(err, 'Failed to initialize calendar context'));
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

  // 2. Fetch Resources when selected Turf changes
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
          .select('id, turf_id, name, active, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, schedule_version')
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
          setGeneralError(extractDatabaseError(err, 'Failed to load resources'));
        }
      }
    }

    loadResources();
    return () => {
      cancelled = true;
    };
  }, [selectedTurfId, supabase]);

  // 3. Fetch Operating Hours for selected Resource
  const loadOperatingHours = useCallback(async (resourceId: string) => {
    if (!resourceId) {
      setOperatingHours([]);
      return;
    }
    setLoadingSchedule(true);
    try {
      const { data, error } = await supabase
        .from('operating_hours')
        .select('id, resource_id, iso_weekday, opens_at, closes_at, closes_next_day, valid_from, valid_until')
        .eq('resource_id', resourceId)
        .order('iso_weekday');

      if (error) throw error;
      const hours = (data as OperatingHourItem[]) || [];
      setOperatingHours(hours);

      // Populate hours form with existing schedule
      setHoursForm(
        WEEKDAYS.map(w => {
          const match = hours.find(h => h.iso_weekday === w.iso);
          if (match) {
            return {
              iso_weekday: w.iso,
              enabled: true,
              opens_at: match.opens_at.slice(0, 5),
              closes_at: match.closes_at.slice(0, 5),
              closes_next_day: Boolean(match.closes_next_day)
            };
          }
          return {
            iso_weekday: w.iso,
            enabled: false,
            opens_at: '06:00',
            closes_at: '23:00',
            closes_next_day: false
          };
        })
      );
    } catch (err: unknown) {
      setGeneralError(extractDatabaseError(err, 'Failed to load operating hours'));
    } finally {
      setLoadingSchedule(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (selectedResourceId) {
      loadOperatingHours(selectedResourceId);
    } else {
      setOperatingHours([]);
    }
  }, [selectedResourceId, loadOperatingHours]);

  // 4. Fetch Slots and Inventory Allocations scoped to venue-local day boundaries
  const loadSlotsAndAllocations = useCallback(async () => {
    if (!selectedResourceId || !selectedDate) {
      setSlots([]);
      setSpilloverSlots([]);
      setAllocations([]);
      return;
    }

    setLoadingSlots(true);
    setGeneralError(null);
    try {
      const { dayStartIso: boundaryStart, dayEndIso: boundaryEnd } = getLocalDayBoundaries(selectedDate, venueTimezone);

      const [slotsRes, spilloverRes, allocRes] = await Promise.all([
        // Slots strictly starting within the selected venue-local day
        supabase
          .from('slots')
          .select('id, turf_id, resource_id, starts_at, ends_at, published, schedule_version')
          .eq('resource_id', selectedResourceId)
          .gte('starts_at', boundaryStart)
          .lt('starts_at', boundaryEnd)
          .order('starts_at'),
        // Optional spillover slots from previous day's closes_next_day schedule
        // (starts before today's local midnight, but ends after today's local midnight)
        supabase
          .from('slots')
          .select('id, turf_id, resource_id, starts_at, ends_at, published, schedule_version')
          .eq('resource_id', selectedResourceId)
          .lt('starts_at', boundaryStart)
          .gt('ends_at', boundaryStart)
          .order('starts_at'),
        // Inventory allocations active in this interval
        supabase
          .from('inventory_allocations')
          .select('id, turf_id, resource_id, booking_id, kind, starts_at, ends_at, reason, released_at, created_at')
          .eq('resource_id', selectedResourceId)
          .gt('ends_at', boundaryStart)
          .lt('starts_at', boundaryEnd)
          .is('released_at', null)
          .order('starts_at')
      ]);

      if (slotsRes.error) throw slotsRes.error;
      if (spilloverRes.error) throw spilloverRes.error;
      if (allocRes.error) throw allocRes.error;

      setSlots((slotsRes.data as SlotItem[]) || []);
      setSpilloverSlots((spilloverRes.data as SlotItem[]) || []);
      setAllocations((allocRes.data as InventoryAllocationItem[]) || []);
    } catch (err: unknown) {
      setGeneralError(extractDatabaseError(err, 'Failed to load slots and blocks'));
    } finally {
      setLoadingSlots(false);
    }
  }, [selectedResourceId, selectedDate, venueTimezone, supabase]);

  useEffect(() => {
    loadSlotsAndAllocations();
  }, [loadSlotsAndAllocations]);

  // Handlers for Operating Hours
  const handleSaveOperatingHours = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedResourceId) return;
    setSavingHours(true);
    setHoursError(null);
    setHoursSuccess(null);

    try {
      const activeWindows = hoursForm
        .filter(w => w.enabled)
        .map(w => ({
          iso_weekday: w.iso_weekday,
          opens_at: w.opens_at,
          closes_at: w.closes_at,
          closes_next_day: w.closes_next_day
        }));

      if (activeWindows.length === 0) {
        throw new Error('You must configure at least one operating day.');
      }

      const { data: updatedHours, error: rpcErr } = await supabase.rpc('set_resource_operating_hours', {
        p_resource_id: selectedResourceId,
        p_hours: activeWindows,
        p_valid_from: validFromDate ? validFromDate : null,
        p_valid_until: validUntilDate ? validUntilDate : null
      });

      if (rpcErr) throw rpcErr;

      // Invalidate resource cache: re-fetch resource to get bumped schedule_version
      const { data: refreshedRes } = await supabase
        .from('resources')
        .select('id, turf_id, name, active, booking_increment_minutes, minimum_duration_minutes, maximum_duration_minutes, schedule_version')
        .eq('id', selectedResourceId)
        .single();

      if (refreshedRes) {
        setResources(prev =>
          prev.map(r => (r.id === refreshedRes.id ? (refreshedRes as ResourceItem) : r))
        );
      }

      setHoursSuccess(
        `Operating hours updated successfully! Resource schedule version bumped to v${
          refreshedRes?.schedule_version || 'new'
        }.`
      );
      setToastMessage('Schedule version updated. Surviving slots restamped.');

      await loadOperatingHours(selectedResourceId);
      await loadSlotsAndAllocations();
      setTimeout(() => setShowHoursModal(false), 1200);
    } catch (err: unknown) {
      setHoursError(extractDatabaseError(err, 'Failed to save operating hours'));
    } finally {
      setSavingHours(false);
    }
  };

  // Handlers for Time Blocking (Maintenance)
  const handleCreateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedResourceId || !blockStartTime || !blockEndTime) return;
    setSavingBlock(true);
    setBlockError(null);

    try {
      const startsAtISO = zonedLocalToUtc(blockStartTime, venueTimezone);
      const endsAtISO = zonedLocalToUtc(blockEndTime, venueTimezone);

      if (new Date(endsAtISO) <= new Date(startsAtISO)) {
        throw new Error('Block end time must be after start time.');
      }

      const { error: rpcErr } = await supabase.rpc('block_resource_time', {
        p_resource_id: selectedResourceId,
        p_starts_at: startsAtISO,
        p_ends_at: endsAtISO,
        p_reason: blockReason || 'Maintenance Block'
      });

      if (rpcErr) {
        if (rpcErr.code === '23P01') {
          throw new Error('Slot unavailable: The selected time range overlaps with an existing reservation or active block.');
        }
        throw rpcErr;
      }

      setToastMessage('Maintenance block successfully activated.');
      setShowBlockModal(false);
      setBlockStartTime('');
      setBlockEndTime('');
      await loadSlotsAndAllocations();
    } catch (err: unknown) {
      setBlockError(extractDatabaseError(err, 'Failed to block resource time'));
    } finally {
      setSavingBlock(false);
    }
  };

  // Handler for Releasing a Block
  const handleReleaseBlock = async (allocationId: string) => {
    if (!allocationId) return;
    setReleasingBlockId(allocationId);
    try {
      const { error: rpcErr } = await supabase.rpc('release_resource_block', {
        p_allocation_id: allocationId
      });

      if (rpcErr) throw rpcErr;

      setToastMessage('Maintenance block released successfully.');
      await loadSlotsAndAllocations();
    } catch (err: unknown) {
      setGeneralError(extractDatabaseError(err, 'Failed to release maintenance block'));
    } finally {
      setReleasingBlockId(null);
    }
  };

  // Quick date navigator
  const handleDateStep = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const quickDates = useMemo(() => {
    const list = [];
    const nowTz = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: venueTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(nowTz).split('-');
    const base = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));

    for (let i = 0; i < 7; i++) {
      const cur = new Date(base);
      cur.setUTCDate(base.getUTCDate() + i);
      const iso = cur.toISOString().split('T')[0];
      const weekdayName = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(cur);
      const dayNum = cur.getUTCDate();
      list.push({ iso, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekdayName, dayNum });
    }
    return list;
  }, [venueTimezone]);

  const hasOperatingHours = operatingHours.length > 0;

  if (!loadingCaps && turfs.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <CalendarIcon className="w-6 h-6 text-emerald-400" />
            Court Calendar & Slot Operations
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time court availability grid and slot management.
          </p>
        </div>
        <div className="p-12 text-center bg-slate-900/60 border border-slate-800 rounded-2xl space-y-3">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-slate-100">No Venue Assigned</h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Your staff account is not currently assigned to any active sports arena. Contact your Master Owner to assign you to a venue in the Staff & Invites console.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 bg-emerald-950/90 border border-emerald-500/40 rounded-2xl shadow-2xl backdrop-blur-md text-emerald-200 text-sm animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header & Venue Selector */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <CalendarIcon className="w-6 h-6 text-emerald-400" />
            Court Calendar & Slot Operations
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time court availability grid, operational maintenance blocking, and operating schedule management.
          </p>
        </div>

        {/* Venue Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl">
            <Building2 className="w-4 h-4 text-emerald-400" />
            <select
              value={selectedTurfId}
              onChange={e => setSelectedTurfId(e.target.value)}
              className="bg-transparent text-sm text-slate-200 font-medium focus:outline-none cursor-pointer pr-2"
              disabled={loadingCaps || turfs.length === 0}
            >
              {turfs.map(t => (
                <option key={t.id} value={t.id} className="bg-slate-900 text-slate-200">
                  {t.name} ({t.city})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => loadSlotsAndAllocations()}
            disabled={loadingSlots}
            title="Refresh Slots & Blocks"
            className="p-2.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loadingSlots ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {generalError && (
        <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-2xl flex items-start gap-3 text-red-200 text-sm">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-red-300">Operational Notice: </span>
            {generalError}
          </div>
          <button
            onClick={() => setGeneralError(null)}
            className="text-red-400 hover:text-red-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Resource Tabs & Version Badge */}
      <div className="glass-panel p-4 rounded-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
            {resources.length === 0 ? (
              <span className="text-sm text-slate-500 italic">No courts or resources found for this venue.</span>
            ) : (
              resources.map(r => {
                const isSelected = r.id === selectedResourceId;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedResourceId(r.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 shadow-sm shadow-emerald-950'
                        : 'bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                    <span>{r.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-md bg-slate-900/60 border border-slate-700/50 text-slate-400">
                      {r.booking_increment_minutes}m slots
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selectedResource && (
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-slate-800 rounded-xl text-xs">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-slate-400">Schedule Cache:</span>
                <span className="font-mono font-bold text-emerald-400">
                  v{selectedResource.schedule_version}
                </span>
              </div>

              {canEditListing && (
                <button
                  onClick={() => setShowHoursModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Settings2 className="w-3.5 h-3.5 text-slate-400" />
                  Operating Hours
                </button>
              )}

              {canBlockSlots && (
                <button
                  onClick={() => {
                    setBlockStartTime(`${selectedDate}T10:00`);
                    setBlockEndTime(`${selectedDate}T11:00`);
                    setShowBlockModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  Block Maintenance
                </button>
              )}
            </div>
          )}
        </div>

        {/* Operating Hours Unconfigured Warning Banner (Item 1 resolution) */}
        {!hasOperatingHours && selectedResource && !loadingSchedule && (
          <div className="p-4 bg-amber-950/30 border border-amber-500/40 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-amber-200">
                  Operating Schedule Not Configured (Unbookable)
                </h4>
                <p className="text-xs text-amber-300/80 mt-0.5 max-w-xl">
                  This court has zero operating hours rows. Under fail-closed operating hours verification,
                  all booking attempts will be rejected with <code className="bg-amber-950 px-1 py-0.5 rounded text-amber-300">OUTSIDE_OPERATING_HOURS</code> until an active weekly schedule is defined.
                </p>
              </div>
            </div>
            {canEditListing && (
              <button
                onClick={() => setShowHoursModal(true)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl transition-colors cursor-pointer shrink-0 shadow-md shadow-amber-950"
              >
                Configure Schedule Now
              </button>
            )}
          </div>
        )}

        {/* Date Selector Strip */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => handleDateStep(-1)}
              className="p-2 bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Previous Day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {quickDates.map(item => {
              const isSelected = item.iso === selectedDate;
              return (
                <button
                  key={item.iso}
                  onClick={() => setSelectedDate(item.iso)}
                  className={`flex flex-col items-center justify-center min-w-[70px] px-3 py-1.5 rounded-xl text-xs transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950 font-bold shadow-lg shadow-emerald-950'
                      : 'bg-slate-900/60 hover:bg-slate-800 border border-slate-800/80 text-slate-300 hover:text-white'
                  }`}
                >
                  <span className={`text-[10px] uppercase font-semibold ${isSelected ? 'text-slate-900' : 'text-slate-400'}`}>
                    {item.label}
                  </span>
                  <span className="text-sm font-bold">{item.dayNum}</span>
                </button>
              );
            })}

            <button
              onClick={() => handleDateStep(1)}
              className="p-2 bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Next Day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 bg-slate-900/80 border border-slate-800 text-slate-200 text-xs rounded-xl focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Slots & Inventory Allocations Grid */}
      <div className="glass-panel p-6 rounded-2xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-white">
                  Slot Grid & Reservations — {formatLocalHeaderDate(dayStartIso, venueTimezone)}
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono border border-slate-700">
                  {venueTimezone}
                </span>
                <span
                  data-testid="rendered-slot-count"
                  className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold"
                >
                  {slots.length} Day Slots
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Local Day: <span className="font-mono text-emerald-400 font-semibold">{selectedDate}</span> (Boundaries: {formatLocalTime(dayStartIso, venueTimezone)} – {formatLocalTime(dayEndIso, venueTimezone)} {venueTimezone})
              </p>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Available</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span>Hold / Booking</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span>Maintenance Block</span>
            </div>
          </div>
        </div>

        {/* Previous Day Overnight Spillover Section (closes_next_day) */}
        {spilloverSlots.length > 0 && (
          <div className="p-4 rounded-2xl bg-indigo-950/30 border border-indigo-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-300 font-bold text-sm">
                <Moon className="w-4 h-4 text-indigo-400" />
                <span>Previous Day Overnight Spillover (closes_next_day)</span>
              </div>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-900/60 border border-indigo-700/50 text-indigo-200 font-mono font-semibold">
                {spilloverSlots.length} spillover slot{spilloverSlots.length > 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-xs text-indigo-300/70">
              These slots originated from the previous day schedule extending past midnight into {selectedDate}.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-1">
              {spilloverSlots.map(slot => {
                const startLabel = formatLocalTime(slot.starts_at, venueTimezone);
                const endLabel = formatLocalTime(slot.ends_at, venueTimezone);
                const dateLabel = formatLocalDate(slot.starts_at, venueTimezone);

                const overlappingAlloc = allocations.find(
                  a => new Date(a.starts_at) < new Date(slot.ends_at) && new Date(a.ends_at) > new Date(slot.starts_at)
                );
                const isMaintenance = overlappingAlloc?.kind === 'block';
                const isBookingOrHold = overlappingAlloc?.kind === 'booking' || overlappingAlloc?.kind === 'hold';

                return (
                  <div
                    key={slot.id}
                    data-testid={`spillover-slot-tile-${slot.id}`}
                    className="p-4 rounded-xl border bg-indigo-950/20 border-indigo-800/60"
                  >
                    <div className="flex items-center justify-between text-xs text-indigo-300/80 border-b border-indigo-800/40 pb-2 mb-2">
                      <div className="flex items-center gap-1.5 font-medium">
                        <CalendarIcon className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{dateLabel} (Spillover)</span>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400">v{slot.schedule_version}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-white font-mono">{startLabel} – {endLabel}</span>
                      {isMaintenance ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          MAINTENANCE
                        </span>
                      ) : isBookingOrHold ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          {overlappingAlloc.kind.toUpperCase()}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          AVAILABLE
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loadingSlots ? (
          <div className="p-12 text-center text-slate-500 space-y-2">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-500 mx-auto" />
            <p className="text-sm">Loading slot allocations and blocks...</p>
          </div>
        ) : slots.length === 0 ? (
          <div className="p-12 text-center space-y-3 bg-slate-900/30 rounded-2xl border border-slate-800/60">
            <Info className="w-8 h-8 text-slate-500 mx-auto" />
            <h3 className="text-base font-semibold text-slate-300">No Slots Materialized for this Date</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Slots for this resource have not yet been materialized or published for this date.
              Ensure operating hours are defined and pricing rules cover this date window.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {slots.map(slot => {
              const startLabel = formatLocalTime(slot.starts_at, venueTimezone);
              const endLabel = formatLocalTime(slot.ends_at, venueTimezone);
              const dateLabel = formatLocalDate(slot.starts_at, venueTimezone);
              const startDt = new Date(slot.starts_at);
              const endDt = new Date(slot.ends_at);

              // Check if any active allocation overlaps this slot
              const overlappingAlloc = allocations.find(
                a => new Date(a.starts_at) < endDt && new Date(a.ends_at) > startDt
              );

              const isMaintenance = overlappingAlloc?.kind === 'block';
              const isBookingOrHold = overlappingAlloc?.kind === 'booking' || overlappingAlloc?.kind === 'hold';

              return (
                <div
                  key={slot.id}
                  data-testid={`slot-tile-${slot.id}`}
                  className={`p-4 rounded-xl border transition-all ${
                    isMaintenance
                      ? 'bg-amber-950/20 border-amber-500/40 shadow-sm'
                      : isBookingOrHold
                      ? 'bg-blue-950/20 border-blue-500/40 shadow-sm'
                      : 'bg-slate-900/60 border-slate-800/80 hover:border-emerald-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800/80 pb-2 mb-2.5">
                    <div className="flex items-center gap-1.5 font-medium text-slate-300">
                      <CalendarIcon className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-semibold">{dateLabel}</span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500">v{slot.schedule_version}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white font-mono">{startLabel} – {endLabel}</span>
                    {isMaintenance ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        MAINTENANCE
                      </span>
                    ) : isBookingOrHold ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {overlappingAlloc.kind.toUpperCase()}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        AVAILABLE
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                    <span className="text-[11px] text-slate-400">
                      {slot.published ? 'Published' : 'Draft'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {venueTimezone}
                    </span>
                  </div>

                  {isMaintenance && overlappingAlloc && (
                    <div className="mt-3 pt-3 border-t border-amber-500/20 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-amber-300/90 truncate" title={overlappingAlloc.reason || ''}>
                        {overlappingAlloc.reason || 'Maintenance'}
                      </span>
                      {canBlockSlots && (
                        <button
                          onClick={() => handleReleaseBlock(overlappingAlloc.id)}
                          disabled={releasingBlockId === overlappingAlloc.id}
                          className="flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300 cursor-pointer"
                        >
                          <Unlock className="w-3 h-3" />
                          <span>Release</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Active Maintenance Blocks Summary */}
        {allocations.filter(a => a.kind === 'block').length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-800 space-y-4">
            <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" />
              Active Maintenance Blocks on {selectedResource?.name}
            </h3>

            <div className="space-y-2">
              {allocations
                .filter(a => a.kind === 'block')
                .map(block => (
                  <div
                    key={block.id}
                    className="p-3.5 bg-amber-950/20 border border-amber-500/30 rounded-xl flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="text-xs font-semibold text-white">
                        {formatLocalTime(block.starts_at, venueTimezone)}
                        {' – '}
                        {formatLocalTime(block.ends_at, venueTimezone)}
                        {' ('}
                        {formatLocalDate(block.starts_at, venueTimezone)}
                        {')'}
                      </div>
                      <div className="text-xs text-amber-300/80 mt-0.5">
                        {block.reason || 'Routine Maintenance'}
                      </div>
                    </div>

                    {canBlockSlots && (
                      <button
                        onClick={() => handleReleaseBlock(block.id)}
                        disabled={releasingBlockId === block.id}
                        className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                      >
                        {releasingBlockId === block.id ? 'Releasing...' : 'Release Block'}
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Operating Hours Modal */}
      {showHoursModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-2xl rounded-2xl p-6 space-y-6 max-h-[90vh] overflow-y-auto border border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-emerald-400" />
                  Configure Operating Hours — {selectedResource?.name}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Updates 7-day schedule, bumps resource schedule_version, and enforces the coverage invariant.
                </p>
              </div>
              <button
                onClick={() => setShowHoursModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {hoursError && (
              <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-300">
                {hoursError}
              </div>
            )}

            {hoursSuccess && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-xl text-xs text-emerald-300">
                {hoursSuccess}
              </div>
            )}

            <form onSubmit={handleSaveOperatingHours} className="space-y-4">
              <div className="space-y-3">
                {hoursForm.map(day => {
                  const weekdayInfo = WEEKDAYS.find(w => w.iso === day.iso_weekday);
                  return (
                    <div
                      key={day.iso_weekday}
                      className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        day.enabled ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-950/40 border-slate-900 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-3 w-32">
                        <input
                          type="checkbox"
                          id={`day-${day.iso_weekday}`}
                          checked={day.enabled}
                          onChange={e =>
                            setHoursForm(prev =>
                              prev.map(d =>
                                d.iso_weekday === day.iso_weekday
                                  ? { ...d, enabled: e.target.checked }
                                  : d
                              )
                            )
                          }
                          className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                        />
                        <label
                          htmlFor={`day-${day.iso_weekday}`}
                          className="text-sm font-semibold text-slate-200 cursor-pointer"
                        >
                          {weekdayInfo?.name}
                        </label>
                      </div>

                      {day.enabled ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-400">Open:</span>
                            <input
                              type="time"
                              value={day.opens_at}
                              onChange={e =>
                                setHoursForm(prev =>
                                  prev.map(d =>
                                    d.iso_weekday === day.iso_weekday
                                      ? { ...d, opens_at: e.target.value }
                                      : d
                                  )
                                )
                              }
                              className="px-2 py-1 bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-lg focus:outline-none focus:border-emerald-500"
                            />
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-400">Close:</span>
                            <input
                              type="time"
                              value={day.closes_at}
                              onChange={e =>
                                setHoursForm(prev =>
                                  prev.map(d =>
                                    d.iso_weekday === day.iso_weekday
                                      ? { ...d, closes_at: e.target.value }
                                      : d
                                  )
                                )
                              }
                              className="px-2 py-1 bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-lg focus:outline-none focus:border-emerald-500"
                            />
                          </div>

                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={day.closes_next_day}
                              onChange={e =>
                                setHoursForm(prev =>
                                  prev.map(d =>
                                    d.iso_weekday === day.iso_weekday
                                      ? { ...d, closes_next_day: e.target.checked }
                                      : d
                                  )
                                )
                              }
                              className="w-3.5 h-3.5 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                            />
                            <span className="text-[11px] text-slate-400">+1 Day</span>
                          </label>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600 italic">Closed</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Optional Validity Window */}
              <div className="pt-2 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Valid From (Optional)
                  </label>
                  <input
                    type="date"
                    value={validFromDate}
                    onChange={e => setValidFromDate(e.target.value)}
                    placeholder="Today by default"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-xl focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Leave empty to take effect immediately.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Valid Until (Optional)
                  </label>
                  <input
                    type="date"
                    value={validUntilDate}
                    onChange={e => setValidUntilDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-xl focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Leave empty for open-ended perpetual schedule.</p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowHoursModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingHours}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-md shadow-emerald-950"
                >
                  {savingHours ? 'Saving Schedule...' : 'Save & Bump Version'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Block Maintenance Modal */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md rounded-2xl p-6 space-y-6 border border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-400" />
                Block Court for Maintenance
              </h3>
              <button
                onClick={() => setShowBlockModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {blockError && (
              <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-300">
                {blockError}
              </div>
            )}

            <form onSubmit={handleCreateBlock} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Starts At (Local Time)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={blockStartTime}
                  onChange={e => setBlockStartTime(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Ends At (Local Time)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={blockEndTime}
                  onChange={e => setBlockEndTime(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Reason / Notes
                </label>
                <input
                  type="text"
                  required
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  placeholder="e.g. Grass turf brushing & lighting check"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowBlockModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBlock}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-md shadow-amber-950"
                >
                  {savingBlock ? 'Applying Block...' : 'Confirm Block'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
