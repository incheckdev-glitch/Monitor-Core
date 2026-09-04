-- Remove Developer access from every Accounting permission resource.
delete from public.role_permissions
where role_key = 'dev'
  and (resource = 'accounting' or resource like 'accounting_%');

insert into public.role_permissions
  (role_key, resource, action, is_allowed, is_active, allowed_roles)
select distinct
  'dev', rp.resource, rp.action, false, true, '{}'::text[]
from public.role_permissions rp
where rp.resource = 'accounting' or rp.resource like 'accounting_%'
on conflict (role_key, resource, action)
do update set
  is_allowed = false,
  is_active = true,
  allowed_roles = '{}'::text[];

-- Accounting tables historically allowed all authenticated users directly.
-- Preserve access for other roles while explicitly blocking developer roles at RLS.
do $$
declare
  r record;
  p_select text;
  p_insert text;
  p_update text;
  p_delete text;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename like 'accounting\_%' escape '\'
  loop
    p_select := r.tablename || '_authenticated_select';
    p_insert := r.tablename || '_authenticated_insert';
    p_update := r.tablename || '_authenticated_update';
    p_delete := r.tablename || '_authenticated_delete';

    execute format('drop policy if exists %I on public.%I', p_select, r.tablename);
    execute format('drop policy if exists %I on public.%I', p_insert, r.tablename);
    execute format('drop policy if exists %I on public.%I', p_update, r.tablename);
    execute format('drop policy if exists %I on public.%I', p_delete, r.tablename);

    execute format(
      'create policy %I on public.%I for select to authenticated using (coalesce(public.current_app_role(), '''') not in (''dev'',''developer''))',
      p_select, r.tablename
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (coalesce(public.current_app_role(), '''') not in (''dev'',''developer''))',
      p_insert, r.tablename
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (coalesce(public.current_app_role(), '''') not in (''dev'',''developer'')) with check (coalesce(public.current_app_role(), '''') not in (''dev'',''developer''))',
      p_update, r.tablename
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (coalesce(public.current_app_role(), '''') not in (''dev'',''developer''))',
      p_delete, r.tablename
    );
  end loop;
end $$;
