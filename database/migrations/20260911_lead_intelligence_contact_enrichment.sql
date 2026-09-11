-- Lead Intelligence selective contact enrichment.
-- A user explicitly clicks one suggested lead to look for public email/phone details.
-- No bulk/automatic enrichment is performed.

alter table public.lead_intelligence_suggestions
  add column if not exists person_phone text,
  add column if not exists company_phone text,
  add column if not exists contact_phone_type text,
  add column if not exists contact_enrichment_status text not null default 'not_requested',
  add column if not exists contact_enriched_at timestamptz,
  add column if not exists contact_enrichment_sources jsonb not null default '[]'::jsonb,
  add column if not exists contact_enrichment_note text,
  add column if not exists contact_enrichment_response_id text,
  add column if not exists contact_enrichment_usage jsonb not null default '{}'::jsonb,
  add column if not exists contact_enrichment_error text;

alter table public.lead_intelligence_suggestions
  drop constraint if exists lead_intelligence_suggestions_contact_enrichment_status_check;
alter table public.lead_intelligence_suggestions
  add constraint lead_intelligence_suggestions_contact_enrichment_status_check
  check (contact_enrichment_status in ('not_requested','running','completed','failed'));

create table if not exists public.lead_intelligence_contact_enrichments (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.lead_intelligence_suggestions(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'running' check (status in ('running','completed','failed')),
  model text,
  openai_response_id text,
  web_search_cap smallint not null default 2 check (web_search_cap between 1 and 2),
  email text,
  person_phone text,
  company_phone text,
  phone_type text,
  source_urls jsonb not null default '[]'::jsonb,
  note text,
  usage jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_li_contact_enrichments_user_started
  on public.lead_intelligence_contact_enrichments(created_by, started_at desc);
create index if not exists idx_li_contact_enrichments_suggestion_started
  on public.lead_intelligence_contact_enrichments(suggestion_id, started_at desc);
create unique index if not exists uq_li_contact_enrichment_one_running
  on public.lead_intelligence_contact_enrichments(suggestion_id)
  where status = 'running';

alter table public.lead_intelligence_contact_enrichments enable row level security;
revoke all on public.lead_intelligence_contact_enrichments from anon;
grant select, insert, update on public.lead_intelligence_contact_enrichments to authenticated;

drop policy if exists lead_intelligence_contact_enrichments_select on public.lead_intelligence_contact_enrichments;
create policy lead_intelligence_contact_enrichments_select
  on public.lead_intelligence_contact_enrichments for select to authenticated
  using (public.can_use_lead_intelligence());

drop policy if exists lead_intelligence_contact_enrichments_insert on public.lead_intelligence_contact_enrichments;
create policy lead_intelligence_contact_enrichments_insert
  on public.lead_intelligence_contact_enrichments for insert to authenticated
  with check (public.can_use_lead_intelligence() and created_by = auth.uid());

drop policy if exists lead_intelligence_contact_enrichments_update on public.lead_intelligence_contact_enrichments;
create policy lead_intelligence_contact_enrichments_update
  on public.lead_intelligence_contact_enrichments for update to authenticated
  using (public.can_use_lead_intelligence())
  with check (public.can_use_lead_intelligence());

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
  if v_uid is null then raise exception 'Authentication is required.'; end if;
  select l.daily_limit, l.weekly_limit, l.monthly_limit, true
    into v_daily, v_weekly, v_monthly, v_has_row
    from public.lead_intelligence_user_limits l where l.user_id = v_uid;
  if not v_has_row then v_daily := 10; v_weekly := 50; v_monthly := 150; end if;

  select
    (select count(*) from public.lead_intelligence_runs r where r.created_by=v_uid and r.started_at>=v_day_start)
      + (select count(*) from public.lead_intelligence_contact_enrichments e where e.created_by=v_uid and e.started_at>=v_day_start),
    (select count(*) from public.lead_intelligence_runs r where r.created_by=v_uid and r.started_at>=v_week_start)
      + (select count(*) from public.lead_intelligence_contact_enrichments e where e.created_by=v_uid and e.started_at>=v_week_start),
    (select count(*) from public.lead_intelligence_runs r where r.created_by=v_uid and r.started_at>=v_month_start)
      + (select count(*) from public.lead_intelligence_contact_enrichments e where e.created_by=v_uid and e.started_at>=v_month_start)
    into v_today, v_week, v_month;

  return jsonb_build_object(
    'timezone','UTC','today_requests',v_today,'week_requests',v_week,'month_requests',v_month,
    'daily_limit',v_daily,'weekly_limit',v_weekly,'monthly_limit',v_monthly,
    'daily_remaining',case when v_daily is null then null else greatest(v_daily-v_today,0) end,
    'weekly_remaining',case when v_weekly is null then null else greatest(v_weekly-v_week,0) end,
    'monthly_remaining',case when v_monthly is null then null else greatest(v_monthly-v_month,0) end,
    'allowed',(v_daily is null or v_today<v_daily) and (v_weekly is null or v_week<v_weekly) and (v_monthly is null or v_month<v_monthly)
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
  if new.created_by is null then new.created_by := auth.uid(); end if;
  if new.created_by is null then raise exception 'A Lead Intelligence user is required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.created_by::text,360));

  select l.daily_limit,l.weekly_limit,l.monthly_limit,true
    into v_daily,v_weekly,v_monthly,v_has_row
    from public.lead_intelligence_user_limits l where l.user_id=new.created_by;
  if not v_has_row then v_daily:=10; v_weekly:=50; v_monthly:=150; end if;

  select
    (select count(*) from public.lead_intelligence_runs r where r.created_by=new.created_by and r.started_at>=v_day_start)
      + (select count(*) from public.lead_intelligence_contact_enrichments e where e.created_by=new.created_by and e.started_at>=v_day_start),
    (select count(*) from public.lead_intelligence_runs r where r.created_by=new.created_by and r.started_at>=v_week_start)
      + (select count(*) from public.lead_intelligence_contact_enrichments e where e.created_by=new.created_by and e.started_at>=v_week_start),
    (select count(*) from public.lead_intelligence_runs r where r.created_by=new.created_by and r.started_at>=v_month_start)
      + (select count(*) from public.lead_intelligence_contact_enrichments e where e.created_by=new.created_by and e.started_at>=v_month_start)
    into v_today,v_week,v_month;

  if v_daily is not null and v_today>=v_daily then raise exception 'Daily Lead Intelligence limit reached (% requests).',v_daily; end if;
  if v_weekly is not null and v_week>=v_weekly then raise exception 'Weekly Lead Intelligence limit reached (% requests).',v_weekly; end if;
  if v_monthly is not null and v_month>=v_monthly then raise exception 'Monthly Lead Intelligence limit reached (% requests).',v_monthly; end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_lead_intelligence_enrichment_limits on public.lead_intelligence_contact_enrichments;
create trigger trg_enforce_lead_intelligence_enrichment_limits
before insert on public.lead_intelligence_contact_enrichments
for each row execute function public.enforce_lead_intelligence_request_limits();

create or replace function public.lead_intelligence_admin_dashboard()
returns table (
  user_id uuid,user_name text,email text,role_key text,
  today_requests bigint,week_requests bigint,month_requests bigint,
  today_results bigint,week_results bigint,month_results bigint,
  today_failed bigint,week_failed bigint,month_failed bigint,
  today_cost_usd numeric,week_cost_usd numeric,month_cost_usd numeric,
  unpriced_month_requests bigint,daily_limit integer,weekly_limit integer,monthly_limit integer,uses_default_limits boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.lead_intelligence_is_admin() then raise exception 'Admin or GM access is required.'; end if;
  return query
  with bounds as (
    select
      (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') as day_start,
      (date_trunc('week',now() at time zone 'UTC') at time zone 'UTC') as week_start,
      (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') as month_start
  ),
  research_priced as (
    select r.created_by,r.started_at,r.status,r.result_count::bigint as result_count,
      case
        when lower(coalesce(r.model,''))='gpt-5.6-luna' then
          (greatest(coalesce((r.usage->>'input_tokens')::numeric,0)-coalesce((r.usage->'input_tokens_details'->>'cached_tokens')::numeric,0)-coalesce((r.usage->'input_tokens_details'->>'cache_write_tokens')::numeric,0),0)*0.20
           +coalesce((r.usage->'input_tokens_details'->>'cached_tokens')::numeric,0)*0.02
           +coalesce((r.usage->'input_tokens_details'->>'cache_write_tokens')::numeric,0)*0.25
           +coalesce((r.usage->>'output_tokens')::numeric,0)*1.20)/1000000.0
           +case when r.openai_response_id is not null then 0.03 else 0 end
        when lower(coalesce(r.model,'')) in ('gpt-5.6-sol','gpt-5.6') then
          (greatest(coalesce((r.usage->>'input_tokens')::numeric,0)-coalesce((r.usage->'input_tokens_details'->>'cached_tokens')::numeric,0)-coalesce((r.usage->'input_tokens_details'->>'cache_write_tokens')::numeric,0),0)*4.00
           +coalesce((r.usage->'input_tokens_details'->>'cached_tokens')::numeric,0)*0.40
           +coalesce((r.usage->'input_tokens_details'->>'cache_write_tokens')::numeric,0)*5.00
           +coalesce((r.usage->>'output_tokens')::numeric,0)*20.00)/1000000.0
           +case when r.openai_response_id is not null then 0.16 else 0 end
        else 0::numeric end as cost_usd,
      (coalesce(r.model,'')='' or r.usage is null or r.usage='{}'::jsonb) as is_unpriced
    from public.lead_intelligence_runs r
  ),
  enrichment_priced as (
    select e.created_by,e.started_at,e.status,0::bigint as result_count,
      case when lower(coalesce(e.model,''))='gpt-5.6-luna' then
        (greatest(coalesce((e.usage->>'input_tokens')::numeric,0)-coalesce((e.usage->'input_tokens_details'->>'cached_tokens')::numeric,0)-coalesce((e.usage->'input_tokens_details'->>'cache_write_tokens')::numeric,0),0)*0.20
         +coalesce((e.usage->'input_tokens_details'->>'cached_tokens')::numeric,0)*0.02
         +coalesce((e.usage->'input_tokens_details'->>'cache_write_tokens')::numeric,0)*0.25
         +coalesce((e.usage->>'output_tokens')::numeric,0)*1.20)/1000000.0
         +case when e.openai_response_id is not null then 0.01*e.web_search_cap::numeric else 0 end
        else 0::numeric end as cost_usd,
      (coalesce(e.model,'')='' or e.usage is null or e.usage='{}'::jsonb) as is_unpriced
    from public.lead_intelligence_contact_enrichments e
  ),
  paid_events as (
    select * from research_priced union all select * from enrichment_priced
  ),
  agg as (
    select p.created_by,
      count(*) filter(where p.started_at>=b.day_start) as today_requests,
      count(*) filter(where p.started_at>=b.week_start) as week_requests,
      count(*) filter(where p.started_at>=b.month_start) as month_requests,
      coalesce(sum(p.result_count) filter(where p.started_at>=b.day_start),0)::bigint as today_results,
      coalesce(sum(p.result_count) filter(where p.started_at>=b.week_start),0)::bigint as week_results,
      coalesce(sum(p.result_count) filter(where p.started_at>=b.month_start),0)::bigint as month_results,
      count(*) filter(where p.started_at>=b.day_start and p.status='failed') as today_failed,
      count(*) filter(where p.started_at>=b.week_start and p.status='failed') as week_failed,
      count(*) filter(where p.started_at>=b.month_start and p.status='failed') as month_failed,
      coalesce(sum(p.cost_usd) filter(where p.started_at>=b.day_start),0)::numeric as today_cost_usd,
      coalesce(sum(p.cost_usd) filter(where p.started_at>=b.week_start),0)::numeric as week_cost_usd,
      coalesce(sum(p.cost_usd) filter(where p.started_at>=b.month_start),0)::numeric as month_cost_usd,
      count(*) filter(where p.started_at>=b.month_start and p.is_unpriced) as unpriced_month_requests
    from paid_events p cross join bounds b group by p.created_by
  )
  select
    pr.id,
    coalesce(nullif(pr.display_name,''),nullif(pr.full_name,''),nullif(pr.name,''),nullif(pr.username,''),pr.email,'User')::text,
    pr.email::text,
    lower(coalesce(nullif(pr.role_key,''),nullif(pr.role,''),''))::text,
    coalesce(a.today_requests,0)::bigint,coalesce(a.week_requests,0)::bigint,coalesce(a.month_requests,0)::bigint,
    coalesce(a.today_results,0)::bigint,coalesce(a.week_results,0)::bigint,coalesce(a.month_results,0)::bigint,
    coalesce(a.today_failed,0)::bigint,coalesce(a.week_failed,0)::bigint,coalesce(a.month_failed,0)::bigint,
    round(coalesce(a.today_cost_usd,0),6),round(coalesce(a.week_cost_usd,0),6),round(coalesce(a.month_cost_usd,0),6),
    coalesce(a.unpriced_month_requests,0)::bigint,
    case when l.user_id is null then 10 else l.daily_limit end,
    case when l.user_id is null then 50 else l.weekly_limit end,
    case when l.user_id is null then 150 else l.monthly_limit end,
    (l.user_id is null)
  from public.profiles pr
  left join agg a on a.created_by=pr.id
  left join public.lead_intelligence_user_limits l on l.user_id=pr.id
  where coalesce(pr.is_active,true)
  order by coalesce(a.month_requests,0) desc,
    coalesce(nullif(pr.display_name,''),nullif(pr.full_name,''),nullif(pr.name,''),nullif(pr.username,''),pr.email,'User') asc;
end;
$$;

revoke all on function public.lead_intelligence_admin_dashboard() from public;
grant execute on function public.lead_intelligence_admin_dashboard() to authenticated;

comment on table public.lead_intelligence_contact_enrichments is
  'Selective, user-triggered public contact lookups for individual Lead Intelligence suggestions. No automatic bulk enrichment.';
comment on function public.lead_intelligence_admin_dashboard() is
  'Admin/GM Lead Intelligence usage dashboard. Request totals and conservative estimated cost include prospect research and selective contact enrichment.';
