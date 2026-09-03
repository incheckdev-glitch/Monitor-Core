-- Restore the CSM Workplace permission set from the old ERP.
-- This complements the CS 360 / notifications / workflow CSM permission correction.

insert into public.role_permissions (role_key, resource, action, is_allowed, is_active, allowed_roles)
values
  ('csm','csm','view',true,true,array['csm']),
  ('csm','csm','update',true,true,array['csm']),
  ('csm','csm','export',true,true,array['csm']),
  ('csm','csm_activities','create',true,true,array['csm']),
  ('csm','csm_activities','edit',true,true,array['csm']),
  ('csm','csm_activities','export',true,true,array['csm']),
  ('csm','csm_activities','get',true,true,array['csm']),
  ('csm','csm_activities','list',true,true,array['csm']),
  ('csm','csm_activities','update',true,true,array['csm']),
  ('csm','csm_activities','view',true,true,array['csm'])
on conflict (role_key, resource, action) do update set
  is_allowed = excluded.is_allowed,
  is_active = excluded.is_active,
  allowed_roles = excluded.allowed_roles,
  updated_at = now();
