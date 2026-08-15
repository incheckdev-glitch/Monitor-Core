-- InCheck360 contact business ID generation
-- Fixes live create-contact failures where public.contacts.contact_id is NOT NULL
-- but the Contacts UI intentionally leaves business-ID assignment to the data layer.
-- Safe to re-run.

begin;

create sequence if not exists public.contact_business_id_seq;

-- Align the sequence with existing Contact#NNNNN records without moving it backwards.
do $$
declare
  v_max bigint := 0;
  v_current bigint := 0;
begin
  select coalesce(max((regexp_match(contact_id, '^Contact#([0-9]+)$', 'i'))[1]::bigint), 0)
    into v_max
  from public.contacts
  where contact_id ~* '^Contact#[0-9]+$';

  select last_value into v_current from public.contact_business_id_seq;

  if v_max > v_current then
    perform setval('public.contact_business_id_seq', v_max, true);
  elsif v_max = 0 and v_current = 1 then
    -- New sequence: make the first generated ID Contact#00001.
    perform setval('public.contact_business_id_seq', 1, false);
  end if;
end $$;

create or replace function public.assign_contact_business_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(btrim(new.contact_id), '') is null then
    new.contact_id := 'Contact#' || lpad(nextval('public.contact_business_id_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_contact_business_id on public.contacts;
create trigger trg_assign_contact_business_id
before insert on public.contacts
for each row
execute function public.assign_contact_business_id();

commit;

notify pgrst, 'reload schema';
