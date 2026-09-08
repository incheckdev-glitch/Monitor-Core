-- Prevent reseller_user from tampering with ownership, internal workflow, or amount-due fields.

create or replace function private.reseller_enforce_external_write()
returns trigger
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  rid uuid;
  calc numeric;
  deal_row public.reseller_deals%rowtype;
begin
  if private.reseller_current_role()<>'reseller_user' then
    return new;
  end if;

  rid := private.reseller_current_reseller_id();
  if rid is null or new.reseller_id is distinct from rid then
    raise exception 'Reseller scope violation';
  end if;

  if tg_table_name='reseller_companies' then
    if tg_op='INSERT' then
      new.ownership_status := 'unregistered';
      new.ownership_expires_at := null;
      if new.company_status='customer' then new.company_status := 'prospect'; end if;
    else
      new.ownership_status := old.ownership_status;
      new.ownership_expires_at := old.ownership_expires_at;
      if new.company_status='customer' and old.company_status<>'customer' then
        raise exception 'Customer status is created by activation approval';
      end if;
    end if;
  elsif tg_table_name='reseller_deals' then
    calc := private.reseller_calculated_amount(new.reseller_id,new.customer_sale_amount,new.location_count);
    new.estimated_incheck_amount := coalesce(calc,0);
  elsif tg_table_name='reseller_activations' then
    if new.deal_id is not null then
      select * into deal_row from public.reseller_deals d where d.id=new.deal_id and d.reseller_id=rid;
      if found then
        new.customer_sale_amount := deal_row.customer_sale_amount;
        new.location_count := deal_row.location_count;
      end if;
    end if;
    calc := private.reseller_calculated_amount(new.reseller_id,new.customer_sale_amount,new.location_count);
    new.amount_due_to_incheck := coalesce(calc,0);
    new.approved_at := case when tg_op='UPDATE' then old.approved_at else null end;
    new.approved_by := case when tg_op='UPDATE' then old.approved_by else null end;
    new.activated_at := case when tg_op='UPDATE' then old.activated_at else null end;
  elsif tg_table_name='reseller_requests' then
    new.assigned_to := case when tg_op='UPDATE' then old.assigned_to else null end;
    new.resolution := case when tg_op='UPDATE' then old.resolution else null end;
    new.resolved_at := case when tg_op='UPDATE' then old.resolved_at else null end;
    new.resolved_by := case when tg_op='UPDATE' then old.resolved_by else null end;
  elsif tg_table_name='reseller_renewals' and tg_op='UPDATE' then
    new.company_id := old.company_id;
    new.activation_id := old.activation_id;
    new.currency := old.currency;
    new.renewal_amount := old.renewal_amount;
    new.current_locations := old.current_locations;
    new.renewal_date := old.renewal_date;
    new.response_due_date := old.response_due_date;
    new.new_start_date := old.new_start_date;
    new.new_end_date := old.new_end_date;
  end if;

  return new;
end;
$$;

revoke all on function private.reseller_enforce_external_write() from public,anon,authenticated;

-- Run before the existing reseller workflow triggers.
drop trigger if exists trg_reseller_external_companies on public.reseller_companies;
create trigger trg_reseller_external_companies before insert or update on public.reseller_companies for each row execute function private.reseller_enforce_external_write();

drop trigger if exists trg_reseller_external_deals on public.reseller_deals;
create trigger trg_reseller_external_deals before insert or update on public.reseller_deals for each row execute function private.reseller_enforce_external_write();

drop trigger if exists trg_reseller_external_activations on public.reseller_activations;
create trigger trg_reseller_external_activations before insert or update on public.reseller_activations for each row execute function private.reseller_enforce_external_write();

drop trigger if exists trg_reseller_external_requests on public.reseller_requests;
create trigger trg_reseller_external_requests before insert or update on public.reseller_requests for each row execute function private.reseller_enforce_external_write();

drop trigger if exists trg_reseller_external_renewals on public.reseller_renewals;
create trigger trg_reseller_external_renewals before update on public.reseller_renewals for each row execute function private.reseller_enforce_external_write();
