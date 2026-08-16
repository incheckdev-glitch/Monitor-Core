-- InCheck360 friendly Deal business ID allocation
--
-- Keeps existing Deal IDs unchanged. New Lead -> Deal conversions use Deal#NNNNN.
-- Safe to re-run.

begin;

create or replace function public.convert_lead_to_deal(p_lead_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.leads;
  d public.deals;
  v_code text;
  v_seq bigint;
begin
  select * into l from public.leads where id = p_lead_uuid for update;
  if not found then raise exception 'Lead not found'; end if;
  if lower(coalesce(l.status, '')) <> 'qualified' then raise exception 'Lead must be qualified before conversion'; end if;

  perform pg_advisory_xact_lock(hashtext('incheck360:deal-business-id'));

  select coalesce(max((regexp_match(deal_id, '^Deal#([0-9]+)$', 'i'))[1]::bigint), 0) + 1
    into v_seq
    from public.deals
   where deal_id ~* '^Deal#[0-9]+$';

  v_code := 'Deal#' || lpad(v_seq::text, 5, '0');

  insert into public.deals(
    deal_id, lead_id, source_lead_uuid, lead_code, full_name,
    company_id, company_name, customer_name, customer_legal_name, customer_address,
    contact_id, contact_name, contact_email, contact_phone, phone, email, country,
    lead_source, service_interest, stage, next_follow_up_at, priority, estimated_value,
    currency, assigned_to, converted_by, converted_at, notes, created_by, updated_by
  )
  values(
    v_code, l.id, l.id, l.lead_id, l.full_name,
    l.company_id, l.company_name, l.customer_name, l.customer_legal_name, l.customer_address,
    l.contact_id, l.contact_name, l.contact_email, l.contact_phone, l.phone, l.email, l.country,
    l.lead_source, l.service_interest, 'proposal', l.next_follow_up_at, l.priority, l.estimated_value,
    l.currency, l.assigned_to, auth.uid(), now(), l.notes, auth.uid(), auth.uid()
  )
  returning * into d;

  update public.leads
     set converted_at = now(),
         converted_to_deal_id = d.id,
         converted_deal_uuid = d.id,
         converted_by = auth.uid(),
         updated_at = now()
   where id = l.id;

  return jsonb_build_object(
    'id', d.id,
    'deal_uuid', d.id,
    'created_deal_uuid', d.id,
    'deal_id', d.deal_id,
    'created_deal_id', d.deal_id
  );
end;
$$;

grant execute on function public.convert_lead_to_deal(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
