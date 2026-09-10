-- Lead Intelligence usage dashboard and per-user request limits.
-- Defaults apply when no explicit row exists: 10/day, 50/week, 150/month.

create table if not exists public.lead_intelligence_user_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_limit integer null check (daily_limit between 0 and 100000),
  weekly_limit integer null check (weekly_limit between 0 and 100000),
  monthly_limit integer null check (monthly_limit between 0 and 100000),
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.lead_intelligence_user_limits enable row level security;
revoke all on public.lead_intelligence_user_limits from anon, authenticated;

create or replace function public.lead_intelligence_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and coalesce(p.is_active, true)
       and lower(coalesce(nullif(p.role_key, ''), nullif(p.role, ''), '')) in ('admin', 'gm')
  );
$$;

revoke all on function public.lead_intelligence_is_admin() from public;
grant execute on function public.lead_intelligence_is_admin() to authenticated;

create or replace function public.lead_intelligence_my_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_daily integer;
  v_weekly integer;
  v_monthly integer;
  v_has_row boolean := false;
  v_today integer := 0;
  v_week integer := 0;
  v_month integer := 0;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_week_start timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
begin
  if v_uid is null then
    raise exception 'Authentication is required.';
  end if;

  select l.daily_limit, l.weekly_limit, l.monthly_limit, true
    into v_daily, v_weekly, v_monthly, v_has_row
    from public.lead_intelligence_user_limits l
   where l.user_id = v_uid;

  if not v_has_row then
    v_daily := 10;
    v_weekly := 50;
    v_monthly := 150;
  end if;

  select
    count(*) filter (where r.started_at >= v_day_start),
    count(*) filter (where r.started_at >= v_week_start),
    count(*) filter (where r.started_at >= v_month_start)
    into v_today, v_week, v_month
    from public.lead_intelligence_runs r
   where r.created_by = v_uid;

  return jsonb_build_object(
    'timezone', 'UTC',
    'today_requests', v_today,
    'week_requests', v_week,
    'month_requests', v_month,
    'daily_limit', v_daily,
    'weekly_limit', v_weekly,
    'monthly_limit', v_monthly,
    'daily_remaining', case when v_daily is null then null else greatest(v_daily - v_today, 0) end,
    'weekly_remaining', case when v_weekly is null then null else greatest(v_weekly - v_week, 0) end,
    'monthly_remaining', case when v_monthly is null then null else greatest(v_monthly - v_month, 0) end,
    'allowed', (v_daily is null or v_today < v_daily)
               and (v_weekly is null or v_week < v_weekly)
               and (v_monthly is null or v_month < v_monthly)
  );
end;
$$;

revoke all on function public.lead_intelligence_my_quota() from public;
grant execute on function public.lead_intelligence_my_quota() to authenticated;

create or replace function public.enforce_lead_intelligence_request_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daily integer;
  v_weekly integer;
  v_monthly integer;
  v_has_row boolean := false;
  v_today integer := 0;
  v_week integer := 0;
  v_month integer := 0;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_week_start timestamptz := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if new.created_by is null then
    raise exception 'A Lead Intelligence user is required.';
  end if;

  -- Serialize request creation per user so parallel clicks cannot bypass limits.
  perform pg_advisory_xact_lock(hashtextextended(new.created_by::text, 360));

  select l.daily_limit, l.weekly_limit, l.monthly_limit, true
    into v_daily, v_weekly, v_monthly, v_has_row
    from public.lead_intelligence_user_limits l
   where l.user_id = new.created_by;

  if not v_has_row then
    v_daily := 10;
    v_weekly := 50;
    v_monthly := 150;
  end if;

  select
    count(*) filter (where r.started_at >= v_day_start),
    count(*) filter (where r.started_at >= v_week_start),
    count(*) filter (where r.started_at >= v_month_start)
    into v_today, v_week, v_month
    from public.lead_intelligence_runs r
   where r.created_by = new.created_by;

  if v_daily is not null and v_today >= v_daily then
    raise exception 'Daily Lead Intelligence limit reached (% requests).', v_daily;
  end if;
  if v_weekly is not null and v_week >= v_weekly then
    raise exception 'Weekly Lead Intelligence limit reached (% requests).', v_weekly;
  end if;
  if v_monthly is not null and v_month >= v_monthly then
    raise exception 'Monthly Lead Intelligence limit reached (% requests).', v_monthly;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_lead_intelligence_request_limits on public.lead_intelligence_runs;
create trigger trg_enforce_lead_intelligence_request_limits
before insert on public.lead_intelligence_runs
for each row execute function public.enforce_lead_intelligence_request_limits();

create or replace function public.lead_intelligence_set_user_limits(
  p_user_id uuid,
  p_daily_limit integer,
  p_weekly_limit integer,
  p_monthly_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.lead_intelligence_is_admin() then
    raise exception 'Admin or GM access is required.';
  end if;
  if p_user_id is null then
    raise exception 'A user is required.';
  end if;
  if p_daily_limit is not null and (p_daily_limit < 0 or p_daily_limit > 100000) then
    raise exception 'Daily limit must be between 0 and 100000, or blank for unlimited.';
  end if;
  if p_weekly_limit is not null and (p_weekly_limit < 0 or p_weekly_limit > 100000) then
    raise exception 'Weekly limit must be between 0 and 100000, or blank for unlimited.';
  end if;
  if p_monthly_limit is not null and (p_monthly_limit < 0 or p_monthly_limit > 100000) then
    raise exception 'Monthly limit must be between 0 and 100000, or blank for unlimited.';
  end if;

  insert into public.lead_intelligence_user_limits (
    user_id, daily_limit, weekly_limit, monthly_limit, updated_by, updated_at
  ) values (
    p_user_id, p_daily_limit, p_weekly_limit, p_monthly_limit, auth.uid(), now()
  )
  on conflict (user_id) do update set
    daily_limit = excluded.daily_limit,
    weekly_limit = excluded.weekly_limit,
    monthly_limit = excluded.monthly_limit,
    updated_by = auth.uid(),
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'daily_limit', p_daily_limit,
    'weekly_limit', p_weekly_limit,
    'monthly_limit', p_monthly_limit
  );
end;
$$;

revoke all on function public.lead_intelligence_set_user_limits(uuid, integer, integer, integer) from public;
grant execute on function public.lead_intelligence_set_user_limits(uuid, integer, integer, integer) to authenticated;

create or replace function public.lead_intelligence_admin_dashboard()
returns table (
  user_id uuid,
  user_name text,
  email text,
  role_key text,
  today_requests bigint,
  week_requests bigint,
  month_requests bigint,
  today_results bigint,
  week_results bigint,
  month_results bigint,
  today_failed bigint,
  week_failed bigint,
  month_failed bigint,
  today_cost_usd numeric,
  week_cost_usd numeric,
  month_cost_usd numeric,
  unpriced_month_requests bigint,
  daily_limit integer,
  weekly_limit integer,
  monthly_limit integer,
  uses_default_limits boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.lead_intelligence_is_admin() then
    raise exception 'Admin or GM access is required.';
  end if;

  return query
  with bounds as (
    select
      (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') as day_start,
      (date_trunc('week', now() at time zone 'UTC') at time zone 'UTC') as week_start,
      (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC') as month_start
  ),
  priced as (
    select
      r.*,
      case
        when lower(coalesce(r.model, '')) = 'gpt-5.6-luna' then
          (
            greatest(
              coalesce((r.usage->>'input_tokens')::numeric, 0)
              - coalesce((r.usage->'input_tokens_details'->>'cached_tokens')::numeric, 0)
              - coalesce((r.usage->'input_tokens_details'->>'cache_write_tokens')::numeric, 0),
              0
            ) * 0.20
            + coalesce((r.usage->'input_tokens_details'->>'cached_tokens')::numeric, 0) * 0.02
            + coalesce((r.usage->'input_tokens_details'->>'cache_write_tokens')::numeric, 0) * 0.25
            + coalesce((r.usage->>'output_tokens')::numeric, 0) * 1.20
          ) / 1000000.0
          + case when r.openai_response_id is not null then 0.03 else 0 end
        when lower(coalesce(r.model, '')) in ('gpt-5.6-sol', 'gpt-5.6') then
          (
            greatest(
              coalesce((r.usage->>'input_tokens')::numeric, 0)
              - coalesce((r.usage->'input_tokens_details'->>'cached_tokens')::numeric, 0)
              - coalesce((r.usage->'input_tokens_details'->>'cache_write_tokens')::numeric, 0),
              0
            ) * 4.00
            + coalesce((r.usage->'input_tokens_details'->>'cached_tokens')::numeric, 0) * 0.40
            + coalesce((r.usage->'input_tokens_details'->>'cache_write_tokens')::numeric, 0) * 5.00
            + coalesce((r.usage->>'output_tokens')::numeric, 0) * 20.00
          ) / 1000000.0
          + case when r.openai_response_id is not null then 0.16 else 0 end
        else 0::numeric
      end as conservative_cost_usd,
      (
        coalesce(r.model, '') = ''
        or r.usage is null
        or r.usage = '{}'::jsonb
      ) as is_unpriced
    from public.lead_intelligence_runs r
  ),
  agg as (
    select
      p.created_by,
      count(*) filter (where p.started_at >= b.day_start) as today_requests,
      count(*) filter (where p.started_at >= b.week_start) as week_requests,
      count(*) filter (where p.started_at >= b.month_start) as month_requests,
      coalesce(sum(p.result_count) filter (where p.started_at >= b.day_start), 0)::bigint as today_results,
      coalesce(sum(p.result_count) filter (where p.started_at >= b.week_start), 0)::bigint as week_results,
      coalesce(sum(p.result_count) filter (where p.started_at >= b.month_start), 0)::bigint as month_results,
      count(*) filter (where p.started_at >= b.day_start and p.status = 'failed') as today_failed,
      count(*) filter (where p.started_at >= b.week_start and p.status = 'failed') as week_failed,
      count(*) filter (where p.started_at >= b.month_start and p.status = 'failed') as month_failed,
      coalesce(sum(p.conservative_cost_usd) filter (where p.started_at >= b.day_start), 0)::numeric as today_cost_usd,
      coalesce(sum(p.conservative_cost_usd) filter (where p.started_at >= b.week_start), 0)::numeric as week_cost_usd,
      coalesce(sum(p.conservative_cost_usd) filter (where p.started_at >= b.month_start), 0)::numeric as month_cost_usd,
      count(*) filter (where p.started_at >= b.month_start and p.is_unpriced) as unpriced_month_requests
    from priced p cross join bounds b
    group by p.created_by
  )
  select
    pr.id as user_id,
    coalesce(nullif(pr.display_name, ''), nullif(pr.full_name, ''), nullif(pr.name, ''), nullif(pr.username, ''), pr.email, 'User')::text as user_name,
    pr.email::text,
    lower(coalesce(nullif(pr.role_key, ''), nullif(pr.role, ''), ''))::text as role_key,
    coalesce(a.today_requests, 0)::bigint,
    coalesce(a.week_requests, 0)::bigint,
    coalesce(a.month_requests, 0)::bigint,
    coalesce(a.today_results, 0)::bigint,
    coalesce(a.week_results, 0)::bigint,
    coalesce(a.month_results, 0)::bigint,
    coalesce(a.today_failed, 0)::bigint,
    coalesce(a.week_failed, 0)::bigint,
    coalesce(a.month_failed, 0)::bigint,
    round(coalesce(a.today_cost_usd, 0), 6),
    round(coalesce(a.week_cost_usd, 0), 6),
    round(coalesce(a.month_cost_usd, 0), 6),
    coalesce(a.unpriced_month_requests, 0)::bigint,
    case when l.user_id is null then 10 else l.daily_limit end as daily_limit,
    case when l.user_id is null then 50 else l.weekly_limit end as weekly_limit,
    case when l.user_id is null then 150 else l.monthly_limit end as monthly_limit,
    (l.user_id is null) as uses_default_limits
  from public.profiles pr
  left join agg a on a.created_by = pr.id
  left join public.lead_intelligence_user_limits l on l.user_id = pr.id
  where coalesce(pr.is_active, true)
  order by coalesce(a.month_requests, 0) desc,
           coalesce(nullif(pr.display_name, ''), nullif(pr.full_name, ''), nullif(pr.name, ''), nullif(pr.username, ''), pr.email, 'User') asc;
end;
$$;

revoke all on function public.lead_intelligence_admin_dashboard() from public;
grant execute on function public.lead_intelligence_admin_dashboard() to authenticated;

comment on table public.lead_intelligence_user_limits is
  'Per-user Lead Intelligence request caps. NULL means unlimited. Missing row uses 10/day, 50/week, 150/month.';
comment on function public.lead_intelligence_admin_dashboard() is
  'Admin/GM-only Lead Intelligence usage dashboard. Cost is a conservative estimate based on recorded tokens plus the configured maximum web-search allowance; historical unpriced runs are flagged.';
