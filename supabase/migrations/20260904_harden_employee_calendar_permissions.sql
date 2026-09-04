-- Harden CRM Employee Calendar table and RPC permissions.
-- Applied to the Monitor Core Supabase project on 2026-09-04.

revoke all privileges on table public.employee_calendar_events from anon;
revoke all privileges on table public.employee_calendar_settings from anon;
revoke all privileges on table public.employee_calendar_shares from anon;
revoke all privileges on table public.employee_calendar_reminders from anon;
revoke all privileges on table public.employee_calendar_agenda_log from anon;

revoke all privileges on table public.employee_calendar_events from authenticated;
revoke all privileges on table public.employee_calendar_settings from authenticated;
revoke all privileges on table public.employee_calendar_shares from authenticated;
revoke all privileges on table public.employee_calendar_reminders from authenticated;
revoke all privileges on table public.employee_calendar_agenda_log from authenticated;

grant select, insert, update, delete on table public.employee_calendar_events to authenticated;
grant select, insert, update, delete on table public.employee_calendar_settings to authenticated;
grant select, insert, update, delete on table public.employee_calendar_shares to authenticated;
grant select on table public.employee_calendar_reminders to authenticated;
grant select on table public.employee_calendar_agenda_log to authenticated;

revoke execute on function public.employee_calendar_access_level(uuid) from public, anon;
revoke execute on function public.employee_calendar_list_people() from public, anon;
revoke execute on function public.employee_calendar_notify_share() from public, anon;
revoke execute on function public.employee_calendar_sync_reminders() from public, anon;
revoke execute on function public.employee_calendar_touch_updated_at() from public, anon;
revoke execute on function public.process_employee_calendar_reminders() from public, anon, authenticated;

grant execute on function public.employee_calendar_access_level(uuid) to authenticated;
grant execute on function public.employee_calendar_list_people() to authenticated;
