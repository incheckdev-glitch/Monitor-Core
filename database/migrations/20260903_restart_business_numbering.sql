-- Monitor Core production business-numbering restart (2026-09-03)
--
-- Purpose:
--   * Restart the clean production baseline at #00001.
--   * Keep Company / Contact / Agreement counters aligned with persisted rows.
--   * Remove the obsolete agreement_number_seq trigger that could make
--     agreement_id and agreement_number diverge.
--
-- Guardrail:
--   This one-time restart only runs while companies, contacts, and agreements
--   each contain at most one baseline row. It fails instead of mass-renumbering
--   a populated production environment.

-- Remove the legacy agreement-number trigger. It independently consumed
-- agreement_number_seq and caused agreement_id / agreement_number to diverge.
drop trigger if exists trg_allocate_agreement_number on public.agreements;

create sequence if not exists public.agreement_business_id_seq;

create or replace function public.assign_agreement_business_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_seq bigint;
  v_existing_seq bigint;
begin
  if nullif(btrim(new.agreement_id), '') is null then
    v_seq := nextval('public.agreement_business_id_seq');
    new.agreement_id := 'Agreement#' || lpad(v_seq::text, 5, '0');
    new.agreement_number := new.agreement_id;
    new.sequence_number := v_seq;
  elsif new.agreement_id ~* '^Agreement#[0-9]+$' then
    v_existing_seq := (regexp_match(new.agreement_id, '^Agreement#([0-9]+)$', 'i'))[1]::bigint;
    new.agreement_number := 'Agreement#' || lpad(v_existing_seq::text, 5, '0');
    new.sequence_number := v_existing_seq;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assign_agreement_business_id on public.agreements;
create trigger trg_assign_agreement_business_id
before insert on public.agreements
for each row
execute function public.assign_agreement_business_id();

do $$
declare
  v_count bigint;
  v_old_company_id text;
  v_old_contact_id text;
  v_old_agreement_id text;
  v_old_agreement_number text;
begin
  select count(*) into v_count from public.companies;
  if v_count = 0 then
    perform setval('public.company_business_id_seq', 1, false);
  elsif v_count = 1 then
    select company_id into v_old_company_id from public.companies limit 1;
    update public.companies
       set company_id = 'Company#00001'
     where company_id is distinct from 'Company#00001';
    update public.company_documents
       set company_id = 'Company#00001'
     where company_id = v_old_company_id;
    perform setval('public.company_business_id_seq', 1, true);
  else
    raise exception 'Numbering restart expected at most one company, found %', v_count;
  end if;

  select count(*) into v_count from public.contacts;
  if v_count = 0 then
    perform setval('public.contact_business_id_seq', 1, false);
  elsif v_count = 1 then
    select contact_id into v_old_contact_id from public.contacts limit 1;
    update public.contacts
       set contact_id = 'Contact#00001'
     where contact_id is distinct from 'Contact#00001';
    perform setval('public.contact_business_id_seq', 1, true);
  else
    raise exception 'Numbering restart expected at most one contact, found %', v_count;
  end if;

  select count(*) into v_count from public.agreements;
  if v_count = 0 then
    perform setval('public.agreement_business_id_seq', 1, false);
  elsif v_count = 1 then
    select agreement_id, agreement_number
      into v_old_agreement_id, v_old_agreement_number
      from public.agreements
      limit 1;

    update public.agreements
       set agreement_id = 'Agreement#00001',
           agreement_number = 'Agreement#00001',
           sequence_number = 1
     where agreement_id is distinct from 'Agreement#00001'
        or agreement_number is distinct from 'Agreement#00001'
        or sequence_number is distinct from 1;

    update public.lifecycle_status_logs
       set entity_id = case
             when entity_id in (v_old_agreement_id, v_old_agreement_number)
               then 'Agreement#00001'
             else entity_id
           end,
           entity_number = case
             when entity_number in (v_old_agreement_id, v_old_agreement_number)
               then 'Agreement#00001'
             else entity_number
           end
     where entity_id in (v_old_agreement_id, v_old_agreement_number)
        or entity_number in (v_old_agreement_id, v_old_agreement_number);

    perform setval('public.agreement_business_id_seq', 1, true);
  else
    raise exception 'Numbering restart expected at most one agreement, found %', v_count;
  end if;

  -- Keep the retired legacy sequence harmless if it still exists.
  if to_regclass('public.agreement_number_seq') is not null then
    perform setval('public.agreement_number_seq', 1, false);
  end if;

  -- Commission receipt numbering is already a sequence-backed business ID.
  -- Align it with the current rows or make the first new receipt number 1.
  if to_regclass('public.sales_commission_receipt_no_seq') is not null then
    select count(*) into v_count from public.sales_commission_receipts;
    if v_count = 0 then
      perform setval('public.sales_commission_receipt_no_seq', 1, false);
    else
      perform setval(
        'public.sales_commission_receipt_no_seq',
        greatest(
          coalesce(
            (
              select max((regexp_match(receipt_number, '([0-9]+)$'))[1]::bigint)
              from public.sales_commission_receipts
              where receipt_number ~ '[0-9]+$'
            ),
            1
          ),
          1
        ),
        true
      );
    end if;
  end if;
end
$$;

notify pgrst, 'reload schema';
