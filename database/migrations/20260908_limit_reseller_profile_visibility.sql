-- External reseller users may read only their own profile. Internal authenticated roles keep the existing directory read behavior.
drop policy if exists profiles_authenticated_read on public.profiles;
drop policy if exists profiles_authenticated_scoped_read on public.profiles;
create policy profiles_authenticated_scoped_read on public.profiles
for select to authenticated
using (
  public.current_app_role() <> 'reseller_user'
  or id = auth.uid()
);
