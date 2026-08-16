-- InCheck360 Communication Centre current application user helper restore
--
-- The live secure Communication Centre RPCs (visibility, reply, close, reopen)
-- call public.cc_current_app_user_id(), but production currently does not expose
-- that helper. Communication Centre participant rows use the authenticated
-- profile UUID, which is the same UUID returned by auth.uid().
--
-- Safe to re-run. No business rows are modified.

begin;

create or replace function public.cc_current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.profiles p
   where p.id = auth.uid()
     and coalesce(p.is_active, true)
   limit 1
$$;

revoke all on function public.cc_current_app_user_id() from public;
grant execute on function public.cc_current_app_user_id() to authenticated;

commit;

notify pgrst, 'reload schema';
