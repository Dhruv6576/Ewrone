import { NextResponse } from 'next/server';

export interface ActiveHoldEntry {
  bookingId: string;
  resourceId: string;
  resourceName?: string;
  turfName?: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  expiresAt: string;
}

// In-memory registry of active holds on the server
const activeHoldsRegistry: Map<string, ActiveHoldEntry> = new Map([
  [
    'hold-seed-001',
    {
      bookingId: 'hold-seed-001',
      resourceId: '88888888-2222-2222-2222-222222222222',
      resourceName: 'Arena Pitch 1',
      turfName: 'Apex Sports Hub',
      startsAt: '2026-09-30T05:30:00+00:00', // 11:00 AM to 12:00 PM IST
      endsAt: '2026-09-30T06:30:00+00:00',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  ],
]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const resourceId = searchParams.get('resource_id');
  const startsAt = searchParams.get('starts_at');
  const endsAt = searchParams.get('ends_at');

  const now = Date.now();
  const results: any[] = [];
  const startFilter = startsAt ? new Date(startsAt).getTime() : 0;
  const endFilter = endsAt ? new Date(endsAt).getTime() : Infinity;

  for (const [id, entry] of activeHoldsRegistry.entries()) {
    // Purge expired holds
    if (new Date(entry.expiresAt).getTime() <= now) {
      activeHoldsRegistry.delete(id);
      continue;
    }

    if (resourceId && entry.resourceId !== resourceId) {
      continue;
    }

    const entryStart = new Date(entry.startsAt).getTime();
    const entryEnd = new Date(entry.endsAt).getTime();

    // Overlaps with queried time window
    if (entryEnd > startFilter && entryStart < endFilter) {
      results.push({
        starts_at: entry.startsAt,
        ends_at: entry.endsAt,
        isHold: true,
        isConfirmedBooking: false,
        booking_id: entry.bookingId,
        resource_id: entry.resourceId,
        resource_name: entry.resourceName,
        turf_name: entry.turfName,
        expires_at: entry.expiresAt,
      });
    }
  }

  return NextResponse.json({ holds: results });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bookingId, resourceId, resourceName, turfName, startsAt, endsAt, expiresAt } = body;

    if (!bookingId || !startsAt || !endsAt) {
      return NextResponse.json({ error: 'bookingId, startsAt, and endsAt are required' }, { status: 400 });
    }

    const effectiveExpiresAt = expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString();

    activeHoldsRegistry.set(bookingId, {
      bookingId,
      resourceId: resourceId || '',
      resourceName: resourceName || 'Pitch',
      turfName: turfName || 'Turf',
      startsAt,
      endsAt,
      createdAt: new Date().toISOString(),
      expiresAt: effectiveExpiresAt,
    });

    return NextResponse.json({ success: true, count: activeHoldsRegistry.size });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bookingId = searchParams.get('booking_id');

    if (bookingId) {
      activeHoldsRegistry.delete(bookingId);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
