begin;

-- Align selected roles with the CSM role for Client Success 360.
-- Target roles: viewer, admin, gm, sfc, hoo.
-- CSM baseline actions: view, list, get, create, update, delete, export, manage.

delete from public.role_permissions
where role_key in ('viewer','admin','gm','sfc','hoo')
  and lower(resource) in ('client_success','customer_success');

insert into public.role_permissions (role_key, resource, action, is_allowed, is_active, allowed_roles)
select r.role_key, 'client_success', a.action, true, true, array[r.role_key]::text[]
from (values ('viewer'),('admin'),('gm'),('sfc'),('hoo')) as r(role_key)
cross join (
  values
    ('view'),
    ('list'),
    ('get'),
    ('create'),
    ('update'),
    ('delete'),
    ('export'),
    ('manage')
) as a(action)
on conflict (role_key, resource, action)
do update set
  is_allowed = excluded.is_allowed,
  is_active = excluded.is_active,
  allowed_roles = excluded.allowed_roles,
  updated_at = now();

commit;
