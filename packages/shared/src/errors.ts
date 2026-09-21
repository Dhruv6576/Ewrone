/**
 * Shared database & API error extractor.
 * Handles Error, PostgrestError, Deno Edge Function error responses,
 * and arbitrary API response objects, returning a string that includes
 * the error message and SQLSTATE/error code when present.
 */
export interface ExtractedDatabaseError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  formatted: string;
}

export function extractDatabaseErrorObject(err: unknown, fallbackMessage = 'Operation failed'): ExtractedDatabaseError {
  if (!err) {
    return { message: fallbackMessage, formatted: fallbackMessage };
  }

  if (typeof err === 'string') {
    return { message: err, formatted: err };
  }

  const obj = err as Record<string, any>;

  const message =
    obj.message ||
    obj.error_description ||
    (typeof obj.error === 'string' ? obj.error : obj.error?.message) ||
    obj.statusText ||
    (err instanceof Error ? err.message : fallbackMessage);

  const code = obj.code || obj.sqlstate || (typeof obj.error === 'object' ? obj.error?.code : undefined);
  const details = obj.details || obj.detail;
  const hint = obj.hint;

  let formatted = message;
  if (details && typeof details === 'string' && !formatted.includes(details)) {
    formatted += ` (${details})`;
  }
  if (hint && typeof hint === 'string' && !formatted.includes(hint)) {
    formatted += ` [Hint: ${hint}]`;
  }
  if (code && !formatted.includes(`[${code}]`) && !formatted.includes(`(${code})`)) {
    formatted = `[${code}] ${formatted}`;
  }

  return { message, code, details, hint, formatted };
}

export function extractDatabaseError(err: unknown, fallbackMessage = 'Operation failed'): string {
  return extractDatabaseErrorObject(err, fallbackMessage).formatted;
}

