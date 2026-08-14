-- Run with psql variable admin_email after creating that user in Supabase Auth.
-- Example: psql "$TARGET_DATABASE_URL" -v admin_email='admin@example.com' -f database/seeds/02_bootstrap_admin_profile.sql

insert into public.profiles (id, name, email, username, role_key, is_active)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'full_name',''), nullif(u.raw_user_meta_data->>'name',''), split_part(u.email,'@',1)),
  lower(u.email),
  coalesce(nullif(u.raw_user_meta_data->>'username',''), split_part(u.email,'@',1)),
  'admin',
  true
from auth.users u
where lower(u.email) = lower(:'admin_email')
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  username = excluded.username,
  role_key = 'admin',
  is_active = true;
