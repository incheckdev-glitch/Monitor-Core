-- Prevent friendly/business ID sequences from falling behind imported or manually assigned IDs.
-- This migration keeps generated identifiers collision-safe across CRM, agreements,
-- reseller records, sales commission receipts, tickets and credit notes.

create or replace function public.next_safe_prefixed_business_id(
  p_table regclass,
  p_column text,
  p_sequence regclass,
  p_prefix text,
  p_pad integer default 5
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max bigint := 0;
  v_next bigint;
  v_sql text;
  v_allowed boolean := false;
begin
  v_allowed :=
       (p_table = 'public.companies'::regclass and p_column = 'company_id' and p_sequence = 'public.company_business_id_seq'::regclass and p_prefix = 'Company#' and p_pad = 5)
    or (p_table = 'public.contacts'::regclass and p_column = 'contact_id' and p_sequence = 'public.contact_business_id_seq'::regclass and p_prefix = 'Contact#' and p_pad = 5)
    or (p_table = 'public.agreements'::regclass and p_column = 'agreement_id' and p_sequence = 'public.agreement_business_id_seq'::regclass and p_prefix = 'Agreement#' and p_pad = 5)
    or (p_table = 'public.sales_commission_receipts'::regclass and p_column = 'receipt_number' and p_sequence = 'public.sales_commission_receipt_no_seq'::regclass and p_prefix ~ '^CR/[0-9]{4}/$' and p_pad = 5)
    or (p_table = 'public.reseller_activations'::regclass and p_column = 'activation_code' and p_sequence = 'public.reseller_activation_code_seq'::regclass and p_prefix = 'RAC-' and p_pad = 5)
    or (p_table = 'public.reseller_companies'::regclass and p_column = 'company_code' and p_sequence = 'public.reseller_company_code_seq'::regclass and p_prefix = 'RCO-' and p_pad = 5)
    or (p_table = 'public.reseller_contacts'::regclass and p_column = 'contact_code' and p_sequence = 'public.reseller_contact_code_seq'::regclass and p_prefix = 'RCT-' and p_pad = 5)
    or (p_table = 'public.reseller_deals'::regclass and p_column = 'deal_code' and p_sequence = 'public.reseller_deal_code_seq'::regclass and p_prefix = 'RDL-' and p_pad = 5)
    or (p_table = 'public.reseller_leads'::regclass and p_column = 'lead_code' and p_sequence = 'public.reseller_lead_code_seq'::regclass and p_prefix = 'RLD-' and p_pad = 5)
    or (p_table = 'public.reseller_ownerships'::regclass and p_column = 'ownership_code' and p_sequence = 'public.reseller_ownership_code_seq'::regclass and p_prefix = 'ROW-' and p_pad = 5)
    or (p_table = 'public.reseller_payments'::regclass and p_column = 'payment_code' and p_sequence = 'public.reseller_payment_code_seq'::regclass and p_prefix = 'RPY-' and p_pad = 5)
    or (p_table = 'public.reseller_renewals'::regclass and p_column = 'renewal_code' and p_sequence = 'public.reseller_renewal_code_seq'::regclass and p_prefix = 'RRN-' and p_pad = 5)
    or (p_table = 'public.reseller_requests'::regclass and p_column = 'request_code' and p_sequence = 'public.reseller_request_code_seq'::regclass and p_prefix = 'RRQ-' and p_pad = 5)
    or (p_table = 'public.reseller_settlements'::regclass and p_column = 'settlement_code' and p_sequence = 'public.reseller_settlement_code_seq'::regclass and p_prefix = 'RST-' and p_pad = 5)
    or (p_table = 'public.resellers'::regclass and p_column = 'reseller_code' and p_sequence = 'public.reseller_code_seq'::regclass and p_prefix = 'RSL-' and p_pad = 5);

  if not v_allowed then
    raise exception 'Unsupported business ID allocator target';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_table::text || '.' || p_column));

  v_sql := format(
    'select coalesce(max((regexp_match(%1$I, ''([0-9]+)$''))[1]::bigint) filter (where %1$I ~ ''[0-9]+$''), 0) from %2$s',
    p_column,
    p_table
  );
  execute v_sql into v_max;

  v_next := nextval(p_sequence);
  if v_next <= v_max then
    perform setval(p_sequence, v_max, true);
    v_next := nextval(p_sequence);
  end if;

  return p_prefix || lpad(v_next::text, p_pad, '0');
end;
$$;

revoke execute on function public.next_safe_prefixed_business_id(regclass,text,regclass,text,integer) from public;
revoke execute on function public.next_safe_prefixed_business_id(regclass,text,regclass,text,integer) from anon;
grant execute on function public.next_safe_prefixed_business_id(regclass,text,regclass,text,integer) to authenticated;
grant execute on function public.next_safe_prefixed_business_id(regclass,text,regclass,text,integer) to service_role;

-- Resync persisted sequence-backed IDs without moving a sequence backwards.
do $$
declare
  v_max bigint;
  v_last bigint;
begin
  select coalesce(max((regexp_match(company_id, '([0-9]+)$'))[1]::bigint), 0)
    into v_max from public.companies where company_id ~ '[0-9]+$';
  select last_value into v_last from public.company_business_id_seq;
  if v_last < v_max then perform setval('public.company_business_id_seq', v_max, true); end if;

  select coalesce(max((regexp_match(contact_id, '([0-9]+)$'))[1]::bigint), 0)
    into v_max from public.contacts where contact_id ~ '[0-9]+$';
  select last_value into v_last from public.contact_business_id_seq;
  if v_last < v_max then perform setval('public.contact_business_id_seq', v_max, true); end if;

  select coalesce(max((regexp_match(agreement_id, '([0-9]+)$'))[1]::bigint), 0)
    into v_max from public.agreements where agreement_id ~* '^Agreement#[0-9]+$';
  select last_value into v_last from public.agreement_business_id_seq;
  if v_last < v_max then perform setval('public.agreement_business_id_seq', v_max, true); end if;

  select coalesce(max((regexp_match(receipt_number, '([0-9]+)$'))[1]::bigint), 0)
    into v_max from public.sales_commission_receipts where receipt_number ~ '[0-9]+$';
  select last_value into v_last from public.sales_commission_receipt_no_seq;
  if v_last < v_max then perform setval('public.sales_commission_receipt_no_seq', v_max, true); end if;
end;
$$;

create or replace function public.assign_company_business_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(btrim(new.company_id), '') is null then
    new.company_id := public.next_safe_prefixed_business_id(
      'public.companies'::regclass,
      'company_id',
      'public.company_business_id_seq'::regclass,
      'Company#',
      5
    );
  end if;
  return new;
end;
$$;

create or replace function public.assign_contact_business_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(btrim(new.contact_id), '') is null then
    new.contact_id := public.next_safe_prefixed_business_id(
      'public.contacts'::regclass,
      'contact_id',
      'public.contact_business_id_seq'::regclass,
      'Contact#',
      5
    );
  end if;
  return new;
end;
$$;

create or replace function public.assign_agreement_business_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_existing_seq bigint;
begin
  if nullif(btrim(new.agreement_id), '') is null then
    new.agreement_id := public.next_safe_prefixed_business_id(
      'public.agreements'::regclass,
      'agreement_id',
      'public.agreement_business_id_seq'::regclass,
      'Agreement#',
      5
    );
    v_existing_seq := (regexp_match(new.agreement_id, '^Agreement#([0-9]+)$', 'i'))[1]::bigint;
    new.agreement_number := new.agreement_id;
    new.sequence_number := v_existing_seq;
  elsif new.agreement_id ~* '^Agreement#[0-9]+$' then
    v_existing_seq := (regexp_match(new.agreement_id, '^Agreement#([0-9]+)$', 'i'))[1]::bigint;
    new.agreement_number := 'Agreement#' || lpad(v_existing_seq::text, 5, '0');
    new.sequence_number := v_existing_seq;
  end if;
  return new;
end;
$$;

create or replace function public.assign_sales_commission_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := extract(year from coalesce(new.payment_date, current_date))::integer::text;
begin
  if nullif(btrim(coalesce(new.receipt_number, '')), '') is null then
    new.receipt_number := public.next_safe_prefixed_business_id(
      'public.sales_commission_receipts'::regclass,
      'receipt_number',
      'public.sales_commission_receipt_no_seq'::regclass,
      'CR/' || v_year || '/',
      5
    );
  end if;
  return new;
end;
$$;

alter table public.reseller_activations alter column activation_code set default public.next_safe_prefixed_business_id('public.reseller_activations'::regclass,'activation_code','public.reseller_activation_code_seq'::regclass,'RAC-',5);
alter table public.reseller_companies alter column company_code set default public.next_safe_prefixed_business_id('public.reseller_companies'::regclass,'company_code','public.reseller_company_code_seq'::regclass,'RCO-',5);
alter table public.reseller_contacts alter column contact_code set default public.next_safe_prefixed_business_id('public.reseller_contacts'::regclass,'contact_code','public.reseller_contact_code_seq'::regclass,'RCT-',5);
alter table public.reseller_deals alter column deal_code set default public.next_safe_prefixed_business_id('public.reseller_deals'::regclass,'deal_code','public.reseller_deal_code_seq'::regclass,'RDL-',5);
alter table public.reseller_leads alter column lead_code set default public.next_safe_prefixed_business_id('public.reseller_leads'::regclass,'lead_code','public.reseller_lead_code_seq'::regclass,'RLD-',5);
alter table public.reseller_ownerships alter column ownership_code set default public.next_safe_prefixed_business_id('public.reseller_ownerships'::regclass,'ownership_code','public.reseller_ownership_code_seq'::regclass,'ROW-',5);
alter table public.reseller_payments alter column payment_code set default public.next_safe_prefixed_business_id('public.reseller_payments'::regclass,'payment_code','public.reseller_payment_code_seq'::regclass,'RPY-',5);
alter table public.reseller_renewals alter column renewal_code set default public.next_safe_prefixed_business_id('public.reseller_renewals'::regclass,'renewal_code','public.reseller_renewal_code_seq'::regclass,'RRN-',5);
alter table public.reseller_requests alter column request_code set default public.next_safe_prefixed_business_id('public.reseller_requests'::regclass,'request_code','public.reseller_request_code_seq'::regclass,'RRQ-',5);
alter table public.reseller_settlements alter column settlement_code set default public.next_safe_prefixed_business_id('public.reseller_settlements'::regclass,'settlement_code','public.reseller_settlement_code_seq'::regclass,'RST-',5);
alter table public.resellers alter column reseller_code set default public.next_safe_prefixed_business_id('public.resellers'::regclass,'reseller_code','public.reseller_code_seq'::regclass,'RSL-',5);

create or replace function public.next_ticket_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_num integer;
  next_id text;
begin
  perform pg_advisory_xact_lock(hashtext('public.tickets.ticket_id'));

  select coalesce(max(nullif(regexp_replace(ticket_id, '\D', '', 'g'), '')::integer), 0) + 1
    into next_num
    from public.tickets
   where ticket_id is not null;

  loop
    next_id := 'TICKET-' || lpad(next_num::text, 4, '0');
    if not exists (select 1 from public.tickets where ticket_id = next_id) then
      return next_id;
    end if;
    next_num := next_num + 1;
  end loop;
end;
$$;

create or replace function public.next_credit_note_number(p_date date default current_date)
returns text
language plpgsql
set search_path = public
as $$
declare
  y text := to_char(coalesce(p_date, current_date), 'YYYY');
  n integer;
begin
  perform pg_advisory_xact_lock(
    hashtext('public.credit_notes.credit_note_number'),
    extract(year from coalesce(p_date, current_date))::integer
  );

  select coalesce(max(nullif(regexp_replace(credit_note_number, '^CN/' || y || '/', ''), '')::integer), 0) + 1
    into n
    from public.credit_notes
   where credit_note_number ~ ('^CN/' || y || '/[0-9]+$');

  return 'CN/' || y || '/' || n::text;
end;
$$;

create or replace function public.next_business_sequence(
  p_table regclass,
  p_column text,
  p_prefix text,
  p_pad integer default 5
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
  v_sql text;
begin
  perform pg_advisory_xact_lock(hashtext(p_table::text || '.' || p_column));
  v_sql := format(
    'select coalesce(max(nullif(regexp_replace(%1$I, ''\\D'', '''', ''g''), '''')::bigint),0)+1 from %2$s',
    p_column,
    p_table
  );
  execute v_sql into v_next;
  return coalesce(p_prefix,'') || lpad(v_next::text, greatest(coalesce(p_pad,1),1), '0');
end;
$$;
