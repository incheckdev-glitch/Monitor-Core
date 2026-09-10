-- Server-side IP tracking for User Activity.
-- IP addresses are intentionally isolated from browser-writable activity tables.

create table if not exists public.user_activity_ip_log (
  session_id uuid primary key references public.user_activity_sessions(id) on delete cascade,
  user_id uuid not null,
  ip_address inet,
  captured_at timestamptz not null default now()
);

create index if not exists user_activity_ip_log_user_captured_idx
  on public.user_activity_ip_log (user_id, captured_at desc);

alter table public.user_activity_ip_log enable row level security;

-- Browser clients must never be able to read, insert, update or delete IP records.
revoke all on table public.user_activity_ip_log from anon, authenticated;
grant select, insert, update, delete on table public.user_activity_ip_log to service_role;

comment on table public.user_activity_ip_log is
  'Server-captured IP address for ERP user activity sessions. Not readable or writable by normal authenticated users.';
comment on column public.user_activity_ip_log.ip_address is
  'Client IP captured by the authenticated user-activity-ip Edge Function from the request path.';
