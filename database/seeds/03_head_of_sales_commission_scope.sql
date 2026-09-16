-- Head of Sales commission scope override.
-- Safe to re-run after the baseline role/permission seed.

delete from public.role_permissions
where lower(role_key) = 'head_of_sales'
  and lower(resource) in ('sales_commissions','sales_commission_installments')
  and lower(action) = 'manage_all';

insert into public.role_permissions
  (permission_id, role_key, resource, action, is_allowed, is_active, allowed_roles, created_at, updated_at)
values
  (gen_random_uuid(), 'head_of_sales', 'sales_commissions', 'view_related', true, true, array['head_of_sales']::text[], now(), now()),
  (gen_random_uuid(), 'head_of_sales', 'sales_commission_installments', 'view_related', true, true, array['head_of_sales']::text[], now(), now())
on conflict (role_key, resource, action)
do update set
  is_allowed = true,
  is_active = true,
  allowed_roles = array['head_of_sales']::text[],
  updated_at = now();
