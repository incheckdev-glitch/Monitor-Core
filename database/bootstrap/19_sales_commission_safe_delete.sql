begin;

create or replace function public.delete_sales_commission(p_commission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_has_paid boolean;
  v_has_active_receipt boolean;
begin
  if public.sales_commission_access_level() <> 'manage_all' then
    raise exception 'You do not have permission to delete commission records.';
  end if;

  select exists(select 1 from public.sales_commissions where id = p_commission_id) into v_exists;
  if not v_exists then
    raise exception 'Commission record was not found.';
  end if;

  perform 1 from public.sales_commissions where id = p_commission_id for update;

  select exists(
    select 1 from public.sales_commission_installments i
    where i.commission_id = p_commission_id
      and (lower(coalesce(i.status, '')) = 'paid' or coalesce(i.paid_amount, 0) > 0)
  ) into v_has_paid;
  if v_has_paid then
    raise exception 'A commission with paid installments cannot be deleted. Undo the payments first.';
  end if;

  select exists(
    select 1 from public.sales_commission_receipts r
    where r.commission_id = p_commission_id
      and lower(coalesce(r.status, 'issued')) not in ('void', 'voided', 'cancelled', 'canceled')
  ) into v_has_active_receipt;
  if v_has_active_receipt then
    raise exception 'A commission with an active receipt cannot be deleted. Undo the payment first.';
  end if;

  delete from public.sales_commission_receipts
  where commission_id = p_commission_id
    and lower(coalesce(status, '')) in ('void', 'voided', 'cancelled', 'canceled');

  delete from public.sales_commissions where id = p_commission_id;
  if not found then
    raise exception 'Commission record was not deleted.';
  end if;

  return true;
end;
$$;

revoke all on function public.delete_sales_commission(uuid) from public;
grant execute on function public.delete_sales_commission(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
