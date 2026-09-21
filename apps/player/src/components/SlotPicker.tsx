'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient, extractDatabaseError } from '@boxcodex/shared';
import { formatINR, formatTime } from '@/lib/utils';
import { Calendar, Clock, AlertCircle, ShieldCheck, Sparkles, ArrowRight, Check } from 'lucide-react';

interface Resource {
  id: string;
  name: string;
  booking_increment_minutes: number;
}

interface SlotPickerProps {
  turf: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
  };
  resources: Resource[];
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

export function SlotPicker({ turf, resources }: SlotPickerProps) {
  const router = useRouter();
  const supabase = createBrowserClient('player');
  const timezone = turf.timezone || 'Asia/Kolkata';

  const [selectedResource, setSelectedResource] = useState<Resource | undefined>(resources?.[0]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return getLocalDateString(new Date(), timezone);
  });
  const [selectedSlot, setSelectedSlot] = useState<{ start: string; end: string } | null>(null);
  const [quote, setQuote] = useState<any>(null);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [hasSlots, setHasSlots] = useState<boolean>(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate date options (Next 7 days in turf timezone)
  const dateOptions = Array.from({ length: 7 }, (_, i) => {
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

  // Fetch allocations and calculate slots for selected date & resource
  useEffect(() => {
    if (!selectedResource) return;

    async function loadAllocations() {
      setLoadingSlots(true);
      setError(null);
      setSelectedSlot(null);
      setQuote(null);

      try {
        const tzOffset = getTimezoneOffsetString(new Date(`${selectedDate}T12:00:00Z`), timezone);
        const startOfDay = `${selectedDate}T00:00:00${tzOffset}`;
        const endOfDay = `${selectedDate}T23:59:59${tzOffset}`;

        // Check if any published slots exist in database for this resource & date
        const { data: slotRows, error: slotErr } = await supabase
          .from('slots')
          .select('id')
          .eq('resource_id', selectedResource.id)
          .gte('starts_at', startOfDay)
          .lt('starts_at', endOfDay)
          .limit(1);

        if (slotErr) console.warn('Slot verification check warning:', slotErr);
        const slotsExist = slotRows && slotRows.length > 0;
        setHasSlots(!!slotsExist);

        // Call the public RPC: get_public_slot_allocations
        const { data: allocs, error: allocErr } = await supabase.rpc('get_public_slot_allocations', {
          p_resource_id: selectedResource.id,
          p_starts_at: startOfDay,
          p_ends_at: endOfDay,
        });

        if (allocErr) throw allocErr;
        setAllocations(allocs || []);
      } catch (err: unknown) {
        console.error('Error loading slots from RPC:', err);
        setError(extractDatabaseError(err, 'Failed to load slots'));
      } finally {
        setLoadingSlots(false);
      }
    }

    loadAllocations();
  }, [selectedResource, selectedDate, timezone, supabase]);

  // Generate 1-hour time slots between 06:00 and 23:00 in turf timezone
  const tzOffset = getTimezoneOffsetString(new Date(`${selectedDate}T12:00:00Z`), timezone);
  const timeSlots = Array.from({ length: 17 }, (_, i) => {
    const hour = 6 + i;
    const startHourStr = hour.toString().padStart(2, '0');
    const endHourStr = (hour + 1).toString().padStart(2, '0');
    const startIso = `${selectedDate}T${startHourStr}:00:00${tzOffset}`;
    const endIso = `${selectedDate}T${endHourStr}:00:00${tzOffset}`;

    // Check collision with existing allocations
    const isOccupied = allocations.some((a) => {
      const aStart = new Date(a.starts_at).getTime();
      const aEnd = new Date(a.ends_at).getTime();
      const slotStart = new Date(startIso).getTime();
      const slotEnd = new Date(endIso).getTime();
      return Math.max(aStart, slotStart) < Math.min(aEnd, slotEnd);
    });

    const isPast = new Date(startIso).getTime() < Date.now();

    return {
      startIso,
      endIso,
      label: `${startHourStr}:00 - ${endHourStr}:00`,
      isAvailable: !isOccupied && !isPast,
      isOccupied,
      isPast,
    };
  });

  // Calculate authoritative quote whenever a slot is clicked
  const handleSelectSlot = async (slot: { startIso: string; endIso: string }) => {
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

  // Create Hold and proceed to Checkout
  const handleCreateHold = async () => {
    if (!selectedSlot || !selectedResource) return;
    setHolding(true);
    setError(null);

    try {
      // Check auth status
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Redirect to login with callback
        const currentUrl = window.location.pathname;
        router.push(`/login?redirect=${encodeURIComponent(currentUrl)}`);
        return;
      }

      const idempotencyKey = `hold_${session.user.id.slice(0, 8)}_${Date.now()}`;

      // Call transactional RPC: create_booking_hold
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

      // Route immediately to payment checkout review
      router.push(`/book/${holdRes.booking_id}`);
    } catch (err: unknown) {
      setError(extractDatabaseError(err, 'Failed to reserve slot'));
    } finally {
      setHolding(false);
    }
  };

  if (!resources || resources.length === 0 || !selectedResource) {
    return (
      <div className="p-8 rounded-2xl bg-slate-900/50 border border-slate-800 text-center space-y-2">
        <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
        <h3 className="text-sm font-semibold text-slate-200">No Courts Configured</h3>
        <p className="text-xs text-slate-400">No slots published for this venue yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 1. Resource / Court Selector */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
          Select Ground / Court
        </label>
        <div className="flex flex-wrap gap-2.5">
          {resources.map((res) => (
            <button
              key={res.id}
              onClick={() => setSelectedResource(res)}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                selectedResource.id === res.id
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              <span>{res.name}</span>
              {selectedResource.id === res.id && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Date Selector */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
          Select Date
        </label>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {dateOptions.map(({ dateStr, label }) => (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(dateStr)}
              className={`px-4 py-3 rounded-xl text-xs font-semibold shrink-0 transition-all text-center flex flex-col items-center gap-0.5 ${
                selectedDate === dateStr
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
              }`}
            >
              <span>{label}</span>
              <span className={`text-[10px] ${selectedDate === dateStr ? 'text-emerald-950 font-bold' : 'text-slate-500'}`}>
                {dateStr}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Slot Availability Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Available Time Slots (60 min increments)
          </label>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              Available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-800 border border-slate-700" />
              Booked
            </span>
          </div>
        </div>

        {loadingSlots ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="h-14 rounded-xl bg-slate-900/60 animate-pulse border border-slate-800" />
            ))}
          </div>
        ) : !hasSlots ? (
          <div className="p-8 rounded-2xl bg-slate-900/50 border border-slate-800 text-center space-y-2">
            <Clock className="w-8 h-8 text-amber-400 mx-auto" />
            <h3 className="text-sm font-semibold text-slate-200">No Slots Published</h3>
            <p className="text-xs text-slate-400">No slots published for this venue yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {timeSlots.map((slot) => {
              const isSelected = selectedSlot?.start === slot.startIso;

              return (
                <button
                  key={slot.startIso}
                  disabled={!slot.isAvailable}
                  onClick={() => handleSelectSlot(slot)}
                  className={`p-3 rounded-xl text-xs font-medium text-left transition-all border relative flex flex-col justify-between h-16 ${
                    !slot.isAvailable
                      ? 'bg-slate-950/40 border-slate-800/40 text-slate-600 cursor-not-allowed'
                      : isSelected
                      ? 'bg-emerald-500/10 border-emerald-400 text-emerald-300 ring-1 ring-emerald-400 shadow-md shadow-emerald-500/15'
                      : 'bg-slate-900/70 hover:bg-slate-850 border-slate-800 text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <div className="font-semibold flex items-center justify-between">
                    <span>{slot.label}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>

                  <div className="text-[10px] mt-1">
                    {slot.isOccupied ? (
                      <span className="text-slate-600 font-medium">Reserved</span>
                    ) : slot.isPast ? (
                      <span className="text-slate-600">Past</span>
                    ) : (
                      <span className={isSelected ? 'text-emerald-400 font-bold' : 'text-emerald-500 font-medium'}>
                        Instant Lock Available
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-red-950/50 border border-red-500/30 text-red-300 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* 4. Pricing Quote & Hold CTA Drawer */}
      {selectedSlot && quote && (
        <div className="glass-panel rounded-2xl p-5 sm:p-6 border border-emerald-500/30 glow-emerald animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-emerald-400 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Slot Summary & Authoritative Quote
              </div>
              <div className="text-base font-bold text-white mt-1">
                {selectedResource.name} • {formatTime(selectedSlot.start)} to {formatTime(selectedSlot.end)}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Includes floodlights, turf pitch, and 7-minute temporary double-booking lock
              </div>
            </div>

            <div className="flex items-center gap-4 self-end sm:self-auto">
              <div className="text-right">
                <div className="text-xs text-slate-400">Total payable</div>
                <div className="text-xl font-extrabold text-white">
                  {formatINR(quote.total_minor)}
                </div>
              </div>

              <button
                disabled={holding}
                onClick={handleCreateHold}
                className="px-5 py-3 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-300 hover:to-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50 flex items-center gap-2"
              >
                {holding ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>Locking Slot...</span>
                  </>
                ) : (
                  <>
                    <span>Hold Slot & Pay</span>
                    <ArrowRight className="w-4 h-4" />
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
