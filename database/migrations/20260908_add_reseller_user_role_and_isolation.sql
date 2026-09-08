-- Monitor Core ERP: add reseller_user role and strict reseller row isolation.
-- One reseller per reseller_user for now. Admin retains full access.

insert into public.roles(role_key, role_name, description, is_active)
values ('reseller_user','Reseller User','External reseller workspace user restricted to one reseller account.',true)
on conflict (role_key) do update set
  role_name=excluded.role_name,
  description=excluded.description,
  is_active=true,
  updated_at=now();

create table if not exists public.reseller_user_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reseller_user_links_one_reseller_per_user unique(user_id)
);
create index if not exists reseller_user_links_reseller_idx on public.reseller_user_links(reseller_id) where is_active;

create or replace function private.reseller_current_role()
returns text
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select lower(coalesce(p.role_key,p.role,''))
  from public.profiles p
  where p.id=(select auth.uid()) and p.is_active=true
  limit 1;
$$;

create or replace function private.reseller_current_reseller_id()
returns uuid
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select l.reseller_id
  from public.reseller_user_links l
  join public.profiles p on p.id=l.user_id
  where l.user_id=(select auth.uid())
    and l.is_active=true
    and p.is_active=true
    and lower(coalesce(p.role_key,p.role,''))='reseller_user'
  limit 1;
$$;

create or replace function private.reseller_can_access(p_reseller_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public,private,pg_temp
as $$
  select private.reseller_is_admin()
      or (
        private.reseller_current_role()='reseller_user'
        and p_reseller_id is not null
        and p_reseller_id=private.reseller_current_reseller_id()
      );
$$;

revoke all on function private.reseller_current_role() from public,anon;
revoke all on function private.reseller_current_reseller_id() from public,anon;
revoke all on function private.reseller_can_access(uuid) from public,anon;
grant execute on function private.reseller_current_role() to authenticated;
grant execute on function private.reseller_current_reseller_id() to authenticated;
grant execute on function private.reseller_can_access(uuid) to authenticated;

alter table public.reseller_user_links enable row level security;
revoke all on table public.reseller_user_links from anon;
grant select,insert,update,delete on table public.reseller_user_links to authenticated;

drop policy if exists reseller_user_links_admin_all on public.reseller_user_links;
create policy reseller_user_links_admin_all on public.reseller_user_links
for all to authenticated
using (private.reseller_is_admin())
with check (private.reseller_is_admin());

drop policy if exists reseller_user_links_self_select on public.reseller_user_links;
create policy reseller_user_links_self_select on public.reseller_user_links
for select to authenticated
using ((select auth.uid())=user_id and is_active=true);

-- Reseller master: reseller users may read only their own reseller profile; only admin can write.
drop policy if exists admin_only_resellers on public.resellers;
drop policy if exists resellers_select_admin_or_own on public.resellers;
create policy resellers_select_admin_or_own on public.resellers
for select to authenticated
using (private.reseller_can_access(id));
drop policy if exists resellers_admin_insert on public.resellers;
create policy resellers_admin_insert on public.resellers for insert to authenticated with check (private.reseller_is_admin());
drop policy if exists resellers_admin_update on public.resellers;
create policy resellers_admin_update on public.resellers for update to authenticated using (private.reseller_is_admin()) with check (private.reseller_is_admin());
drop policy if exists resellers_admin_delete on public.resellers;
create policy resellers_admin_delete on public.resellers for delete to authenticated using (private.reseller_is_admin());

-- Own-row SELECT across every reseller-owned table.
do $$
declare t text;
begin
  foreach t in array array[
    'reseller_companies','reseller_contacts','reseller_ownerships','reseller_leads','reseller_deals',
    'reseller_activations','reseller_requests','reseller_renewals','reseller_settlements','reseller_payments','reseller_market_checks'
  ] loop
    execute format('drop policy if exists %I on public.%I','admin_only_'||t,t);
    execute format('drop policy if exists %I on public.%I','reseller_select_admin_or_own_'||t,t);
    execute format('create policy %I on public.%I for select to authenticated using (private.reseller_can_access(reseller_id))','reseller_select_admin_or_own_'||t,t);
  end loop;
end $$;

-- Own sub-CRM: reseller users may create/update/delete their own CRM records.
do $$
declare t text;
begin
  foreach t in array array['reseller_companies','reseller_contacts','reseller_leads','reseller_deals'] loop
    execute format('drop policy if exists %I on public.%I','reseller_insert_admin_or_own_'||t,t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.reseller_can_access(reseller_id))','reseller_insert_admin_or_own_'||t,t);
    execute format('drop policy if exists %I on public.%I','reseller_update_admin_or_own_'||t,t);
    execute format('create policy %I on public.%I for update to authenticated using (private.reseller_can_access(reseller_id)) with check (private.reseller_can_access(reseller_id))','reseller_update_admin_or_own_'||t,t);
    execute format('drop policy if exists %I on public.%I','reseller_delete_admin_or_own_'||t,t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.reseller_can_access(reseller_id))','reseller_delete_admin_or_own_'||t,t);
  end loop;
end $$;

-- Ownership requests: reseller can submit a pending request only; decisions remain admin-only.
drop policy if exists reseller_ownerships_insert_admin_or_own on public.reseller_ownerships;
create policy reseller_ownerships_insert_admin_or_own on public.reseller_ownerships
for insert to authenticated
with check (private.reseller_is_admin() or (private.reseller_can_access(reseller_id) and status='pending'));
drop policy if exists reseller_ownerships_admin_update on public.reseller_ownerships;
create policy reseller_ownerships_admin_update on public.reseller_ownerships for update to authenticated using (private.reseller_is_admin()) with check (private.reseller_is_admin());
drop policy if exists reseller_ownerships_admin_delete on public.reseller_ownerships;
create policy reseller_ownerships_admin_delete on public.reseller_ownerships for delete to authenticated using (private.reseller_is_admin());

-- Activations: reseller can create/edit draft or submitted requests only; approval/activation stays admin-only.
drop policy if exists reseller_activations_insert_admin_or_own on public.reseller_activations;
create policy reseller_activations_insert_admin_or_own on public.reseller_activations
for insert to authenticated
with check (private.reseller_is_admin() or (private.reseller_can_access(reseller_id) and status in ('draft','submitted')));
drop policy if exists reseller_activations_update_admin_or_own on public.reseller_activations;
create policy reseller_activations_update_admin_or_own on public.reseller_activations
for update to authenticated
using (private.reseller_can_access(reseller_id))
with check (private.reseller_is_admin() or (private.reseller_can_access(reseller_id) and status in ('draft','submitted')));
drop policy if exists reseller_activations_delete_admin_or_draft_own on public.reseller_activations;
create policy reseller_activations_delete_admin_or_draft_own on public.reseller_activations
for delete to authenticated
using (private.reseller_is_admin() or (private.reseller_can_access(reseller_id) and status='draft'));

-- Requests: reseller owns creation and can update only reseller-side workflow states.
drop policy if exists reseller_requests_insert_admin_or_own on public.reseller_requests;
create policy reseller_requests_insert_admin_or_own on public.reseller_requests
for insert to authenticated
with check (private.reseller_is_admin() or (private.reseller_can_access(reseller_id) and status in ('draft','submitted')));
drop policy if exists reseller_requests_update_admin_or_own on public.reseller_requests;
create policy reseller_requests_update_admin_or_own on public.reseller_requests
for update to authenticated
using (private.reseller_can_access(reseller_id))
with check (private.reseller_is_admin() or (private.reseller_can_access(reseller_id) and status in ('draft','submitted','waiting_on_reseller')));
drop policy if exists reseller_requests_delete_admin_or_draft_own on public.reseller_requests;
create policy reseller_requests_delete_admin_or_draft_own on public.reseller_requests
for delete to authenticated
using (private.reseller_is_admin() or (private.reseller_can_access(reseller_id) and status='draft'));

-- Renewals: reseller can respond, but cannot create/delete renewal obligations.
drop policy if exists reseller_renewals_update_admin_or_own on public.reseller_renewals;
create policy reseller_renewals_update_admin_or_own on public.reseller_renewals
for update to authenticated
using (private.reseller_can_access(reseller_id))
with check (private.reseller_is_admin() or (private.reseller_can_access(reseller_id) and status in ('upcoming','contacting_customer','confirmed','not_renewing')));
drop policy if exists reseller_renewals_admin_insert on public.reseller_renewals;
create policy reseller_renewals_admin_insert on public.reseller_renewals for insert to authenticated with check (private.reseller_is_admin());
drop policy if exists reseller_renewals_admin_delete on public.reseller_renewals;
create policy reseller_renewals_admin_delete on public.reseller_renewals for delete to authenticated using (private.reseller_is_admin());

-- Settlements/payments are financial records: reseller is read-only, admin writes.
do $$
declare t text;
begin
  foreach t in array array['reseller_settlements','reseller_payments'] loop
    execute format('drop policy if exists %I on public.%I','reseller_finance_admin_insert_'||t,t);
    execute format('create policy %I on public.%I for insert to authenticated with check (private.reseller_is_admin())','reseller_finance_admin_insert_'||t,t);
    execute format('drop policy if exists %I on public.%I','reseller_finance_admin_update_'||t,t);
    execute format('create policy %I on public.%I for update to authenticated using (private.reseller_is_admin()) with check (private.reseller_is_admin())','reseller_finance_admin_update_'||t,t);
    execute format('drop policy if exists %I on public.%I','reseller_finance_admin_delete_'||t,t);
    execute format('create policy %I on public.%I for delete to authenticated using (private.reseller_is_admin())','reseller_finance_admin_delete_'||t,t);
  end loop;
end $$;

-- Market-check audit rows may be inserted only for the current reseller or by admin.
drop policy if exists reseller_market_checks_insert_admin_or_own on public.reseller_market_checks;
create policy reseller_market_checks_insert_admin_or_own on public.reseller_market_checks
for insert to authenticated
with check (private.reseller_can_access(reseller_id));

-- Keep reseller_user out of all ordinary ERP modules for now.
delete from public.role_permissions where role_key='reseller_user';
