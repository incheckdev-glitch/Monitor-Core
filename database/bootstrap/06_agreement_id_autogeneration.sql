-- InCheck360 agreement business ID generation
-- Fixes live proposal-to-agreement conversion failures where public.agreements.agreement_id
-- is NOT NULL but agreement creation correctly leaves business-ID assignment to the data layer.
-- Safe to re-run.

begin;

create sequence if not exists public.agreement_business_id_seq;

-- Align the sequence with existing Agreement#NNNNN / agreement_number / sequence_number values.
do $$
declare
  v_max bigint := 0;
  v_current bigint := 0;
begin
  select greatest(
    coalesce((select max((regexp_match(agreement_id, '^Agreement#([0-9]+)$', 'i'))[1]::bigint)
              from public.agreements
              where agreement_id ~* '^Agreement#[0-9]+$'), 0),
    coalesce((select max(agreement_number::bigint)
              from public.agreements
              where agreement_number ~ '^[0-9]+$'), 0),
    coalesce((select max(sequence_number) from public.agreements), 0)
  ) into v_max;

  select last_value into v_current from public.agreement_business_id_seq;

  if v_max > v_current then
    perform setval('public.agreement_business_id_seq', v_max, true);
  elsif v_max = 0 and v_current = 1 then
    -- New sequence: make the first generated agreement Agreement#00001.
    perform setval('public.agreement_business_id_seq', 1, false);
  end if;
end $$;

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

    if nullif(btrim(new.agreement_number), '') is null then
      new.agreement_number := lpad(v_seq::text, 5, '0');
    end if;

    if new.sequence_number is null then
      new.sequence_number := v_seq;
    end if;
  else
    -- If a caller supplied Agreement#NNNNN, preserve it and fill companion fields only when blank.
    if new.agreement_id ~* '^Agreement#[0-9]+$' then
      v_existing_seq := (regexp_match(new.agreement_id, '^Agreement#([0-9]+)$', 'i'))[1]::bigint;

      if nullif(btrim(new.agreement_number), '') is null then
        new.agreement_number := lpad(v_existing_seq::text, 5, '0');
      end if;

      if new.sequence_number is null then
        new.sequence_number := v_existing_seq;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assign_agreement_business_id on public.agreements;
create trigger trg_assign_agreement_business_id
before insert on public.agreements
for each row
execute function public.assign_agreement_business_id();

commit;

notify pgrst, 'reload schema';
