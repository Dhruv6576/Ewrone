export function formatINR(minorUnits: number | string | bigint): string {
  const amount = Number(minorUnits) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

export function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} - ${formatTime(endIso)}`;
}

export function resolveImageUrl(storagePath?: string | null): string | null {
  if (!storagePath || typeof storagePath !== 'string') return null;
  const trimmed = storagePath.trim();
  if (!trimmed) return null;

  // External or root-relative URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')) {
    return trimmed;
  }

  // Supabase storage object path
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://akbndqzrnqxyckldboaw.supabase.co';
  const cleanPath = trimmed.replace(/^\/+/, '');

  if (cleanPath.startsWith('turf-photos/') || cleanPath.startsWith('photos/') || cleanPath.startsWith('images/')) {
    return `${supabaseUrl}/storage/v1/object/public/${cleanPath}`;
  }

  return `${supabaseUrl}/storage/v1/object/public/turf-photos/${cleanPath}`;
}
