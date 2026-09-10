-- Fix missing-row default detection for Lead Intelligence quotas.

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

  if not coalesce(v_has_row, false) then
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

  perform pg_advisory_xact_lock(hashtextextended(new.created_by::text, 360));

  select l.daily_limit, l.weekly_limit, l.monthly_limit, true
    into v_daily, v_weekly, v_monthly, v_has_row
    from public.lead_intelligence_user_limits l
   where l.user_id = new.created_by;

  if not coalesce(v_has_row, false) then
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
