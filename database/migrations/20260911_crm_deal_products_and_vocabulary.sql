-- CRM vocabulary + deal product-interest support.
-- 1) Deal stage label: "Converted to Proposal" -> "Proposal".
-- 2) Deal can store multiple Product Catalog interests.

alter table public.deals
  add column if not exists interested_product_ids uuid[] not null default '{}'::uuid[];

comment on column public.deals.interested_product_ids is
  'Product Catalog item UUIDs the prospect/deal is interested in. Multiple selections are allowed.';

update public.deals
   set stage = 'Proposal',
       updated_at = now()
 where lower(trim(coalesce(stage, ''))) in ('converted to proposal', 'proposal sent');

create or replace function public.normalize_deal_pipeline_vocabulary()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_stage text;
begin
  v_stage := lower(trim(coalesce(new.stage, '')));

  if v_stage in ('converted to proposal', 'proposal sent', 'proposal') then
    new.stage := 'Proposal';
  end if;

  if new.interested_product_ids is null then
    new.interested_product_ids := '{}'::uuid[];
  else
    select coalesce(array_agg(x.id order by x.id), '{}'::uuid[])
      into new.interested_product_ids
      from (
        select distinct unnest(new.interested_product_ids) as id
      ) x;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_deals_normalize_pipeline_vocabulary on public.deals;
create trigger trg_deals_normalize_pipeline_vocabulary
before insert or update of stage, interested_product_ids on public.deals
for each row execute function public.normalize_deal_pipeline_vocabulary();

create index if not exists idx_deals_interested_product_ids_gin
  on public.deals using gin (interested_product_ids);

do $body$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.crm_daily_brief_source_snapshot(timestamp with time zone)'::regprocedure)
    into v_definition;

  if v_definition is not null then
    v_definition := replace(
      v_definition,
      $q$not in ('lost','closed','converted','won')$q$,
      $q$not in ('lost','closed','converted','won','disregard')$q$
    );
    execute v_definition;
  end if;
exception
  when undefined_function then
    null;
end;
$body$;
