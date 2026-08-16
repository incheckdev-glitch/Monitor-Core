-- InCheck360 gap-safe production business ID allocation
--
-- The previous concurrency hardening serialized count(*) + 1 allocation, which
-- still collides when historical records contain numbering gaps (for example
-- SA/2026/01 and SA/2026/03 with only two rows). This patch keeps transaction
-- advisory locks but allocates from MAX(existing numeric suffix) + 1 instead.
--
-- Safe to re-run. Existing business IDs are not changed.

begin;

-- --------------------------------------------------------------------------
-- Lead -> Deal: Deal#NNNNN
-- --------------------------------------------------------------------------
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

  perform pg_advisory_xact_lock(hashtext('incheck360:deal-business-id'), extract(year from current_date)::integer);

  select coalesce(max((regexp_match(deal_id, '^Deal#([0-9]+)

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

-- --------------------------------------------------------------------------
-- Deal -> Proposal: Proposal#NNNNN
-- --------------------------------------------------------------------------
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
  select * into d from public.deals where id = p_deal_uuid;
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

  return jsonb_build_object(
    'id', p.id,
    'proposal_uuid', p.id,
    'created_proposal_uuid', p.id,
    'proposal_id', p.proposal_id,
    'ref_number', p.ref_number
  );
end;
$$;

grant execute on function public.create_proposal_from_deal(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Agreement -> Client + Invoice: CLIENT/YYYY/NNNN and SA/YYYY/NN
-- --------------------------------------------------------------------------
create or replace function public.create_invoice_from_agreement(p_agreement_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.agreements;
  i public.invoices;
  v_id text;
  v_no text;
  c uuid;
  v_year text := to_char(current_date, 'YYYY');
  v_client_seq bigint;
  v_invoice_seq bigint;
begin
  select * into a from public.agreements where id = p_agreement_uuid;
  if not found then raise exception 'Agreement not found'; end if;

  select cl.id into c
    from public.clients cl
   where cl.source_agreement_id = a.id
   limit 1;

  if c is null then
    perform pg_advisory_xact_lock(hashtext('incheck360:client-business-id'), extract(year from current_date)::integer);

    select cl.id into c
      from public.clients cl
     where cl.source_agreement_id = a.id
     limit 1;

    if c is null then
      select coalesce(max((regexp_match(client_id, '^CLIENT/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint), 0) + 1
        into v_client_seq
        from public.clients
       where client_id ~* ('^CLIENT/' || v_year || '/[0-9]+$');

      insert into public.clients(
        client_id, client_name, company_name, primary_email, primary_phone,
        billing_frequency, payment_term, source_agreement_id, created_by, updated_by
      )
      values(
        'CLIENT/' || v_year || '/' || lpad(v_client_seq::text, 4, '0'),
        coalesce(a.customer_name, a.customer_legal_name, a.company_name, 'Client'),
        a.company_name,
        a.customer_contact_email,
        a.customer_contact_phone,
        a.billing_frequency,
        a.payment_term,
        a.id,
        auth.uid(),
        auth.uid()
      )
      returning id into c;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('incheck360:invoice-business-id'), extract(year from current_date)::integer);

  select coalesce(max(seq_value), 0) + 1
    into v_invoice_seq
    from (
      select (regexp_match(invoice_id, '^SA/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.invoices
       where invoice_id ~* ('^SA/' || v_year || '/[0-9]+$')
      union all
      select (regexp_match(invoice_number, '^SA/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.invoices
       where invoice_number ~* ('^SA/' || v_year || '/[0-9]+$')
    ) existing;

  v_no := 'SA/' || v_year || '/' || lpad(v_invoice_seq::text, 2, '0');
  v_id := v_no;

  insert into public.invoices(
    invoice_id, invoice_number, client_id, agreement_uuid, agreement_id, agreement_number,
    proposal_id, issue_date, due_date, billing_frequency, payment_term, payment_terms,
    company_id, company_name, contact_id, contact_name, contact_email, contact_phone, contact_mobile,
    customer_name, customer_legal_name, customer_address, customer_contact_name, customer_contact_email,
    provider_legal_name, provider_address, subtotal_locations, subtotal_one_time, invoice_total,
    status, currency, created_by, updated_by
  )
  values(
    v_id, v_no, c, a.id, a.agreement_id, a.agreement_number,
    a.proposal_id, current_date, current_date + 7, a.billing_frequency, a.payment_term, a.payment_terms,
    a.company_id, a.company_name, a.contact_id, a.contact_name, a.contact_email, a.contact_phone, a.contact_mobile,
    a.customer_name, a.customer_legal_name, a.customer_address, a.customer_contact_name, a.customer_contact_email,
    a.provider_legal_name, a.provider_address, a.subtotal_locations, a.subtotal_one_time, a.grand_total,
    'issued', a.currency, auth.uid(), auth.uid()
  )
  returning * into i;

  insert into public.invoice_items(
    invoice_id, section, line_no, location_name, item_name, unit_price, discount_percent,
    discounted_unit_price, quantity, license_quantity, line_total, service_start_date,
    service_end_date, capability_name, capability_value, notes,
    source_agreement_item_id, source_agreement_id, source_agreement_reference
  )
  select
    i.id, ai.section, ai.line_no, ai.location_name, ai.item_name, ai.unit_price, ai.discount_percent,
    ai.discounted_unit_price, ai.quantity, ai.license_quantity, ai.line_total, ai.service_start_date,
    ai.service_end_date, ai.capability_name, ai.capability_value, ai.notes,
    ai.id, a.id, coalesce(a.agreement_number, a.agreement_id)
  from public.agreement_items ai
  where ai.agreement_id = a.id
    and coalesce(ai.is_superseded, false) = false;

  return jsonb_build_object(
    'id', i.id,
    'invoice_uuid', i.id,
    'created_invoice_uuid', i.id,
    'invoice_id', i.invoice_id,
    'invoice_number', i.invoice_number
  );
end;
$$;

grant execute on function public.create_invoice_from_agreement(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Invoice -> Receipt: RV/YYYY/NN
-- --------------------------------------------------------------------------
create or replace function public.create_receipt_from_invoice(
  p_invoice_uuid uuid,
  p_amount numeric,
  p_payment_method text default null,
  p_payment_reference text default null,
  p_receipt_date text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.invoices;
  r public.receipts;
  v_no text;
  v_date date;
  v_old numeric;
  v_new numeric;
  v_year text := to_char(current_date, 'YYYY');
  v_receipt_seq bigint;
begin
  select * into i from public.invoices where id = p_invoice_uuid for update;
  if not found then raise exception 'Invoice not found'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Receipt amount must be greater than zero'; end if;

  v_date := coalesce(nullif(p_receipt_date, '')::date, current_date);
  v_old := coalesce(i.amount_paid, i.received_amount, 0);
  v_new := v_old + p_amount;

  perform pg_advisory_xact_lock(hashtext('incheck360:receipt-business-id'), extract(year from current_date)::integer);

  select coalesce(max(seq_value), 0) + 1
    into v_receipt_seq
    from (
      select (regexp_match(receipt_id, '^RV/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.receipts
       where receipt_id ~* ('^RV/' || v_year || '/[0-9]+$')
      union all
      select (regexp_match(receipt_number, '^RV/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.receipts
       where receipt_number ~* ('^RV/' || v_year || '/[0-9]+$')
    ) existing;

  v_no := 'RV/' || v_year || '/' || lpad(v_receipt_seq::text, 2, '0');

  insert into public.receipts(
    receipt_id, receipt_number, invoice_id, invoice_number,
    agreement_uuid, agreement_id, agreement_number, client_id,
    company_id, company_name, customer_name, customer_legal_name, customer_address,
    contact_id, contact_name, contact_email, contact_phone, contact_mobile,
    receipt_date, payment_date, amount_received, amount_paid, payment_method,
    payment_reference, status, currency, invoice_total, old_paid_total, paid_now,
    received_amount, new_paid_total, pending_amount, payment_state, created_by, updated_by
  )
  values(
    v_no, v_no, i.id, i.invoice_number,
    i.agreement_uuid, i.agreement_id, i.agreement_number, i.client_id,
    i.company_id, i.company_name, i.customer_name, i.customer_legal_name, i.customer_address,
    i.contact_id, i.contact_name, i.contact_email, i.contact_phone, i.contact_mobile,
    v_date, v_date, p_amount, p_amount, p_payment_method,
    p_payment_reference, 'issued', i.currency, i.invoice_total, v_old, p_amount,
    p_amount, v_new, greatest(i.invoice_total - v_new - coalesce(i.credit_note_amount, 0), 0),
    case when v_new + coalesce(i.credit_note_amount, 0) >= i.invoice_total then 'paid' else 'partial' end,
    auth.uid(), auth.uid()
  )
  returning * into r;

  insert into public.receipt_items(
    receipt_id, invoice_item_id, section, line_no, location_name, item_name, description,
    quantity, unit_price, discount_percent, discounted_unit_price, line_total, amount,
    capability_name, capability_value, notes, service_start_date, service_end_date, currency
  )
  select
    r.id, ii.id, ii.section, ii.line_no, ii.location_name, ii.item_name, ii.item_name,
    ii.quantity, ii.unit_price, ii.discount_percent, ii.discounted_unit_price, ii.line_total, ii.line_total,
    ii.capability_name, ii.capability_value, ii.notes, ii.service_start_date, ii.service_end_date, i.currency
  from public.invoice_items ii
  where ii.invoice_id = i.id;

  update public.invoices
     set amount_paid = v_new,
         received_amount = v_new,
         pending_amount = greatest(invoice_total - v_new - coalesce(credit_note_amount, 0), 0),
         balance_due = greatest(invoice_total - v_new - coalesce(credit_note_amount, 0), 0),
         payment_state = case when v_new + coalesce(credit_note_amount, 0) >= invoice_total then 'paid' else 'partial' end,
         payment_status = case when v_new + coalesce(credit_note_amount, 0) >= invoice_total then 'paid' else 'partial' end,
         paid_at = case when v_new + coalesce(credit_note_amount, 0) >= invoice_total then now() else paid_at end,
         updated_at = now()
   where id = i.id;

  return jsonb_build_object(
    'id', r.id,
    'receipt_uuid', r.id,
    'created_receipt_uuid', r.id,
    'receipt_id', r.receipt_id,
    'receipt_number', r.receipt_number
  );
end;
$$;

grant execute on function public.create_receipt_from_invoice(uuid, numeric, text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
, 'i'))[1]::bigint), 0) + 1
    into v_seq
    from public.deals
   where deal_id ~* '^Deal#[0-9]+

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

-- --------------------------------------------------------------------------
-- Deal -> Proposal: Proposal#NNNNN
-- --------------------------------------------------------------------------
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
  select * into d from public.deals where id = p_deal_uuid;
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

  return jsonb_build_object(
    'id', p.id,
    'proposal_uuid', p.id,
    'created_proposal_uuid', p.id,
    'proposal_id', p.proposal_id,
    'ref_number', p.ref_number
  );
end;
$$;

grant execute on function public.create_proposal_from_deal(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Agreement -> Client + Invoice: CLIENT/YYYY/NNNN and SA/YYYY/NN
-- --------------------------------------------------------------------------
create or replace function public.create_invoice_from_agreement(p_agreement_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.agreements;
  i public.invoices;
  v_id text;
  v_no text;
  c uuid;
  v_year text := to_char(current_date, 'YYYY');
  v_client_seq bigint;
  v_invoice_seq bigint;
begin
  select * into a from public.agreements where id = p_agreement_uuid;
  if not found then raise exception 'Agreement not found'; end if;

  select cl.id into c
    from public.clients cl
   where cl.source_agreement_id = a.id
   limit 1;

  if c is null then
    perform pg_advisory_xact_lock(hashtext('incheck360:client-business-id'), extract(year from current_date)::integer);

    select cl.id into c
      from public.clients cl
     where cl.source_agreement_id = a.id
     limit 1;

    if c is null then
      select coalesce(max((regexp_match(client_id, '^CLIENT/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint), 0) + 1
        into v_client_seq
        from public.clients
       where client_id ~* ('^CLIENT/' || v_year || '/[0-9]+$');

      insert into public.clients(
        client_id, client_name, company_name, primary_email, primary_phone,
        billing_frequency, payment_term, source_agreement_id, created_by, updated_by
      )
      values(
        'CLIENT/' || v_year || '/' || lpad(v_client_seq::text, 4, '0'),
        coalesce(a.customer_name, a.customer_legal_name, a.company_name, 'Client'),
        a.company_name,
        a.customer_contact_email,
        a.customer_contact_phone,
        a.billing_frequency,
        a.payment_term,
        a.id,
        auth.uid(),
        auth.uid()
      )
      returning id into c;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('incheck360:invoice-business-id'), extract(year from current_date)::integer);

  select coalesce(max(seq_value), 0) + 1
    into v_invoice_seq
    from (
      select (regexp_match(invoice_id, '^SA/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.invoices
       where invoice_id ~* ('^SA/' || v_year || '/[0-9]+$')
      union all
      select (regexp_match(invoice_number, '^SA/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.invoices
       where invoice_number ~* ('^SA/' || v_year || '/[0-9]+$')
    ) existing;

  v_no := 'SA/' || v_year || '/' || lpad(v_invoice_seq::text, 2, '0');
  v_id := v_no;

  insert into public.invoices(
    invoice_id, invoice_number, client_id, agreement_uuid, agreement_id, agreement_number,
    proposal_id, issue_date, due_date, billing_frequency, payment_term, payment_terms,
    company_id, company_name, contact_id, contact_name, contact_email, contact_phone, contact_mobile,
    customer_name, customer_legal_name, customer_address, customer_contact_name, customer_contact_email,
    provider_legal_name, provider_address, subtotal_locations, subtotal_one_time, invoice_total,
    status, currency, created_by, updated_by
  )
  values(
    v_id, v_no, c, a.id, a.agreement_id, a.agreement_number,
    a.proposal_id, current_date, current_date + 7, a.billing_frequency, a.payment_term, a.payment_terms,
    a.company_id, a.company_name, a.contact_id, a.contact_name, a.contact_email, a.contact_phone, a.contact_mobile,
    a.customer_name, a.customer_legal_name, a.customer_address, a.customer_contact_name, a.customer_contact_email,
    a.provider_legal_name, a.provider_address, a.subtotal_locations, a.subtotal_one_time, a.grand_total,
    'issued', a.currency, auth.uid(), auth.uid()
  )
  returning * into i;

  insert into public.invoice_items(
    invoice_id, section, line_no, location_name, item_name, unit_price, discount_percent,
    discounted_unit_price, quantity, license_quantity, line_total, service_start_date,
    service_end_date, capability_name, capability_value, notes,
    source_agreement_item_id, source_agreement_id, source_agreement_reference
  )
  select
    i.id, ai.section, ai.line_no, ai.location_name, ai.item_name, ai.unit_price, ai.discount_percent,
    ai.discounted_unit_price, ai.quantity, ai.license_quantity, ai.line_total, ai.service_start_date,
    ai.service_end_date, ai.capability_name, ai.capability_value, ai.notes,
    ai.id, a.id, coalesce(a.agreement_number, a.agreement_id)
  from public.agreement_items ai
  where ai.agreement_id = a.id
    and coalesce(ai.is_superseded, false) = false;

  return jsonb_build_object(
    'id', i.id,
    'invoice_uuid', i.id,
    'created_invoice_uuid', i.id,
    'invoice_id', i.invoice_id,
    'invoice_number', i.invoice_number
  );
end;
$$;

grant execute on function public.create_invoice_from_agreement(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Invoice -> Receipt: RV/YYYY/NN
-- --------------------------------------------------------------------------
create or replace function public.create_receipt_from_invoice(
  p_invoice_uuid uuid,
  p_amount numeric,
  p_payment_method text default null,
  p_payment_reference text default null,
  p_receipt_date text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.invoices;
  r public.receipts;
  v_no text;
  v_date date;
  v_old numeric;
  v_new numeric;
  v_year text := to_char(current_date, 'YYYY');
  v_receipt_seq bigint;
begin
  select * into i from public.invoices where id = p_invoice_uuid for update;
  if not found then raise exception 'Invoice not found'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Receipt amount must be greater than zero'; end if;

  v_date := coalesce(nullif(p_receipt_date, '')::date, current_date);
  v_old := coalesce(i.amount_paid, i.received_amount, 0);
  v_new := v_old + p_amount;

  perform pg_advisory_xact_lock(hashtext('incheck360:receipt-business-id'), extract(year from current_date)::integer);

  select coalesce(max(seq_value), 0) + 1
    into v_receipt_seq
    from (
      select (regexp_match(receipt_id, '^RV/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.receipts
       where receipt_id ~* ('^RV/' || v_year || '/[0-9]+$')
      union all
      select (regexp_match(receipt_number, '^RV/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.receipts
       where receipt_number ~* ('^RV/' || v_year || '/[0-9]+$')
    ) existing;

  v_no := 'RV/' || v_year || '/' || lpad(v_receipt_seq::text, 2, '0');

  insert into public.receipts(
    receipt_id, receipt_number, invoice_id, invoice_number,
    agreement_uuid, agreement_id, agreement_number, client_id,
    company_id, company_name, customer_name, customer_legal_name, customer_address,
    contact_id, contact_name, contact_email, contact_phone, contact_mobile,
    receipt_date, payment_date, amount_received, amount_paid, payment_method,
    payment_reference, status, currency, invoice_total, old_paid_total, paid_now,
    received_amount, new_paid_total, pending_amount, payment_state, created_by, updated_by
  )
  values(
    v_no, v_no, i.id, i.invoice_number,
    i.agreement_uuid, i.agreement_id, i.agreement_number, i.client_id,
    i.company_id, i.company_name, i.customer_name, i.customer_legal_name, i.customer_address,
    i.contact_id, i.contact_name, i.contact_email, i.contact_phone, i.contact_mobile,
    v_date, v_date, p_amount, p_amount, p_payment_method,
    p_payment_reference, 'issued', i.currency, i.invoice_total, v_old, p_amount,
    p_amount, v_new, greatest(i.invoice_total - v_new - coalesce(i.credit_note_amount, 0), 0),
    case when v_new + coalesce(i.credit_note_amount, 0) >= i.invoice_total then 'paid' else 'partial' end,
    auth.uid(), auth.uid()
  )
  returning * into r;

  insert into public.receipt_items(
    receipt_id, invoice_item_id, section, line_no, location_name, item_name, description,
    quantity, unit_price, discount_percent, discounted_unit_price, line_total, amount,
    capability_name, capability_value, notes, service_start_date, service_end_date, currency
  )
  select
    r.id, ii.id, ii.section, ii.line_no, ii.location_name, ii.item_name, ii.item_name,
    ii.quantity, ii.unit_price, ii.discount_percent, ii.discounted_unit_price, ii.line_total, ii.line_total,
    ii.capability_name, ii.capability_value, ii.notes, ii.service_start_date, ii.service_end_date, i.currency
  from public.invoice_items ii
  where ii.invoice_id = i.id;

  update public.invoices
     set amount_paid = v_new,
         received_amount = v_new,
         pending_amount = greatest(invoice_total - v_new - coalesce(credit_note_amount, 0), 0),
         balance_due = greatest(invoice_total - v_new - coalesce(credit_note_amount, 0), 0),
         payment_state = case when v_new + coalesce(credit_note_amount, 0) >= invoice_total then 'paid' else 'partial' end,
         payment_status = case when v_new + coalesce(credit_note_amount, 0) >= invoice_total then 'paid' else 'partial' end,
         paid_at = case when v_new + coalesce(credit_note_amount, 0) >= invoice_total then now() else paid_at end,
         updated_at = now()
   where id = i.id;

  return jsonb_build_object(
    'id', r.id,
    'receipt_uuid', r.id,
    'created_receipt_uuid', r.id,
    'receipt_id', r.receipt_id,
    'receipt_number', r.receipt_number
  );
end;
$$;

grant execute on function public.create_receipt_from_invoice(uuid, numeric, text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
;

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

-- --------------------------------------------------------------------------
-- Deal -> Proposal: Proposal#NNNNN
-- --------------------------------------------------------------------------
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
  select * into d from public.deals where id = p_deal_uuid;
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

  return jsonb_build_object(
    'id', p.id,
    'proposal_uuid', p.id,
    'created_proposal_uuid', p.id,
    'proposal_id', p.proposal_id,
    'ref_number', p.ref_number
  );
end;
$$;

grant execute on function public.create_proposal_from_deal(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Agreement -> Client + Invoice: CLIENT/YYYY/NNNN and SA/YYYY/NN
-- --------------------------------------------------------------------------
create or replace function public.create_invoice_from_agreement(p_agreement_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.agreements;
  i public.invoices;
  v_id text;
  v_no text;
  c uuid;
  v_year text := to_char(current_date, 'YYYY');
  v_client_seq bigint;
  v_invoice_seq bigint;
begin
  select * into a from public.agreements where id = p_agreement_uuid;
  if not found then raise exception 'Agreement not found'; end if;

  select cl.id into c
    from public.clients cl
   where cl.source_agreement_id = a.id
   limit 1;

  if c is null then
    perform pg_advisory_xact_lock(hashtext('incheck360:client-business-id'), extract(year from current_date)::integer);

    select cl.id into c
      from public.clients cl
     where cl.source_agreement_id = a.id
     limit 1;

    if c is null then
      select coalesce(max((regexp_match(client_id, '^CLIENT/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint), 0) + 1
        into v_client_seq
        from public.clients
       where client_id ~* ('^CLIENT/' || v_year || '/[0-9]+$');

      insert into public.clients(
        client_id, client_name, company_name, primary_email, primary_phone,
        billing_frequency, payment_term, source_agreement_id, created_by, updated_by
      )
      values(
        'CLIENT/' || v_year || '/' || lpad(v_client_seq::text, 4, '0'),
        coalesce(a.customer_name, a.customer_legal_name, a.company_name, 'Client'),
        a.company_name,
        a.customer_contact_email,
        a.customer_contact_phone,
        a.billing_frequency,
        a.payment_term,
        a.id,
        auth.uid(),
        auth.uid()
      )
      returning id into c;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('incheck360:invoice-business-id'), extract(year from current_date)::integer);

  select coalesce(max(seq_value), 0) + 1
    into v_invoice_seq
    from (
      select (regexp_match(invoice_id, '^SA/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.invoices
       where invoice_id ~* ('^SA/' || v_year || '/[0-9]+$')
      union all
      select (regexp_match(invoice_number, '^SA/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.invoices
       where invoice_number ~* ('^SA/' || v_year || '/[0-9]+$')
    ) existing;

  v_no := 'SA/' || v_year || '/' || lpad(v_invoice_seq::text, 2, '0');
  v_id := v_no;

  insert into public.invoices(
    invoice_id, invoice_number, client_id, agreement_uuid, agreement_id, agreement_number,
    proposal_id, issue_date, due_date, billing_frequency, payment_term, payment_terms,
    company_id, company_name, contact_id, contact_name, contact_email, contact_phone, contact_mobile,
    customer_name, customer_legal_name, customer_address, customer_contact_name, customer_contact_email,
    provider_legal_name, provider_address, subtotal_locations, subtotal_one_time, invoice_total,
    status, currency, created_by, updated_by
  )
  values(
    v_id, v_no, c, a.id, a.agreement_id, a.agreement_number,
    a.proposal_id, current_date, current_date + 7, a.billing_frequency, a.payment_term, a.payment_terms,
    a.company_id, a.company_name, a.contact_id, a.contact_name, a.contact_email, a.contact_phone, a.contact_mobile,
    a.customer_name, a.customer_legal_name, a.customer_address, a.customer_contact_name, a.customer_contact_email,
    a.provider_legal_name, a.provider_address, a.subtotal_locations, a.subtotal_one_time, a.grand_total,
    'issued', a.currency, auth.uid(), auth.uid()
  )
  returning * into i;

  insert into public.invoice_items(
    invoice_id, section, line_no, location_name, item_name, unit_price, discount_percent,
    discounted_unit_price, quantity, license_quantity, line_total, service_start_date,
    service_end_date, capability_name, capability_value, notes,
    source_agreement_item_id, source_agreement_id, source_agreement_reference
  )
  select
    i.id, ai.section, ai.line_no, ai.location_name, ai.item_name, ai.unit_price, ai.discount_percent,
    ai.discounted_unit_price, ai.quantity, ai.license_quantity, ai.line_total, ai.service_start_date,
    ai.service_end_date, ai.capability_name, ai.capability_value, ai.notes,
    ai.id, a.id, coalesce(a.agreement_number, a.agreement_id)
  from public.agreement_items ai
  where ai.agreement_id = a.id
    and coalesce(ai.is_superseded, false) = false;

  return jsonb_build_object(
    'id', i.id,
    'invoice_uuid', i.id,
    'created_invoice_uuid', i.id,
    'invoice_id', i.invoice_id,
    'invoice_number', i.invoice_number
  );
end;
$$;

grant execute on function public.create_invoice_from_agreement(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Invoice -> Receipt: RV/YYYY/NN
-- --------------------------------------------------------------------------
create or replace function public.create_receipt_from_invoice(
  p_invoice_uuid uuid,
  p_amount numeric,
  p_payment_method text default null,
  p_payment_reference text default null,
  p_receipt_date text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.invoices;
  r public.receipts;
  v_no text;
  v_date date;
  v_old numeric;
  v_new numeric;
  v_year text := to_char(current_date, 'YYYY');
  v_receipt_seq bigint;
begin
  select * into i from public.invoices where id = p_invoice_uuid for update;
  if not found then raise exception 'Invoice not found'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Receipt amount must be greater than zero'; end if;

  v_date := coalesce(nullif(p_receipt_date, '')::date, current_date);
  v_old := coalesce(i.amount_paid, i.received_amount, 0);
  v_new := v_old + p_amount;

  perform pg_advisory_xact_lock(hashtext('incheck360:receipt-business-id'), extract(year from current_date)::integer);

  select coalesce(max(seq_value), 0) + 1
    into v_receipt_seq
    from (
      select (regexp_match(receipt_id, '^RV/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.receipts
       where receipt_id ~* ('^RV/' || v_year || '/[0-9]+$')
      union all
      select (regexp_match(receipt_number, '^RV/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.receipts
       where receipt_number ~* ('^RV/' || v_year || '/[0-9]+$')
    ) existing;

  v_no := 'RV/' || v_year || '/' || lpad(v_receipt_seq::text, 2, '0');

  insert into public.receipts(
    receipt_id, receipt_number, invoice_id, invoice_number,
    agreement_uuid, agreement_id, agreement_number, client_id,
    company_id, company_name, customer_name, customer_legal_name, customer_address,
    contact_id, contact_name, contact_email, contact_phone, contact_mobile,
    receipt_date, payment_date, amount_received, amount_paid, payment_method,
    payment_reference, status, currency, invoice_total, old_paid_total, paid_now,
    received_amount, new_paid_total, pending_amount, payment_state, created_by, updated_by
  )
  values(
    v_no, v_no, i.id, i.invoice_number,
    i.agreement_uuid, i.agreement_id, i.agreement_number, i.client_id,
    i.company_id, i.company_name, i.customer_name, i.customer_legal_name, i.customer_address,
    i.contact_id, i.contact_name, i.contact_email, i.contact_phone, i.contact_mobile,
    v_date, v_date, p_amount, p_amount, p_payment_method,
    p_payment_reference, 'issued', i.currency, i.invoice_total, v_old, p_amount,
    p_amount, v_new, greatest(i.invoice_total - v_new - coalesce(i.credit_note_amount, 0), 0),
    case when v_new + coalesce(i.credit_note_amount, 0) >= i.invoice_total then 'paid' else 'partial' end,
    auth.uid(), auth.uid()
  )
  returning * into r;

  insert into public.receipt_items(
    receipt_id, invoice_item_id, section, line_no, location_name, item_name, description,
    quantity, unit_price, discount_percent, discounted_unit_price, line_total, amount,
    capability_name, capability_value, notes, service_start_date, service_end_date, currency
  )
  select
    r.id, ii.id, ii.section, ii.line_no, ii.location_name, ii.item_name, ii.item_name,
    ii.quantity, ii.unit_price, ii.discount_percent, ii.discounted_unit_price, ii.line_total, ii.line_total,
    ii.capability_name, ii.capability_value, ii.notes, ii.service_start_date, ii.service_end_date, i.currency
  from public.invoice_items ii
  where ii.invoice_id = i.id;

  update public.invoices
     set amount_paid = v_new,
         received_amount = v_new,
         pending_amount = greatest(invoice_total - v_new - coalesce(credit_note_amount, 0), 0),
         balance_due = greatest(invoice_total - v_new - coalesce(credit_note_amount, 0), 0),
         payment_state = case when v_new + coalesce(credit_note_amount, 0) >= invoice_total then 'paid' else 'partial' end,
         payment_status = case when v_new + coalesce(credit_note_amount, 0) >= invoice_total then 'paid' else 'partial' end,
         paid_at = case when v_new + coalesce(credit_note_amount, 0) >= invoice_total then now() else paid_at end,
         updated_at = now()
   where id = i.id;

  return jsonb_build_object(
    'id', r.id,
    'receipt_uuid', r.id,
    'created_receipt_uuid', r.id,
    'receipt_id', r.receipt_id,
    'receipt_number', r.receipt_number
  );
end;
$$;

grant execute on function public.create_receipt_from_invoice(uuid, numeric, text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
