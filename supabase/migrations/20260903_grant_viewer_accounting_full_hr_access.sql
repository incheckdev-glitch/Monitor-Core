-- Keep Viewer and Accounting aligned with Admin for the complete HR module.
-- This covers the top-level hr resource and every hr_* subresource/action.

begin;

delete from public.role_permissions
where role_key in ('viewer', 'accounting')
  and (resource = 'hr' or resource like 'hr_%');

insert into public.role_permissions
  (role_key, resource, action, is_allowed, is_active, allowed_roles, created_at, updated_at)
select
  target.role_key,
  src.resource,
  src.action,
  true,
  true,
  array[target.role_key]::text[],
  now(),
  now()
from public.role_permissions src
cross join (values ('viewer'::text), ('accounting'::text)) as target(role_key)
where src.role_key = 'admin'
  and src.is_active = true
  and src.is_allowed = true
  and (src.resource = 'hr' or src.resource like 'hr_%');

commit;
