'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import { formatINR, formatTime } from '@/lib/utils';
import {
  getConfirmedAllocationsForResource,
  getActiveHoldsForResource,
  recordActiveHold,
} from '@/lib/bookings-store';
import {
  Calendar,
  Clock,
  AlertCircle,
  Sparkles,
  ArrowUpRight,
  Check,
  Minus,
  Plus,
  ChevronUp,
} from 'lucide-react';

interface Resource {
  id: string;
  name: string;
  booking_increment_minutes: number;
  minimum_duration_minutes?: number;
  maximum_duration_minutes?: number;
}

interface SlotPickerProps {
  turf: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
  };
  resources: Resource[];
  initialResourceId?: string;
}

function getLocalDateString(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch (e) {
    return date.toISOString().split('T')[0];
  }
}

function getTimezoneOffsetString(date: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'Asia/Kolkata',
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart && tzPart.value.startsWith('GMT')) {
      const offset = tzPart.value.replace('GMT', '');
      if (!offset) return '+00:00';
      const match = offset.match(/^([+-])(\d+)(?::(\d+))?$/);
      if (match) {
        const sign = match[1];
        const hours = match[2].padStart(2, '0');
        const mins = (match[3] || '00').padStart(2, '0');
        return `${sign}${hours}:${mins}`;
      }
    }
    return '+05:30';
  } catch (e) {
    return '+05:30';
  }
}

export function SlotPicker({ turf, resources, initialResourceId }: SlotPickerProps) {
  const router = useRouter();
  const supabase = createBrowserClient('player');
  const timezone = turf.timezone || 'Asia/Kolkata';

  const [selectedResource, setSelectedResource] = useState<Resource | undefined>(() => {
    if (initialResourceId) {
      const match = resources?.find((r) => r.id === initialResourceId);
      if (match) return match;
    }
    return resources?.[0];
  });

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return getLocalDateString(new Date(), timezone);
  });

  // Duration in hours: 1, 2, 3, 4 etc.
  const [durationHours, setDurationHours] = useState<number>(1);

  const [selectedSlot, setSelectedSlot] = useState<{ start: string; end: string } | null>(null);
  const [quote, setQuote] = useState<any>(null);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [operatingHours, setOperatingHours] = useState<{ opens: number; closes: number }>({
    opens: 6,
    closes: 23,
  });
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Maximum allowed duration in hours (defaults to 4 if not set)
  const maxDurationHours = Math.min(
    6,
    Math.max(1, Math.floor((selectedResource?.maximum_duration_minutes || 240) / 60))
  );

  // Generate date options (Next 7 days in turf timezone)
  const dateOptions = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = getLocalDateString(d, timezone);
      const label =
        i === 0
          ? 'Today'
          : i === 1
          ? 'Tomorrow'
          : new Intl.DateTimeFormat('en-IN', {
              timeZone: timezone,
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            }).format(d);
      return { dateStr, label };
    });
  }, [timezone]);

  // Fetch operating hours & allocations for selected date & resource
  const loadResourceSchedule = useCallback(async () => {
    if (!selectedResource) return;
    setLoadingSlots(true);
    setError(null);
    setSelectedSlot(null);
    setQuote(null);

    try {
      const tzOffset = getTimezoneOffsetString(new Date(`${selectedDate}T12:00:00Z`), timezone);
      const startOfDay = `${selectedDate}T00:00:00${tzOffset}`;
      const endOfDay = `${selectedDate}T23:59:59${tzOffset}`;

      // 1. Fetch operating hours for this resource
      const { data: hoursData } = await supabase
        .from('operating_hours')
        .select('iso_weekday, opens_at, closes_at')
        .eq('resource_id', selectedResource.id);

      if (hoursData && hoursData.length > 0) {
        const targetDay = new Date(`${selectedDate}T12:00:00Z`).getUTCDay() || 7;
        const matchedDay = hoursData.find((h) => h.iso_weekday === targetDay) || hoursData[0];
        if (matchedDay) {
          const openHour = parseInt(matchedDay.opens_at.split(':')[0], 10);
          const closeHour = parseInt(matchedDay.closes_at.split(':')[0], 10);
          setOperatingHours({
            opens: isNaN(openHour) ? 6 : openHour,
            closes: isNaN(closeHour) ? 23 : closeHour,
          });
        }
      }

      // 2. Call authoritative RPC: get_public_slot_allocations
      const { data: dbAllocs } = await supabase.rpc(
        'get_public_slot_allocations',
        {
          p_resource_id: selectedResource.id,
          p_starts_at: startOfDay,
          p_ends_at: endOfDay,
        }
      );

      // 3. Merge with permanent confirmed allocations from local store
      const localConfirmedAllocs = getConfirmedAllocationsForResource(
        selectedResource.id,
        startOfDay,
        endOfDay,
        selectedResource.name
      );

      // 4. Fetch server-side confirmed allocations across all clients
      let serverConfirmedAllocs: any[] = [];
      try {
        const sRes = await fetch(
          `/api/confirmed-slots?resource_id=${encodeURIComponent(selectedResource.id)}&starts_at=${encodeURIComponent(startOfDay)}&ends_at=${encodeURIComponent(endOfDay)}`
        );
        if (sRes.ok) {
          const sData = await sRes.json();
          serverConfirmedAllocs = sData.slots || [];
        }
      } catch (_) {}

      // 5. Fetch local active holds
      const localActiveHolds = getActiveHoldsForResource(
        selectedResource.id,
        startOfDay,
        endOfDay,
        selectedResource.name
      );

      // 6. Fetch server-side active holds across all clients
      let serverActiveHolds: any[] = [];
      try {
        const hRes = await fetch(
          `/api/active-holds?resource_id=${encodeURIComponent(selectedResource.id)}&starts_at=${encodeURIComponent(startOfDay)}&ends_at=${encodeURIComponent(endOfDay)}`
        );
        if (hRes.ok) {
          const hData = await hRes.json();
          serverActiveHolds = hData.holds || [];
        }
      } catch (_) {}

      // Combine confirmed allocations
      const confirmedList = [
        ...localConfirmedAllocs.map((c) => ({ ...c, isConfirmedBooking: true, isHold: false })),
        ...serverConfirmedAllocs.map((c) => ({ ...c, isConfirmedBooking: true, isHold: false })),
      ];

      // Process dbAllocs: if matching confirmedList, it's confirmed. Otherwise it's an unconfirmed active hold!
      const processedDbAllocs = (dbAllocs || []).map((dba: any) => {
        const isConfirmed = confirmedList.some((c) => {
          const cStart = new Date(c.starts_at).getTime();
          const cEnd = new Date(c.ends_at).getTime();
          const dbaStart = new Date(dba.starts_at).getTime();
          const dbaEnd = new Date(dba.ends_at).getTime();
          return Math.max(cStart, dbaStart) < Math.min(cEnd, dbaEnd);
        });
        return {
          starts_at: dba.starts_at,
          ends_at: dba.ends_at,
          isConfirmedBooking: isConfirmed,
          isHold: !isConfirmed,
        };
      });

      // Combine all allocations so confirmed bookings and active holds are precisely tracked
      const mergedAllocs = [
        ...processedDbAllocs,
        ...confirmedList,
        ...localActiveHolds.map((h) => ({ ...h, isHold: true, isConfirmedBooking: false })),
        ...serverActiveHolds.map((h) => ({ ...h, isHold: true, isConfirmedBooking: false })),
      ];

      setAllocations(mergedAllocs);
    } catch (err: unknown) {
      console.error('Error loading slots from RPC:', err);
      setError(extractDatabaseError(err, 'Failed to load slots'));
    } finally {
      setLoadingSlots(false);
    }
  }, [selectedResource, selectedDate, timezone, supabase]);

  useEffect(() => {
    loadResourceSchedule();

    // Cross-tab and local event listeners to immediately mark slots as booked upon payment
    const handleBookingConfirmed = () => {
      loadResourceSchedule();
    };

    const handleHoldUpdated = () => {
      loadResourceSchedule();
    };

    window.addEventListener('ewrone-booking-confirmed', handleBookingConfirmed);
    window.addEventListener('ewrone-hold-updated', handleHoldUpdated);
    window.addEventListener('storage', handleBookingConfirmed);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('ewrone_bookings_channel');
      bc.onmessage = (ev) => {
        if (
          ev.data?.type === 'BOOKING_CONFIRMED' ||
          ev.data?.type === 'HOLD_CREATED' ||
          ev.data?.type === 'HOLD_RELEASED'
        ) {
          loadResourceSchedule();
        }
      };
    }

    return () => {
      window.removeEventListener('ewrone-booking-confirmed', handleBookingConfirmed);
      window.removeEventListener('ewrone-hold-updated', handleHoldUpdated);
      window.removeEventListener('storage', handleBookingConfirmed);
      if (bc) bc.close();
    };
  }, [loadResourceSchedule]);

  // Generate slots across operating hours with duration in mind
  const tzOffset = getTimezoneOffsetString(new Date(`${selectedDate}T12:00:00Z`), timezone);
  const startHour = operatingHours.opens;
  const endHour = operatingHours.closes;
  const slotCount = Math.max(1, endHour - startHour);

  const timeSlots = useMemo(() => {
    return Array.from({ length: slotCount }, (_, i) => {
      const hour = startHour + i;
      const startHourStr = hour.toString().padStart(2, '0');
      const startIso = `${selectedDate}T${startHourStr}:00:00${tzOffset}`;

      const slotStartTime = new Date(startIso).getTime();
      const slotStartHourEnd = slotStartTime + 60 * 60 * 1000;
      const slotEndTime = slotStartTime + durationHours * 60 * 60 * 1000;
      const endIso = new Date(slotEndTime).toISOString();

      // 12-hour formatted start label: e.g. "11:00 AM", "1:00 PM"
      const period = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 === 0 ? 12 : hour % 12;
      const startLabel = `${displayHour}:00 ${period}`;

      // 1. Check if the starting slot itself is occupied by ANY allocation
      const startingHourAlloc = allocations.find((a) => {
        const aStart = new Date(a.starts_at).getTime();
        const aEnd = new Date(a.ends_at).getTime();
        return Math.max(aStart, slotStartTime) < Math.min(aEnd, slotStartHourEnd);
      });

      // 2. Check if start time is already in the past
      const isPast = slotStartTime < Date.now();

      // 3. Check if requested duration exceeds venue operating hours (e.g. closing at 11 PM)
      const exceedsHours = hour + durationHours > endHour;

      // 4. Check if the requested multi-hour duration collides with any allocation at later hours
      const fullDurationCollisionAlloc = allocations.find((a) => {
        const aStart = new Date(a.starts_at).getTime();
        const aEnd = new Date(a.ends_at).getTime();
        return Math.max(aStart, slotStartTime) < Math.min(aEnd, slotEndTime);
      });

      // Determine slotStatus: 'booked' | 'hold' | 'not_possible' | 'available'
      let slotStatus: 'booked' | 'hold' | 'not_possible' | 'available' = 'available';
      let statusReason = '';

      if (startingHourAlloc) {
        if (startingHourAlloc.isConfirmedBooking) {
          slotStatus = 'booked';
          statusReason = 'Slot is confirmed booked';
        } else {
          slotStatus = 'hold';
          statusReason = 'Slot is currently on hold pending payment';
        }
      } else if (isPast) {
        slotStatus = 'not_possible';
        statusReason = 'Slot time has already passed';
      } else if (exceedsHours) {
        slotStatus = 'not_possible';
        const closePeriod = endHour >= 12 ? 'PM' : 'AM';
        const displayClose = endHour % 12 === 0 ? 12 : endHour % 12;
        statusReason = `Cannot book ${durationHours} Hr: exceeds closing time (${displayClose}:00 ${closePeriod})`;
      } else if (fullDurationCollisionAlloc) {
        slotStatus = 'not_possible';
        statusReason = `Cannot book ${durationHours} Hr: collides with an upcoming reserved slot`;
      } else {
        slotStatus = 'available';
      }

      const isAvailable = slotStatus === 'available';

      return {
        startIso,
        endIso,
        startLabel,
        slotStatus,
        statusReason,
        isAvailable,
        isPast,
        exceedsHours,
      };
    });
  }, [selectedDate, tzOffset, startHour, endHour, slotCount, allocations, durationHours]);

  // Clean up selected slot if it becomes unavailable due to duration changes
  useEffect(() => {
    if (selectedSlot) {
      const match = timeSlots.find((s) => s.startIso === selectedSlot.start);
      if (!match || !match.isAvailable) {
        setSelectedSlot(null);
        setQuote(null);
      }
    }
  }, [timeSlots, selectedSlot]);

  // Calculate authoritative quote whenever a slot is clicked
  const handleSelectSlot = async (
    slot: { startIso: string; endIso: string }
  ) => {
    if (!selectedResource) return;
    setSelectedSlot({ start: slot.startIso, end: slot.endIso });
    setError(null);

    try {
      const { data, error: quoteErr } = await supabase.rpc('quote_booking', {
        p_resource_id: selectedResource.id,
        p_starts_at: slot.startIso,
        p_ends_at: slot.endIso,
      });

      if (quoteErr) throw quoteErr;
      setQuote(data);
    } catch (err: unknown) {
      console.error('Quote error:', err);
      const msg = extractDatabaseError(err, 'Failed to calculate quote');
      if (msg.includes('PRICING_NOT_CONFIGURED') || msg.includes('P0002')) {
        setError('Pricing has not been configured for this venue yet. Please contact the venue owner.');
      } else {
        setError(msg);
      }
    }
  };

  // Handle increasing duration hours
  const handleIncreaseDuration = async () => {
    if (durationHours < maxDurationHours) {
      const nextDuration = durationHours + 1;
      setDurationHours(nextDuration);

      if (selectedSlot && selectedResource) {
        const startMillis = new Date(selectedSlot.start).getTime();
        const nextEndIso = new Date(startMillis + nextDuration * 3600000).toISOString();
        await handleSelectSlot({
          startIso: selectedSlot.start,
          endIso: nextEndIso,
        });
      }
    }
  };

  // Handle decreasing duration hours
  const handleDecreaseDuration = async () => {
    if (durationHours > 1) {
      const nextDuration = durationHours - 1;
      setDurationHours(nextDuration);

      if (selectedSlot && selectedResource) {
        const startMillis = new Date(selectedSlot.start).getTime();
        const nextEndIso = new Date(startMillis + nextDuration * 3600000).toISOString();
        await handleSelectSlot({
          startIso: selectedSlot.start,
          endIso: nextEndIso,
        });
      }
    }
  };

  // Create Hold and proceed to Checkout
  const handleCreateHold = async () => {
    if (!selectedSlot || !selectedResource) return;
    setHolding(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const currentUrl = window.location.pathname;
        router.push(`/login?redirect=${encodeURIComponent(currentUrl)}`);
        return;
      }

      const idempotencyKey = `hold_${session.user.id.slice(0, 8)}_${Date.now()}`;

      const { data: holdRes, error: holdErr } = await supabase.rpc('create_booking_hold', {
        p_resource_id: selectedResource.id,
        p_starts_at: selectedSlot.start,
        p_ends_at: selectedSlot.end,
        p_idempotency_key: idempotencyKey,
        p_contact_name: session.user.user_metadata?.name || session.user.email?.split('@')[0],
        p_contact_phone: session.user.phone || '+919999988888',
        p_contact_email: session.user.email,
      });

      if (holdErr) {
        if (holdErr.code === '23P01' || holdErr.message.includes('SLOT_UNAVAILABLE')) {
          throw new Error('This slot was just locked by another player. Please select another slot.');
        }
        throw holdErr;
      }

      // Record active hold locally & on server so it immediately marks as ON HOLD everywhere
      recordActiveHold({
        bookingId: holdRes.booking_id,
        resourceId: selectedResource.id,
        resourceName: selectedResource.name,
        turfName: turf.name,
        startsAt: selectedSlot.start,
        endsAt: selectedSlot.end,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });

      router.push(`/book/${holdRes.booking_id}`);
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to reserve slot'));
    } finally {
      setHolding(false);
    }
  };

  if (!resources || resources.length === 0 || !selectedResource) {
    return (
      <div className="p-8 rounded-2xl bg-white dark:bg-[#0c1017] border border-slate-200 dark:border-slate-800 text-center space-y-2 shadow-sm">
        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">No Courts Configured</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">No courts configured for this venue yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 1. Resource / Court Selector */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2.5">
          Select Ground / Court
        </label>
        <div className="flex flex-wrap gap-2.5">
          {resources.map((res) => {
            const isSelected = selectedResource.id === res.id;
            return (
              <button
                key={res.id}
                type="button"
                onClick={() => setSelectedResource(res)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  isSelected
                    ? 'bg-[#00df81] text-slate-950 shadow-md shadow-[#00df81]/25 font-black'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 dark:bg-[#0c1017] dark:hover:bg-[#131d27] dark:text-slate-300 dark:border-slate-800'
                }`}
              >
                <span>{res.name}</span>
                {isSelected && (
                  <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Date Selector */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2.5">
          Select Date
        </label>
        <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-thin">
          {dateOptions.map(({ dateStr, label }) => {
            const isSelected = selectedDate === dateStr;
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => setSelectedDate(dateStr)}
                className={`px-4 py-3 rounded-xl text-xs font-bold shrink-0 transition-all text-center flex flex-col items-center gap-0.5 cursor-pointer ${
                  isSelected
                    ? 'bg-[#00df81] text-slate-950 shadow-md shadow-[#00df81]/25 font-black'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 dark:bg-[#0c1017] dark:hover:bg-[#131d27] dark:text-slate-300 dark:border-slate-800'
                }`}
              >
                <span>{label}</span>
                <span
                  className={`text-[10px] ${
                    isSelected
                      ? 'text-slate-950/80 font-bold'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {dateStr}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Slot Availability Grid with Duration Stepper & Status Legend */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#00df81]" />
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
              Select time slot
            </h3>
            <ChevronUp className="w-4 h-4 text-slate-400 ml-0.5" />
          </div>

          {/* Stepper to increase / decrease slot hours (1 Hr, 2 Hr, 3 Hr, etc.) */}
          <div className="flex items-center gap-2 sm:gap-3 bg-white dark:bg-[#0c1017] border border-slate-200 dark:border-slate-800/90 rounded-xl px-2.5 sm:px-3 py-1.5 shadow-sm dark:shadow-md self-start sm:self-auto">
            <button
              type="button"
              disabled={durationHours <= 1}
              onClick={handleDecreaseDuration}
              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 dark:bg-slate-900 dark:border-slate-700/80 dark:text-slate-300 dark:hover:text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              aria-label="Decrease duration"
              title="Decrease duration by 1 hour"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>

            <span className="font-bold text-sm sm:text-base text-[#00df81] min-w-[38px] text-center select-none">
              {durationHours} Hr
            </span>

            <button
              type="button"
              disabled={durationHours >= maxDurationHours}
              onClick={handleIncreaseDuration}
              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 dark:bg-slate-900 dark:border-slate-700/80 dark:text-slate-300 dark:hover:text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              aria-label="Increase duration"
              title="Increase duration by 1 hour"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Status Legend Bar */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 py-2 px-3 rounded-xl bg-slate-50 dark:bg-[#090d13] border border-slate-200 dark:border-slate-800/80 text-xs mb-4 select-none">
          <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px] uppercase tracking-wider mr-1">
            Status:
          </span>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00df81]" />
            <span className="font-medium text-slate-700 dark:text-slate-300">Available</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span className="font-medium text-rose-600 dark:text-rose-400">Booked</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
            </span>
            <span className="font-medium text-amber-600 dark:text-amber-400">On Hold</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 dark:bg-slate-600" />
            <span className="font-medium text-slate-500 dark:text-slate-400">Not Possible</span>
          </div>
        </div>

        {loadingSlots ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 12 }).map((_, idx) => (
              <div
                key={idx}
                className="h-16 sm:h-18 rounded-xl bg-slate-100 dark:bg-slate-900/60 animate-pulse border border-slate-200 dark:border-slate-800/80"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {timeSlots.map((slot) => {
              const isSelected = selectedSlot?.start === slot.startIso;

              // State 1: Confirmed BOOKED slot
              if (slot.slotStatus === 'booked') {
                return (
                  <button
                    key={slot.startIso}
                    type="button"
                    disabled
                    title="Slot is confirmed booked"
                    className="h-16 sm:h-18 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 cursor-not-allowed flex flex-col items-center justify-center p-2 select-none transition-all shadow-none"
                  >
                    <span className="line-through text-slate-400 dark:text-slate-500 text-xs sm:text-sm font-semibold">
                      {slot.startLabel}
                    </span>
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-950/70 px-2 py-0.5 rounded-md">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                      BOOKED
                    </span>
                  </button>
                );
              }

              // State 2: Temporary ON HOLD slot (pending payment confirmation)
              if (slot.slotStatus === 'hold') {
                return (
                  <button
                    key={slot.startIso}
                    type="button"
                    disabled
                    title="Slot is currently held pending payment"
                    className="h-16 sm:h-18 rounded-xl border border-amber-300/80 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/25 text-amber-700 dark:text-amber-400 cursor-not-allowed flex flex-col items-center justify-center p-2 select-none transition-all shadow-none"
                  >
                    <span className="line-through text-slate-400 dark:text-slate-500 text-xs sm:text-sm font-semibold">
                      {slot.startLabel}
                    </span>
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/70 px-2 py-0.5 rounded-md">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                      </span>
                      ON HOLD
                    </span>
                  </button>
                );
              }

              // State 3: NOT POSSIBLE slot (exceeds duration hours, collides with upcoming slot, or past time)
              if (slot.slotStatus === 'not_possible') {
                return (
                  <button
                    key={slot.startIso}
                    type="button"
                    disabled
                    title={slot.statusReason || 'Slot cannot be booked for this duration'}
                    className="h-16 sm:h-18 rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/80 dark:bg-[#070a0f]/60 text-slate-400 dark:text-slate-500 cursor-not-allowed flex flex-col items-center justify-center p-2 select-none opacity-70 transition-all shadow-none"
                  >
                    <span className="line-through text-slate-400 dark:text-slate-600 text-xs sm:text-sm font-medium">
                      {slot.startLabel}
                    </span>
                    <span className="mt-1 inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-200/80 dark:bg-slate-800/80 px-1.5 py-0.5 rounded-md">
                      NOT POSSIBLE
                    </span>
                  </button>
                );
              }

              // State 4: AVAILABLE slot (clean, selectable, green highlighted when chosen)
              return (
                <button
                  key={slot.startIso}
                  type="button"
                  onClick={() => handleSelectSlot({ startIso: slot.startIso, endIso: slot.endIso })}
                  className={`h-16 sm:h-18 rounded-xl font-bold transition-all border flex flex-col items-center justify-center p-2 select-none cursor-pointer ${
                    isSelected
                      ? 'bg-[#00df81]/15 text-[#00df81] border-2 border-[#00df81] font-black shadow-md shadow-[#00df81]/20 scale-[1.02]'
                      : 'bg-white hover:bg-[#00df81]/10 hover:border-[#00df81]/50 text-slate-800 border-slate-200 dark:bg-[#0c1017] dark:hover:bg-[#131d27] dark:border-slate-800 dark:text-white dark:hover:border-[#00df81]/40 active:scale-[0.98] shadow-xs'
                  }`}
                >
                  <span
                    className={`text-sm sm:text-base ${
                      isSelected ? 'text-[#00df81] font-black' : 'text-slate-800 dark:text-white font-bold'
                    }`}
                  >
                    {slot.startLabel}
                  </span>
                  {isSelected ? (
                    <span className="mt-1 inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-black uppercase text-slate-950 bg-[#00df81] px-2 py-0.5 rounded-full shadow-xs">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                      SELECTED
                    </span>
                  ) : (
                    <span className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                      {durationHours} {durationHours === 1 ? 'Hour' : 'Hours'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* 4. Pricing Quote & Hold CTA Drawer */}
      {selectedSlot && quote && (
        <div className="rounded-2xl p-5 sm:p-6 border border-[#00df81]/40 shadow-xl shadow-slate-200/50 dark:shadow-2xl bg-white dark:bg-[#0c1017] text-slate-900 dark:text-white animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-[#00df81] font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Slot Summary & Authoritative Quote
              </div>
              <div className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-1">
                {selectedResource.name} &bull; {formatTime(selectedSlot.start)} to{' '}
                {formatTime(selectedSlot.end)} ({durationHours}{' '}
                {durationHours === 1 ? 'Hour' : 'Hours'})
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                <span>
                  Total:{' '}
                  <strong className="text-slate-900 dark:text-white font-semibold">
                    {formatINR(quote.total_minor)}
                  </strong>
                </span>
                <span>&bull;</span>
                <span className="text-[#00df81] font-semibold">
                  Advance to Lock: {formatINR(quote.required_online_minor ?? 0)}
                </span>
                <span>&bull;</span>
                <span>Balance at turf: {formatINR(quote.balance_due_minor ?? 0)}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 self-end sm:self-auto">
              <div className="text-right">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Advance payable now
                </div>
                <div className="text-xl sm:text-2xl font-black text-[#00df81]">
                  {formatINR(quote.required_online_minor ?? 0)}
                </div>
              </div>

              <button
                type="button"
                disabled={holding}
                onClick={handleCreateHold}
                className="px-6 py-3.5 rounded-md text-xs font-black uppercase tracking-wider text-slate-950 bg-[#00df81] hover:bg-[#00c974] transition-all shadow-lg shadow-[#00df81]/25 active:scale-95 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {holding ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>LOCKING SLOT...</span>
                  </>
                ) : (
                  <>
                    <span>HOLD SLOT & PAY</span>
                    <ArrowUpRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SlotPicker;
