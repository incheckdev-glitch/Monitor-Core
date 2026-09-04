-- Pin the Calendar updated_at trigger helper to the public schema.
-- Applied to the Monitor Core Supabase project on 2026-09-04.

alter function public.employee_calendar_touch_updated_at() set search_path = public;
