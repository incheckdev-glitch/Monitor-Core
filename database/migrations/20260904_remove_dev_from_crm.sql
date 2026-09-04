-- Remove Developer access from CRM modules (Companies, Contacts, Leads, Deals)
-- Developer is explicitly denied at the role-permission layer and removed from hard-coded RLS bypasses.

with crm_actions(resource, action) as (
  values
    ('companies','create'),('companies','delete'),('companies','export'),('companies','get'),('companies','list'),('companies','update'),('companies','verify'),('companies','verify_company'),('companies','view'),
    ('contacts','create'),('contacts','delete'),('contacts','export'),('contacts','get'),('contacts','list'),('contacts','update'),
    ('deals','create'),('deals','delete'),('deals','export'),('deals','get'),('deals','list'),('deals','update'),('deals','view'),
    ('leads','convert'),('leads','convert_to_deal'),('leads','create'),('leads','delete'),('leads','export'),('leads','get'),('leads','list'),('leads','update'),('leads','view')
)
insert into public.role_permissions(role_key, resource, action, is_allowed, is_active, allowed_roles, updated_at)
select 'dev', resource, action, false, true, '{}'::text[], now()
from crm_actions
on conflict (role_key, resource, action)
do update set
  is_allowed = false,
  is_active = true,
  allowed_roles = '{}'::text[],
  updated_at = now();

-- Companies
DROP POLICY IF EXISTS incheck360_core_select_companies ON public.companies;
CREATE POLICY incheck360_core_select_companies ON public.companies
FOR SELECT USING (
  current_app_role() = 'admin'
  OR app_has_permission('companies','list')
  OR app_has_permission('companies','get')
  OR app_has_permission('companies','view')
  OR app_has_permission('companies','manage')
  OR app_has_permission('companies','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_insert_companies ON public.companies;
CREATE POLICY incheck360_core_insert_companies ON public.companies
FOR INSERT WITH CHECK (
  current_app_role() = 'admin'
  OR app_has_permission('companies','create')
  OR app_has_permission('companies','manage')
  OR app_has_permission('companies','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_update_companies ON public.companies;
CREATE POLICY incheck360_core_update_companies ON public.companies
FOR UPDATE USING (
  current_app_role() = 'admin'
  OR app_has_permission('companies','update')
  OR app_has_permission('companies','edit')
  OR app_has_permission('companies','manage')
  OR app_has_permission('companies','manage_all')
) WITH CHECK (
  current_app_role() = 'admin'
  OR app_has_permission('companies','update')
  OR app_has_permission('companies','edit')
  OR app_has_permission('companies','manage')
  OR app_has_permission('companies','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_delete_companies ON public.companies;
CREATE POLICY incheck360_core_delete_companies ON public.companies
FOR DELETE USING (
  current_app_role() = 'admin'
  OR app_has_permission('companies','delete')
  OR app_has_permission('companies','manage')
  OR app_has_permission('companies','manage_all')
);

-- Contacts
DROP POLICY IF EXISTS incheck360_core_select_contacts ON public.contacts;
CREATE POLICY incheck360_core_select_contacts ON public.contacts
FOR SELECT USING (
  current_app_role() = 'admin'
  OR app_has_permission('contacts','list')
  OR app_has_permission('contacts','get')
  OR app_has_permission('contacts','view')
  OR app_has_permission('contacts','manage')
  OR app_has_permission('contacts','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_insert_contacts ON public.contacts;
CREATE POLICY incheck360_core_insert_contacts ON public.contacts
FOR INSERT WITH CHECK (
  current_app_role() = 'admin'
  OR app_has_permission('contacts','create')
  OR app_has_permission('contacts','manage')
  OR app_has_permission('contacts','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_update_contacts ON public.contacts;
CREATE POLICY incheck360_core_update_contacts ON public.contacts
FOR UPDATE USING (
  current_app_role() = 'admin'
  OR app_has_permission('contacts','update')
  OR app_has_permission('contacts','edit')
  OR app_has_permission('contacts','manage')
  OR app_has_permission('contacts','manage_all')
) WITH CHECK (
  current_app_role() = 'admin'
  OR app_has_permission('contacts','update')
  OR app_has_permission('contacts','edit')
  OR app_has_permission('contacts','manage')
  OR app_has_permission('contacts','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_delete_contacts ON public.contacts;
CREATE POLICY incheck360_core_delete_contacts ON public.contacts
FOR DELETE USING (
  current_app_role() = 'admin'
  OR app_has_permission('contacts','delete')
  OR app_has_permission('contacts','manage')
  OR app_has_permission('contacts','manage_all')
);

-- Leads
DROP POLICY IF EXISTS incheck360_core_select_leads ON public.leads;
CREATE POLICY incheck360_core_select_leads ON public.leads
FOR SELECT USING (
  current_app_role() = 'admin'
  OR app_has_permission('leads','list')
  OR app_has_permission('leads','get')
  OR app_has_permission('leads','view')
  OR app_has_permission('leads','manage')
  OR app_has_permission('leads','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_insert_leads ON public.leads;
CREATE POLICY incheck360_core_insert_leads ON public.leads
FOR INSERT WITH CHECK (
  current_app_role() = 'admin'
  OR app_has_permission('leads','create')
  OR app_has_permission('leads','manage')
  OR app_has_permission('leads','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_update_leads ON public.leads;
CREATE POLICY incheck360_core_update_leads ON public.leads
FOR UPDATE USING (
  current_app_role() = 'admin'
  OR app_has_permission('leads','update')
  OR app_has_permission('leads','edit')
  OR app_has_permission('leads','manage')
  OR app_has_permission('leads','manage_all')
) WITH CHECK (
  current_app_role() = 'admin'
  OR app_has_permission('leads','update')
  OR app_has_permission('leads','edit')
  OR app_has_permission('leads','manage')
  OR app_has_permission('leads','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_delete_leads ON public.leads;
CREATE POLICY incheck360_core_delete_leads ON public.leads
FOR DELETE USING (
  current_app_role() = 'admin'
  OR app_has_permission('leads','delete')
  OR app_has_permission('leads','manage')
  OR app_has_permission('leads','manage_all')
);

-- Deals
DROP POLICY IF EXISTS incheck360_core_select_deals ON public.deals;
CREATE POLICY incheck360_core_select_deals ON public.deals
FOR SELECT USING (
  current_app_role() = 'admin'
  OR app_has_permission('deals','list')
  OR app_has_permission('deals','get')
  OR app_has_permission('deals','view')
  OR app_has_permission('deals','manage')
  OR app_has_permission('deals','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_insert_deals ON public.deals;
CREATE POLICY incheck360_core_insert_deals ON public.deals
FOR INSERT WITH CHECK (
  current_app_role() = 'admin'
  OR app_has_permission('deals','create')
  OR app_has_permission('deals','manage')
  OR app_has_permission('deals','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_update_deals ON public.deals;
CREATE POLICY incheck360_core_update_deals ON public.deals
FOR UPDATE USING (
  current_app_role() = 'admin'
  OR app_has_permission('deals','update')
  OR app_has_permission('deals','edit')
  OR app_has_permission('deals','manage')
  OR app_has_permission('deals','manage_all')
) WITH CHECK (
  current_app_role() = 'admin'
  OR app_has_permission('deals','update')
  OR app_has_permission('deals','edit')
  OR app_has_permission('deals','manage')
  OR app_has_permission('deals','manage_all')
);
DROP POLICY IF EXISTS incheck360_core_delete_deals ON public.deals;
CREATE POLICY incheck360_core_delete_deals ON public.deals
FOR DELETE USING (
  current_app_role() = 'admin'
  OR app_has_permission('deals','delete')
  OR app_has_permission('deals','manage')
  OR app_has_permission('deals','manage_all')
);
