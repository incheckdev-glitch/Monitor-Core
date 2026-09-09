-- GM must be authorization-equivalent to Admin while retaining its own role identity.

create or replace function public.app_has_permission(p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists(
    select 1
    from public.role_permissions rp
    join public.profiles p on lower(p.role_key)=lower(rp.role_key)
    where p.id=auth.uid() and coalesce(p.is_active,true)=true
      and lower(rp.resource)=lower(coalesce(p_resource,''))
      and lower(rp.action)=lower(coalesce(p_action,''))
      and coalesce(rp.is_allowed,false)=true and coalesce(rp.is_active,true)=true
  ) or public.current_app_role() in ('admin','dev','gm','general_manager','generalmanager');
$function$;

create or replace function public.get_my_role_permissions()
returns table(role_key text, resource text, action text, is_allowed boolean, is_active boolean, allowed_roles text[])
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with current_profile as (
    select lower(
      regexp_replace(
        trim(coalesce(p.role_key::text, '')),
        '[\s-]+',
        '_',
        'g'
      )
    ) as normalized_role_key
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, false) = true
      and nullif(trim(coalesce(p.role_key::text, '')), '') is not null
    limit 1
  ), effective_profile as (
    select
      normalized_role_key,
      case
        when normalized_role_key in ('gm','general_manager','generalmanager') then 'admin'
        else normalized_role_key
      end as permission_role_key
    from current_profile
  )
  select
    ep.normalized_role_key::text as role_key,
    rp.resource::text,
    rp.action::text,
    coalesce(rp.is_allowed, true)::boolean,
    coalesce(rp.is_active, true)::boolean,
    array[ep.normalized_role_key]::text[] as allowed_roles
  from public.role_permissions rp
  join effective_profile ep
    on lower(
      regexp_replace(
        trim(coalesce(rp.role_key::text, '')),
        '[\s-]+',
        '_',
        'g'
      )
    ) = ep.permission_role_key
  where coalesce(rp.is_active, true) = true
  order by lower(coalesce(rp.resource::text, '')),
           lower(coalesce(rp.action::text, ''));
$function$;

create or replace function public.crm_is_admin_user()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null
    and public.current_app_role() in ('admin','gm','general_manager','generalmanager');
$function$;

create or replace function public.client_success_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null
    and public.current_app_role() in ('admin','gm','general_manager','generalmanager');
$function$;

create or replace function private.reseller_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select auth.uid() is not null
    and public.current_app_role() in ('admin','gm','general_manager','generalmanager');
$function$;

create or replace function public.current_user_is_proposal_admin()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $function$
  select auth.uid() is not null
    and public.current_app_role() in ('admin','gm','general_manager','generalmanager','super_admin','superadmin');
$function$;

create or replace function public.cs360_has_permission(p_allow_actions text[], p_deny_actions text[] default null::text[])
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role text := public.cs360_current_role_key();
  v_allow_actions text[] := coalesce(p_allow_actions, array[]::text[]);
  v_deny_actions text[] := coalesce(p_deny_actions, p_allow_actions, array[]::text[]);
begin
  if v_role in ('admin','gm','general_manager','generalmanager') then
    return true;
  end if;

  if v_role = '' then
    return false;
  end if;

  if to_regclass('public.role_permissions') is null then
    return false;
  end if;

  if exists (
    select 1
    from public.role_permissions rp
    where lower(coalesce(rp.role_key, '')) = v_role
      and lower(coalesce(rp.resource, '')) in ('client_success', 'customer_success')
      and lower(coalesce(rp.action, '')) = any(v_deny_actions)
      and coalesce(rp.is_active, true) = true
      and coalesce(rp.is_allowed, true) = false
  ) then
    return false;
  end if;

  return exists (
    select 1
    from public.role_permissions rp
    where lower(coalesce(rp.role_key, '')) = v_role
      and lower(coalesce(rp.resource, '')) in ('client_success', 'customer_success')
      and lower(coalesce(rp.action, '')) = any(v_allow_actions || array['manage'])
      and coalesce(rp.is_active, true) = true
      and coalesce(rp.is_allowed, true) = true
  );
end;
$function$;

create or replace function public.cs360_has_permission(p_actions text[])
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role text := public.cs360_current_role_key();
  v_actions text[] := coalesce(p_actions, array[]::text[]);
begin
  if v_role in ('admin','gm','general_manager','generalmanager') then
    return true;
  end if;

  if v_role = '' then
    return false;
  end if;

  if to_regclass('public.role_permissions') is null then
    return false;
  end if;

  if exists (
    select 1
    from public.role_permissions rp
    where lower(coalesce(rp.role_key, '')) = v_role
      and lower(coalesce(rp.resource, '')) in ('client_success', 'customer_success')
      and lower(coalesce(rp.action, '')) = any(v_actions || array['manage'])
      and coalesce(rp.is_active, true) = true
      and coalesce(rp.is_allowed, true) = false
  ) then
    return false;
  end if;

  return exists (
    select 1
    from public.role_permissions rp
    where lower(coalesce(rp.role_key, '')) = v_role
      and lower(coalesce(rp.resource, '')) in ('client_success', 'customer_success')
      and lower(coalesce(rp.action, '')) = any(v_actions || array['manage'])
      and coalesce(rp.is_active, true) = true
      and coalesce(rp.is_allowed, true) = true
  );
end;
$function$;

create or replace function public.cs360_save_can_write()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role text := coalesce(public.cs360_save_current_role_key(), '');
  v_allowed boolean := false;
begin
  if v_role in ('admin','administrator','super_admin','gm','general_manager','generalmanager','csm','customer_success') then
    return true;
  end if;

  if to_regclass('public.role_permissions') is not null and v_role <> '' then
    execute $q$
      select exists (
        select 1
        from public.role_permissions rp
        where lower(coalesce(rp.role_key, '')) = $1
          and lower(coalesce(rp.resource, '')) in ('client_success','customer_success')
          and lower(coalesce(rp.action, '')) in ('create','insert','add','update','edit','manage')
          and coalesce(rp.is_active, true) = true
          and coalesce(rp.is_allowed, true) = true
      )
    $q$ into v_allowed using v_role;
  end if;

  return coalesce(v_allowed, false);
end;
$function$;

create or replace function public.sales_commission_access_level()
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_level text;
begin
  v_role := lower(regexp_replace(trim(coalesce(
    (select p.role_key::text from public.profiles p where p.id = auth.uid() limit 1),
    auth.jwt()->'app_metadata'->>'role',
    auth.jwt()->'user_metadata'->>'role',
    ''
  )), '[\s-]+', '_', 'g'));

  if v_role in ('admin','gm','general_manager','generalmanager') then
    return 'manage_all';
  end if;

  if to_regclass('public.role_permissions') is not null then
    execute $query$
      select case
        when coalesce(bool_or(lower(action::text) = 'manage_all'), false) then 'manage_all'
        when coalesce(bool_or(lower(action::text) = 'view_all'), false) then 'view_all'
        when coalesce(bool_or(lower(action::text) = 'view_related'), false) then 'view_related'
        else 'none'
      end
      from public.role_permissions
      where lower(regexp_replace(trim(coalesce(role_key::text, '')), '[\s-]+', '_', 'g')) = $1
        and lower(trim(coalesce(resource::text, ''))) = 'sales_commissions'
        and lower(trim(coalesce(action::text, ''))) in ('manage_all', 'view_all', 'view_related')
        and coalesce(is_active, true) = true
        and coalesce(is_allowed, true) = true
    $query$
    into v_level
    using v_role;
  end if;

  return coalesce(v_level, 'none');
end;
$function$;

create or replace function public.upsert_role_permission(
  p_role_key text,
  p_resource text,
  p_action text,
  p_is_allowed boolean default true,
  p_is_active boolean default true,
  p_allowed_roles text default null::text
)
returns public.role_permissions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.role_permissions;
  v_roles text[];
begin
  if public.current_app_role() not in ('admin','dev','gm','general_manager','generalmanager') then
    raise exception 'permission denied';
  end if;
  v_roles := case
    when coalesce(trim(p_allowed_roles),'')='' then array[lower(trim(p_role_key))]::text[]
    else regexp_split_to_array(p_allowed_roles,'\s*,\s*')
  end;
  insert into public.role_permissions(role_key,resource,action,is_allowed,is_active,allowed_roles,updated_at)
  values(lower(trim(p_role_key)),lower(trim(p_resource)),lower(trim(p_action)),coalesce(p_is_allowed,true),coalesce(p_is_active,true),v_roles,now())
  on conflict(role_key,resource,action) do update
    set is_allowed=excluded.is_allowed,
        is_active=excluded.is_active,
        allowed_roles=excluded.allowed_roles,
        updated_at=now()
  returning * into v;
  return v;
end;
$function$;

-- Keep the existing expired-proposal implementation intact and only replace
-- its hard-coded Admin-only guard with the shared Admin-equivalent guard.
do $gm_admin_expired_proposal_patch$
declare
  v_def text;
begin
  select pg_get_functiondef('public.admin_accept_expired_proposal(uuid,text)'::regprocedure)
    into v_def;

  if position('if v_role <> ''admin'' then' in v_def) > 0 then
    v_def := replace(
      v_def,
      'if v_role <> ''admin'' then',
      'if not public.current_user_is_proposal_admin() then'
    );
    execute v_def;
  elsif position('if not public.current_user_is_proposal_admin() then' in v_def) = 0 then
    raise exception 'Unexpected admin_accept_expired_proposal guard; migration stopped to avoid an unsafe rewrite.';
  end if;
end;
$gm_admin_expired_proposal_patch$;

alter policy profiles_admin_dev_update on public.profiles
  using (public.current_app_role() in ('admin','dev','gm','general_manager','generalmanager'))
  with check (public.current_app_role() in ('admin','dev','gm','general_manager','generalmanager'));

alter policy user_activity_events_select_own_or_admin on public.user_activity_events
  using (((select auth.uid()) = user_id)
    or public.current_app_role() in ('admin','gm','general_manager','generalmanager'));

alter policy user_activity_sessions_select_own_or_admin on public.user_activity_sessions
  using (((select auth.uid()) = user_id)
    or public.current_app_role() in ('admin','gm','general_manager','generalmanager'));

alter policy user_module_usage_select_own_or_admin on public.user_module_usage
  using (((select auth.uid()) = user_id)
    or public.current_app_role() in ('admin','gm','general_manager','generalmanager'));
