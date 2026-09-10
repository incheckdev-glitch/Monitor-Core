-- Ensure sales conversions respect the current Deal pipeline.
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
    l.lead_source, l.service_interest, 'In Progress', l.next_follow_up_at, l.priority, l.estimated_value,
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

create or replace function public.create_proposal_from_deal(p_deal_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.deals;
  p public.proposals;
  v_id text;
  v_seq bigint;
begin
  select * into d from public.deals where id = p_deal_uuid for update;
  if not found then raise exception 'Deal not found'; end if;

  perform pg_advisory_xact_lock(hashtext('incheck360:proposal-business-id'));

  select coalesce(max(seq_value), 0) + 1
    into v_seq
    from (
      select (regexp_match(proposal_id, '^Proposal#([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.proposals
       where proposal_id ~* '^Proposal#[0-9]+$'
      union all
      select (regexp_match(ref_number, '^Proposal#([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.proposals
       where ref_number ~* '^Proposal#[0-9]+$'
    ) existing;

  v_id := 'Proposal#' || lpad(v_seq::text, 5, '0');

  insert into public.proposals(
    proposal_id, ref_number, deal_id, company_id, company_name,
    contact_id, contact_name, contact_email, contact_phone,
    customer_name, customer_legal_name, customer_address,
    currency, status, created_by, updated_by, proposal_date, proposal_valid_until
  )
  values(
    v_id, v_id, d.id, d.company_id, d.company_name,
    d.contact_id, d.contact_name, d.contact_email, d.contact_phone,
    d.customer_name, d.customer_legal_name, d.customer_address,
    coalesce(d.currency, 'USD'), 'draft', auth.uid(), auth.uid(), current_date, current_date + 14
  )
  returning * into p;

  update public.deals
     set stage = 'Converted to Proposal',
         updated_by = auth.uid(),
         updated_at = now()
   where id = d.id;

  return jsonb_build_object(
    'id', p.id,
    'proposal_uuid', p.id,
    'created_proposal_uuid', p.id,
    'proposal_id', p.proposal_id,
    'ref_number', p.ref_number
  );
end;
$$;
