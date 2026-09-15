create or replace function public.list_communication_centre_assignable_users()
returns table (
  id uuid,
  full_name text,
  display_name text,
  name text,
  email text,
  role_key text,
  role text,
  department text,
  job_title text,
  is_active boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.full_name,
    p.display_name,
    p.name,
    p.email,
    coalesce(nullif(p.role_key, ''), nullif(p.role, '')) as role_key,
    p.role,
    p.department,
    p.job_title,
    p.is_active
  from public.profiles p
  where coalesce(p.is_active, true) = true
  order by coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), nullif(p.name, ''), p.email, p.id::text);
$$;

revoke all on function public.list_communication_centre_assignable_users() from public, anon;
grant execute on function public.list_communication_centre_assignable_users() to authenticated;

create or replace function public.list_communication_centre_assignable_roles()
returns table (
  role_key text,
  role_name text,
  display_name text,
  description text,
  is_active boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.role_key,
    r.role_name,
    r.role_name as display_name,
    r.description,
    r.is_active
  from public.roles r
  where coalesce(r.is_active, true) = true
  order by coalesce(nullif(r.role_name, ''), r.role_key);
$$;

revoke all on function public.list_communication_centre_assignable_roles() from public, anon;
grant execute on function public.list_communication_centre_assignable_roles() to authenticated;
