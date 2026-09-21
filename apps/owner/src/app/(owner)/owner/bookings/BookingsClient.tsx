'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import {
  Ticket,
  Calendar as CalendarIcon,
  Clock,
  Building2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
  ChevronLeft,
  ChevronRight,
  User,
  Phone,
  Mail,
  Plus,
  ShieldAlert,
  Layers,
  Ban,
  Info,
  Banknote,
  Search,
  Filter
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

interface BookingListItem {
  id: string;
  reference_code: string;
  turf_id: string;
  resource_id: string;
  source: string;
  status: string;
  starts_at: string;
  ends_at: string;
  total_minor: number;
  currency: string;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  resources?: {
    id: string;
    name: string;
    booking_increment_minutes: number;
  } | null;
}

interface BookingContact {
  booking_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

// Timezone helpers (reused from CalendarClient)
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

function formatCurrency(amountMinor: number, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amountMinor / 100);
}

// Prefix-first error mapping (Correction 1)
export function mapBookingError(err: unknown): string {
  if (!err) return 'An unexpected error occurred';
  const errObj = err as { message?: string; code?: string };
  const rawMessage = typeof err === 'string' ? err : errObj.message || '';
  const prefix = rawMessage.includes(':') ? rawMessage.split(':')[0].trim() : rawMessage.trim();
  const detail = rawMessage.includes(':') ? rawMessage.substring(rawMessage.indexOf(':') + 1).trim() : '';

  switch (prefix) {
    case 'OUTSIDE_OPERATING_HOURS':
      return "outside the venue's operating hours";
    case 'DURATION_TOO_SHORT':
      return detail.toLowerCase().startsWith('minimum duration is')
        ? detail.toLowerCase()
        : 'minimum duration not met';
    case 'DURATION_TOO_LONG':
      return detail.toLowerCase().startsWith('maximum duration is')
        ? detail.toLowerCase()
        : 'maximum duration exceeded';
    case 'INVALID_INCREMENT':
      return detail.toLowerCase().startsWith('duration must be an exact multiple of')
        ? detail.toLowerCase()
        : 'duration must be an exact multiple of booking increment';
    case 'INVALID_TIME_RANGE':
      return 'end must be after start';
    case 'SLOT_UNAVAILABLE':
      return 'slot was just taken';
    case 'SLOT_NOT_FOUND':
      return 'start time is not aligned to the booking increment';
    case 'PRICING_NOT_CONFIGURED':
      return 'no pricing rule covers this slot';
    case 'BOOKING_NOT_FOUND':
    case 'PERM_DENIED':
    case 'PERMISSION_DENIED':
    case 'RESOURCE_UNAVAILABLE':
    case 'IDEMPOTENCY_KEY_REQUIRED':
    case 'INVALID_BOOKING_STATUS':
    case 'RESOURCE_NOT_FOUND':
    case 'PROFILE_NOT_FOUND':
    case 'AUTH_REQUIRED':
      return rawMessage;
    default:
      if (errObj.code === '23P01') return 'slot was just taken';
      if (errObj.code === 'P0003') return 'start time is not aligned to the booking increment';
      return rawMessage || 'Operation failed';

  }
}

export default function BookingsClient() {
  const supabase = useMemo(() => createBrowserClient('owner'), []);

  // Capabilities & User Context
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loadingCaps, setLoadingCaps] = useState(true);

  // Venues & Resources
  const [turfs, setTurfs] = useState<TurfItem[]>([]);
  const [selectedTurfId, setSelectedTurfId] = useState<string>('');
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('all');

  // Filters & State
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [bookings, setBookings] = useState<BookingListItem[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // Modals & Feedback
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Contact Modal State
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactBooking, setContactBooking] = useState<BookingListItem | null>(null);
  const [contactData, setContactData] = useState<BookingContact | null>(null);
  const [loadingContact, setLoadingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  // Cancel Modal State
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancellingBooking, setCancellingBooking] = useState<BookingListItem | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('Player requested cancellation');
  const [submittingCancel, setSubmittingCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

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

  // Derived capability gating (Correction 2 & 3)
  const canReadBookings = isOwner || capabilities.includes('bookings.read');
  const canCreateWalkin =
    isOwner ||
    (capabilities.includes('bookings.create_walkin') && capabilities.includes('payments.record_offline')) ||
    capabilities.includes('bookings.manage');
  const canCancel = isOwner || capabilities.includes('bookings.cancel');

  const selectedTurf = useMemo(
    () => turfs.find(t => t.id === selectedTurfId),
    [turfs, selectedTurfId]
  );
  const venueTimezone = selectedTurf?.timezone || 'Asia/Kolkata';

  const { dayStartIso, dayEndIso } = useMemo(() => {
    return getLocalDayBoundaries(selectedDate, venueTimezone);
  }, [selectedDate, venueTimezone]);

  // Selected Walk-in Resource
  const selectedWalkinResource = useMemo(
    () => resources.find(r => r.id === walkinResourceId) || resources[0],
    [resources, walkinResourceId]
  );

  // Increment-aligned time slots for walk-in time picker
  const alignedTimeOptions = useMemo(() => {
    const inc = selectedWalkinResource?.booking_increment_minutes || 60;
    const options: string[] = [];
    // Generate times across typical hours: 06:00 to 23:00
    for (let h = 6; h <= 23; h++) {
      for (let m = 0; m < 60; m += inc) {
        if (h === 23 && m > 0) break;
        const hh = h.toString().padStart(2, '0');
        const mm = m.toString().padStart(2, '0');
        options.push(`${hh}:${mm}`);
      }
    }
    return options;
  }, [selectedWalkinResource]);

  // Duration options for walk-in picker based on min/max duration and increment
  const durationOptions = useMemo(() => {
    const inc = selectedWalkinResource?.booking_increment_minutes || 60;
    const min = selectedWalkinResource?.minimum_duration_minutes || 60;
    const max = selectedWalkinResource?.maximum_duration_minutes || 180;
    const options: number[] = [];
    for (let d = min; d <= max; d += inc) {
      options.push(d);
    }
    return options.length > 0 ? options : [60, 120, 180];
  }, [selectedWalkinResource]);

  // Toast auto-hide
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // 1. Initial Load: Fetch Capabilities and Accessible Turfs
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

  // 2. Fetch Resources when Turf changes
  useEffect(() => {
    if (!selectedTurfId) {
      setResources([]);
      setSelectedResourceId('all');
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
        if (resList.length > 0 && !walkinResourceId) {
          setWalkinResourceId(resList[0].id);
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
  }, [selectedTurfId, supabase, walkinResourceId]);

  // 3. Load Bookings via PostgREST (Gated on canReadBookings)
  const loadBookings = useCallback(async () => {
    if (!selectedTurfId || !canReadBookings) {
      setBookings([]);
      return;
    }

    setLoadingBookings(true);
    try {
      let query = supabase
        .from('bookings')
        .select(`
          id,
          reference_code,
          turf_id,
          resource_id,
          source,
          status,
          starts_at,
          ends_at,
          total_minor,
          currency,
          created_at,
          confirmed_at,
          cancelled_at,
          resources (
            id,
            name,
            booking_increment_minutes
          )
        `)
        .eq('turf_id', selectedTurfId)
        .gte('starts_at', dayStartIso)
        .lt('starts_at', dayEndIso)
        .order('starts_at', { ascending: true });

      if (selectedResourceId && selectedResourceId !== 'all') {
        query = query.eq('resource_id', selectedResourceId);
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Handle single or array embed from PostgREST composite FK
      const formatted = ((data as unknown[]) || []).map((row: any) => {
        const res = Array.isArray(row.resources) ? row.resources[0] : row.resources;
        return {
          ...row,
          resources: res || null
        } as BookingListItem;
      });

      setBookings(formatted);
    } catch (err: unknown) {
      setGeneralError(extractDatabaseError(err, 'Failed to load bookings'));
    } finally {
      setLoadingBookings(false);
    }
  }, [selectedTurfId, canReadBookings, dayStartIso, dayEndIso, selectedResourceId, statusFilter, supabase]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  // 4. On-demand Contact Fetch (Correction 5)
  const handleOpenContact = async (b: BookingListItem) => {
    setContactBooking(b);
    setContactData(null);
    setContactError(null);
    setContactModalOpen(true);
    setLoadingContact(true);

    try {
      const { data, error } = await supabase.rpc('get_booking_contact', {
        p_booking_id: b.id
      });
      if (error) throw error;
      setContactData(data as BookingContact);
    } catch (err: unknown) {
      setContactError(extractDatabaseError(err, 'Failed to retrieve booking contact'));
    } finally {
      setLoadingContact(false);
    }
  };

  // 5. Cancellation Handler (Verbatim server error display)
  const handleConfirmCancel = async () => {
    if (!cancellingBooking) return;
    setSubmittingCancel(true);
    setCancelError(null);

    try {
      const { error } = await supabase.rpc('cancel_booking', {
        p_booking_id: cancellingBooking.id,
        p_reason: cancelReason || 'Player requested cancellation'
      });

      if (error) {
        // Show server message verbatim
        setCancelError(error.message || 'Cancellation rejected by server');
        return;
      }

      setToastMessage(`Booking ${cancellingBooking.reference_code} cancelled successfully.`);
      setCancelModalOpen(false);
      setCancellingBooking(null);
      await loadBookings();
    } catch (err: unknown) {
      setCancelError(extractDatabaseError(err, 'Failed to cancel booking'));
    } finally {
      setSubmittingCancel(false);
    }
  };

  // 6. Live Quote for Walk-in Modal
  const computeWalkinInterval = useCallback(() => {
    if (!walkinDate || !walkinStartTime || !walkinDurationMinutes) return null;
    const [hh, mm] = walkinStartTime.split(':').map(Number);
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
        setWalkinQuoteError(mapBookingError(error));
        setWalkinQuote(null);
      } else {
        setWalkinQuote({
          total_minor: data?.total_minor || 0,
          currency: data?.currency || 'INR'
        });
      }
    } catch (err: unknown) {
      setWalkinQuoteError(mapBookingError(err));
      setWalkinQuote(null);
    } finally {
      setQuotingWalkin(false);
    }
  }, [walkinResourceId, computeWalkinInterval, supabase]);

  // Recalculate quote on relevant parameter change
  useEffect(() => {
    if (walkinModalOpen) {
      updateWalkinQuote();
    }
  }, [walkinModalOpen, walkinResourceId, walkinDate, walkinStartTime, walkinDurationMinutes, updateWalkinQuote]);

  // 7. Submit Walk-in Booking
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
    if (!walkinContactPhone.trim()) {
      setWalkinSubmitError('Contact phone is required');
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
        p_contact_phone: walkinContactPhone.trim(),
        p_contact_email: walkinContactEmail.trim() || null,
        p_payment_method: walkinPaymentMethod,
        p_notes: walkinNotes.trim() || null,
        p_idempotency_key: idempotencyKey
      });

      if (error) {
        setWalkinSubmitError(mapBookingError(error));
        return;
      }

      setToastMessage(`Walk-in booking confirmed (${data?.reference_code || 'Success'})`);
      setWalkinModalOpen(false);
      // Reset form
      setWalkinContactName('');
      setWalkinContactPhone('');
      setWalkinContactEmail('');
      setWalkinNotes('');
      setWalkinSubmitError(null);
      await loadBookings();
    } catch (err: unknown) {
      setWalkinSubmitError(mapBookingError(err));
    } finally {
      setSubmittingWalkin(false);
    }
  };

  // Date Navigation
  const handleDateStep = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 bg-emerald-950/90 border border-emerald-500/40 rounded-2xl shadow-2xl backdrop-blur-md text-emerald-200 text-sm animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Ticket className="w-6 h-6 text-emerald-400" />
            Bookings & Reservations
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Monitor real-time court reservations, record walk-in entries, and manage customer cancellations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Venue Selector */}
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
            onClick={() => loadBookings()}
            disabled={loadingBookings}
            title="Refresh Bookings"
            className="p-2.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loadingBookings ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          {/* New Walk-in Button (Gated on canCreateWalkin) */}
          {canCreateWalkin && (
            <button
              onClick={() => {
                setWalkinDate(selectedDate);
                setWalkinModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-bold rounded-xl transition-colors shadow-lg shadow-emerald-950 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Record Walk-in</span>
            </button>
          )}
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

      {/* Controls & Filter Panel */}
      <div className="glass-panel p-4 rounded-2xl space-y-4">
        {/* Visible Row for Venue Timezone and Context */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-slate-800 rounded-xl text-xs">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">Venue Timezone:</span>
              <span className="font-mono font-bold text-emerald-400">{venueTimezone}</span>
            </div>
            <div className="text-xs text-slate-400">
              Showing bookings for{' '}
              <span className="text-slate-200 font-semibold">
                {formatLocalHeaderDate(dayStartIso, venueTimezone)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-mono">
              {bookings.length} {bookings.length === 1 ? 'reservation' : 'reservations'} loaded
            </span>
          </div>
        </div>

        {/* Date, Resource, and Status Filters */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Quick Date Stepper */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDateStep(-1)}
              className="p-2 bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Previous Day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-slate-800 rounded-xl">
              <CalendarIcon className="w-4 h-4 text-emerald-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="bg-transparent text-sm text-slate-200 font-medium focus:outline-none cursor-pointer"
              />
            </div>
            <button
              onClick={() => handleDateStep(1)}
              className="p-2 bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl transition-colors cursor-pointer"
              title="Next Day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
              className="px-3 py-1.5 bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/50 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Today
            </button>
          </div>

          {/* Court Resource Filter */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-slate-800 rounded-xl text-xs">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400">Court:</span>
              <select
                value={selectedResourceId}
                onChange={e => setSelectedResourceId(e.target.value)}
                className="bg-transparent text-xs text-slate-200 font-medium focus:outline-none cursor-pointer"
              >
                <option value="all" className="bg-slate-900 text-slate-200">
                  All Courts ({resources.length})
                </option>
                {resources.map(r => (
                  <option key={r.id} value={r.id} className="bg-slate-900 text-slate-200">
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter (Correction 4: All 7 Statuses) */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-slate-800 rounded-xl text-xs">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400">Status:</span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-transparent text-xs text-slate-200 font-medium focus:outline-none cursor-pointer"
              >
                <option value="all" className="bg-slate-900 text-slate-200">
                  All Statuses
                </option>
                <option value="confirmed" className="bg-slate-900 text-slate-200">
                  Confirmed
                </option>
                <option value="held" className="bg-slate-900 text-slate-200">
                  Held
                </option>
                <option value="cancelled" className="bg-slate-900 text-slate-200">
                  Cancelled
                </option>
                <option value="completed" className="bg-slate-900 text-slate-200">
                  Completed
                </option>
                <option value="expired" className="bg-slate-900 text-slate-200">
                  Expired
                </option>
                <option value="no_show" className="bg-slate-900 text-slate-200">
                  No Show
                </option>
                <option value="payment_exception" className="bg-slate-900 text-slate-200">
                  Payment Exception
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {!canReadBookings ? (
        /* Correction 3: Explicit missing capability state instead of empty list */
        <div className="p-8 bg-slate-900/60 border border-slate-800 rounded-2xl text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white">Booking Read Access Restricted</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Your account does not possess the <code className="text-amber-300 font-mono">bookings.read</code> capability
            for this venue. Viewing existing reservation records is restricted.
          </p>
          {canCreateWalkin && (
            <p className="text-xs text-emerald-400/90 font-medium">
              You are authorized to record new walk-in bookings using the &ldquo;Record Walk-in&rdquo; button above.
            </p>
          )}
        </div>
      ) : loadingBookings ? (
        <div className="p-12 text-center text-slate-500 flex items-center justify-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
          <span>Loading bookings for {selectedDate}...</span>
        </div>
      ) : bookings.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/40 border border-slate-800/80 rounded-2xl space-y-2">
          <Ticket className="w-8 h-8 text-slate-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-300">No Reservations Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No reservations matched the selected date ({selectedDate}) and filter criteria.
          </p>
        </div>
      ) : (
        /* Booking Table */
        <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/80 border-b border-slate-800 text-xs text-slate-400 uppercase font-semibold">
                <tr>
                  <th className="px-5 py-3.5">Ref Code</th>
                  <th className="px-5 py-3.5">Court</th>
                  <th className="px-5 py-3.5">Local Schedule</th>
                  <th className="px-5 py-3.5">Source</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Amount</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {bookings.map(b => {
                  const startTime = formatLocalTime(b.starts_at, venueTimezone);
                  const endTime = formatLocalTime(b.ends_at, venueTimezone);
                  const bookingDate = formatLocalDate(b.starts_at, venueTimezone);

                  return (
                    <tr key={b.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-5 py-4 font-mono font-bold text-slate-200">
                        {b.reference_code}
                      </td>
                      <td className="px-5 py-4 text-slate-300">
                        {b.resources?.name || 'Standard Pitch'}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 text-slate-200">
                          <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>
                            {startTime} - {endTime}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{bookingDate}</div>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
                            b.source === 'walkin'
                              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                              : 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                          }`}
                        >
                          {b.source === 'walkin' ? 'Walk-in' : 'Online'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold capitalize ${
                            b.status === 'confirmed'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : b.status === 'cancelled'
                              ? 'bg-red-500/15 text-red-300 border border-red-500/30'
                              : b.status === 'held'
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {b.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-slate-200">
                        {formatCurrency(b.total_minor, b.currency)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Contact Details (On-Demand PII) */}
                          <button
                            onClick={() => handleOpenContact(b)}
                            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                            title="View Contact Details"
                          >
                            Contact
                          </button>

                          {/* Cancellation Button (Gated on canCancel & confirmed) */}
                          {canCancel && b.status === 'confirmed' && (
                            <button
                              onClick={() => {
                                setCancellingBooking(b);
                                setCancelError(null);
                                setCancelReason('Player requested cancellation');
                                setCancelModalOpen(true);
                              }}
                              className="px-2.5 py-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                              title="Cancel Reservation"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* On-Demand Contact Modal (Correction 5) */}
      {contactModalOpen && contactBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="max-w-md w-full glass-panel rounded-2xl border border-slate-800 p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">
                  Customer Contact ({contactBooking.reference_code})
                </h3>
              </div>
              <button
                onClick={() => {
                  setContactModalOpen(false);
                  setContactBooking(null);
                  setContactData(null);
                }}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingContact ? (
              <div className="p-8 text-center flex items-center justify-center gap-2 text-slate-400 text-sm">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Decrypting contact record...</span>
              </div>
            ) : contactError ? (
              <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-200">
                {contactError}
              </div>
            ) : contactData &&
              !contactData.contact_name &&
              !contactData.contact_phone &&
              !contactData.contact_email ? (
              /* Expired retention state */
              <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-xl text-center space-y-2">
                <ShieldAlert className="w-6 h-6 text-amber-400 mx-auto" />
                <h4 className="text-sm font-semibold text-slate-200">Contact Record Expired</h4>
                <p className="text-xs text-slate-400">
                  Customer contact details are no longer retained under the statutory 180-day privacy policy.
                </p>
              </div>
            ) : contactData ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                  <User className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <div className="text-xs text-slate-500">Customer Name</div>
                    <div className="text-sm font-semibold text-slate-200">
                      {contactData.contact_name || 'N/A'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                  <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <div className="text-xs text-slate-500">Phone Number</div>
                    <div className="text-sm font-semibold text-slate-200 font-mono">
                      {contactData.contact_phone || 'N/A'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                  <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                  <div>
                    <div className="text-xs text-slate-500">Email Address</div>
                    <div className="text-sm font-semibold text-slate-200">
                      {contactData.contact_email || 'Not provided'}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-2.5 bg-slate-950/60 border border-slate-900 rounded-xl text-[11px] text-slate-500">
                  <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span>Customer PII retrieved on-demand under the 180-day data retention window.</span>
                </div>
              </div>
            ) : null}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => {
                  setContactModalOpen(false);
                  setContactBooking(null);
                  setContactData(null);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancellation Modal (Verbatim server error display) */}
      {cancelModalOpen && cancellingBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="max-w-md w-full glass-panel rounded-2xl border border-red-500/20 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2 text-red-400">
                <Ban className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Cancel Reservation</h3>
              </div>
              <button
                onClick={() => {
                  setCancelModalOpen(false);
                  setCancellingBooking(null);
                  setCancelError(null);
                }}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              You are about to cancel reservation{' '}
              <span className="font-mono font-bold text-white">{cancellingBooking.reference_code}</span>.
              The slot inventory will be freed immediately and refund policy rules will be applied.
            </p>

            {cancelError && (
              <div className="p-3 bg-red-950/50 border border-red-800 rounded-xl text-xs text-red-200">
                <span className="font-semibold text-red-300">Server Notice: </span>
                {cancelError}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Cancellation Reason</label>
              <input
                type="text"
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setCancelModalOpen(false);
                  setCancellingBooking(null);
                  setCancelError(null);
                }}
                disabled={submittingCancel}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={submittingCancel}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                {submittingCancel ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Walk-in Modal */}
      {walkinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in overflow-y-auto">
          <div className="max-w-lg w-full glass-panel rounded-2xl border border-emerald-500/20 p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Banknote className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">Record Counter Walk-in</h3>
              </div>
              <button
                onClick={() => {
                  setWalkinModalOpen(false);
                  setWalkinSubmitError(null);
                }}
                className="text-slate-400 hover:text-slate-200 cursor-pointer"
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
                <label className="text-xs text-slate-400 font-medium">Court / Resource</label>
                <select
                  value={walkinResourceId}
                  onChange={e => setWalkinResourceId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  {resources.map(r => (
                    <option key={r.id} value={r.id} className="bg-slate-900 text-slate-200">
                      {r.name} ({r.booking_increment_minutes}m slot increments)
                    </option>
                  ))}
                </select>
              </div>

              {/* Date & Time Picker */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-medium">Date</label>
                  <input
                    type="date"
                    value={walkinDate}
                    onChange={e => setWalkinDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  />
                </div>

                {/* Increment-aligned Start Time Picker */}
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-medium">Start Time ({venueTimezone})</label>
                  <select
                    value={walkinStartTime}
                    onChange={e => setWalkinStartTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    {alignedTimeOptions.map(t => (
                      <option key={t} value={t} className="bg-slate-900 text-slate-200">
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Duration Picker */}
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-medium">Duration</label>
                  <select
                    value={walkinDurationMinutes}
                    onChange={e => setWalkinDurationMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    {durationOptions.map(d => (
                      <option key={d} value={d} className="bg-slate-900 text-slate-200">
                        {d} mins ({d / 60} {d === 60 ? 'hr' : 'hrs'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Live Quote Price Display */}
              <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">Total Payable Amount</div>
                  <div className="text-sm font-mono font-bold text-emerald-400">
                    {quotingWalkin ? (
                      <span className="text-slate-500 font-sans font-normal text-xs flex items-center gap-1">
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
                <div className="text-right text-xs text-slate-500">
                  <span>Authoritative Quote</span>
                </div>
              </div>

              {/* Customer Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-medium">Customer Name *</label>
                  <input
                    type="text"
                    required
                    value={walkinContactName}
                    onChange={e => setWalkinContactName(e.target.value)}
                    placeholder="e.g. Virat Kohli"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-medium">Customer Phone *</label>
                  <input
                    type="tel"
                    required
                    value={walkinContactPhone}
                    onChange={e => setWalkinContactPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-medium">Customer Email (Optional)</label>
                  <input
                    type="email"
                    value={walkinContactEmail}
                    onChange={e => setWalkinContactEmail(e.target.value)}
                    placeholder="player@example.com"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-medium">Payment Method Received</label>
                  <select
                    value={walkinPaymentMethod}
                    onChange={e => setWalkinPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="cash" className="bg-slate-900 text-slate-200">
                      Cash (Hand-to-Hand)
                    </option>
                    <option value="upi_offline" className="bg-slate-900 text-slate-200">
                      Counter UPI QR Code
                    </option>
                    <option value="card_offline" className="bg-slate-900 text-slate-200">
                      Counter POS Card Machine
                    </option>
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">Internal Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={walkinNotes}
                  onChange={e => setWalkinNotes(e.target.value)}
                  placeholder="Counter notes or reference..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 resize-none"
                />
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
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingWalkin || Boolean(walkinQuoteError)}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50 shadow-lg shadow-emerald-950"
                >
                  {submittingWalkin ? 'Recording...' : 'Confirm & Record Walk-in'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
