-- InCheck360 Payment Forecast production RPC restoration
--
-- The expanded live resource test proved that the frontend contracts existed in
-- supabase-data.js / payment-forecast.js, but the corresponding public RPCs were
-- absent from the deployed clean database. This patch restores the complete
-- read-side forecast suite using invoice payment schedules as the source of truth.
--
-- Safe to re-run. Read-only RPCs only; no invoice/receipt values are modified.

begin;

-- --------------------------------------------------------------------------
-- 1) Follow-up foundation used by the collection workflow
-- --------------------------------------------------------------------------

create table if not exists public.payment_forecast_followups (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid,
  invoice_number text,
  schedule_no integer,
  client_name text,
  follow_up_status text not null default 'not_started'
    check (follow_up_status in ('not_started','contacted','promised_to_pay','disputed','escalated','closed')),
  last_follow_up_at timestamptz,
  next_follow_up_at timestamptz,
  follow_up_notes text,
  assigned_to uuid,
  assigned_to_email text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payment_forecast_followups_invoice_schedule_uidx
  on public.payment_forecast_followups(invoice_id, schedule_no)
  where invoice_id is not null;

create index if not exists payment_forecast_followups_status_idx
  on public.payment_forecast_followups(follow_up_status, next_follow_up_at);

grant select, insert, update, delete on public.payment_forecast_followups to authenticated;

-- --------------------------------------------------------------------------
-- 2) Canonical forecast row view
-- --------------------------------------------------------------------------

drop view if exists public.payment_forecast_rows_v1 cascade;

create view public.payment_forecast_rows_v1
with (security_invoker = true)
as
select
  s.id as schedule_id,
  i.id as invoice_uuid,
  i.id as invoice_id,
  coalesce(i.invoice_number, i.invoice_id) as invoice_number,
  i.agreement_uuid,
  i.agreement_id,
  i.agreement_number,
  coalesce(i.client_id::text, nullif(i.company_id, '')) as client_id,
  coalesce(nullif(i.company_name, ''), nullif(i.customer_name, ''), nullif(i.customer_legal_name, ''), 'Unknown Client') as client_name,
  i.company_id,
  i.company_name,
  i.customer_name,
  i.customer_legal_name,
  i.currency,
  i.status as invoice_status,
  coalesce(nullif(i.payment_term, ''), nullif(i.payment_terms, ''), nullif(s.schedule_label, ''), 'Annually') as payment_term,
  s.schedule_no,
  s.schedule_no as payment_no,
  s.due_date as scheduled_due_date,
  s.due_date,
  coalesce(s.schedule_label, '') as schedule_label,
  coalesce(s.scheduled_amount, 0)::numeric as scheduled_amount,
  coalesce(s.paid_amount, 0)::numeric as paid_amount,
  coalesce(s.credit_applied_amount, 0)::numeric as allocated_credit_amount,
  greatest(
    coalesce(s.scheduled_amount, 0)
    - coalesce(s.paid_amount, 0)
    - coalesce(s.credit_applied_amount, 0),
    0
  )::numeric as remaining_amount,
  case
    when greatest(coalesce(s.scheduled_amount, 0) - coalesce(s.paid_amount, 0) - coalesce(s.credit_applied_amount, 0), 0) <= 0
         and coalesce(s.credit_applied_amount, 0) > 0
         and coalesce(s.paid_amount, 0) <= 0
      then 'credited'
    when greatest(coalesce(s.scheduled_amount, 0) - coalesce(s.paid_amount, 0) - coalesce(s.credit_applied_amount, 0), 0) <= 0
      then 'paid'
    when s.due_date < current_date
      then 'overdue'
    when s.due_date <= current_date + 7
      then 'due_soon'
    else 'scheduled'
  end as forecast_status,
  f.id as followup_id,
  coalesce(f.follow_up_status, 'not_started') as follow_up_status,
  f.follow_up_notes,
  f.last_follow_up_at,
  f.next_follow_up_at,
  f.assigned_to,
  f.assigned_to_email,
  i.created_at as invoice_created_at,
  s.created_at as schedule_created_at,
  s.updated_at as schedule_updated_at
from public.invoice_payment_schedule s
join public.invoices i on i.id = s.invoice_id
left join public.payment_forecast_followups f
  on f.invoice_id = i.id
 and f.schedule_no = s.schedule_no
where lower(coalesce(i.status, '')) not in ('cancelled','canceled','void','voided','deleted','rejected');

grant select on public.payment_forecast_rows_v1 to authenticated;

-- --------------------------------------------------------------------------
-- 3) Shared permission check
-- --------------------------------------------------------------------------

create or replace function public.payment_forecast_assert_view_permission()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := lower(coalesce(public.current_app_role(), ''));
begin
  if v_role in ('admin','dev','accounting','accountant','sfc','senior_fc','senior_financial_controller','gm','general_manager') then
    return;
  end if;

  if public.app_has_permission('payment_forecast','view')
     or public.app_has_permission('payment_forecast','list')
     or public.app_has_permission('payment_forecast','manage')
     or public.app_has_permission('payment_forecast','manage_all') then
    return;
  end if;

  raise exception 'permission denied for payment forecast';
end;
$$;

grant execute on function public.payment_forecast_assert_view_permission() to authenticated;

-- --------------------------------------------------------------------------
-- 4) Shared filtered-row function
-- --------------------------------------------------------------------------

create or replace function public.payment_forecast_filtered_rows(
  p_client text default null,
  p_currency text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_due_this_month boolean default false,
  p_due_this_week boolean default false,
  p_follow_up_status text default null,
  p_only_unpaid boolean default false,
  p_overdue_only boolean default false,
  p_payment_term text default null,
  p_search text default null,
  p_status text default null,
  p_view text default null
)
returns setof public.payment_forecast_rows_v1
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.payment_forecast_assert_view_permission();

  return query
  select r.*
  from public.payment_forecast_rows_v1 r
  where
    (p_client is null or trim(p_client) = '' or lower(trim(p_client)) = 'all'
      or r.client_id = trim(p_client)
      or lower(r.client_name) = lower(trim(p_client)))
    and (p_currency is null or trim(p_currency) = '' or lower(trim(p_currency)) = 'all'
      or lower(r.currency) = lower(trim(p_currency)))
    and (p_date_from is null or r.due_date >= p_date_from)
    and (p_date_to is null or r.due_date <= p_date_to)
    and (coalesce(p_due_this_week, false) = false
      or (r.remaining_amount > 0 and r.due_date between current_date and current_date + 7))
    and (coalesce(p_due_this_month, false) = false
      or (r.remaining_amount > 0 and date_trunc('month', r.due_date)::date = date_trunc('month', current_date)::date))
    and (p_follow_up_status is null or trim(p_follow_up_status) = '' or lower(trim(p_follow_up_status)) = 'all'
      or lower(r.follow_up_status) = lower(trim(p_follow_up_status)))
    and (coalesce(p_only_unpaid, false) = false or r.remaining_amount > 0)
    and (coalesce(p_overdue_only, false) = false or r.forecast_status = 'overdue')
    and (p_payment_term is null or trim(p_payment_term) = '' or lower(trim(p_payment_term)) = 'all'
      or lower(r.payment_term) = lower(trim(p_payment_term)))
    and (p_status is null or trim(p_status) = '' or lower(trim(p_status)) = 'all'
      or lower(r.forecast_status) = lower(trim(p_status)))
    and (
      p_search is null or trim(p_search) = ''
      or r.invoice_number ilike '%' || trim(p_search) || '%'
      or coalesce(r.agreement_number, '') ilike '%' || trim(p_search) || '%'
      or r.client_name ilike '%' || trim(p_search) || '%'
    )
    and (
      p_view is null or trim(p_view) = '' or lower(trim(p_view)) in ('all','overview','client_distribution','monthly_forecast')
      or (lower(trim(p_view)) = 'overdue' and r.forecast_status = 'overdue')
      or (lower(trim(p_view)) = 'upcoming' and r.remaining_amount > 0 and r.due_date >= current_date)
      or (lower(trim(p_view)) in ('collection_follow_up','followup','follow_up') and r.remaining_amount > 0)
    );
end;
$$;

grant execute on function public.payment_forecast_filtered_rows(text,text,date,date,boolean,boolean,text,boolean,boolean,text,text,text,text) to authenticated;

-- --------------------------------------------------------------------------
-- 5) Paged receivable rows
-- --------------------------------------------------------------------------

create or replace function public.get_payment_forecast_page(
  p_client text default null,
  p_currency text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_due_this_month boolean default false,
  p_due_this_week boolean default false,
  p_follow_up_status text default null,
  p_only_unpaid boolean default false,
  p_overdue_only boolean default false,
  p_page integer default 1,
  p_page_size integer default 10,
  p_payment_term text default null,
  p_search text default null,
  p_status text default null,
  p_view text default null
)
returns table(total_count bigint, row_data jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 200);
begin
  perform public.payment_forecast_assert_view_permission();

  return query
  with filtered as (
    select *
    from public.payment_forecast_filtered_rows(
      p_client, p_currency, p_date_from, p_date_to, p_due_this_month, p_due_this_week,
      p_follow_up_status, p_only_unpaid, p_overdue_only, p_payment_term, p_search, p_status, p_view
    )
  )
  select
    count(*) over()::bigint,
    to_jsonb(f)
  from filtered f
  order by f.due_date asc, f.invoice_number asc, f.schedule_no asc
  offset (v_page - 1) * v_page_size
  limit v_page_size;
end;
$$;

grant execute on function public.get_payment_forecast_page(text,text,date,date,boolean,boolean,text,boolean,boolean,integer,integer,text,text,text,text) to authenticated;

-- Collection Follow-up uses the same canonical receivable row shape but defaults
-- to outstanding schedules only.
create or replace function public.get_payment_forecast_followups_page(
  p_client text default null,
  p_currency text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_due_this_month boolean default false,
  p_due_this_week boolean default false,
  p_follow_up_status text default null,
  p_only_unpaid boolean default true,
  p_overdue_only boolean default false,
  p_page integer default 1,
  p_page_size integer default 10,
  p_payment_term text default null,
  p_search text default null,
  p_status text default null,
  p_view text default 'collection_follow_up'
)
returns table(total_count bigint, row_data jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 200);
begin
  perform public.payment_forecast_assert_view_permission();

  return query
  with filtered as (
    select *
    from public.payment_forecast_filtered_rows(
      p_client, p_currency, p_date_from, p_date_to, p_due_this_month, p_due_this_week,
      p_follow_up_status, coalesce(p_only_unpaid, true), p_overdue_only,
      p_payment_term, p_search, p_status, coalesce(p_view, 'collection_follow_up')
    )
  )
  select
    count(*) over()::bigint,
    to_jsonb(f)
  from filtered f
  order by
    case f.forecast_status when 'overdue' then 0 when 'due_soon' then 1 else 2 end,
    f.due_date asc,
    f.invoice_number asc,
    f.schedule_no asc
  offset (v_page - 1) * v_page_size
  limit v_page_size;
end;
$$;

grant execute on function public.get_payment_forecast_followups_page(text,text,date,date,boolean,boolean,text,boolean,boolean,integer,integer,text,text,text,text) to authenticated;

-- --------------------------------------------------------------------------
-- 6) Summary cards
-- --------------------------------------------------------------------------

create or replace function public.get_payment_forecast_summary(
  p_client text default null,
  p_currency text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_due_this_month boolean default false,
  p_due_this_week boolean default false,
  p_follow_up_status text default null,
  p_only_unpaid boolean default false,
  p_overdue_only boolean default false,
  p_payment_term text default null,
  p_search text default null,
  p_status text default null,
  p_view text default null
)
returns table(summary_data jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.payment_forecast_assert_view_permission();

  return query
  with filtered as (
    select *
    from public.payment_forecast_filtered_rows(
      p_client, p_currency, p_date_from, p_date_to, p_due_this_month, p_due_this_week,
      p_follow_up_status, p_only_unpaid, p_overdue_only, p_payment_term, p_search, p_status, p_view
    )
  ), totals as (
    select
      count(*)::bigint as scheduled_rows,
      coalesce(sum(scheduled_amount), 0)::numeric as gross_scheduled,
      coalesce(sum(paid_amount), 0)::numeric as paid_amount,
      coalesce(sum(allocated_credit_amount), 0)::numeric as credit_adjusted,
      coalesce(sum(remaining_amount), 0)::numeric as remaining_forecast,
      coalesce(sum(remaining_amount) filter (where forecast_status = 'overdue'), 0)::numeric as overdue_amount,
      coalesce(sum(remaining_amount) filter (where remaining_amount > 0 and due_date between current_date and current_date + 7), 0)::numeric as due_this_week,
      coalesce(sum(remaining_amount) filter (where remaining_amount > 0 and date_trunc('month', due_date)::date = date_trunc('month', current_date)::date), 0)::numeric as due_this_month,
      coalesce(sum(remaining_amount) filter (where remaining_amount > 0 and due_date between current_date and current_date + 30), 0)::numeric as next_30_days,
      coalesce(sum(remaining_amount) filter (where remaining_amount > 0 and due_date between current_date and current_date + 90), 0)::numeric as next_90_days,
      case when count(distinct currency) = 1 then min(currency) else 'MULTI' end as currency
    from filtered
  )
  select jsonb_build_object(
    'scheduled_rows', t.scheduled_rows,
    'gross_scheduled', t.gross_scheduled,
    'paid_amount', t.paid_amount,
    'credit_adjusted', t.credit_adjusted,
    'remaining_forecast', t.remaining_forecast,
    'overdue_amount', t.overdue_amount,
    'due_this_week', t.due_this_week,
    'due_this_month', t.due_this_month,
    'next_30_days', t.next_30_days,
    'next_90_days', t.next_90_days,
    'collection_risk_percent', case
      when t.remaining_forecast > 0 then round((t.overdue_amount / t.remaining_forecast) * 100, 2)
      else 0
    end,
    'currency', coalesce(t.currency, 'USD')
  )
  from totals t;
end;
$$;

grant execute on function public.get_payment_forecast_summary(text,text,date,date,boolean,boolean,text,boolean,boolean,text,text,text,text) to authenticated;

-- --------------------------------------------------------------------------
-- 7) Client distribution
-- --------------------------------------------------------------------------

create or replace function public.get_payment_forecast_client_distribution(
  p_client text default null,
  p_currency text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_due_this_month boolean default false,
  p_due_this_week boolean default false,
  p_follow_up_status text default null,
  p_only_unpaid boolean default false,
  p_overdue_only boolean default false,
  p_page integer default 1,
  p_page_size integer default 10,
  p_payment_term text default null,
  p_search text default null,
  p_status text default null,
  p_view text default null
)
returns table(total_count bigint, row_data jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 200);
begin
  perform public.payment_forecast_assert_view_permission();

  return query
  with filtered as (
    select *
    from public.payment_forecast_filtered_rows(
      p_client, p_currency, p_date_from, p_date_to, p_due_this_month, p_due_this_week,
      p_follow_up_status, p_only_unpaid, p_overdue_only, p_payment_term, p_search, p_status, null
    )
  ), grouped as (
    select
      client_id,
      client_name,
      currency,
      count(*)::bigint as scheduled_payment_count,
      count(distinct invoice_uuid)::bigint as invoice_count,
      coalesce(sum(scheduled_amount), 0)::numeric as gross_scheduled_amount,
      coalesce(sum(paid_amount), 0)::numeric as paid_amount,
      coalesce(sum(allocated_credit_amount), 0)::numeric as credit_adjustment_amount,
      coalesce(sum(remaining_amount), 0)::numeric as net_expected_amount,
      coalesce(sum(remaining_amount) filter (where forecast_status = 'overdue'), 0)::numeric as overdue_amount,
      coalesce(sum(remaining_amount) filter (where forecast_status = 'due_soon'), 0)::numeric as due_soon_amount,
      min(due_date) filter (where remaining_amount > 0) as next_due_date
    from filtered
    group by client_id, client_name, currency
  )
  select
    count(*) over()::bigint,
    to_jsonb(g)
  from grouped g
  order by g.net_expected_amount desc, g.client_name asc, g.currency asc
  offset (v_page - 1) * v_page_size
  limit v_page_size;
end;
$$;

grant execute on function public.get_payment_forecast_client_distribution(text,text,date,date,boolean,boolean,text,boolean,boolean,integer,integer,text,text,text,text) to authenticated;

-- --------------------------------------------------------------------------
-- 8) Monthly forecast
-- --------------------------------------------------------------------------

create or replace function public.get_payment_forecast_monthly_summary(
  p_client text default null,
  p_currency text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_due_this_month boolean default false,
  p_due_this_week boolean default false,
  p_follow_up_status text default null,
  p_only_unpaid boolean default false,
  p_overdue_only boolean default false,
  p_page integer default 1,
  p_page_size integer default 10,
  p_payment_term text default null,
  p_search text default null,
  p_status text default null,
  p_view text default null
)
returns table(total_count bigint, row_data jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 200);
begin
  perform public.payment_forecast_assert_view_permission();

  return query
  with filtered as (
    select *
    from public.payment_forecast_filtered_rows(
      p_client, p_currency, p_date_from, p_date_to, p_due_this_month, p_due_this_week,
      p_follow_up_status, p_only_unpaid, p_overdue_only, p_payment_term, p_search, p_status, null
    )
  ), grouped as (
    select
      date_trunc('month', due_date)::date as forecast_month,
      currency,
      count(*)::bigint as scheduled_payment_count,
      count(distinct invoice_uuid)::bigint as invoice_count,
      coalesce(sum(scheduled_amount), 0)::numeric as gross_scheduled_amount,
      coalesce(sum(paid_amount), 0)::numeric as paid_amount,
      coalesce(sum(allocated_credit_amount), 0)::numeric as credit_adjustment_amount,
      coalesce(sum(remaining_amount), 0)::numeric as net_expected_amount,
      coalesce(sum(remaining_amount) filter (where forecast_status = 'overdue'), 0)::numeric as overdue_amount,
      coalesce(sum(remaining_amount) filter (where forecast_status = 'due_soon'), 0)::numeric as due_soon_amount,
      min(due_date) filter (where remaining_amount > 0) as next_due_date
    from filtered
    group by date_trunc('month', due_date)::date, currency
  )
  select
    count(*) over()::bigint,
    to_jsonb(g)
  from grouped g
  order by g.forecast_month asc, g.currency asc
  offset (v_page - 1) * v_page_size
  limit v_page_size;
end;
$$;

grant execute on function public.get_payment_forecast_monthly_summary(text,text,date,date,boolean,boolean,text,boolean,boolean,integer,integer,text,text,text,text) to authenticated;

commit;

notify pgrst, 'reload schema';
