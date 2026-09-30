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
  X,
  Banknote
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

function formatCurrency(minor: number, currency: string) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency
  }).format(minor / 100);
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

  // Walk-in Modal State
  const [walkinModalOpen, setWalkinModalOpen] = useState(false);
  const [walkinResourceId, setWalkinResourceId] = useState<string>('');
  const [walkinDate, setWalkinDate] = useState<string>('');
  const [walkinStartTime, setWalkinStartTime] = useState<string>('10:00');
  const [walkinDurationMinutes, setWalkinDurationMinutes] = useState<number>(60);
  const [walkinContactName, setWalkinContactName] = useState<string>('');
  const [walkinContactPhone, setWalkinContactPhone] = useState<string>('');
  const [walkinContactEmail, setWalkinContactEmail] = useState<string>('');
  const [walkinPaymentMethod, setWalkinPaymentMethod] = useState<string>('cash');
  const [walkinNotes, setWalkinNotes] = useState<string>('');
  const [walkinQuote, setWalkinQuote] = useState<{ total_minor: number; currency: string } | null>(null);
  const [quotingWalkin, setQuotingWalkin] = useState(false);
  const [walkinQuoteError, setWalkinQuoteError] = useState<string | null>(null);
  const [submittingWalkin, setSubmittingWalkin] = useState(false);
  const [walkinSubmitError, setWalkinSubmitError] = useState<string | null>(null);

  // Cancellation Modal State
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null);
  const [cancellingContact, setCancellingContact] = useState<{contact_name: string, contact_phone: string} | null>(null);
  const [loadingCancelContact, setLoadingCancelContact] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>('Player requested cancellation');
  const [submittingCancel, setSubmittingCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const canEditListing = capabilities.includes('listing.edit');
  const canBlockSlots = capabilities.includes('slots.block');
  const canCreateWalkin = capabilities.includes('bookings.create_walkin') || capabilities.includes('bookings.manage');
  const canCancelBooking = capabilities.includes('bookings.cancel') || capabilities.includes('bookings.manage');

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

  const alignedTimeOptions = useMemo(() => {
    const opts = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        opts.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
      }
    }
    return opts;
  }, []);

  const durationOptions = useMemo(() => {
    const increment = selectedResource?.booking_increment_minutes || 60;
    const defaultMax = 1440; // Fallback max
    
    if (!walkinDate || !walkinStartTime || !walkinResourceId) {
      const opts = [];
      for (let m = increment; m <= defaultMax; m += increment) {
        opts.push(m);
      }
      return opts;
    }

    try {
      const startLocal = `${walkinDate}T${walkinStartTime}`;
      const startUtcStr = zonedLocalToUtc(startLocal, venueTimezone);
      const startDt = new Date(startUtcStr);

      // 1. Find closing time from slots for this specific day
      // Slots represent all bookable chunks. The latest 'ends_at' among slots is the closing time.
      const resourceSlots = slots.filter(s => s.resource_id === walkinResourceId);
      let maxEndsAtDt = new Date(startDt.getTime() + defaultMax * 60000); // default to 24h later
      
      if (resourceSlots.length > 0) {
        let latestEnd = new Date(resourceSlots[0].ends_at);
        for (const slot of resourceSlots) {
          const endDt = new Date(slot.ends_at);
          if (endDt > latestEnd) latestEnd = endDt;
        }
        maxEndsAtDt = latestEnd;
      }

      // 2. Find next allocation starting AFTER the selected walkinStartTime
      const resourceAllocs = allocations.filter(a => a.resource_id === walkinResourceId);
      let nextAllocDt: Date | null = null;
      
      for (const alloc of resourceAllocs) {
        const allocStartDt = new Date(alloc.starts_at);
        if (allocStartDt > startDt) {
          if (!nextAllocDt || allocStartDt < nextAllocDt) {
            nextAllocDt = allocStartDt;
          }
        }
      }

      // Determine the hard limit based on closing time OR next allocation
      const limitDt = nextAllocDt && nextAllocDt < maxEndsAtDt ? nextAllocDt : maxEndsAtDt;
      
      let availableMins = Math.floor((limitDt.getTime() - startDt.getTime()) / 60000);
      
      // Safety bounds
      if (availableMins <= 0) availableMins = increment;
      const finalMax = Math.min(availableMins, defaultMax);

      const opts = [];
      for (let m = increment; m <= finalMax; m += increment) {
        opts.push(m);
      }
      
      if (opts.length === 0) opts.push(increment);
      return opts;
    } catch(e) {
      const opts = [];
      for (let m = increment; m <= defaultMax; m += increment) opts.push(m);
      return opts;
    }
  }, [walkinDate, walkinStartTime, walkinResourceId, slots, allocations, venueTimezone, selectedResource]);

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

  // 6. Live Quote for Walk-in Modal
  const computeWalkinInterval = useCallback(() => {
    if (!walkinDate || !walkinStartTime || !walkinDurationMinutes) return null;
    const startLocal = `${walkinDate}T${walkinStartTime}`;
    const startsAtUtc = zonedLocalToUtc(startLocal, venueTimezone);

    const startLocalObj = new Date(`${walkinDate}T${walkinStartTime}:00`);
    const endLocalObj = new Date(startLocalObj.getTime() + walkinDurationMinutes * 60 * 1000);
    const endLocalY = endLocalObj.getFullYear();
    const endLocalM = (endLocalObj.getMonth() + 1).toString().padStart(2, '0');
    const endLocalD = endLocalObj.getDate().toString().padStart(2, '0');
    const endLocalH = endLocalObj.getHours().toString().padStart(2, '0');
    const endLocalMin = endLocalObj.getMinutes().toString().padStart(2, '0');
    const endLocal = `${endLocalY}-${endLocalM}-${endLocalD}T${endLocalH}:${endLocalMin}`;
    const endsAtUtc = zonedLocalToUtc(endLocal, venueTimezone);

    return { startsAtUtc, endsAtUtc };
  }, [walkinDate, walkinStartTime, walkinDurationMinutes, venueTimezone]);

  const updateWalkinQuote = useCallback(async () => {
    if (!walkinResourceId) return;
    const interval = computeWalkinInterval();
    if (!interval) return;

    setQuotingWalkin(true);
    setWalkinQuoteError(null);

    try {
      const { data, error } = await supabase.rpc('quote_booking', {
        p_resource_id: walkinResourceId,
        p_starts_at: interval.startsAtUtc,
        p_ends_at: interval.endsAtUtc
      });

      if (error) {
        setWalkinQuoteError(extractDatabaseError(error, 'Quote failed'));
        setWalkinQuote(null);
      } else {
        setWalkinQuote({
          total_minor: data?.total_minor || 0,
          currency: data?.currency || 'INR'
        });
      }
    } catch (err: unknown) {
      setWalkinQuoteError(extractDatabaseError(err, 'Quote failed'));
      setWalkinQuote(null);
    } finally {
      setQuotingWalkin(false);
    }
  }, [walkinResourceId, computeWalkinInterval, supabase]);

  useEffect(() => {
    if (walkinModalOpen) {
      updateWalkinQuote();
    }
  }, [walkinModalOpen, walkinResourceId, walkinDate, walkinStartTime, walkinDurationMinutes, updateWalkinQuote]);

  const handleSubmitWalkin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkinResourceId) {
      setWalkinSubmitError('Please select a court resource');
      return;
    }
    if (!walkinContactName.trim()) {
      setWalkinSubmitError('Contact name is required');
      return;
    }
    if (!walkinContactPhone.trim() || walkinContactPhone.trim().length !== 10) {
      setWalkinSubmitError('Contact phone must be exactly 10 digits');
      return;
    }

    const interval = computeWalkinInterval();
    if (!interval) {
      setWalkinSubmitError('Invalid time or date specified');
      return;
    }

    setSubmittingWalkin(true);
    setWalkinSubmitError(null);

    try {
      const idempotencyKey = `walkin-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const { data, error } = await supabase.rpc('create_walkin_booking', {
        p_resource_id: walkinResourceId,
        p_starts_at: interval.startsAtUtc,
        p_ends_at: interval.endsAtUtc,
        p_contact_name: walkinContactName.trim(),
        p_contact_phone: `+91${walkinContactPhone.trim()}`,
        p_contact_email: walkinContactEmail.trim() || null,
        p_payment_method: walkinPaymentMethod,
        p_notes: walkinNotes.trim() || null,
        p_idempotency_key: idempotencyKey
      });

      if (error) {
        setWalkinSubmitError(extractDatabaseError(error, 'Booking failed'));
        return;
      }

      setToastMessage(`Walk-in booking confirmed (${data?.reference_code || 'Success'})`);
      setWalkinModalOpen(false);
      setWalkinContactName('');
      setWalkinContactPhone('');
      setWalkinContactEmail('');
      setWalkinNotes('');
      setWalkinSubmitError(null);
      await loadSlotsAndAllocations();
    } catch (err: unknown) {
      setWalkinSubmitError(extractDatabaseError(err, 'Booking failed'));
    } finally {
      setSubmittingWalkin(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancellingBookingId) return;
    setSubmittingCancel(true);
    setCancelError(null);

    try {
      const { error } = await supabase.rpc('cancel_booking', {
        p_booking_id: cancellingBookingId,
        p_reason: cancelReason.trim() || 'Player requested cancellation from calendar'
      });

      if (error) {
        setCancelError(error.message || 'Cancellation rejected by server');
        return;
      }

      setToastMessage('Booking cancelled successfully.');
      setCancellingBookingId(null);
      setCancelReason('Player requested cancellation');
      await loadSlotsAndAllocations();
    } catch (err: unknown) {
      setCancelError(extractDatabaseError(err, 'Failed to submit cancellation'));
    } finally {
      setSubmittingCancel(false);
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
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <CalendarIcon className="w-6 h-6 text-neutral-200" />
            Court Calendar & Slot Operations
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Real-time court availability grid and slot management.
          </p>
        </div>
        <div className="p-12 text-center bg-neutral-200/50 dark:bg-neutral-900/60 border border-neutral-300 dark:border-neutral-800 rounded-2xl space-y-3">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">No Venue Assigned</h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-md mx-auto">
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
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 bg-neutral-950/90 border border-neutral-900 dark:border-white/40 rounded-2xl shadow-2xl backdrop-blur-md text-neutral-200 text-sm animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-neutral-200 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header & Venue Selector */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <CalendarIcon className="w-6 h-6 text-neutral-200" />
            Court Calendar & Slot Operations
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            Real-time court availability grid, operational maintenance blocking, and operating schedule management.
          </p>
        </div>

        {/* Venue Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-neutral-200/50 dark:bg-neutral-900/80 border border-neutral-300 dark:border-neutral-800 rounded-xl">
            <Building2 className="w-4 h-4 text-neutral-200" />
            <select
              value={selectedTurfId}
              onChange={e => setSelectedTurfId(e.target.value)}
              className="bg-transparent text-sm text-neutral-800 dark:text-neutral-200 font-medium focus:outline-none cursor-pointer pr-2"
              disabled={loadingCaps || turfs.length === 0}
            >
              {turfs.map(t => (
                <option key={t.id} value={t.id} className="bg-neutral-200/50 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200">
                  {t.name} ({t.city})
                </option>
              ))}
            </select>
          </div>

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-300 dark:border-neutral-800/80 pb-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
            {resources.length === 0 ? (
              <span className="text-sm text-neutral-500 italic">No courts or resources found for this venue.</span>
            ) : (
              resources.map(r => {
                const isSelected = r.id === selectedResourceId;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedResourceId(r.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'bg-neutral-900 dark:bg-white/15 border border-neutral-900 dark:border-white/40 text-neutral-300 shadow-sm shadow-neutral-950'
                        : 'bg-neutral-200/50 dark:bg-neutral-800/40 hover:bg-neutral-200/50 dark:bg-neutral-800/80 border border-neutral-300 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:text-neutral-200'
                    }`}
                  >
                    <Layers className="w-4 h-4" />
                    <span>{r.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-md bg-neutral-200/50 dark:bg-neutral-900/60 border border-neutral-700/50 text-neutral-500 dark:text-neutral-400">
                      {r.booking_increment_minutes}m slots
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selectedResource && (
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-200/50 dark:bg-neutral-900/80 border border-neutral-300 dark:border-neutral-800 rounded-xl text-xs">
                <Sparkles className="w-3.5 h-3.5 text-neutral-200" />
                <span className="text-neutral-500 dark:text-neutral-400">Schedule Cache:</span>
                <span className="font-mono font-bold text-neutral-200">
                  v{selectedResource.schedule_version}
                </span>
              </div>

              {canEditListing && (
                <button
                  onClick={() => setShowHoursModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-200/50 dark:bg-neutral-800/80 hover:bg-neutral-700/80 border border-neutral-700 text-neutral-800 dark:text-neutral-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Settings2 className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400" />
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
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold rounded-xl transition-colors cursor-pointer shrink-0 shadow-md shadow-amber-950"
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
              className="p-2 bg-neutral-200/50 dark:bg-neutral-900/60 hover:bg-neutral-200/50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:text-neutral-200 rounded-xl transition-colors cursor-pointer"
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
                      ? 'bg-neutral-900 dark:bg-primary dark:text-neutral-950 text-neutral-950 font-bold shadow-lg shadow-neutral-950'
                      : 'bg-neutral-200/50 dark:bg-neutral-900/60 hover:bg-neutral-200/50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-800/80 text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:text-white'
                  }`}
                >
                  <span className={`text-[10px] uppercase font-semibold ${isSelected ? 'text-neutral-900' : 'text-neutral-500 dark:text-neutral-400'}`}>
                    {item.label}
                  </span>
                  <span className="text-sm font-bold">{item.dayNum}</span>
                </button>
              );
            })}

            <button
              onClick={() => handleDateStep(1)}
              className="p-2 bg-neutral-200/50 dark:bg-neutral-900/60 hover:bg-neutral-200/50 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:text-neutral-200 rounded-xl transition-colors cursor-pointer"
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
              className="px-3 py-1.5 bg-neutral-200/50 dark:bg-neutral-900/80 border border-neutral-300 dark:border-neutral-800 text-neutral-800 dark:text-neutral-200 text-xs rounded-xl focus:outline-none focus:border-neutral-900 dark:border-primary"
            />
          </div>
        </div>
      </div>

      {/* Slots & Inventory Allocations Grid */}
      <div className="glass-panel p-6 rounded-2xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-neutral-900 dark:bg-white/10 border border-neutral-900 dark:border-white/30 rounded-xl text-neutral-200">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-neutral-900 dark:text-white">
                  Slot Grid & Reservations — {formatLocalHeaderDate(dayStartIso, venueTimezone)}
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-200/50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-mono border border-neutral-700">
                  {venueTimezone}
                </span>
                <span
                  data-testid="rendered-slot-count"
                  className="text-xs px-2.5 py-0.5 rounded-full bg-neutral-900 dark:bg-white/20 border border-neutral-900 dark:border-white/40 text-neutral-300 font-bold"
                >
                  {slots.length} Day Slots
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Local Day: <span className="font-mono text-neutral-200 font-semibold">{selectedDate}</span> (Boundaries: {formatLocalTime(dayStartIso, venueTimezone)} – {formatLocalTime(dayEndIso, venueTimezone)} {venueTimezone})
              </p>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
              <span className="w-2.5 h-2.5 rounded-full bg-neutral-900 dark:bg-primary dark:text-neutral-950" />
              <span>Available</span>
            </div>
            <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span>Hold / Booking</span>
            </div>
            <div className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
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
                      <span className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">v{slot.schedule_version}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-neutral-900 dark:text-white font-mono">{startLabel} – {endLabel}</span>
                      {isMaintenance ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          MAINTENANCE
                        </span>
                      ) : isBookingOrHold ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          {overlappingAlloc.kind.toUpperCase()}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-900 dark:bg-white/20 text-neutral-300 border border-neutral-900 dark:border-white/30">
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
          <div className="p-12 text-center text-neutral-500 space-y-2">
            <RefreshCw className="w-8 h-8 animate-spin text-neutral-900 dark:text-white mx-auto" />
            <p className="text-sm">Loading slot allocations and blocks...</p>
          </div>
        ) : slots.length === 0 ? (
          <div className="p-12 text-center space-y-3 bg-neutral-900/30 rounded-2xl border border-neutral-300 dark:border-neutral-800/60">
            <Info className="w-8 h-8 text-neutral-500 mx-auto" />
            <h3 className="text-base font-semibold text-neutral-700 dark:text-neutral-300">No Slots Materialized for this Date</h3>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
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

              const isAvailable = !isMaintenance && !isBookingOrHold;
              const isBooking = overlappingAlloc?.kind === 'booking';
              
              const isClickable = (isAvailable && canCreateWalkin) || (isBooking && canCancelBooking);

              const WrapperComponent = isClickable ? 'button' : 'div';
              const wrapperProps = isClickable ? {
                onClick: () => {
                  if (isAvailable && canCreateWalkin) {
                    setWalkinResourceId(slot.resource_id);
                    setWalkinDate(slot.starts_at.split('T')[0]);
                    
                    const localStart = formatLocalTime(slot.starts_at, venueTimezone);
                    setWalkinStartTime(localStart);
                    
                    const diff = endDt.getTime() - startDt.getTime();
                    setWalkinDurationMinutes(Math.round(diff / 60000));
                    
                    setWalkinModalOpen(true);
                  } else if (isBooking && canCancelBooking && overlappingAlloc?.booking_id) {
                    const bId = overlappingAlloc.booking_id;
                    setCancellingBookingId(bId);
                    setCancellingContact(null);
                    setLoadingCancelContact(true);
                    supabase.rpc('get_booking_contact', { p_booking_id: bId }).then(({ data }) => {
                      if (data) setCancellingContact(data as {contact_name: string, contact_phone: string});
                      setLoadingCancelContact(false);
                    });
                  }
                },
                className: `text-left w-full p-4 rounded-xl border transition-all ${
                  isBooking 
                    ? 'bg-blue-950/20 border-blue-500/40 hover:border-blue-500/60 hover:bg-blue-900/30 cursor-pointer shadow-sm hover:shadow-blue-900/20'
                    : 'bg-neutral-200/50 dark:bg-neutral-900/60 border-neutral-300 dark:border-neutral-800/80 hover:border-neutral-900 dark:border-white/60 hover:bg-neutral-950/20 cursor-pointer shadow-sm hover:shadow-neutral-900/20'
                }`
              } : {
                className: `p-4 rounded-xl border transition-all ${
                  isMaintenance
                    ? 'bg-amber-950/20 border-amber-500/40 shadow-sm'
                    : isBookingOrHold
                    ? 'bg-blue-950/20 border-blue-500/40 shadow-sm'
                    : 'bg-neutral-200/50 dark:bg-neutral-900/60 border-neutral-300 dark:border-neutral-800/80'
                }`
              };

              return (
                <WrapperComponent
                  key={slot.id}
                  data-testid={`slot-tile-${slot.id}`}
                  {...wrapperProps}
                >
                  <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 border-b border-neutral-300 dark:border-neutral-800/80 pb-2 mb-2.5">
                    <div className="flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
                      <CalendarIcon className="w-3.5 h-3.5 text-neutral-200" />
                      <span className="font-semibold">{dateLabel}</span>
                    </div>
                    <span className="font-mono text-[10px] text-neutral-500">v{slot.schedule_version}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-neutral-900 dark:text-white font-mono">{startLabel} – {endLabel}</span>
                    {isMaintenance ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        MAINTENANCE
                      </span>
                    ) : isBookingOrHold ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {overlappingAlloc.kind === 'booking' ? 'BOOKED' : overlappingAlloc.kind.toUpperCase()}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-neutral-900 dark:bg-white/20 text-neutral-300 border border-neutral-900 dark:border-white/30">
                        AVAILABLE
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                    <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {slot.published ? 'Published' : 'Draft'}
                    </span>
                    <span className="text-[10px] font-mono text-neutral-500">
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
                </WrapperComponent>
              );
            })}
          </div>
        )}

        {/* Active Maintenance Blocks Summary */}
        {allocations.filter(a => a.kind === 'block').length > 0 && (
          <div className="mt-8 pt-6 border-t border-neutral-300 dark:border-neutral-800 space-y-4">
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
                      <div className="text-xs font-semibold text-neutral-900 dark:text-white">
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
          <div className="glass-panel w-full max-w-2xl rounded-2xl p-6 space-y-6 max-h-[90vh] overflow-y-auto border border-neutral-700">
            <div className="flex items-center justify-between border-b border-neutral-300 dark:border-neutral-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-neutral-200" />
                  Configure Operating Hours — {selectedResource?.name}
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  Updates 7-day schedule, bumps resource schedule_version, and enforces the coverage invariant.
                </p>
              </div>
              <button
                onClick={() => setShowHoursModal(false)}
                className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:text-white cursor-pointer"
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
              <div className="p-3 bg-neutral-950/40 border border-neutral-800/60 rounded-xl text-xs text-neutral-300">
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
                        day.enabled ? 'bg-neutral-200/50 dark:bg-neutral-900/60 border-neutral-300 dark:border-neutral-800' : 'bg-neutral-100 dark:bg-neutral-950/40 border-neutral-900 opacity-60'
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
                          className="w-4 h-4 rounded text-neutral-900 dark:text-white focus:ring-neutral-900 dark:ring-white cursor-pointer"
                        />
                        <label
                          htmlFor={`day-${day.iso_weekday}`}
                          className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 cursor-pointer"
                        >
                          {weekdayInfo?.name}
                        </label>
                      </div>

                      {day.enabled ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-neutral-500 dark:text-neutral-400">Open:</span>
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
                              className="px-2 py-1 bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 rounded-lg focus:outline-none focus:border-neutral-900 dark:border-primary"
                            />
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-neutral-500 dark:text-neutral-400">Close:</span>
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
                              className="px-2 py-1 bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 rounded-lg focus:outline-none focus:border-neutral-900 dark:border-primary"
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
                              className="w-3.5 h-3.5 rounded text-neutral-900 dark:text-white focus:ring-neutral-900 dark:ring-white cursor-pointer"
                            />
                            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">+1 Day</span>
                          </label>
                        </div>
                      ) : (
                        <span className="text-xs text-neutral-600 italic">Closed</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Optional Validity Window */}
              <div className="pt-2 border-t border-neutral-300 dark:border-neutral-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                    Valid From (Optional)
                  </label>
                  <input
                    type="date"
                    value={validFromDate}
                    onChange={e => setValidFromDate(e.target.value)}
                    placeholder="Today by default"
                    className="w-full px-3 py-2 bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 rounded-xl focus:outline-none focus:border-neutral-900 dark:border-primary"
                  />
                  <p className="text-[10px] text-neutral-500 mt-1">Leave empty to take effect immediately.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                    Valid Until (Optional)
                  </label>
                  <input
                    type="date"
                    value={validUntilDate}
                    onChange={e => setValidUntilDate(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 rounded-xl focus:outline-none focus:border-neutral-900 dark:border-primary"
                  />
                  <p className="text-[10px] text-neutral-500 mt-1">Leave empty for open-ended perpetual schedule.</p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-300 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setShowHoursModal(false)}
                  className="px-4 py-2 bg-neutral-200/50 dark:bg-neutral-800 hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingHours}
                  className="px-5 py-2 bg-neutral-900 dark:bg-primary dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-neutral-200 text-neutral-950 text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-md shadow-neutral-950"
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
          <div className="glass-panel w-full max-w-md rounded-2xl p-6 space-y-6 border border-neutral-700">
            <div className="flex items-center justify-between border-b border-neutral-300 dark:border-neutral-800 pb-4">
              <h3 className="text-lg font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-400" />
                Block Court for Maintenance
              </h3>
              <button
                onClick={() => setShowBlockModal(false)}
                className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:text-white cursor-pointer"
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
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  Starts At (Local Time)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={blockStartTime}
                  onChange={e => setBlockStartTime(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  Ends At (Local Time)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={blockEndTime}
                  onChange={e => setBlockEndTime(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                  Reason / Notes
                </label>
                <input
                  type="text"
                  required
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  placeholder="e.g. Grass turf brushing & lighting check"
                  className="w-full px-3 py-2 bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 text-xs text-neutral-800 dark:text-neutral-200 rounded-xl focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-300 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setShowBlockModal(false)}
                  className="px-4 py-2 bg-neutral-200/50 dark:bg-neutral-800 hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBlock}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-md shadow-amber-950"
                >
                  {savingBlock ? 'Applying Block...' : 'Confirm Block'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Walk-in Modal */}
      {walkinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in overflow-y-auto">
          <div className="max-w-lg w-full glass-panel rounded-2xl border border-neutral-900 dark:border-white/20 p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-neutral-300 dark:border-neutral-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Banknote className="w-5 h-5 text-neutral-200" />
                <h3 className="text-base font-bold text-neutral-900 dark:text-white">Record Counter Walk-in</h3>
              </div>
              <button
                onClick={() => {
                  setWalkinModalOpen(false);
                  setWalkinSubmitError(null);
                }}
                className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {walkinSubmitError && (
              <div className="p-3 bg-red-950/40 border border-red-800 rounded-xl text-xs text-red-200">
                <span className="font-semibold text-red-300">Notice: </span>
                {walkinSubmitError}
              </div>
            )}

            <form onSubmit={handleSubmitWalkin} className="space-y-4">
              {/* Resource Selector */}
              <div className="space-y-1.5">
                <label className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">Court / Resource</label>
                <select
                  value={walkinResourceId}
                  onChange={e => setWalkinResourceId(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 dark:bg-zinc-900 border border-neutral-300 dark:border-neutral-800 rounded-xl text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-neutral-900 dark:border-primary cursor-pointer"
                >
                  {resources.map(r => (
                    <option key={r.id} value={r.id} className="bg-neutral-50 dark:bg-zinc-900 text-neutral-800 dark:text-neutral-200">
                      {r.name} ({r.booking_increment_minutes}m slot increments)
                    </option>
                  ))}
                </select>
              </div>

              {/* Date & Time Picker */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">Date</label>
                  <input
                    type="date"
                    value={walkinDate}
                    onChange={e => setWalkinDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-neutral-50 dark:bg-zinc-900 border border-neutral-300 dark:border-neutral-800 rounded-xl text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-neutral-900 dark:border-primary cursor-pointer"
                  />
                </div>

                {/* Increment-aligned Start Time Picker */}
                <div className="space-y-1.5">
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">Start Time ({venueTimezone})</label>
                  <select
                    value={walkinStartTime}
                    onChange={e => setWalkinStartTime(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 dark:bg-zinc-900 border border-neutral-300 dark:border-neutral-800 rounded-xl text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-neutral-900 dark:border-primary cursor-pointer"
                  >
                    {alignedTimeOptions.map(t => (
                      <option key={t} value={t} className="bg-neutral-50 dark:bg-zinc-900 text-neutral-800 dark:text-neutral-200">
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Duration Picker */}
                <div className="space-y-1.5">
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">Duration</label>
                  <select
                    value={walkinDurationMinutes}
                    onChange={e => setWalkinDurationMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-neutral-50 dark:bg-zinc-900 border border-neutral-300 dark:border-neutral-800 rounded-xl text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-neutral-900 dark:border-primary cursor-pointer"
                  >
                    {durationOptions.map(d => (
                      <option key={d} value={d} className="bg-neutral-50 dark:bg-zinc-900 text-neutral-800 dark:text-neutral-200">
                        {d} mins ({d / 60} {d === 60 ? 'hr' : 'hrs'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Live Quote Price Display */}
              <div className="p-3 bg-neutral-100 dark:bg-zinc-900/90 border border-neutral-300 dark:border-neutral-800 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">Total Payable Amount</div>
                  <div className="text-sm font-mono font-bold text-neutral-900 dark:text-white dark:text-neutral-200">
                    {quotingWalkin ? (
                      <span className="text-neutral-500 font-sans font-normal text-xs flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Calculating quote...
                      </span>
                    ) : walkinQuoteError ? (
                      <span className="text-red-400 font-sans font-medium text-xs">{walkinQuoteError}</span>
                    ) : walkinQuote ? (
                      formatCurrency(walkinQuote.total_minor, walkinQuote.currency)
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div className="text-right text-xs text-neutral-500">
                  <span>Authoritative Quote</span>
                </div>
              </div>

              {/* Customer Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">Customer Name *</label>
                  <input
                    type="text"
                    required
                    value={walkinContactName}
                    onChange={e => setWalkinContactName(e.target.value)}
                    placeholder="e.g. Virat Kohli"
                    className="w-full px-3 py-2 bg-neutral-50 dark:bg-zinc-900 border border-neutral-300 dark:border-neutral-800 rounded-xl text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-neutral-900 dark:border-primary"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">Customer Phone *</label>
                  <div className="flex items-center bg-neutral-50 dark:bg-zinc-900 border border-neutral-300 dark:border-neutral-800 rounded-xl focus-within:border-neutral-900 dark:border-primary overflow-hidden transition-colors">
                    <span className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 font-mono border-r border-neutral-300 dark:border-neutral-800 bg-neutral-100 dark:bg-black/40">
                      +91
                    </span>
                    <input
                      type="tel"
                      required
                      maxLength={10}
                      pattern="[0-9]{10}"
                      value={walkinContactPhone}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        if (val.length <= 10) setWalkinContactPhone(val);
                      }}
                      placeholder="9876543210"
                      className="w-full px-3 py-2 bg-transparent text-xs text-neutral-800 dark:text-neutral-200 font-mono focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">Payment Method</label>
                <select
                  value={walkinPaymentMethod}
                  onChange={e => setWalkinPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 dark:bg-zinc-900 border border-neutral-300 dark:border-neutral-800 rounded-xl text-xs text-neutral-800 dark:text-neutral-200 focus:outline-none focus:border-neutral-900 dark:border-primary cursor-pointer"
                >
                  <option value="cash" className="bg-neutral-50 dark:bg-zinc-900 text-neutral-800 dark:text-neutral-200">
                    Cash (Hand-to-Hand)
                  </option>
                  <option value="upi_offline" className="bg-neutral-50 dark:bg-zinc-900 text-neutral-800 dark:text-neutral-200">
                    Counter UPI QR Code
                  </option>
                  <option value="card_offline" className="bg-neutral-50 dark:bg-zinc-900 text-neutral-800 dark:text-neutral-200">
                    Counter POS Card Machine
                  </option>
                </select>
              </div>



              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setWalkinModalOpen(false);
                    setWalkinSubmitError(null);
                  }}
                  disabled={submittingWalkin}
                  className="px-4 py-2 bg-neutral-200/50 dark:bg-neutral-800 hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingWalkin || Boolean(walkinQuoteError)}
                  className="px-5 py-2 bg-neutral-900 dark:bg-primary dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-neutral-200 text-neutral-950 text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50 shadow-lg shadow-neutral-950"
                >
                  {submittingWalkin ? 'Recording...' : 'Confirm & Record Walk-in'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Booking Modal */}
      {cancellingBookingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in overflow-y-auto">
          <div className="max-w-md w-full glass-panel rounded-2xl border border-red-500/30 p-6 space-y-5 bg-black">
            <div className="flex items-center justify-between border-b border-neutral-300 dark:border-neutral-800 pb-3">
              <h3 className="text-lg font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-500" />
                Cancel Booking
              </h3>
              <button
                onClick={() => setCancellingBookingId(null)}
                className="text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cancelError && (
              <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-300">
                {cancelError}
              </div>
            )}

            <div className="space-y-5">
              <div className="p-4 bg-red-950/20 border border-red-500/20 rounded-xl space-y-2">
                <p className="text-base text-neutral-700 dark:text-neutral-300 leading-snug">
                  Are you sure you want to cancel this booking? This will immediately free up the slot for other customers.
                </p>
                {loadingCancelContact ? (
                  <p className="text-sm text-neutral-500 mt-2 flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" /> Loading customer info...
                  </p>
                ) : cancellingContact ? (
                  <div className="mt-3 pt-3 border-t border-red-900/30 space-y-1">
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">Customer: <span className="font-bold text-neutral-900 dark:text-white text-base">{cancellingContact.contact_name || 'N/A'}</span></p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">Phone: <span className="font-mono text-neutral-900 dark:text-white text-base">{cancellingContact.contact_phone || 'N/A'}</span></p>
                  </div>
                ) : null}
              </div>

              <div>
                <label className="block text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-1.5">
                  Cancellation Reason / Notes
                </label>
                <input
                  type="text"
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder="e.g. Player requested cancellation"
                  className="w-full px-4 py-3 bg-neutral-50 dark:bg-zinc-900 border border-neutral-300 dark:border-neutral-800 text-sm text-neutral-800 dark:text-neutral-200 rounded-xl focus:outline-none focus:border-red-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-5 border-t border-neutral-300 dark:border-neutral-800">
              <button
                onClick={() => setCancellingBookingId(null)}
                className="px-5 py-2.5 bg-neutral-200/50 dark:bg-neutral-800 hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 text-sm font-semibold rounded-xl cursor-pointer transition-colors"
              >
                Keep Booking
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={submittingCancel}
                className="px-6 py-2.5 bg-red-500 hover:bg-red-400 text-white text-sm font-bold rounded-xl transition-colors cursor-pointer shadow-md shadow-red-950 disabled:opacity-50"
              >
                {submittingCancel ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
