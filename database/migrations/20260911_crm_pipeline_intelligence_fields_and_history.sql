alter table public.leads
  add column if not exists number_of_locations integer,
  add column if not exists rollout_scope text,
  add column if not exists interested_product_ids uuid[] not null default '{}'::uuid[],
  add column if not exists contact_channel text,
  add column if not exists meeting_at timestamptz,
  add column if not exists meeting_outcome text,
  add column if not exists lost_reason text,
  add column if not exists disregard_reason text,
  add column if not exists next_action text,
  add column if not exists status_changed_at timestamptz;

alter table public.deals
  add column if not exists number_of_locations integer,
  add column if not exists rollout_scope text,
  add column if not exists lost_reason text,
  add column if not exists next_action text,
  add column if not exists poc_expected_end_date date,
  add column if not exists stage_changed_at timestamptz;

update public.leads
set status_changed_at = coalesce(status_changed_at, updated_at, created_at, now())
where status_changed_at is null;

update public.deals
set stage_changed_at = coalesce(stage_changed_at, updated_at, created_at, now())
where stage_changed_at is null;

create table if not exists public.crm_pipeline_transition_history (
  id bigserial primary key,
  entity_type text not null check (entity_type in ('lead','deal')),
  entity_id uuid not null,
  entity_ref text,
  from_stage text,
  to_stage text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  assigned_to text
);

create index if not exists crm_pipeline_transition_history_entity_idx
  on public.crm_pipeline_transition_history(entity_type, entity_id, changed_at);
create index if not exists crm_pipeline_transition_history_changed_at_idx
  on public.crm_pipeline_transition_history(changed_at desc);

alter table public.crm_pipeline_transition_history enable row level security;

create or replace function public.crm_touch_lead_status_changed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.status_changed_at := coalesce(new.status_changed_at, new.created_at, now());
  elsif lower(trim(coalesce(new.status,''))) is distinct from lower(trim(coalesce(old.status,''))) then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.crm_touch_deal_stage_changed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_changed_at := coalesce(new.stage_changed_at, new.created_at, now());
  elsif lower(trim(coalesce(new.stage,''))) is distinct from lower(trim(coalesce(old.stage,''))) then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_touch_lead_status_changed_at on public.leads;
create trigger trg_crm_touch_lead_status_changed_at
before insert or update of status on public.leads
for each row execute function public.crm_touch_lead_status_changed_at();

drop trigger if exists trg_crm_touch_deal_stage_changed_at on public.deals;
create trigger trg_crm_touch_deal_stage_changed_at
before insert or update of stage on public.deals
for each row execute function public.crm_touch_deal_stage_changed_at();

create or replace function public.crm_log_lead_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(trim(coalesce(new.status,''))) is distinct from lower(trim(coalesce(old.status,''))) then
    insert into public.crm_pipeline_transition_history(
      entity_type, entity_id, entity_ref, from_stage, to_stage, changed_at, changed_by, assigned_to
    ) values (
      'lead', new.id, new.lead_id, lower(trim(coalesce(old.status,''))), lower(trim(coalesce(new.status,''))),
      coalesce(new.status_changed_at, now()), coalesce(new.updated_by, new.last_updated_by, auth.uid()), new.assigned_to
    );
  end if;
  return new;
end;
$$;

create or replace function public.crm_log_deal_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(trim(coalesce(new.stage,''))) is distinct from lower(trim(coalesce(old.stage,''))) then
    insert into public.crm_pipeline_transition_history(
      entity_type, entity_id, entity_ref, from_stage, to_stage, changed_at, changed_by, assigned_to
    ) values (
      'deal', new.id, new.deal_id, lower(trim(coalesce(old.stage,''))), lower(trim(coalesce(new.stage,''))),
      coalesce(new.stage_changed_at, now()), coalesce(new.updated_by, auth.uid()), new.assigned_to
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_log_lead_status_transition on public.leads;
create trigger trg_crm_log_lead_status_transition
after update of status on public.leads
for each row execute function public.crm_log_lead_status_transition();

drop trigger if exists trg_crm_log_deal_stage_transition on public.deals;
create trigger trg_crm_log_deal_stage_transition
after update of stage on public.deals
for each row execute function public.crm_log_deal_stage_transition();

insert into public.crm_pipeline_transition_history(entity_type, entity_id, entity_ref, from_stage, to_stage, changed_at, changed_by, assigned_to)
select 'lead', l.id, l.lead_id, null, lower(trim(coalesce(l.status,'not contacted yet'))), coalesce(l.status_changed_at,l.updated_at,l.created_at,now()), coalesce(l.updated_by,l.last_updated_by), l.assigned_to
from public.leads l
where not exists (
  select 1 from public.crm_pipeline_transition_history h where h.entity_type='lead' and h.entity_id=l.id
);

insert into public.crm_pipeline_transition_history(entity_type, entity_id, entity_ref, from_stage, to_stage, changed_at, changed_by, assigned_to)
select 'deal', d.id, d.deal_id, null, lower(trim(coalesce(d.stage,'in progress'))), coalesce(d.stage_changed_at,d.updated_at,d.created_at,now()), d.updated_by, d.assigned_to
from public.deals d
where not exists (
  select 1 from public.crm_pipeline_transition_history h where h.entity_type='deal' and h.entity_id=d.id
);

create or replace function public.crm_pipeline_transition_metrics(p_days integer default 180)
returns jsonb
language sql
security definer
set search_path = public
as $$
with ordered as (
  select
    entity_type,
    entity_id,
    from_stage,
    to_stage,
    changed_at,
    lag(changed_at) over (partition by entity_type, entity_id order by changed_at, id) as previous_changed_at
  from public.crm_pipeline_transition_history
  where changed_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days,180), 3650)))
), durations as (
  select
    entity_type,
    lower(trim(coalesce(from_stage,''))) as from_stage,
    lower(trim(coalesce(to_stage,''))) as to_stage,
    extract(epoch from (changed_at - previous_changed_at)) / 3600.0 as duration_hours
  from ordered
  where previous_changed_at is not null
    and changed_at >= previous_changed_at
), grouped as (
  select
    entity_type,
    from_stage,
    to_stage,
    count(*)::integer as transition_count,
    round(avg(duration_hours)::numeric, 1) as avg_hours,
    round(percentile_cont(0.5) within group (order by duration_hours)::numeric, 1) as median_hours
  from durations
  group by entity_type, from_stage, to_stage
)
select jsonb_build_object(
  'days', greatest(1, least(coalesce(p_days,180), 3650)),
  'metrics', coalesce(
    (select jsonb_agg(jsonb_build_object(
      'entity_type', entity_type,
      'from_stage', from_stage,
      'to_stage', to_stage,
      'transition_count', transition_count,
      'avg_hours', avg_hours,
      'median_hours', median_hours
    ) order by entity_type, from_stage, to_stage) from grouped),
    '[]'::jsonb
  )
);
$$;

revoke all on function public.crm_pipeline_transition_metrics(integer) from public;
grant execute on function public.crm_pipeline_transition_metrics(integer) to authenticated;

create or replace function public.convert_lead_to_deal(p_lead_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.leads;
  d public.deals;
  v_code text;
  v_seq bigint;
begin
  select * into l from public.leads where id = p_lead_uuid for update;
  if not found then raise exception 'Lead not found'; end if;
  if lower(coalesce(l.status, '')) <> 'qualified' then raise exception 'Lead must be qualified before conversion'; end if;

  perform pg_advisory_xact_lock(hashtext('incheck360:deal-business-id'));

  select coalesce(max((regexp_match(deal_id, '^Deal#([0-9]+)$', 'i'))[1]::bigint), 0) + 1
    into v_seq
    from public.deals
   where deal_id ~* '^Deal#[0-9]+$';

  v_code := 'Deal#' || lpad(v_seq::text, 5, '0');

  insert into public.deals(
    deal_id, lead_id, source_lead_uuid, lead_code, full_name,
    company_id, company_name, customer_name, customer_legal_name, customer_address,
    contact_id, contact_name, contact_email, contact_phone, phone, email, country,
    lead_source, service_interest, stage, next_follow_up_at, priority, estimated_value,
    currency, assigned_to, converted_by, converted_at, notes, created_by, updated_by,
    number_of_locations, rollout_scope, interested_product_ids, next_action
  )
  values(
    v_code, l.id, l.id, l.lead_id, l.full_name,
    l.company_id, l.company_name, l.customer_name, l.customer_legal_name, l.customer_address,
    l.contact_id, l.contact_name, l.contact_email, l.contact_phone, l.phone, l.email, l.country,
    l.lead_source, l.service_interest, 'In Progress', l.next_follow_up_at, l.priority, l.estimated_value,
    l.currency, l.assigned_to, auth.uid(), now(), l.notes, auth.uid(), auth.uid(),
    l.number_of_locations, l.rollout_scope, coalesce(l.interested_product_ids,'{}'::uuid[]), l.next_action
  )
  returning * into d;

  update public.leads
     set converted_at = now(),
         converted_to_deal_id = d.id,
         converted_deal_uuid = d.id,
         converted_by = auth.uid(),
         updated_at = now()
   where id = l.id;

  return jsonb_build_object(
    'id', d.id,
    'deal_uuid', d.id,
    'created_deal_uuid', d.id,
    'deal_id', d.deal_id,
    'created_deal_id', d.deal_id
  );
end;
$$;

grant execute on function public.convert_lead_to_deal(uuid) to authenticated;
