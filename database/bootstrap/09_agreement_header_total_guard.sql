-- InCheck360 agreement header commercial-total guard
-- Prevents partial agreement updates (for example signing) from resetting
-- subtotal/grand_total fields to zero when positive agreement_items exist.
-- Safe to re-run.

begin;

create or replace function public.guard_agreement_header_commercial_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saas numeric(14,2) := 0;
  v_one_time numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
begin
  select
    coalesce(sum(
      case
        when lower(coalesce(ai.section, '')) in ('annual_saas', 'annual saas', 'saas', 'subscription')
          or lower(coalesce(ai.section, '')) like '%annual%'
          or lower(coalesce(ai.section, '')) like '%saas%'
          or lower(coalesce(ai.section, '')) like '%subscription%'
        then coalesce(ai.line_total, 0)
        else 0
      end
    ), 0),
    coalesce(sum(
      case
        when lower(coalesce(ai.section, '')) in ('one_time_fee', 'one time fee', 'one_time', 'one time', 'hardware')
          or lower(coalesce(ai.section, '')) like '%one_time%'
          or lower(coalesce(ai.section, '')) like '%one time%'
          or lower(coalesce(ai.section, '')) like '%setup%'
          or lower(coalesce(ai.section, '')) like '%implementation%'
          or lower(coalesce(ai.section, '')) like '%installation%'
          or lower(coalesce(ai.section, '')) like '%hardware%'
          or lower(coalesce(ai.section, '')) like '%device%'
        then coalesce(ai.line_total, 0)
        else 0
      end
    ), 0)
  into v_saas, v_one_time
  from public.agreement_items ai
  where ai.agreement_id = new.id
    and coalesce(ai.is_superseded, false) = false;

  v_total := round(v_saas + v_one_time, 2);

  -- Agreement items are the source of truth for commercial totals.
  -- Only force synchronization when they represent a positive commercial value,
  -- so empty/non-commercial agreements are not changed unexpectedly.
  if v_total > 0 then
    new.subtotal_locations := round(v_saas, 2);
    new.subtotal_one_time := round(v_one_time, 2);
    new.grand_total := v_total;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_agreement_header_commercial_totals on public.agreements;
create trigger trg_guard_agreement_header_commercial_totals
before update
on public.agreements
for each row
execute function public.guard_agreement_header_commercial_totals();

-- Repair current zero-value headers where commercial agreement items exist.
do $$
declare
  r record;
begin
  for r in
    select a.id
    from public.agreements a
    where coalesce(a.grand_total, 0) <= 0
      and exists (
        select 1
        from public.agreement_items ai
        where ai.agreement_id = a.id
          and coalesce(ai.is_superseded, false) = false
          and coalesce(ai.line_total, 0) > 0
      )
  loop
    perform public.recalculate_agreement_commercial_totals(r.id);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
