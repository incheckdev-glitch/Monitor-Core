-- Secure self-service user profile support.

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists avatar_kind text not null default 'initials';
alter table public.profiles add column if not exists avatar_value text;
alter table public.profiles add column if not exists avatar_path text;

alter table public.profiles drop constraint if exists profiles_avatar_kind_check;
alter table public.profiles add constraint profiles_avatar_kind_check
  check (avatar_kind in ('initials','preset','upload'));

-- Replace broad self-update access with admin/dev direct writes only.
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_admin_dev_update on public.profiles;
create policy profiles_admin_dev_update on public.profiles
for update to authenticated
using (public.current_app_role() = any(array['admin'::text,'dev'::text]))
with check (public.current_app_role() = any(array['admin'::text,'dev'::text]));

create or replace function public.update_my_profile(
  p_full_name text default null,
  p_username text default null,
  p_department text default null,
  p_job_title text default null,
  p_phone text default null,
  p_avatar_kind text default 'initials',
  p_avatar_value text default null,
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
  avatar_path text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path=public,pg_temp
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
  clean_path text := nullif(btrim(coalesce(p_avatar_path,'')),'');
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if clean_name is null or char_length(clean_name) < 2 or char_length(clean_name) > 120 then
    raise exception 'Full name must be between 2 and 120 characters';
  end if;
  if clean_username is not null and char_length(clean_username) > 60 then raise exception 'Username is too long'; end if;
  if clean_department is not null and char_length(clean_department) > 100 then raise exception 'Department is too long'; end if;
  if clean_job_title is not null and char_length(clean_job_title) > 120 then raise exception 'Job title is too long'; end if;
  if clean_phone is not null and char_length(clean_phone) > 40 then raise exception 'Phone is too long'; end if;
  if clean_kind not in ('initials','preset','upload') then raise exception 'Invalid avatar type'; end if;
  if clean_kind='preset' and clean_value not in ('person','business','tech','quality','operations','finance','support','rocket') then
    raise exception 'Invalid preset avatar';
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
      avatar_path=case when clean_kind='upload' then clean_path else null end,
      updated_at=now()
  where p.id=uid;

  if not found then raise exception 'User profile not found'; end if;

  return query
  select p.id,p.name,p.full_name,p.email,p.username,p.role_key,p.role,p.department,p.job_title,p.phone,p.is_active,
         p.avatar_kind,p.avatar_value,p.avatar_path,p.updated_at
  from public.profiles p where p.id=uid;
end;
$$;

revoke all on function public.update_my_profile(text,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.update_my_profile(text,text,text,text,text,text,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-avatars','profile-avatars',false,5242880,array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set
  public=false,
  file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp']::text[];

drop policy if exists profile_avatars_select_own on storage.objects;
create policy profile_avatars_select_own on storage.objects
for select to authenticated
using (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists profile_avatars_insert_own on storage.objects;
create policy profile_avatars_insert_own on storage.objects
for insert to authenticated
with check (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists profile_avatars_update_own on storage.objects;
create policy profile_avatars_update_own on storage.objects
for update to authenticated
using (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists profile_avatars_delete_own on storage.objects;
create policy profile_avatars_delete_own on storage.objects
for delete to authenticated
using (bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
