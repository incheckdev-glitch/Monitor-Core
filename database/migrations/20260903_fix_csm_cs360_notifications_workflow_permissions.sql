-- Restore the intended CSM access model in the new ERP.
-- CSM: full Client Success 360 access, notification access, old-ERP workflow access,
-- and no Credit Notes access at either the application permission or RLS layer.

begin;

insert into public.role_permissions (role_key, resource, action, is_allowed, is_active, allowed_roles, updated_at)
select 'csm', 'client_success', a.action, true, true, array['csm']::text[], now()
from (values
  ('view'),('list'),('get'),('create'),('update'),('delete'),('export'),('manage')
) as a(action)
on conflict (role_key, resource, action) do update
set is_allowed = true,
    is_active = true,
    allowed_roles = array['csm']::text[],
    updated_at = now();

insert into public.role_permissions (role_key, resource, action, is_allowed, is_active, allowed_roles, updated_at)
select 'csm', 'notifications', a.action, true, true, array['csm']::text[], now()
from (values
  ('list'),('get_unread_count'),('mark_read'),('mark_all_read')
) as a(action)
on conflict (role_key, resource, action) do update
set is_allowed = true,
    is_active = true,
    allowed_roles = array['csm']::text[],
    updated_at = now();

insert into public.role_permissions (role_key, resource, action, is_allowed, is_active, allowed_roles, updated_at)
select 'csm', 'workflow', a.action, true, true, array['csm']::text[], now()
from (values
  ('approve'),('get'),('list'),('list_audit'),('list_pending_approvals'),
  ('reject'),('request_approval'),('save'),('view')
) as a(action)
on conflict (role_key, resource, action) do update
set is_allowed = true,
    is_active = true,
    allowed_roles = array['csm']::text[],
    updated_at = now();

insert into public.role_permissions (role_key, resource, action, is_allowed, is_active, allowed_roles, updated_at)
select 'csm', 'credit_notes', a.action, false, true, '{}'::text[], now()
from (values
  ('view'),('list'),('get'),('create'),('update'),('delete'),('cancel'),('print'),('export'),('manage'),('save')
) as a(action)
on conflict (role_key, resource, action) do update
set is_allowed = false,
    is_active = true,
    allowed_roles = '{}'::text[],
    updated_at = now();

commit;

create or replace function public.incheck360_credit_note_read_role_allowed()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and coalesce(p.is_active, true) = true
       and lower(btrim(coalesce(p.role_key, ''))) in (
         'admin','dev','viewer','hoo','sales_executive','head_of_sales',
         'accounting','accountant','senior_financial_controller','financial_controller',
         'senior_fc','sfc','general_manager','gm'
       )
  );
$function$;
