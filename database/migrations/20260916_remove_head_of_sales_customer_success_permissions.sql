begin;

-- Head of Sales is a commercial role and must not have access to the
-- Customer Success workspace or its internal lifecycle operations.
delete from public.role_permissions
where lower(role_key) = 'head_of_sales'
  and lower(resource) in (
    'csm',
    'csm_activities',
    'csm_daily_activity',
    'csm_daily_activity_tracker',
    'client_success',
    'customer_success',
    'client_lifecycle'
  );

commit;
