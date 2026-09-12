create table if not exists public.lead_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  is_primary boolean not null default false,
  opportunity_role text null,
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_contacts_unique_contact unique (lead_id, contact_id),
  constraint lead_contacts_opportunity_role_check check (
    opportunity_role is null or opportunity_role in (
      'Decision Maker','Influencer','Technical','Finance','Operations','Quality','Procurement','Other'
    )
  )
);

create table if not exists public.deal_contacts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  is_primary boolean not null default false,
  opportunity_role text null,
  source_lead_contact_id uuid null references public.lead_contacts(id) on delete set null,
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_contacts_unique_contact unique (deal_id, contact_id),
  constraint deal_contacts_opportunity_role_check check (
    opportunity_role is null or opportunity_role in (
      'Decision Maker','Influencer','Technical','Finance','Operations','Quality','Procurement','Other'
    )
  )
);

create unique index if not exists lead_contacts_one_primary_idx on public.lead_contacts(lead_id) where is_primary;
create unique index if not exists deal_contacts_one_primary_idx on public.deal_contacts(deal_id) where is_primary;
create index if not exists lead_contacts_contact_idx on public.lead_contacts(contact_id);
create index if not exists deal_contacts_contact_idx on public.deal_contacts(contact_id);

alter table public.lead_contacts enable row level security;
alter table public.deal_contacts enable row level security;

drop policy if exists incheck360_core_select_lead_contacts on public.lead_contacts;
create policy incheck360_core_select_lead_contacts on public.lead_contacts for select using (
  lower(coalesce(current_app_role(),'')) in ('admin','gm','general_manager','generalmanager')
  or app_has_permission('leads','list') or app_has_permission('leads','get') or app_has_permission('leads','view')
  or app_has_permission('leads','manage') or app_has_permission('leads','manage_all')
);

drop policy if exists incheck360_core_insert_lead_contacts on public.lead_contacts;
create policy incheck360_core_insert_lead_contacts on public.lead_contacts for insert with check (
  lower(coalesce(current_app_role(),'')) in ('admin','gm','general_manager','generalmanager')
  or app_has_permission('leads','create') or app_has_permission('leads','update') or app_has_permission('leads','edit')
  or app_has_permission('leads','manage') or app_has_permission('leads','manage_all')
);

drop policy if exists incheck360_core_update_lead_contacts on public.lead_contacts;
create policy incheck360_core_update_lead_contacts on public.lead_contacts for update using (
  lower(coalesce(current_app_role(),'')) in ('admin','gm','general_manager','generalmanager')
  or app_has_permission('leads','update') or app_has_permission('leads','edit') or app_has_permission('leads','manage') or app_has_permission('leads','manage_all')
) with check (
  lower(coalesce(current_app_role(),'')) in ('admin','gm','general_manager','generalmanager')
  or app_has_permission('leads','update') or app_has_permission('leads','edit') or app_has_permission('leads','manage') or app_has_permission('leads','manage_all')
);

drop policy if exists incheck360_core_delete_lead_contacts on public.lead_contacts;
create policy incheck360_core_delete_lead_contacts on public.lead_contacts for delete using (
  lower(coalesce(current_app_role(),'')) in ('admin','gm','general_manager','generalmanager')
  or app_has_permission('leads','update') or app_has_permission('leads','edit') or app_has_permission('leads','manage') or app_has_permission('leads','manage_all')
);

drop policy if exists incheck360_core_select_deal_contacts on public.deal_contacts;
create policy incheck360_core_select_deal_contacts on public.deal_contacts for select using (
  lower(coalesce(current_app_role(),'')) in ('admin','gm','general_manager','generalmanager')
  or app_has_permission('deals','list') or app_has_permission('deals','get') or app_has_permission('deals','view')
  or app_has_permission('deals','manage') or app_has_permission('deals','manage_all')
);

drop policy if exists incheck360_core_insert_deal_contacts on public.deal_contacts;
create policy incheck360_core_insert_deal_contacts on public.deal_contacts for insert with check (
  lower(coalesce(current_app_role(),'')) in ('admin','gm','general_manager','generalmanager')
  or app_has_permission('deals','create') or app_has_permission('deals','update') or app_has_permission('deals','edit')
  or app_has_permission('deals','manage') or app_has_permission('deals','manage_all')
);

drop policy if exists incheck360_core_update_deal_contacts on public.deal_contacts;
create policy incheck360_core_update_deal_contacts on public.deal_contacts for update using (
  lower(coalesce(current_app_role(),'')) in ('admin','gm','general_manager','generalmanager')
  or app_has_permission('deals','update') or app_has_permission('deals','edit') or app_has_permission('deals','manage') or app_has_permission('deals','manage_all')
) with check (
  lower(coalesce(current_app_role(),'')) in ('admin','gm','general_manager','generalmanager')
  or app_has_permission('deals','update') or app_has_permission('deals','edit') or app_has_permission('deals','manage') or app_has_permission('deals','manage_all')
);

drop policy if exists incheck360_core_delete_deal_contacts on public.deal_contacts;
create policy incheck360_core_delete_deal_contacts on public.deal_contacts for delete using (
  lower(coalesce(current_app_role(),'')) in ('admin','gm','general_manager','generalmanager')
  or app_has_permission('deals','update') or app_has_permission('deals','edit') or app_has_permission('deals','manage') or app_has_permission('deals','manage_all')
);

grant select, insert, update, delete on public.lead_contacts to authenticated;
grant select, insert, update, delete on public.deal_contacts to authenticated;

insert into public.lead_contacts (lead_id, contact_id, is_primary, opportunity_role)
select l.id, l.contact_uuid, true,
       case when c.decision_role in ('Decision Maker','Influencer','Technical','Finance','Operations','Quality','Procurement','Other') then c.decision_role else null end
from public.leads l
join public.contacts c on c.id = l.contact_uuid
where l.contact_uuid is not null
on conflict (lead_id, contact_id) do update set
  is_primary = true,
  opportunity_role = coalesce(public.lead_contacts.opportunity_role, excluded.opportunity_role),
  updated_at = now();

insert into public.deal_contacts (deal_id, contact_id, is_primary, opportunity_role)
select d.id, c.id, true,
       case when c.decision_role in ('Decision Maker','Influencer','Technical','Finance','Operations','Quality','Procurement','Other') then c.decision_role else null end
from public.deals d
join public.contacts c on c.id::text = d.contact_id
where d.contact_id is not null
on conflict (deal_id, contact_id) do update set
  is_primary = true,
  opportunity_role = coalesce(public.deal_contacts.opportunity_role, excluded.opportunity_role),
  updated_at = now();

create or replace function public.crm_sync_lead_primary_contact()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contact_uuid is null then
    update public.lead_contacts set is_primary = false, updated_at = now() where lead_id = new.id and is_primary;
    return new;
  end if;
  update public.lead_contacts set is_primary = false, updated_at = now()
   where lead_id = new.id and is_primary and contact_id <> new.contact_uuid;
  insert into public.lead_contacts (lead_id, contact_id, is_primary, opportunity_role)
  select new.id, new.contact_uuid, true,
         case when c.decision_role in ('Decision Maker','Influencer','Technical','Finance','Operations','Quality','Procurement','Other') then c.decision_role else null end
  from public.contacts c where c.id = new.contact_uuid
  on conflict (lead_id, contact_id) do update set
    is_primary = true,
    opportunity_role = coalesce(public.lead_contacts.opportunity_role, excluded.opportunity_role),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_crm_sync_lead_primary_contact on public.leads;
create trigger trg_crm_sync_lead_primary_contact after insert or update of contact_uuid on public.leads
for each row execute function public.crm_sync_lead_primary_contact();

create or replace function public.crm_sync_deal_primary_contact()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_contact uuid;
begin
  v_contact := null;
  if new.contact_id is not null and new.contact_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select id into v_contact from public.contacts where id = new.contact_id::uuid;
  end if;
  if v_contact is null then return new; end if;
  update public.deal_contacts set is_primary = false, updated_at = now()
   where deal_id = new.id and is_primary and contact_id <> v_contact;
  insert into public.deal_contacts (deal_id, contact_id, is_primary, opportunity_role)
  select new.id, v_contact, true,
         case when c.decision_role in ('Decision Maker','Influencer','Technical','Finance','Operations','Quality','Procurement','Other') then c.decision_role else null end
  from public.contacts c where c.id = v_contact
  on conflict (deal_id, contact_id) do update set
    is_primary = true,
    opportunity_role = coalesce(public.deal_contacts.opportunity_role, excluded.opportunity_role),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_crm_sync_deal_primary_contact on public.deals;
create trigger trg_crm_sync_deal_primary_contact after insert or update of contact_id on public.deals
for each row execute function public.crm_sync_deal_primary_contact();

create or replace function public.crm_copy_lead_contacts_to_deal()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lead_id uuid;
begin
  v_lead_id := coalesce(new.source_lead_uuid, new.lead_id);
  if v_lead_id is null then return new; end if;
  insert into public.deal_contacts (deal_id, contact_id, is_primary, opportunity_role, source_lead_contact_id, created_by)
  select new.id, lc.contact_id, lc.is_primary, lc.opportunity_role, lc.id, lc.created_by
  from public.lead_contacts lc where lc.lead_id = v_lead_id
  on conflict (deal_id, contact_id) do update set
    is_primary = excluded.is_primary,
    opportunity_role = excluded.opportunity_role,
    source_lead_contact_id = excluded.source_lead_contact_id,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_crm_copy_lead_contacts_to_deal on public.deals;
create trigger trg_crm_copy_lead_contacts_to_deal after insert or update of source_lead_uuid, lead_id on public.deals
for each row execute function public.crm_copy_lead_contacts_to_deal();
