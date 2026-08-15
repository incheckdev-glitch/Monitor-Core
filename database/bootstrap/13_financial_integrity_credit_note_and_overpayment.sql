-- InCheck360 financial integrity hardening
--
-- 1) Adds the credit_note_request_key column already used by the production
--    application for idempotent credit-note creation.
-- 2) Prevents receipts from exceeding the invoice's true outstanding balance,
--    including active credit notes.
--
-- Safe to re-run. Existing invoices, receipts and credit notes are not renumbered
-- or otherwise modified.

begin;

-- --------------------------------------------------------------------------
-- Credit-note idempotency compatibility
-- --------------------------------------------------------------------------
alter table if exists public.credit_notes
  add column if not exists credit_note_request_key text;

create unique index if not exists credit_notes_credit_note_request_key_uidx
  on public.credit_notes (credit_note_request_key)
  where nullif(btrim(credit_note_request_key), '') is not null;

-- --------------------------------------------------------------------------
-- Invoice -> Receipt: reject settled invoices and overpayments
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
  v_total numeric;
  v_credit numeric;
  v_remaining numeric;
  v_year text := to_char(current_date, 'YYYY');
  v_receipt_seq bigint;
begin
  -- Row lock serializes concurrent payments against the same invoice so the
  -- outstanding-balance check cannot race with another receipt.
  select * into i
    from public.invoices
   where id = p_invoice_uuid
   for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Receipt amount must be greater than zero';
  end if;

  v_date := coalesce(nullif(p_receipt_date, '')::date, current_date);
  v_total := coalesce(i.invoice_total, i.grand_total, i.total_amount, 0);
  v_old := coalesce(i.amount_paid, i.received_amount, 0);
  v_credit := greatest(coalesce(i.credit_note_amount, 0), 0);
  v_remaining := greatest(v_total - v_old - v_credit, 0);

  if v_total <= 0 then
    raise exception 'Invoice total must be greater than zero before a receipt can be created';
  end if;

  if v_remaining <= 0.000001 then
    raise exception 'Invoice is already settled';
  end if;

  if p_amount > v_remaining + 0.000001 then
    raise exception 'Receipt amount (%) exceeds outstanding invoice balance (%)',
      round(p_amount, 2), round(v_remaining, 2);
  end if;

  v_new := v_old + p_amount;

  perform pg_advisory_xact_lock(
    hashtext('incheck360:receipt-business-id'),
    extract(year from current_date)::integer
  );

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
    p_payment_reference, 'issued', i.currency, v_total, v_old, p_amount,
    p_amount, v_new, greatest(v_total - v_new - v_credit, 0),
    case when v_new + v_credit >= v_total - 0.000001 then 'paid' else 'partial' end,
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
         pending_amount = greatest(v_total - v_new - v_credit, 0),
         balance_due = greatest(v_total - v_new - v_credit, 0),
         payment_state = case when v_new + v_credit >= v_total - 0.000001 then 'paid' else 'partial' end,
         payment_status = case when v_new + v_credit >= v_total - 0.000001 then 'paid' else 'partial' end,
         paid_at = case when v_new + v_credit >= v_total - 0.000001 then now() else paid_at end,
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
