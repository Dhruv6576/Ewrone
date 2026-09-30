-- Increase maximum duration to 24 hours to allow owners to book as long as they want
UPDATE public.resources SET maximum_duration_minutes = 1440;
