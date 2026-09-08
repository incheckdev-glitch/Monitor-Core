-- Monitor Core ERP: admin-only Reseller Management foundation.
-- Future reseller-user RLS can be added without schema redesign because all owned rows carry reseller_id.

create schema if not exists private;

do $$ begin create sequence public.reseller_code_seq start 1; exception when duplicate_table then null; end $$;
do $$ begin create sequence public.reseller_company_code_seq start 1; exception when duplicate_table then null; end $$;
do $$ begin create sequence public.reseller_contact_code_seq start 1; exception when duplicate_table then null; end $$;
do $$ begin create sequence public.reseller_ownership_code_seq start 1; exception when duplicate_table then null; end $$;
do $$ begin create sequence public.reseller_lead_code_seq start 1; exception when duplicate_table then null; end $$;
do $$ begin create sequence public.reseller_deal_code_seq start 1; exception when duplicate_table then null; end $$;
do $$ begin create sequence public.reseller_activation_code_seq start 1; exception when duplicate_table then null; end $$;
do $$ begin create sequence public.reseller_request_code_seq start 1; exception when duplicate_table then null; end $$;
do $$ begin create sequence public.reseller_renewal_code_seq start 1; exception when duplicate_table then null; end $$;
do $$ begin create sequence public.reseller_settlement_code_seq start 1; exception when duplicate_table then null; end $$;
do $$ begin create sequence public.reseller_payment_code_seq start 1; exception when duplicate_table then null; end $$;

create table if not exists public.resellers (
  id uuid primary key default gen_random_uuid(), reseller_code text not null unique default ('RSL-' || lpad(nextval('public.reseller_code_seq')::text,5,'0')),
  company_name text not null, legal_name text, country text, territory text, primary_contact_name text, primary_contact_email text, primary_contact_phone text,
  status text not null default 'onboarding' check (status in ('onboarding','active','suspended','inactive','expired')),
  agreement_start_date date, agreement_end_date date, internal_owner_user_id uuid references public.profiles(id) on delete set null,
  currency text not null default 'USD', payment_term_days integer not null default 30 check (payment_term_days between 0 and 365),
  commercial_model text not null default 'per_location' check (commercial_model in ('per_location','fixed_wholesale','revenue_share')),
  wholesale_rate numeric(14,2) not null default 0 check (wholesale_rate>=0), revenue_share_percent numeric(7,4) not null default 0 check (revenue_share_percent between 0 and 100),
  ownership_days integer not null default 90 check (ownership_days between 1 and 3650), renewal_responsibility text not null default 'reseller' check (renewal_responsibility in ('reseller','incheck','shared')),
  hardware_model text not null default 'reseller' check (hardware_model in ('reseller','incheck','shared','not_applicable')), allowed_products text[] not null default '{}'::text[], notes text,
  created_by uuid references public.profiles(id) on delete set null, updated_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.reseller_companies (
  id uuid primary key default gen_random_uuid(), company_code text not null unique default ('RCO-' || lpad(nextval('public.reseller_company_code_seq')::text,5,'0')),
  reseller_id uuid not null references public.resellers(id) on delete cascade, company_name text not null, legal_name text, website text, main_email text, main_phone text, country text, city text, address text,
  company_status text not null default 'prospect' check (company_status in ('prospect','qualified','customer','inactive','released','lost')),
  ownership_status text not null default 'unregistered' check (ownership_status in ('unregistered','pending','approved','rejected','released','expired')), ownership_expires_at timestamptz,
  source text not null default 'manual' check (source in ('manual','market_check','import','transfer')), estimated_locations integer not null default 1 check (estimated_locations>=0), notes text,
  created_by uuid references public.profiles(id) on delete set null, updated_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists reseller_companies_reseller_name_uq on public.reseller_companies(reseller_id,lower(regexp_replace(company_name,'[^a-zA-Z0-9]+','','g')));
create index if not exists reseller_companies_reseller_idx on public.reseller_companies(reseller_id);
create index if not exists reseller_companies_status_idx on public.reseller_companies(company_status,ownership_status);

create table if not exists public.reseller_contacts (
  id uuid primary key default gen_random_uuid(), contact_code text not null unique default ('RCT-' || lpad(nextval('public.reseller_contact_code_seq')::text,5,'0')),
  reseller_id uuid not null references public.resellers(id) on delete cascade, company_id uuid references public.reseller_companies(id) on delete set null,
  first_name text,last_name text,full_name text,job_title text,department text,email text,phone text,mobile text,is_primary boolean not null default false,
  contact_status text not null default 'active' check (contact_status in ('active','inactive','left_company')), notes text,
  created_by uuid references public.profiles(id) on delete set null, updated_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists reseller_contacts_reseller_email_uq on public.reseller_contacts(reseller_id,lower(email)) where email is not null and btrim(email)<>'';
create index if not exists reseller_contacts_company_idx on public.reseller_contacts(company_id);

create table if not exists public.reseller_ownerships (
  id uuid primary key default gen_random_uuid(), ownership_code text not null unique default ('ROW-' || lpad(nextval('public.reseller_ownership_code_seq')::text,5,'0')),
  reseller_id uuid not null references public.resellers(id) on delete cascade, company_id uuid not null references public.reseller_companies(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected','released','expired')), submitted_at timestamptz not null default now(), decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null, starts_at timestamptz, expires_at timestamptz, decision_reason text, notes text,
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists reseller_ownerships_open_company_uq on public.reseller_ownerships(company_id) where status in ('pending','approved');
create index if not exists reseller_ownerships_status_idx on public.reseller_ownerships(status,expires_at);

create table if not exists public.reseller_leads (
  id uuid primary key default gen_random_uuid(), lead_code text not null unique default ('RLD-' || lpad(nextval('public.reseller_lead_code_seq')::text,5,'0')),
  reseller_id uuid not null references public.resellers(id) on delete cascade, company_id uuid references public.reseller_companies(id) on delete set null, contact_id uuid references public.reseller_contacts(id) on delete set null,
  lead_name text, status text not null default 'new' check (status in ('new','contacted','qualified','nurturing','converted','lost')), source text,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')), estimated_value numeric(14,2) not null default 0, currency text not null default 'USD', next_follow_up_at timestamptz,
  owner_user_id uuid references public.profiles(id) on delete set null, notes text, created_by uuid references public.profiles(id) on delete set null, updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists reseller_leads_reseller_idx on public.reseller_leads(reseller_id,status);

create table if not exists public.reseller_deals (
  id uuid primary key default gen_random_uuid(), deal_code text not null unique default ('RDL-' || lpad(nextval('public.reseller_deal_code_seq')::text,5,'0')),
  reseller_id uuid not null references public.resellers(id) on delete cascade, company_id uuid references public.reseller_companies(id) on delete set null, contact_id uuid references public.reseller_contacts(id) on delete set null, lead_id uuid references public.reseller_leads(id) on delete set null,
  deal_name text not null, stage text not null default 'prospecting' check (stage in ('prospecting','qualified','proposal','negotiation','won','lost')), currency text not null default 'USD',
  customer_sale_amount numeric(14,2) not null default 0, estimated_incheck_amount numeric(14,2) not null default 0, location_count integer not null default 1 check (location_count>=0), probability_percent numeric(7,2) not null default 10 check (probability_percent between 0 and 100),
  expected_close_date date, won_at timestamptz, reseller_customer_invoice_ref text, owner_user_id uuid references public.profiles(id) on delete set null, notes text,
  created_by uuid references public.profiles(id) on delete set null, updated_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists reseller_deals_reseller_idx on public.reseller_deals(reseller_id,stage);

create table if not exists public.reseller_activations (
  id uuid primary key default gen_random_uuid(), activation_code text not null unique default ('RAC-' || lpad(nextval('public.reseller_activation_code_seq')::text,5,'0')),
  reseller_id uuid not null references public.resellers(id) on delete cascade, company_id uuid not null references public.reseller_companies(id) on delete cascade, deal_id uuid references public.reseller_deals(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','submitted','under_review','approved','rejected','activated','cancelled')), product_name text not null default 'InCheck 360', package_name text,
  location_count integer not null default 1 check (location_count>=0), customer_sale_amount numeric(14,2) not null default 0, amount_due_to_incheck numeric(14,2) not null default 0, currency text not null default 'USD', billing_frequency text not null default 'annual',
  service_start_date date, service_end_date date, requested_at timestamptz, approved_at timestamptz, approved_by uuid references public.profiles(id) on delete set null, activated_at timestamptz,
  reseller_customer_invoice_ref text, notes text, created_by uuid references public.profiles(id) on delete set null, updated_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists reseller_activations_deal_uq on public.reseller_activations(deal_id) where deal_id is not null;
create index if not exists reseller_activations_reseller_idx on public.reseller_activations(reseller_id,status);

create table if not exists public.reseller_requests (
  id uuid primary key default gen_random_uuid(), request_code text not null unique default ('RRQ-' || lpad(nextval('public.reseller_request_code_seq')::text,5,'0')),
  reseller_id uuid not null references public.resellers(id) on delete cascade, company_id uuid references public.reseller_companies(id) on delete set null, activation_id uuid references public.reseller_activations(id) on delete set null,
  request_type text not null check (request_type in ('new_activation','add_location','remove_location','pricing_exception','discount_approval','customer_ownership','ownership_extension','transfer_customer','hardware','support','billing','renewal_change','cancellation','general')),
  subject text not null, description text, priority text not null default 'normal' check (priority in ('low','normal','high','urgent')), status text not null default 'submitted' check (status in ('draft','submitted','assigned','in_progress','waiting_on_reseller','resolved','closed','rejected')),
  assigned_to uuid references public.profiles(id) on delete set null, due_at timestamptz, resolution text, resolved_at timestamptz, resolved_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null, updated_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists reseller_requests_reseller_idx on public.reseller_requests(reseller_id,status);

create table if not exists public.reseller_renewals (
  id uuid primary key default gen_random_uuid(), renewal_code text not null unique default ('RRN-' || lpad(nextval('public.reseller_renewal_code_seq')::text,5,'0')),
  reseller_id uuid not null references public.resellers(id) on delete cascade, company_id uuid not null references public.reseller_companies(id) on delete cascade, activation_id uuid references public.reseller_activations(id) on delete set null,
  status text not null default 'upcoming' check (status in ('upcoming','contacting_customer','confirmed','not_renewing','renewed','expired')), currency text not null default 'USD', renewal_amount numeric(14,2) not null default 0,
  current_locations integer not null default 1 check (current_locations>=0), renewal_date date not null, response_due_date date, decision_date date, new_start_date date, new_end_date date, notes text,
  created_by uuid references public.profiles(id) on delete set null, updated_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists reseller_renewals_activation_uq on public.reseller_renewals(activation_id) where activation_id is not null;
create index if not exists reseller_renewals_date_idx on public.reseller_renewals(renewal_date,status);

create table if not exists public.reseller_settlements (
  id uuid primary key default gen_random_uuid(), settlement_code text not null unique default ('RST-' || lpad(nextval('public.reseller_settlement_code_seq')::text,5,'0')),
  reseller_id uuid not null references public.resellers(id) on delete cascade, company_id uuid references public.reseller_companies(id) on delete set null, activation_id uuid references public.reseller_activations(id) on delete set null, renewal_id uuid references public.reseller_renewals(id) on delete set null,
  source_type text not null default 'manual' check (source_type in ('activation','renewal','manual','adjustment')), description text not null, currency text not null default 'USD', amount_due numeric(14,2) not null default 0 check (amount_due>=0), amount_paid numeric(14,2) not null default 0 check (amount_paid>=0), due_date date,
  status text not null default 'pending' check (status in ('pending','partially_paid','paid','overdue','cancelled')), erp_invoice_id uuid references public.invoices(id) on delete set null, erp_invoice_number text, notes text,
  created_by uuid references public.profiles(id) on delete set null, updated_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists reseller_settlements_activation_uq on public.reseller_settlements(activation_id) where activation_id is not null and source_type='activation';
create unique index if not exists reseller_settlements_renewal_uq on public.reseller_settlements(renewal_id) where renewal_id is not null and source_type='renewal';
create index if not exists reseller_settlements_due_idx on public.reseller_settlements(reseller_id,due_date,status);

create table if not exists public.reseller_payments (
  id uuid primary key default gen_random_uuid(), payment_code text not null unique default ('RPY-' || lpad(nextval('public.reseller_payment_code_seq')::text,5,'0')),
  reseller_id uuid not null references public.resellers(id) on delete cascade, settlement_id uuid not null references public.reseller_settlements(id) on delete cascade, amount numeric(14,2) not null check (amount>0), payment_date date not null default current_date,
  payment_method text, payment_reference text, erp_receipt_id uuid references public.receipts(id) on delete set null, erp_receipt_number text, notes text, created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists reseller_payments_settlement_idx on public.reseller_payments(settlement_id,payment_date);

create table if not exists public.reseller_market_checks (
  id uuid primary key default gen_random_uuid(), reseller_id uuid references public.resellers(id) on delete set null, company_name text, website text, email text, phone text, result_status text not null,
  checked_by uuid references public.profiles(id) on delete set null, checked_at timestamptz not null default now()
);
create index if not exists reseller_market_checks_date_idx on public.reseller_market_checks(checked_at desc);

create or replace function private.reseller_is_admin() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and lower(coalesce(p.role_key,p.role,''))='admin' and coalesce(p.is_active,true)=true);
$$;
create or replace function private.reseller_touch_updated_at() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin new.updated_at:=now(); return new; end; $$;

do $$ declare t text; begin
  foreach t in array array['resellers','reseller_companies','reseller_contacts','reseller_ownerships','reseller_leads','reseller_deals','reseller_activations','reseller_requests','reseller_renewals','reseller_settlements'] loop
    execute format('drop trigger if exists trg_%I_touch on public.%I',t,t);
    execute format('create trigger trg_%I_touch before update on public.%I for each row execute function private.reseller_touch_updated_at()',t,t);
  end loop;
end $$;

create or replace function private.reseller_calculated_amount(p_reseller_id uuid,p_customer_sale numeric,p_locations integer) returns numeric language sql stable set search_path=public,pg_temp as $$
  select round(case r.commercial_model when 'revenue_share' then greatest(coalesce(p_customer_sale,0),0)*coalesce(r.revenue_share_percent,0)/100 when 'fixed_wholesale' then coalesce(r.wholesale_rate,0) else coalesce(r.wholesale_rate,0)*greatest(coalesce(p_locations,0),0) end,2)
  from public.resellers r where r.id=p_reseller_id;
$$;

create or replace function private.reseller_sync_ownership() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_days integer:=90; begin
  select ownership_days into v_days from public.resellers where id=new.reseller_id;
  if new.status='approved' then new.starts_at:=coalesce(new.starts_at,now()); new.expires_at:=coalesce(new.expires_at,new.starts_at+make_interval(days=>coalesce(v_days,90))); new.decided_at:=coalesce(new.decided_at,now()); new.decided_by:=coalesce(new.decided_by,auth.uid()); update public.reseller_companies set ownership_status='approved',ownership_expires_at=new.expires_at,updated_by=auth.uid() where id=new.company_id;
  elsif new.status='pending' then update public.reseller_companies set ownership_status='pending',ownership_expires_at=null,updated_by=auth.uid() where id=new.company_id;
  elsif new.status in ('rejected','released','expired') then new.decided_at:=coalesce(new.decided_at,now()); new.decided_by:=coalesce(new.decided_by,auth.uid()); update public.reseller_companies set ownership_status=new.status,ownership_expires_at=null,company_status=case when new.status='released' then 'released' else company_status end,updated_by=auth.uid() where id=new.company_id; end if; return new;
end; $$;
drop trigger if exists trg_reseller_ownership_sync on public.reseller_ownerships;
create trigger trg_reseller_ownership_sync before insert or update on public.reseller_ownerships for each row execute function private.reseller_sync_ownership();

create or replace function private.reseller_prepare_activation() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
  if coalesce(new.amount_due_to_incheck,0)<=0 then new.amount_due_to_incheck:=coalesce(private.reseller_calculated_amount(new.reseller_id,new.customer_sale_amount,new.location_count),0); end if;
  if new.status='submitted' and new.requested_at is null then new.requested_at:=now(); end if; if new.status='approved' and new.approved_at is null then new.approved_at:=now(); new.approved_by:=coalesce(new.approved_by,auth.uid()); end if; if new.status='activated' and new.activated_at is null then new.activated_at:=now(); end if; return new;
end; $$;
drop trigger if exists trg_reseller_prepare_activation on public.reseller_activations;
create trigger trg_reseller_prepare_activation before insert or update on public.reseller_activations for each row execute function private.reseller_prepare_activation();

create or replace function private.reseller_activation_after_change() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_terms integer:=30; v_company text; v_reseller text; begin
  select payment_term_days,company_name into v_terms,v_reseller from public.resellers where id=new.reseller_id; select company_name into v_company from public.reseller_companies where id=new.company_id;
  if new.status in ('approved','activated') and coalesce(new.amount_due_to_incheck,0)>0 then insert into public.reseller_settlements(reseller_id,company_id,activation_id,source_type,description,currency,amount_due,due_date,status,created_by) values(new.reseller_id,new.company_id,new.id,'activation',concat(coalesce(v_company,'Customer'),' activation ',new.activation_code),new.currency,new.amount_due_to_incheck,coalesce(new.service_start_date,current_date)+coalesce(v_terms,30),'pending',auth.uid()) on conflict do nothing; end if;
  if new.status='activated' and new.service_end_date is not null then insert into public.reseller_renewals(reseller_id,company_id,activation_id,status,currency,renewal_amount,current_locations,renewal_date,response_due_date,created_by) values(new.reseller_id,new.company_id,new.id,'upcoming',new.currency,new.amount_due_to_incheck,new.location_count,new.service_end_date,new.service_end_date-60,auth.uid()) on conflict do nothing; update public.reseller_companies set company_status='customer',updated_by=auth.uid() where id=new.company_id; end if; return new;
end; $$;
drop trigger if exists trg_reseller_activation_after_change on public.reseller_activations;
create trigger trg_reseller_activation_after_change after insert or update of status on public.reseller_activations for each row execute function private.reseller_activation_after_change();

create or replace function private.reseller_deal_after_change() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_amount numeric; begin
  if new.stage='won' and (tg_op='INSERT' or old.stage is distinct from new.stage) then if new.won_at is null then update public.reseller_deals set won_at=now() where id=new.id; end if; v_amount:=case when coalesce(new.estimated_incheck_amount,0)>0 then new.estimated_incheck_amount else private.reseller_calculated_amount(new.reseller_id,new.customer_sale_amount,new.location_count) end; if new.company_id is not null then insert into public.reseller_activations(reseller_id,company_id,deal_id,status,location_count,customer_sale_amount,amount_due_to_incheck,currency,reseller_customer_invoice_ref,created_by) values(new.reseller_id,new.company_id,new.id,'draft',new.location_count,new.customer_sale_amount,coalesce(v_amount,0),new.currency,new.reseller_customer_invoice_ref,auth.uid()) on conflict do nothing; end if; end if; return new;
end; $$;
drop trigger if exists trg_reseller_deal_after_change on public.reseller_deals;
create trigger trg_reseller_deal_after_change after insert or update of stage on public.reseller_deals for each row execute function private.reseller_deal_after_change();

create or replace function private.reseller_renewal_after_change() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare v_terms integer:=30; v_company text; v_amount numeric; begin
  if new.status='renewed' and (tg_op='INSERT' or old.status is distinct from new.status) then select payment_term_days into v_terms from public.resellers where id=new.reseller_id; select company_name into v_company from public.reseller_companies where id=new.company_id; v_amount:=coalesce(nullif(new.renewal_amount,0),(select amount_due_to_incheck from public.reseller_activations where id=new.activation_id),0); insert into public.reseller_settlements(reseller_id,company_id,renewal_id,source_type,description,currency,amount_due,due_date,status,created_by) values(new.reseller_id,new.company_id,new.id,'renewal',concat(coalesce(v_company,'Customer'),' renewal ',new.renewal_code),new.currency,v_amount,coalesce(new.new_start_date,new.renewal_date,current_date)+coalesce(v_terms,30),'pending',auth.uid()) on conflict do nothing; end if; return new;
end; $$;
drop trigger if exists trg_reseller_renewal_after_change on public.reseller_renewals;
create trigger trg_reseller_renewal_after_change after insert or update of status on public.reseller_renewals for each row execute function private.reseller_renewal_after_change();

create or replace function private.reseller_recalculate_settlement(p_settlement_id uuid) returns void language plpgsql set search_path=public,pg_temp as $$
declare v_due numeric; v_paid numeric; v_date date; v_status text; begin select amount_due,due_date,status into v_due,v_date,v_status from public.reseller_settlements where id=p_settlement_id; if not found or v_status='cancelled' then return; end if; select coalesce(sum(amount),0) into v_paid from public.reseller_payments where settlement_id=p_settlement_id; update public.reseller_settlements set amount_paid=v_paid,status=case when v_paid>=v_due and v_due>0 then 'paid' when v_paid>0 then 'partially_paid' when v_date is not null and v_date<current_date then 'overdue' else 'pending' end,updated_by=auth.uid() where id=p_settlement_id; end; $$;
create or replace function private.reseller_payment_after_change() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin if tg_op='DELETE' then perform private.reseller_recalculate_settlement(old.settlement_id); return old; end if; perform private.reseller_recalculate_settlement(new.settlement_id); if tg_op='UPDATE' and old.settlement_id is distinct from new.settlement_id then perform private.reseller_recalculate_settlement(old.settlement_id); end if; return new; end; $$;
drop trigger if exists trg_reseller_payment_after_change on public.reseller_payments;
create trigger trg_reseller_payment_after_change after insert or update or delete on public.reseller_payments for each row execute function private.reseller_payment_after_change();

create or replace function private.reseller_norm(p_value text) returns text language sql immutable set search_path=pg_catalog as $$ select lower(regexp_replace(coalesce(p_value,''),'[^a-zA-Z0-9]+','','g')); $$;
create or replace function private.reseller_digits(p_value text) returns text language sql immutable set search_path=pg_catalog as $$ select regexp_replace(coalesce(p_value,''),'[^0-9]+','','g'); $$;
create or replace function private.reseller_domain(p_value text) returns text language sql immutable set search_path=pg_catalog as $$ select lower(split_part(regexp_replace(regexp_replace(coalesce(p_value,''),'^https?://(www\.)?','','i'),'/.*$','','g'),'@',case when position('@' in coalesce(p_value,''))>0 then 2 else 1 end)); $$;

create or replace function private.reseller_market_check_impl(p_reseller_id uuid,p_company_name text,p_website text,p_email text,p_phone text)
returns table(status text,status_label text) language plpgsql security definer set search_path=public,private,pg_temp as $$
declare n text:=private.reseller_norm(p_company_name); d text:=private.reseller_domain(coalesce(nullif(p_website,''),p_email)); ph text:=private.reseller_digits(p_phone); result text:='available'; label text:='Available'; begin
  if not private.reseller_is_admin() then raise exception 'Not authorized'; end if; if n='' and d='' and ph='' then raise exception 'Enter a company name, website/email domain, or phone'; end if;
  if exists(select 1 from public.clients c where (n<>'' and private.reseller_norm(coalesce(c.company_name,c.client_name))=n) or (d<>'' and private.reseller_domain(c.primary_email)=d) or (ph<>'' and private.reseller_digits(c.primary_phone)=ph)) or exists(select 1 from public.reseller_activations a join public.reseller_companies c on c.id=a.company_id where a.status='activated' and ((n<>'' and private.reseller_norm(c.company_name)=n) or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d)) or (ph<>'' and private.reseller_digits(c.main_phone)=ph))) then result:='existing_customer'; label:='Existing Customer';
  elsif exists(select 1 from public.reseller_ownerships o join public.reseller_companies c on c.id=o.company_id where o.status='pending' and ((n<>'' and private.reseller_norm(c.company_name)=n) or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d)) or (ph<>'' and private.reseller_digits(c.main_phone)=ph))) then result:='pending_registration'; label:='Pending Registration';
  elsif exists(select 1 from public.reseller_ownerships o join public.reseller_companies c on c.id=o.company_id where o.status='approved' and (o.expires_at is null or o.expires_at>now()) and ((n<>'' and private.reseller_norm(c.company_name)=n) or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d)) or (ph<>'' and private.reseller_digits(c.main_phone)=ph))) or exists(select 1 from public.companies c where coalesce(lower(c.company_status),'') not in ('inactive','archived','lost','released') and ((n<>'' and private.reseller_norm(coalesce(c.company_name,c.name,c.legal_name))=n) or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d)) or (ph<>'' and private.reseller_digits(c.main_phone)=ph))) or exists(select 1 from public.leads l where coalesce(lower(l.status),'') not in ('lost','closed','converted','inactive') and ((n<>'' and private.reseller_norm(coalesce(l.company_name,l.customer_name,l.full_name))=n) or (d<>'' and private.reseller_domain(coalesce(l.contact_email,l.email))=d) or (ph<>'' and private.reseller_digits(coalesce(l.contact_phone,l.phone))=ph))) or exists(select 1 from public.deals x where coalesce(lower(x.stage),'') not in ('lost') and ((n<>'' and private.reseller_norm(coalesce(x.company_name,x.customer_name,x.full_name))=n) or (d<>'' and private.reseller_domain(coalesce(x.contact_email,x.email))=d) or (ph<>'' and private.reseller_digits(coalesce(x.contact_phone,x.phone))=ph))) then result:='already_engaged'; label:='Already Engaged';
  elsif exists(select 1 from public.reseller_companies c where c.company_status in ('released','inactive','lost') and ((n<>'' and private.reseller_norm(c.company_name)=n) or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d)) or (ph<>'' and private.reseller_digits(c.main_phone)=ph))) then result:='released'; label:='Inactive / Released'; end if;
  insert into public.reseller_market_checks(reseller_id,company_name,website,email,phone,result_status,checked_by) values(p_reseller_id,p_company_name,p_website,p_email,p_phone,result,auth.uid()); return query select result,label;
end; $$;
create or replace function public.reseller_market_check(p_reseller_id uuid default null,p_company_name text default null,p_website text default null,p_email text default null,p_phone text default null) returns table(status text,status_label text) language sql security invoker set search_path=public,private,pg_temp as $$ select * from private.reseller_market_check_impl(p_reseller_id,p_company_name,p_website,p_email,p_phone); $$;

revoke all on schema private from public; grant usage on schema private to authenticated;
revoke all on function private.reseller_is_admin() from public,anon; grant execute on function private.reseller_is_admin() to authenticated;
revoke all on function private.reseller_market_check_impl(uuid,text,text,text,text) from public,anon; grant execute on function private.reseller_market_check_impl(uuid,text,text,text,text) to authenticated;
revoke all on function public.reseller_market_check(uuid,text,text,text,text) from public,anon; grant execute on function public.reseller_market_check(uuid,text,text,text,text) to authenticated;

DO $$ declare t text; begin
  foreach t in array array['resellers','reseller_companies','reseller_contacts','reseller_ownerships','reseller_leads','reseller_deals','reseller_activations','reseller_requests','reseller_renewals','reseller_settlements','reseller_payments','reseller_market_checks'] loop
    execute format('alter table public.%I enable row level security',t); execute format('drop policy if exists %I on public.%I','admin_only_'||t,t); execute format('create policy %I on public.%I for all to authenticated using (private.reseller_is_admin()) with check (private.reseller_is_admin())','admin_only_'||t,t); execute format('revoke all on table public.%I from anon',t); execute format('grant select,insert,update,delete on table public.%I to authenticated',t);
  end loop;
end $$;

grant usage,select on sequence public.reseller_code_seq,public.reseller_company_code_seq,public.reseller_contact_code_seq,public.reseller_ownership_code_seq,public.reseller_lead_code_seq,public.reseller_deal_code_seq,public.reseller_activation_code_seq,public.reseller_request_code_seq,public.reseller_renewal_code_seq,public.reseller_settlement_code_seq,public.reseller_payment_code_seq to authenticated;
revoke all on sequence public.reseller_code_seq,public.reseller_company_code_seq,public.reseller_contact_code_seq,public.reseller_ownership_code_seq,public.reseller_lead_code_seq,public.reseller_deal_code_seq,public.reseller_activation_code_seq,public.reseller_request_code_seq,public.reseller_renewal_code_seq,public.reseller_settlement_code_seq,public.reseller_payment_code_seq from anon;
