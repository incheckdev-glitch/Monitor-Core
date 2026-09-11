-- Balanced-quality Lead Intelligence research profile.
-- Keeps Luna but gives the main prospect search a little more verification room:
-- 5 web calls, low reasoning and 3000 output tokens. Historical runs retain their prior cost caps.

alter table public.lead_intelligence_runs
  add column if not exists research_profile text;

alter table public.lead_intelligence_runs
  add column if not exists web_search_cap integer;

update public.lead_intelligence_runs
   set research_profile = coalesce(nullif(research_profile, ''), 'economy-v1')
 where research_profile is null or research_profile = '';

update public.lead_intelligence_runs
   set web_search_cap = case
     when lower(coalesce(model, '')) in ('gpt-5.6-sol', 'gpt-5.6') then 16
     else 3
   end
 where web_search_cap is null;

alter table public.lead_intelligence_runs
  alter column research_profile set default 'economy-v1',
  alter column research_profile set not null,
  alter column web_search_cap set default 3,
  alter column web_search_cap set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.lead_intelligence_runs'::regclass
       and conname = 'lead_intelligence_runs_web_search_cap_check'
  ) then
    alter table public.lead_intelligence_runs
      add constraint lead_intelligence_runs_web_search_cap_check
      check (web_search_cap between 0 and 50);
  end if;
end $$;

create index if not exists idx_lead_intelligence_runs_profile_user_started
  on public.lead_intelligence_runs (created_by, research_profile, started_at desc);

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
  research_priced as (
    select
      r.created_by,
      r.started_at,
      r.status,
      r.result_count::bigint as result_count,
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
          + case when r.openai_response_id is not null then 0.01 * coalesce(r.web_search_cap, 3)::numeric else 0 end
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
          + case when r.openai_response_id is not null then 0.01 * coalesce(r.web_search_cap, 16)::numeric else 0 end
        else 0::numeric
      end as cost_usd,
      (coalesce(r.model, '') = '' or r.usage is null or r.usage = '{}'::jsonb) as is_unpriced
    from public.lead_intelligence_runs r
  ),
  enrichment_priced as (
    select
      e.created_by,
      e.started_at,
      e.status,
      0::bigint as result_count,
      case
        when lower(coalesce(e.model, '')) = 'gpt-5.6-luna' then
          (
            greatest(
              coalesce((e.usage->>'input_tokens')::numeric, 0)
              - coalesce((e.usage->'input_tokens_details'->>'cached_tokens')::numeric, 0)
              - coalesce((e.usage->'input_tokens_details'->>'cache_write_tokens')::numeric, 0),
              0
            ) * 0.20
            + coalesce((e.usage->'input_tokens_details'->>'cached_tokens')::numeric, 0) * 0.02
            + coalesce((e.usage->'input_tokens_details'->>'cache_write_tokens')::numeric, 0) * 0.25
            + coalesce((e.usage->>'output_tokens')::numeric, 0) * 1.20
          ) / 1000000.0
          + case when e.openai_response_id is not null then 0.01 * e.web_search_cap::numeric else 0 end
        else 0::numeric
      end as cost_usd,
      (coalesce(e.model, '') = '' or e.usage is null or e.usage = '{}'::jsonb) as is_unpriced
    from public.lead_intelligence_contact_enrichments e
  ),
  paid_events as (
    select * from research_priced
    union all
    select * from enrichment_priced
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
      coalesce(sum(p.cost_usd) filter (where p.started_at >= b.day_start), 0)::numeric as today_cost_usd,
      coalesce(sum(p.cost_usd) filter (where p.started_at >= b.week_start), 0)::numeric as week_cost_usd,
      coalesce(sum(p.cost_usd) filter (where p.started_at >= b.month_start), 0)::numeric as month_cost_usd,
      count(*) filter (where p.started_at >= b.month_start and p.is_unpriced) as unpriced_month_requests
    from paid_events p
    cross join bounds b
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
    case when l.user_id is null then 10 else l.daily_limit end,
    case when l.user_id is null then 50 else l.weekly_limit end,
    case when l.user_id is null then 150 else l.monthly_limit end,
    (l.user_id is null)
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

comment on column public.lead_intelligence_runs.research_profile is
  'Lead Intelligence research configuration profile used for cache isolation and auditing.';
comment on column public.lead_intelligence_runs.web_search_cap is
  'Maximum web-search calls allowed for the run; used for conservative cost estimates.';
