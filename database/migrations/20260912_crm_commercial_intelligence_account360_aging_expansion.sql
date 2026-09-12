alter table public.deals add column if not exists probability_percent smallint null;
alter table public.deals add column if not exists expected_close_date date null;
alter table public.deals add column if not exists won_at timestamptz null;
alter table public.deals add column if not exists lost_at timestamptz null;
alter table public.deals add column if not exists closed_at timestamptz null;
alter table public.deals add column if not exists sales_cycle_days integer null;
alter table public.deals add column if not exists win_loss_snapshot jsonb null;
alter table public.companies add column if not exists total_locations integer null;
alter table public.proposals add column if not exists status_changed_at timestamptz null;
alter table public.agreements add column if not exists status_changed_at timestamptz null;

do $$ begin
  alter table public.deals add constraint deals_probability_percent_check check (probability_percent is null or probability_percent between 0 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.companies add constraint companies_total_locations_check check (total_locations is null or total_locations >= 0);
exception when duplicate_object then null; end $$;

create index if not exists deals_expected_close_date_idx on public.deals(expected_close_date) where expected_close_date is not null;
create index if not exists deals_probability_percent_idx on public.deals(probability_percent) where probability_percent is not null;
create index if not exists proposals_status_changed_at_idx on public.proposals(status_changed_at);
create index if not exists agreements_status_changed_at_idx on public.agreements(status_changed_at);

create or replace function public.crm_capture_deal_close_intelligence()
returns trigger language plpgsql set search_path = public as $$
declare v_stage text := lower(trim(coalesce(new.stage,'')));
declare v_old_stage text := case when tg_op='UPDATE' then lower(trim(coalesce(old.stage,''))) else '' end;
declare v_closed_at timestamptz;
begin
  if v_stage='won' and v_old_stage is distinct from 'won' then
    v_closed_at := coalesce(new.won_at,now());
    new.won_at:=v_closed_at; new.lost_at:=null; new.closed_at:=v_closed_at;
    new.sales_cycle_days:=greatest(0,floor(extract(epoch from (v_closed_at-coalesce(new.created_at,v_closed_at)))/86400)::integer);
    new.win_loss_snapshot:=jsonb_build_object('outcome','won','closed_at',v_closed_at,'sales_cycle_days',new.sales_cycle_days,'number_of_locations',new.number_of_locations,'estimated_value',new.estimated_value,'currency',new.currency,'assigned_to',new.assigned_to,'lead_source',new.lead_source,'interested_product_ids',coalesce(to_jsonb(new.interested_product_ids),'[]'::jsonb));
  elsif v_stage='lost' and v_old_stage is distinct from 'lost' then
    v_closed_at := coalesce(new.lost_at,now());
    new.lost_at:=v_closed_at; new.closed_at:=v_closed_at;
    new.sales_cycle_days:=greatest(0,floor(extract(epoch from (v_closed_at-coalesce(new.created_at,v_closed_at)))/86400)::integer);
    new.win_loss_snapshot:=jsonb_build_object('outcome','lost','closed_at',v_closed_at,'sales_cycle_days',new.sales_cycle_days,'number_of_locations',new.number_of_locations,'estimated_value',new.estimated_value,'currency',new.currency,'assigned_to',new.assigned_to,'lead_source',new.lead_source,'lost_reason',new.lost_reason,'interested_product_ids',coalesce(to_jsonb(new.interested_product_ids),'[]'::jsonb));
  elsif tg_op='UPDATE' and v_old_stage='lost' and v_stage<>'lost' then
    new.lost_at:=null; new.closed_at:=null; new.sales_cycle_days:=null; new.win_loss_snapshot:=null;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_capture_deal_close_intelligence on public.deals;
create trigger trg_crm_capture_deal_close_intelligence before insert or update of stage on public.deals for each row execute function public.crm_capture_deal_close_intelligence();

create or replace function public.crm_touch_proposal_status_changed_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op='INSERT' then new.status_changed_at:=coalesce(new.status_changed_at,now());
  elsif new.status is distinct from old.status then new.status_changed_at:=now(); end if;
  return new;
end $$;
drop trigger if exists trg_crm_touch_proposal_status_changed_at on public.proposals;
create trigger trg_crm_touch_proposal_status_changed_at before insert or update of status on public.proposals for each row execute function public.crm_touch_proposal_status_changed_at();

create or replace function public.crm_touch_agreement_status_changed_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op='INSERT' then new.status_changed_at:=coalesce(new.status_changed_at,now());
  elsif new.status is distinct from old.status then new.status_changed_at:=now(); end if;
  return new;
end $$;
drop trigger if exists trg_crm_touch_agreement_status_changed_at on public.agreements;
create trigger trg_crm_touch_agreement_status_changed_at before insert or update of status on public.agreements for each row execute function public.crm_touch_agreement_status_changed_at();

create or replace function public.crm_duplicate_lead_candidates(p_company_id uuid default null,p_contact_id uuid default null,p_email text default null,p_phone text default null)
returns table(id uuid,lead_id text,company_name text,contact_name text,status text,assigned_to text,match_score integer,match_reasons text[])
language sql stable security invoker set search_path=public as $$
with candidate as (
 select l.*,array_remove(array[
  case when p_contact_id is not null and l.contact_uuid=p_contact_id then 'Same contact' end,
  case when nullif(lower(trim(p_email)),'') is not null and lower(trim(coalesce(l.contact_email,l.email,'')))=lower(trim(p_email)) then 'Same email' end,
  case when length(regexp_replace(coalesce(p_phone,''),'\D','','g'))>=6 and regexp_replace(coalesce(l.contact_phone,l.phone,''),'\D','','g')=regexp_replace(p_phone,'\D','','g') then 'Same phone' end,
  case when p_company_id is not null and (l.company_uuid=p_company_id or l.company_id=p_company_id::text) then 'Same company' end
 ],null)::text[] reasons from public.leads l)
select c.id,c.lead_id,c.company_name,c.contact_name,c.status,c.assigned_to,
 ((case when 'Same contact'=any(c.reasons) then 50 else 0 end)+(case when 'Same email'=any(c.reasons) then 30 else 0 end)+(case when 'Same phone'=any(c.reasons) then 30 else 0 end)+(case when 'Same company'=any(c.reasons) then 20 else 0 end))::integer match_score,c.reasons
from candidate c where cardinality(c.reasons)>0 order by match_score desc,c.updated_at desc nulls last limit 8 $$;
grant execute on function public.crm_duplicate_lead_candidates(uuid,uuid,text,text) to authenticated;

create or replace function public.crm_account_360(p_company_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
with c as (select * from public.companies where id=p_company_id limit 1),
contacts_q as (select ct.* from public.contacts ct where ct.company_id=p_company_id::text or ct.company_ids @> array[p_company_id::text] order by ct.is_primary_contact desc,ct.updated_at desc limit 100),
leads_q as (select l.* from public.leads l where l.company_uuid=p_company_id or l.company_id=p_company_id::text order by l.updated_at desc limit 100),
deals_q as (select d.* from public.deals d where d.company_id=p_company_id::text order by d.updated_at desc limit 100),
proposals_q as (select p.* from public.proposals p where p.company_id=p_company_id::text order by p.created_at desc limit 100),
agreements_q as (select a.* from public.agreements a where a.company_id=p_company_id::text order by a.created_at desc limit 100),
invoices_q as (select i.* from public.invoices i where i.company_id=p_company_id::text order by i.created_at desc limit 100),
metrics as (select
 (select count(*) from contacts_q)::int contact_count,(select count(*) from leads_q)::int lead_count,
 (select count(*) from deals_q where lower(trim(coalesce(stage,''))) not in ('lost','won'))::int open_deal_count,
 (select count(*) from deals_q where lower(trim(coalesce(stage,'')))='won')::int won_deal_count,
 (select count(*) from deals_q where lower(trim(coalesce(stage,'')))='lost')::int lost_deal_count,
 (select count(*) from proposals_q)::int proposal_count,(select count(*) from agreements_q)::int agreement_count,(select count(*) from invoices_q)::int invoice_count,
 coalesce((select sum(estimated_value) from deals_q where lower(trim(coalesce(stage,''))) not in ('lost','won')),0) pipeline_value,
 coalesce((select sum(coalesce(invoice_total,grand_total,total_amount,0)) from invoices_q),0) invoiced_value,
 coalesce((select sum(coalesce(amount_paid,0)) from invoices_q),0) paid_value,
 coalesce((select sum(coalesce(balance_due,0)) from invoices_q),0) outstanding_value,
 coalesce((select max(coalesce(number_of_locations,0)) from deals_q where lower(trim(coalesce(stage,'')))='won'),0)::int won_coverage)
select jsonb_build_object(
 'company',coalesce((select to_jsonb(c) from c),'{}'::jsonb),
 'summary',jsonb_build_object('contacts',m.contact_count,'leads',m.lead_count,'open_deals',m.open_deal_count,'won_deals',m.won_deal_count,'lost_deals',m.lost_deal_count,'proposals',m.proposal_count,'agreements',m.agreement_count,'invoices',m.invoice_count,'pipeline_value',m.pipeline_value,'invoiced_value',m.invoiced_value,'paid_value',m.paid_value,'outstanding_value',m.outstanding_value,'total_locations',coalesce((select total_locations from c),0),'won_coverage',m.won_coverage,'expansion_potential',greatest(coalesce((select total_locations from c),0)-m.won_coverage,0)),
 'contacts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'contact_id',contact_id,'name',full_name,'job_title',job_title,'decision_role',decision_role,'email',email,'phone',coalesce(mobile,phone),'primary',is_primary_contact)) from contacts_q),'[]'::jsonb),
 'leads',coalesce((select jsonb_agg(jsonb_build_object('id',id,'lead_id',lead_id,'status',status,'source',lead_source,'assigned_to',assigned_to,'estimated_value',estimated_value,'currency',currency,'locations',number_of_locations,'updated_at',updated_at)) from leads_q),'[]'::jsonb),
 'deals',coalesce((select jsonb_agg(jsonb_build_object('id',id,'deal_id',deal_id,'stage',stage,'probability_percent',probability_percent,'expected_close_date',expected_close_date,'assigned_to',assigned_to,'lead_source',lead_source,'estimated_value',estimated_value,'currency',currency,'locations',number_of_locations,'lost_reason',lost_reason,'won_at',won_at,'lost_at',lost_at,'sales_cycle_days',sales_cycle_days,'updated_at',updated_at)) from deals_q),'[]'::jsonb),
 'proposals',coalesce((select jsonb_agg(jsonb_build_object('id',id,'proposal_id',proposal_id,'status',status,'grand_total',grand_total,'currency',currency,'valid_until',coalesce(valid_until,proposal_valid_until),'status_changed_at',status_changed_at,'created_at',created_at,'updated_at',updated_at)) from proposals_q),'[]'::jsonb),
 'agreements',coalesce((select jsonb_agg(jsonb_build_object('id',id,'agreement_id',agreement_id,'agreement_number',agreement_number,'status',status,'grand_total',grand_total,'currency',currency,'signed_date',signed_date,'status_changed_at',status_changed_at,'created_at',created_at,'updated_at',updated_at)) from agreements_q),'[]'::jsonb),
 'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'invoice_id',invoice_id,'status',status,'payment_status',payment_status,'total',coalesce(invoice_total,grand_total,total_amount,0),'paid',amount_paid,'balance_due',balance_due,'currency',currency,'due_date',due_date,'created_at',created_at)) from invoices_q),'[]'::jsonb)) from metrics m $$;
grant execute on function public.crm_account_360(uuid) to authenticated;
