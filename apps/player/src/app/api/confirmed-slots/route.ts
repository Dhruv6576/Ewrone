import { NextResponse } from 'next/server';

interface ConfirmedSlotEntry {
  bookingId: string;
  resourceId: string;
  resourceName?: string;
  turfName?: string;
  startsAt: string;
  endsAt: string;
  referenceCode?: string;
  confirmedAt: string;
}

// In-memory registry of confirmed slots on the server
const confirmedSlotsRegistry: Map<string, ConfirmedSlotEntry> = new Map([
  [
    '960c84f0-0d39-4a89-bfc9-41c6c3dd24f2',
    {
      bookingId: '960c84f0-0d39-4a89-bfc9-41c6c3dd24f2',
      resourceId: '88888888-2222-2222-2222-222222222222',
      resourceName: 'Arena Pitch 1',
      turfName: 'Apex Sports Hub',
      startsAt: '2026-09-30T01:30:00+00:00',
      endsAt: '2026-09-30T03:30:00+00:00',
      referenceCode: 'BK-6F0CE828',
      confirmedAt: '2026-09-29T15:35:00.000Z',
    },
  ],
  [
    'b1111111-1111-1111-1111-111111111111',
    {
      bookingId: 'b1111111-1111-1111-1111-111111111111',
      resourceId: '77777777-2222-2222-2222-222222222222',
      resourceName: 'Match Pitch A',
      turfName: 'The Dugout Box Cricket',
      startsAt: '2026-09-22T12:30:00+00:00',
      endsAt: '2026-09-22T13:30:00+00:00',
      referenceCode: 'BK-STG-CONFIRMED-001',
      confirmedAt: '2026-09-21T16:50:40.589Z',
    },
  ],
]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const resourceId = searchParams.get('resource_id');
  const startsAt = searchParams.get('starts_at');
  const endsAt = searchParams.get('ends_at');

  const results: any[] = [];
  const startFilter = startsAt ? new Date(startsAt).getTime() : 0;
  const endFilter = endsAt ? new Date(endsAt).getTime() : Infinity;

  for (const entry of confirmedSlotsRegistry.values()) {
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
        isConfirmedBooking: true,
        reference_code: entry.referenceCode,
        resource_id: entry.resourceId,
        resource_name: entry.resourceName,
        turf_name: entry.turfName,
      });
    }
  }

  return NextResponse.json({ slots: results });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bookingId, resourceId, resourceName, turfName, startsAt, endsAt, referenceCode } = body;

    if (!bookingId || !startsAt || !endsAt) {
      return NextResponse.json({ error: 'bookingId, startsAt, and endsAt are required' }, { status: 400 });
    }

    confirmedSlotsRegistry.set(bookingId, {
      bookingId,
      resourceId: resourceId || '',
      resourceName: resourceName || 'Pitch',
      turfName: turfName || 'Turf',
      startsAt,
      endsAt,
      referenceCode: referenceCode || 'BK-CONFIRMED',
      confirmedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, count: confirmedSlotsRegistry.size });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
