-- InCheck360 company business ID generation
-- Fixes live create-company failures where public.companies.company_id is NOT NULL
-- but the Companies UI correctly leaves business-ID assignment to the data layer.
-- Safe to re-run.

begin;

create sequence if not exists public.company_business_id_seq;

-- Align the sequence with existing Company#NNNNN records without moving it backwards.
do $$
declare
  v_max bigint := 0;
  v_current bigint := 0;
begin
  select coalesce(max((regexp_match(company_id, '^Company#([0-9]+)$', 'i'))[1]::bigint), 0)
    into v_max
  from public.companies
  where company_id ~* '^Company#[0-9]+$';

  select last_value into v_current from public.company_business_id_seq;

  if v_max > v_current then
    perform setval('public.company_business_id_seq', v_max, true);
  elsif v_max = 0 and v_current = 1 then
    -- New sequence: make the first generated ID Company#00001.
    perform setval('public.company_business_id_seq', 1, false);
  end if;
end $$;

create or replace function public.assign_company_business_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(btrim(new.company_id), '') is null then
    new.company_id := 'Company#' || lpad(nextval('public.company_business_id_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_company_business_id on public.companies;
create trigger trg_assign_company_business_id
before insert on public.companies
for each row
execute function public.assign_company_business_id();

commit;

-- PostgREST schema cache refresh.
notify pgrst, 'reload schema';
