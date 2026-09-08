-- Modern illustrated avatar themes for self-service user profiles.

alter table public.profiles
  add column if not exists avatar_color text not null default 'blue';

alter table public.profiles
  drop constraint if exists profiles_avatar_color_check;

alter table public.profiles
  add constraint profiles_avatar_color_check
  check (avatar_color in ('blue','navy','teal','green','purple','orange'));

create or replace function public.update_my_profile_v2(
  p_full_name text default null,
  p_username text default null,
  p_department text default null,
  p_job_title text default null,
  p_phone text default null,
  p_avatar_kind text default 'initials',
  p_avatar_value text default null,
  p_avatar_color text default 'blue',
  p_avatar_path text default null
)
returns table(
  id uuid,
  name text,
  full_name text,
  email text,
  username text,
  role_key text,
  role text,
  department text,
  job_title text,
  phone text,
  is_active boolean,
  avatar_kind text,
  avatar_value text,
  avatar_color text,
  avatar_path text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  uid uuid := auth.uid();
  clean_name text := nullif(btrim(coalesce(p_full_name,'')),'');
  clean_username text := nullif(btrim(coalesce(p_username,'')),'');
  clean_department text := nullif(btrim(coalesce(p_department,'')),'');
  clean_job_title text := nullif(btrim(coalesce(p_job_title,'')),'');
  clean_phone text := nullif(btrim(coalesce(p_phone,'')),'');
  clean_kind text := lower(btrim(coalesce(p_avatar_kind,'initials')));
  clean_value text := nullif(btrim(coalesce(p_avatar_value,'')),'');
  clean_color text := lower(btrim(coalesce(p_avatar_color,'blue')));
  clean_path text := nullif(btrim(coalesce(p_avatar_path,'')),'');
begin
  if uid is null then
    raise exception 'Authentication required';
  end if;

  if clean_name is null or char_length(clean_name) < 2 or char_length(clean_name) > 120 then
    raise exception 'Full name must be between 2 and 120 characters';
  end if;
  if clean_username is not null and char_length(clean_username) > 60 then raise exception 'Username is too long'; end if;
  if clean_department is not null and char_length(clean_department) > 100 then raise exception 'Department is too long'; end if;
  if clean_job_title is not null and char_length(clean_job_title) > 120 then raise exception 'Job title is too long'; end if;
  if clean_phone is not null and char_length(clean_phone) > 40 then raise exception 'Phone is too long'; end if;

  if clean_kind not in ('initials','preset','upload') then
    raise exception 'Invalid avatar type';
  end if;

  if clean_color not in ('blue','navy','teal','green','purple','orange') then
    raise exception 'Invalid avatar color';
  end if;

  if clean_kind='preset' and clean_value not in (
    'exec_male','modern_beard','tech_glasses','clean_cut',
    'casual_male','minimal_male','professional_female','female_glasses',
    'executive_female','casual_female','minimal_female','creative_female',
    'neutral_modern_1','neutral_modern_2','creative_neutral','minimal_neutral'
  ) then
    raise exception 'Invalid illustrated avatar';
  end if;

  if clean_kind='upload' and (clean_path is null or clean_path not like uid::text || '/%') then
    raise exception 'Invalid avatar file path';
  end if;

  update public.profiles p
  set full_name=clean_name,
      name=clean_name,
      username=clean_username,
      department=clean_department,
      job_title=clean_job_title,
      phone=clean_phone,
      avatar_kind=clean_kind,
      avatar_value=case when clean_kind='preset' then clean_value else null end,
      avatar_color=clean_color,
      avatar_path=case when clean_kind='upload' then clean_path else null end,
      updated_at=now()
  where p.id=uid;

  if not found then
    raise exception 'User profile not found';
  end if;

  return query
  select p.id,p.name,p.full_name,p.email,p.username,p.role_key,p.role,p.department,p.job_title,p.phone,p.is_active,
         p.avatar_kind,p.avatar_value,p.avatar_color,p.avatar_path,p.updated_at
  from public.profiles p
  where p.id=uid;
end;
$$;

revoke all on function public.update_my_profile_v2(text,text,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.update_my_profile_v2(text,text,text,text,text,text,text,text,text) to authenticated;
