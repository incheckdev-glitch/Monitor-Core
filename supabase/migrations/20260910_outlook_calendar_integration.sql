-- Outlook Calendar integration for the CRM / Employee Calendar.
-- Microsoft OAuth tokens are server-only: authenticated/anon roles receive no access
-- to the connection, OAuth-state, or deletion-tombstone tables.

alter table public.employee_calendar_events
  add column if not exists outlook_event_id text,
  add column if not exists outlook_change_key text,
  add column if not exists outlook_ical_uid text,
  add column if not exists outlook_web_url text,
  add column if not exists outlook_last_modified_at timestamptz,
  add column if not exists outlook_last_synced_at timestamptz,
  add column if not exists outlook_sync_hash text,
  add column if not exists outlook_sync_status text not null default 'not_synced',
  add column if not exists outlook_sync_error text,
  add column if not exists outlook_teams_enabled boolean not null default false,
  add column if not exists outlook_invite_related_contact boolean not null default false;

alter table public.employee_calendar_events
  drop constraint if exists employee_calendar_events_outlook_sync_status_check;

alter table public.employee_calendar_events
  add constraint employee_calendar_events_outlook_sync_status_check
  check (outlook_sync_status in ('not_synced','pending','synced','error','disconnected'));

create unique index if not exists employee_calendar_events_owner_outlook_event_uidx
  on public.employee_calendar_events(owner_user_id, outlook_event_id)
  where outlook_event_id is not null;

create index if not exists employee_calendar_events_outlook_sync_idx
  on public.employee_calendar_events(owner_user_id, updated_at, start_at)
  where event_type <> 'Personal';

create index if not exists employee_calendar_events_outlook_invite_idx
  on public.employee_calendar_events(owner_user_id, outlook_invite_related_contact)
  where outlook_invite_related_contact = true;

create table if not exists public.outlook_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'connected'
    check (status in ('connected','needs_reauth','disconnected','error')),
  tenant_id text,
  microsoft_user_id text,
  microsoft_email text,
  microsoft_display_name text,
  primary_calendar_id text,
  primary_calendar_name text,
  allowed_online_meeting_providers jsonb not null default '[]'::jsonb,
  default_online_meeting_provider text,
  access_token text,
  access_token_expires_at timestamptz,
  refresh_token text,
  token_type text,
  scope text,
  two_way_enabled boolean not null default true,
  teams_default boolean not null default false,
  invite_related_contacts boolean not null default false,
  sync_mode text not null default 'crm_only' check (sync_mode in ('crm_only')),
  sync_window_past_days integer not null default 30 check (sync_window_past_days between 0 and 365),
  sync_window_future_days integer not null default 365 check (sync_window_future_days between 30 and 1095),
  last_push_sync_at timestamptz,
  last_pull_sync_at timestamptz,
  last_sync_at timestamptz,
  webhook_subscription_id text,
  webhook_expires_at timestamptz,
  webhook_client_state text,
  last_webhook_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.outlook_calendar_connections
  add column if not exists invite_related_contacts boolean not null default false;

create unique index if not exists outlook_calendar_connections_subscription_uidx
  on public.outlook_calendar_connections(webhook_subscription_id)
  where webhook_subscription_id is not null;

create table if not exists public.outlook_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_verifier text not null,
  redirect_uri text not null,
  return_hash text not null default '#employee-calendar',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists outlook_oauth_states_expiry_idx
  on public.outlook_oauth_states(expires_at);

create table if not exists public.outlook_event_tombstones (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  erp_event_id uuid,
  outlook_event_id text not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

create index if not exists outlook_event_tombstones_pending_idx
  on public.outlook_event_tombstones(owner_user_id, created_at)
  where processed_at is null;

alter table public.outlook_calendar_connections enable row level security;
alter table public.outlook_oauth_states enable row level security;
alter table public.outlook_event_tombstones enable row level security;

revoke all on table public.outlook_calendar_connections from public, anon, authenticated;
revoke all on table public.outlook_oauth_states from public, anon, authenticated;
revoke all on table public.outlook_event_tombstones from public, anon, authenticated;

grant select, insert, update, delete on table public.outlook_calendar_connections to service_role;
grant select, insert, update, delete on table public.outlook_oauth_states to service_role;
grant select, insert, update, delete on table public.outlook_event_tombstones to service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.capture_outlook_calendar_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.outlook_event_id is not null then
    insert into public.outlook_event_tombstones(owner_user_id, erp_event_id, outlook_event_id)
    values (old.owner_user_id, old.id, old.outlook_event_id);
  end if;
  return old;
end;
$$;

revoke all on function private.capture_outlook_calendar_delete() from public, anon, authenticated;

drop trigger if exists trg_employee_calendar_outlook_delete on public.employee_calendar_events;
create trigger trg_employee_calendar_outlook_delete
after delete on public.employee_calendar_events
for each row execute function private.capture_outlook_calendar_delete();
