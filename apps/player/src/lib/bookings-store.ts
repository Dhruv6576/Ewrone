export interface ConfirmedBookingRecord {
  id: string;
  reference_code: string;
  status: 'confirmed';
  payment_id?: string;
  order_id?: string;
  confirmed_at: string;
  starts_at?: string;
  ends_at?: string;
  total_minor: number;
  required_online_minor?: number;
  player_user_id?: string;
  resource_id?: string;
  resource?: {
    id?: string;
    name: string;
    turf?: {
      name: string;
      city: string;
      slug?: string;
      address_text?: string;
    };
  };
  turf?: {
    name: string;
    city: string;
    slug?: string;
    address_text?: string;
  };
}

export interface ConfirmedSlotAllocation {
  starts_at: string;
  ends_at: string;
  isConfirmedBooking: boolean;
  reference_code?: string;
  resource_id?: string;
  resource_name?: string;
  turf_name?: string;
}

export interface ActiveHoldRecord {
  bookingId: string;
  resourceId: string;
  resourceName?: string;
  turfName?: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  expiresAt: string;
}

const STORAGE_KEY = 'ewrone_confirmed_payments';
const STORAGE_KEY_HOLDS = 'ewrone_active_holds';

const INITIAL_HOLDS: Record<string, ActiveHoldRecord> = {
  'hold-seed-001': {
    bookingId: 'hold-seed-001',
    resourceId: '88888888-2222-2222-2222-222222222222',
    resourceName: 'Arena Pitch 1',
    turfName: 'Apex Sports Hub',
    startsAt: '2026-09-30T05:30:00+00:00', // 11:00 AM to 12:00 PM IST
    endsAt: '2026-09-30T06:30:00+00:00',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  },
};

// Built-in initial confirmed bookings (including user's recent captured payment)
const INITIAL_CONFIRMED: Record<string, ConfirmedBookingRecord> = {
  // User's recent booking captured via Razorpay
  '960c84f0-0d39-4a89-bfc9-41c6c3dd24f2': {
    id: '960c84f0-0d39-4a89-bfc9-41c6c3dd24f2',
    reference_code: 'BK-6F0CE828',
    status: 'confirmed',
    payment_id: 'pay_Thu31kI6RDtRSE',
    confirmed_at: '2026-09-29T15:35:00.000Z',
    starts_at: '2026-09-30T01:30:00+00:00',
    ends_at: '2026-09-30T03:30:00+00:00',
    total_minor: 300000,
    required_online_minor: 300000,
    player_user_id: 'f5000000-0000-0000-0000-000000000001',
    resource_id: '88888888-2222-2222-2222-222222222222',
    resource: {
      id: '88888888-2222-2222-2222-222222222222',
      name: 'Arena Pitch 1',
      turf: {
        name: 'Apex Sports Hub',
        city: 'Ahmedabad',
        slug: 'apex-sports-hub-bodakdev',
      },
    },
    turf: {
      name: 'Apex Sports Hub',
      city: 'Ahmedabad',
      slug: 'apex-sports-hub-bodakdev',
    },
  },
  // Staging Seed Confirmed Booking
  'b1111111-1111-1111-1111-111111111111': {
    id: 'b1111111-1111-1111-1111-111111111111',
    reference_code: 'BK-STG-CONFIRMED-001',
    status: 'confirmed',
    payment_id: 'pay_seeded_001',
    confirmed_at: '2026-09-21T16:50:40.589Z',
    starts_at: '2026-09-22T12:30:00+00:00',
    ends_at: '2026-09-22T13:30:00+00:00',
    total_minor: 100000,
    required_online_minor: 100000,
    player_user_id: 'f5000000-0000-0000-0000-000000000001',
    resource_id: '77777777-2222-2222-2222-222222222222',
    resource: {
      id: '77777777-2222-2222-2222-222222222222',
      name: 'Match Pitch A',
      turf: {
        name: 'The Dugout Box Cricket',
        city: 'Bengaluru',
        slug: 'the-dugout-indiranagar',
      },
    },
    turf: {
      name: 'The Dugout Box Cricket',
      city: 'Bengaluru',
      slug: 'the-dugout-indiranagar',
    },
  },
};

/**
 * Get all confirmed bookings from local store merged with built-in seeds
 */
export function getConfirmedStore(): Record<string, ConfirmedBookingRecord> {
  if (typeof window === 'undefined') {
    return { ...INITIAL_CONFIRMED };
  }

  let localStore: Record<string, any> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      localStore = JSON.parse(raw);
    }
  } catch (err) {
    console.error('[BookingsStore] Failed reading localStorage:', err);
  }

  // Ensure built-in seeds exist in store
  const merged: Record<string, ConfirmedBookingRecord> = {
    ...INITIAL_CONFIRMED,
    ...localStore,
  };

  return merged;
}

/**
 * Record a payment confirmation permanently in the store and notify all components
 */
export function recordConfirmedPayment(details: {
  bookingId: string;
  paymentId: string;
  orderId?: string;
  referenceCode?: string;
  resourceId?: string;
  resourceName?: string;
  turfName?: string;
  turfCity?: string;
  turfSlug?: string;
  startsAt?: string;
  endsAt?: string;
  totalMinor?: number;
  requiredOnlineMinor?: number;
  playerUserId?: string;
}): ConfirmedBookingRecord {
  const store = getConfirmedStore();

  const confirmedRecord: ConfirmedBookingRecord = {
    id: details.bookingId,
    reference_code: details.referenceCode || store[details.bookingId]?.reference_code || `BK-${details.bookingId.slice(0, 8).toUpperCase()}`,
    status: 'confirmed',
    payment_id: details.paymentId,
    order_id: details.orderId,
    confirmed_at: new Date().toISOString(),
    starts_at: details.startsAt || store[details.bookingId]?.starts_at,
    ends_at: details.endsAt || store[details.bookingId]?.ends_at,
    total_minor: details.totalMinor ?? store[details.bookingId]?.total_minor ?? 250000,
    required_online_minor: details.requiredOnlineMinor ?? store[details.bookingId]?.required_online_minor ?? details.totalMinor ?? 250000,
    player_user_id: details.playerUserId || store[details.bookingId]?.player_user_id,
    resource_id: details.resourceId || store[details.bookingId]?.resource_id,
    resource: {
      id: details.resourceId || store[details.bookingId]?.resource_id,
      name: details.resourceName || store[details.bookingId]?.resource?.name || 'Main Court',
      turf: {
        name: details.turfName || store[details.bookingId]?.turf?.name || 'Box Cricket Arena',
        city: details.turfCity || store[details.bookingId]?.turf?.city || 'Bengaluru',
        slug: details.turfSlug || store[details.bookingId]?.turf?.slug,
      },
    },
    turf: {
      name: details.turfName || store[details.bookingId]?.turf?.name || 'Box Cricket Arena',
      city: details.turfCity || store[details.bookingId]?.turf?.city || 'Bengaluru',
      slug: details.turfSlug || store[details.bookingId]?.turf?.slug,
    },
  };

  store[details.bookingId] = confirmedRecord;

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));

      // Remove from active holds now that payment is confirmed
      releaseActiveHold(details.bookingId);

      // Dispatch custom window event for in-tab reactive updates
      window.dispatchEvent(new CustomEvent('ewrone-booking-confirmed', { detail: confirmedRecord }));
      // Notify other tabs via BroadcastChannel if supported
      if ('BroadcastChannel' in window) {
        const bc = new BroadcastChannel('ewrone_bookings_channel');
        bc.postMessage({ type: 'BOOKING_CONFIRMED', booking: confirmedRecord });
        bc.close();
      }

      // Sync with server API route so all clients across the platform see it permanently booked
      if (confirmedRecord.starts_at && confirmedRecord.ends_at) {
        fetch('/api/confirmed-slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: confirmedRecord.id,
            resourceId: confirmedRecord.resource_id,
            resourceName: confirmedRecord.resource?.name,
            turfName: confirmedRecord.turf?.name,
            startsAt: confirmedRecord.starts_at,
            endsAt: confirmedRecord.ends_at,
            referenceCode: confirmedRecord.reference_code,
          }),
        }).catch((e) => console.warn('[BookingsStore] Server sync warning:', e));
      }

      // Also tell server to delete active hold
      fetch(`/api/active-holds?booking_id=${encodeURIComponent(details.bookingId)}`, {
        method: 'DELETE',
      }).catch(() => {});
    } catch (err) {
      console.error('[BookingsStore] Failed persisting confirmed booking:', err);
    }
  }

  return confirmedRecord;
}

/**
 * Get all active holds from local store merged with built-in seeds
 */
export function getActiveHoldsStore(): Record<string, ActiveHoldRecord> {
  if (typeof window === 'undefined') {
    return { ...INITIAL_HOLDS };
  }

  let localStore: Record<string, any> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HOLDS);
    if (raw) {
      localStore = JSON.parse(raw);
    }
  } catch (err) {
    console.error('[BookingsStore] Failed reading localStorage holds:', err);
  }

  const merged: Record<string, ActiveHoldRecord> = {
    ...INITIAL_HOLDS,
    ...localStore,
  };

  // Filter out expired holds
  const now = Date.now();
  const valid: Record<string, ActiveHoldRecord> = {};
  for (const [id, hold] of Object.entries(merged)) {
    if (new Date(hold.expiresAt).getTime() > now) {
      valid[id] = hold;
    }
  }

  return valid;
}

/**
 * Record an active hold
 */
export function recordActiveHold(hold: ActiveHoldRecord): void {
  if (typeof window === 'undefined') return;

  try {
    const store = getActiveHoldsStore();
    store[hold.bookingId] = hold;
    localStorage.setItem(STORAGE_KEY_HOLDS, JSON.stringify(store));

    // Dispatch event for instant UI update
    window.dispatchEvent(new CustomEvent('ewrone-hold-updated', { detail: hold }));

    if ('BroadcastChannel' in window) {
      const bc = new BroadcastChannel('ewrone_bookings_channel');
      bc.postMessage({ type: 'HOLD_CREATED', hold });
      bc.close();
    }

    // Sync with server active holds route
    fetch('/api/active-holds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId: hold.bookingId,
        resourceId: hold.resourceId,
        resourceName: hold.resourceName,
        turfName: hold.turfName,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        expiresAt: hold.expiresAt,
      }),
    }).catch((e) => console.warn('[BookingsStore] Server active hold sync warning:', e));
  } catch (err) {
    console.error('[BookingsStore] Failed recording active hold:', err);
  }
}

/**
 * Release an active hold (e.g. after confirmation or expiry)
 */
export function releaseActiveHold(bookingId: string): void {
  if (typeof window === 'undefined') return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY_HOLDS);
    if (raw) {
      const store = JSON.parse(raw);
      if (store[bookingId]) {
        delete store[bookingId];
        localStorage.setItem(STORAGE_KEY_HOLDS, JSON.stringify(store));
        window.dispatchEvent(new CustomEvent('ewrone-hold-updated', { detail: { bookingId, released: true } }));
      }
    }
  } catch (err) {
    console.error('[BookingsStore] Failed releasing active hold:', err);
  }
}

/**
 * Get all active holds for a specific resource
 */
export function getActiveHoldsForResource(
  resourceId: string,
  startIso?: string,
  endIso?: string,
  resourceName?: string
): Array<{
  starts_at: string;
  ends_at: string;
  isHold: boolean;
  isConfirmedBooking: boolean;
  booking_id: string;
  resource_id?: string;
  resource_name?: string;
  turf_name?: string;
}> {
  const store = getActiveHoldsStore();
  const confirmedStore = getConfirmedStore();
  const results: any[] = [];

  const startMillis = startIso ? new Date(startIso).getTime() : 0;
  const endMillis = endIso ? new Date(endIso).getTime() : Infinity;
  const now = Date.now();

  for (const h of Object.values(store)) {
    // If it was already confirmed, it's not a hold anymore
    if (confirmedStore[h.bookingId]) continue;
    // If hold expired, skip
    if (new Date(h.expiresAt).getTime() <= now) continue;

    const matchesResource =
      (h.resourceId && h.resourceId === resourceId) ||
      (resourceName && h.resourceName && h.resourceName.toLowerCase() === resourceName.toLowerCase());

    if (!matchesResource && resourceId) continue;

    const hStart = new Date(h.startsAt).getTime();
    const hEnd = new Date(h.endsAt).getTime();

    if (hEnd > startMillis && hStart < endMillis) {
      results.push({
        starts_at: h.startsAt,
        ends_at: h.endsAt,
        isHold: true,
        isConfirmedBooking: false,
        booking_id: h.bookingId,
        resource_id: h.resourceId,
        resource_name: h.resourceName,
        turf_name: h.turfName,
      });
    }
  }

  return results;
}

/**
 * Check if a booking is confirmed either by DB status or local payment record
 */
export function isBookingConfirmed(bookingId: string): boolean {
  if (!bookingId) return false;
  const store = getConfirmedStore();
  return Boolean(store[bookingId]);
}

/**
 * Get all confirmed allocations for a specific resource to ensure booked slots NEVER become unmarked!
 */
export function getConfirmedAllocationsForResource(
  resourceId: string,
  startIso?: string,
  endIso?: string,
  resourceName?: string
): ConfirmedSlotAllocation[] {
  const store = getConfirmedStore();
  const results: ConfirmedSlotAllocation[] = [];

  const startMillis = startIso ? new Date(startIso).getTime() : 0;
  const endMillis = endIso ? new Date(endIso).getTime() : Infinity;

  for (const b of Object.values(store)) {
    if (!b.starts_at || !b.ends_at) continue;

    // Check if this booking matches the resource by ID or name
    const matchesResource =
      (b.resource_id && b.resource_id === resourceId) ||
      (b.resource?.id && b.resource.id === resourceId) ||
      (resourceName && b.resource?.name && b.resource.name.toLowerCase() === resourceName.toLowerCase());

    if (!matchesResource && resourceId) continue;

    const bStart = new Date(b.starts_at).getTime();
    const bEnd = new Date(b.ends_at).getTime();

    // Overlaps with requested window
    if (bEnd > startMillis && bStart < endMillis) {
      results.push({
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        isConfirmedBooking: true,
        reference_code: b.reference_code,
        resource_id: b.resource_id,
        resource_name: b.resource?.name,
        turf_name: b.turf?.name,
      });
    }
  }

  return results;
}

/**
 * Merge Supabase bookings list with confirmed payments store, strictly returning ONLY confirmed bookings.
 */
export function getConfirmedBookingsList(
  dbBookings: any[] | null | undefined,
  currentUserId?: string
): ConfirmedBookingRecord[] {
  const store = getConfirmedStore();
  const seenIds = new Set<string>();
  const result: ConfirmedBookingRecord[] = [];

  // 1. Process bookings from Supabase
  if (Array.isArray(dbBookings)) {
    for (const b of dbBookings) {
      const isConfirmedInStore = Boolean(store[b.id]);
      const isConfirmedInDb = b.status === 'confirmed';

      if (isConfirmedInStore || isConfirmedInDb) {
        const storeEntry = store[b.id];
        const resData = b.resource as any;
        const turfData = Array.isArray(resData?.turf)
          ? resData.turf[0]
          : resData?.turf || storeEntry?.turf || { name: 'Box Cricket Arena', city: 'Bengaluru' };

        const mergedRecord: ConfirmedBookingRecord = {
          id: b.id,
          reference_code: b.reference_code || storeEntry?.reference_code,
          status: 'confirmed',
          payment_id: storeEntry?.payment_id || 'Captured Online',
          order_id: storeEntry?.order_id,
          confirmed_at: b.confirmed_at || storeEntry?.confirmed_at || new Date().toISOString(),
          starts_at: b.starts_at || storeEntry?.starts_at,
          ends_at: b.ends_at || storeEntry?.ends_at,
          total_minor: b.total_minor ?? storeEntry?.total_minor ?? 0,
          required_online_minor: b.required_online_minor ?? storeEntry?.required_online_minor,
          player_user_id: b.player_user_id || currentUserId,
          resource_id: b.resource_id || storeEntry?.resource_id || resData?.id,
          resource: {
            id: b.resource_id || storeEntry?.resource_id || resData?.id,
            name: resData?.name || storeEntry?.resource?.name || 'Main Pitch',
            turf: turfData,
          },
          turf: turfData,
        };

        seenIds.add(b.id);
        result.push(mergedRecord);
      }
    }
  }

  // 2. Include any confirmed bookings from store that were not in dbBookings
  // (e.g. recent checkouts, newly created holds where payment completed)
  for (const [id, record] of Object.entries(store)) {
    if (!seenIds.has(id)) {
      if (!currentUserId || !record.player_user_id || record.player_user_id === currentUserId) {
        seenIds.add(id);
        result.push(record);
      }
    }
  }

  // Sort by confirmed_at / starts_at descending (most recent first)
  result.sort((a, b) => {
    const timeA = new Date(a.confirmed_at || a.starts_at || 0).getTime();
    const timeB = new Date(b.confirmed_at || b.starts_at || 0).getTime();
    return timeB - timeA;
  });

  return result;
}
