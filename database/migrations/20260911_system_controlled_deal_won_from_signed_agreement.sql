-- Deal Won is a system-controlled CRM stage.
-- A proposal-linked Agreement automatically wins its related Deal when the Agreement
-- becomes signed according to the same signature signals used by the Agreements UI.

create or replace function public.crm_agreement_is_signed(
  p_status text,
  p_customer_official_sign_date date,
  p_customer_sign_date date,
  p_customer_signed_at timestamptz,
  p_provider_official_signatory_1_sign_date date,
  p_provider_sign_date date
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    lower(trim(coalesce(p_status, ''))) in ('signed','signed_active','signed-active','signedactive','active')
    or (
      coalesce(p_customer_official_sign_date, p_customer_sign_date, p_customer_signed_at::date) is not null
      and coalesce(p_provider_official_signatory_1_sign_date, p_provider_sign_date) is not null
    );
$$;

create or replace function public.guard_system_controlled_deal_won()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_old_stage text := case when tg_op = 'UPDATE' then lower(trim(coalesce(old.stage, ''))) else '' end;
  v_new_stage text := lower(trim(coalesce(new.stage, '')));
  v_system text := coalesce(current_setting('app.system_deal_won', true), '');
  v_old_won boolean;
  v_new_won boolean;
begin
  v_old_won := v_old_stage in ('won','closed won','closed_won');
  v_new_won := v_new_stage in ('won','closed won','closed_won');

  if tg_op = 'INSERT' then
    if v_new_won and v_system <> '1' then
      raise exception 'Deal stage Won is system-controlled and can only be set by a signed related agreement.';
    end if;
    return new;
  end if;

  if v_old_won is distinct from v_new_won and v_system <> '1' then
    raise exception 'Deal stage Won is system-controlled and can only change through the signed-agreement lifecycle.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_deals_guard_system_controlled_won on public.deals;
create trigger trg_deals_guard_system_controlled_won
before insert or update of stage on public.deals
for each row execute function public.guard_system_controlled_deal_won();

create or replace function public.normalize_deal_pipeline_vocabulary()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_stage text;
begin
  v_stage := lower(trim(coalesce(new.stage, '')));

  if v_stage in ('converted to proposal', 'proposal sent', 'proposal') then
    new.stage := 'Proposal';
  elsif v_stage in ('won', 'closed won', 'closed_won') then
    new.stage := 'Won';
  elsif v_stage in ('lost', 'closed lost', 'closed_lost') then
    new.stage := 'Lost';
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

create or replace function public.crm_sync_deal_won_from_agreement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_id uuid;
  v_previous_setting text := coalesce(current_setting('app.system_deal_won', true), '');
begin
  if not public.crm_agreement_is_signed(
    new.status,
    new.customer_official_sign_date,
    new.customer_sign_date,
    new.customer_signed_at,
    new.provider_official_signatory_1_sign_date,
    new.provider_sign_date
  ) then
    return new;
  end if;

  if new.proposal_id is null then
    return new;
  end if;

  select p.deal_id
    into v_deal_id
    from public.proposals p
   where p.id = new.proposal_id;

  if v_deal_id is null then
    return new;
  end if;

  perform set_config('app.system_deal_won', '1', true);

  update public.deals d
     set stage = 'Won',
         updated_by = coalesce(new.updated_by, auth.uid(), d.updated_by)
   where d.id = v_deal_id
     and lower(trim(coalesce(d.stage, ''))) not in ('won','closed won','closed_won');

  perform set_config('app.system_deal_won', v_previous_setting, true);
  return new;
end;
$$;

drop trigger if exists trg_agreements_sync_related_deal_won on public.agreements;
create trigger trg_agreements_sync_related_deal_won
after insert or update on public.agreements
for each row execute function public.crm_sync_deal_won_from_agreement();

-- Backfill any already-signed, proposal-linked agreements without allowing manual Won updates.
do $$
declare
  v_previous_setting text := coalesce(current_setting('app.system_deal_won', true), '');
begin
  perform set_config('app.system_deal_won', '1', true);

  update public.deals d
     set stage = 'Won'
    from public.proposals p
    join public.agreements a on a.proposal_id = p.id
   where p.deal_id = d.id
     and public.crm_agreement_is_signed(
       a.status,
       a.customer_official_sign_date,
       a.customer_sign_date,
       a.customer_signed_at,
       a.provider_official_signatory_1_sign_date,
       a.provider_sign_date
     )
     and lower(trim(coalesce(d.stage, ''))) not in ('won','closed won','closed_won');

  perform set_config('app.system_deal_won', v_previous_setting, true);
end;
$$;
