-- Admin-only User Activity module foundation for Monitor Core ERP.
-- Tracks session presence, active/idle time, module dwell time and meaningful UI actions.
-- It intentionally does not store keystrokes, form values or raw mouse movement.

create table if not exists public.user_activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_name text,
  user_email text,
  role_key text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_seen_at timestamptz not null default now(),
  last_interaction_at timestamptz,
  has_activity boolean not null default false,
  activity_state text not null default 'signed_in',
  current_module text,
  active_seconds integer not null default 0,
  idle_seconds integer not null default 0,
  device_type text,
  browser text,
  operating_system text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_activity_sessions_state_check check (activity_state in ('signed_in','active','idle','ended')),
  constraint user_activity_sessions_active_seconds_check check (active_seconds >= 0),
  constraint user_activity_sessions_idle_seconds_check check (idle_seconds >= 0)
);

create table if not exists public.user_activity_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.user_activity_sessions(id) on delete cascade,
  user_id uuid not null,
  event_type text not null,
  module text,
  action text,
  label text,
  element_id text,
  page_path text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.user_module_usage (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.user_activity_sessions(id) on delete cascade,
  user_id uuid not null,
  module text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_seen_at timestamptz not null default now(),
  active_seconds integer not null default 0,
  idle_seconds integer not null default 0,
  constraint user_module_usage_active_seconds_check check (active_seconds >= 0),
  constraint user_module_usage_idle_seconds_check check (idle_seconds >= 0)
);

create index if not exists idx_user_activity_sessions_user_started
  on public.user_activity_sessions(user_id, started_at desc);
create index if not exists idx_user_activity_sessions_last_seen
  on public.user_activity_sessions(last_seen_at desc);
create index if not exists idx_user_activity_sessions_state
  on public.user_activity_sessions(activity_state, last_seen_at desc);
create index if not exists idx_user_activity_events_user_time
  on public.user_activity_events(user_id, occurred_at desc);
create index if not exists idx_user_activity_events_session_time
  on public.user_activity_events(session_id, occurred_at desc);
create index if not exists idx_user_module_usage_user_time
  on public.user_module_usage(user_id, started_at desc);
create index if not exists idx_user_module_usage_session
  on public.user_module_usage(session_id, started_at desc);

alter table public.user_activity_sessions enable row level security;
alter table public.user_activity_events enable row level security;
alter table public.user_module_usage enable row level security;

-- Every signed-in user may create/read/update only their own runtime session rows.
-- Admin may read all rows for the User Activity dashboard, but does not receive write
-- access to another user's tracking records.
drop policy if exists user_activity_sessions_select_own_or_admin on public.user_activity_sessions;
create policy user_activity_sessions_select_own_or_admin
on public.user_activity_sessions
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and coalesce(p.is_active, true) = true
      and lower(trim(coalesce(p.role_key, p.role, ''))) = 'admin'
  )
);

drop policy if exists user_activity_sessions_insert_own on public.user_activity_sessions;
create policy user_activity_sessions_insert_own
on public.user_activity_sessions
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists user_activity_sessions_update_own on public.user_activity_sessions;
create policy user_activity_sessions_update_own
on public.user_activity_sessions
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Activity events are append-only from the browser. Users can see their own rows;
-- admins can read all rows through the dashboard.
drop policy if exists user_activity_events_select_own_or_admin on public.user_activity_events;
create policy user_activity_events_select_own_or_admin
on public.user_activity_events
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and coalesce(p.is_active, true) = true
      and lower(trim(coalesce(p.role_key, p.role, ''))) = 'admin'
  )
);

drop policy if exists user_activity_events_insert_own on public.user_activity_events;
create policy user_activity_events_insert_own
on public.user_activity_events
for insert
to authenticated
with check ((select auth.uid()) = user_id);

-- Module dwell segments are owned by the tracked user. Admin has read-only visibility.
drop policy if exists user_module_usage_select_own_or_admin on public.user_module_usage;
create policy user_module_usage_select_own_or_admin
on public.user_module_usage
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and coalesce(p.is_active, true) = true
      and lower(trim(coalesce(p.role_key, p.role, ''))) = 'admin'
  )
);

drop policy if exists user_module_usage_insert_own on public.user_module_usage;
create policy user_module_usage_insert_own
on public.user_module_usage
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists user_module_usage_update_own on public.user_module_usage;
create policy user_module_usage_update_own
on public.user_module_usage
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.user_activity_sessions from anon;
revoke all on table public.user_activity_events from anon;
revoke all on table public.user_module_usage from anon;

grant select, insert, update on table public.user_activity_sessions to authenticated;
grant select, insert on table public.user_activity_events to authenticated;
grant select, insert, update on table public.user_module_usage to authenticated;

comment on table public.user_activity_sessions is 'ERP session presence and active/idle usage tracking. Admin-readable; users write only their own session rows.';
comment on table public.user_activity_events is 'Meaningful ERP UI activity events. No keystroke or form-value capture.';
comment on table public.user_module_usage is 'Per-session module dwell segments with active and idle seconds.';
