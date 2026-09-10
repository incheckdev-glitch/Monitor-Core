-- Complete Outlook Calendar two-way synchronization metadata and live UI refresh support.

alter table public.employee_calendar_events
  add column if not exists outlook_origin text not null default 'erp',
  add column if not exists outlook_attendees jsonb not null default '[]'::jsonb,
  add column if not exists outlook_categories jsonb not null default '[]'::jsonb;

alter table public.employee_calendar_events
  drop constraint if exists employee_calendar_events_outlook_origin_check;

alter table public.employee_calendar_events
  add constraint employee_calendar_events_outlook_origin_check
  check (outlook_origin in ('erp','outlook'));

update public.employee_calendar_events
set outlook_origin = 'erp'
where outlook_origin is null or outlook_origin not in ('erp','outlook');

alter table public.employee_calendar_events replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'employee_calendar_events'
  ) then
    alter publication supabase_realtime add table public.employee_calendar_events;
  end if;
end
$$;
