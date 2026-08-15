-- InCheck360 agreement commercial totals synchronization
-- Ensures proposal -> agreement -> invoice preserves the actual commercial value.
-- Safe to re-run.

begin;

create or replace function public.recalculate_agreement_commercial_totals(p_agreement_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saas numeric(14,2) := 0;
  v_one_time numeric(14,2) := 0;
begin
  if p_agreement_id is null then
    return;
  end if;

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
  where ai.agreement_id = p_agreement_id
    and coalesce(ai.is_superseded, false) = false;

  update public.agreements a
  set
    subtotal_locations = round(v_saas, 2),
    subtotal_one_time = round(v_one_time, 2),
    grand_total = round(v_saas + v_one_time, 2),
    updated_at = now()
  where a.id = p_agreement_id
    and (
      a.subtotal_locations is distinct from round(v_saas, 2)
      or a.subtotal_one_time is distinct from round(v_one_time, 2)
      or a.grand_total is distinct from round(v_saas + v_one_time, 2)
    );
end;
$$;

create or replace function public.sync_agreement_commercial_totals_from_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_agreement_commercial_totals(old.agreement_id);
    return old;
  end if;

  perform public.recalculate_agreement_commercial_totals(new.agreement_id);

  if tg_op = 'UPDATE' and old.agreement_id is distinct from new.agreement_id then
    perform public.recalculate_agreement_commercial_totals(old.agreement_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_agreement_commercial_totals_from_items on public.agreement_items;
create trigger trg_sync_agreement_commercial_totals_from_items
after insert or update or delete
on public.agreement_items
for each row
execute function public.sync_agreement_commercial_totals_from_items();

-- Repair only clearly stale zero-value agreement headers that already have
-- positive commercial agreement items. Existing non-zero commercial totals are
-- deliberately left untouched.
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
