-- InCheck360 credit-note RLS compatibility
--
-- The application permission matrix allows credit-note creation/cancellation for
-- admin, accounting, sfc and gm, but production RLS can still reject direct
-- authenticated inserts/updates. This patch adds narrowly scoped policies that
-- honor the existing role_permissions table instead of opening the table broadly.
--
-- Safe to re-run. Existing credit notes are not modified.

begin;

create or replace function public.crm_user_has_resource_permission(
  p_resource text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
      join public.role_permissions rp
        on rp.role_key = p.role_key
     where p.id = auth.uid()
       and coalesce(p.is_active, true)
       and rp.resource = p_resource
       and rp.action = p_action
       and coalesce(rp.is_allowed, false)
       and coalesce(rp.is_active, true)
  );
$$;

revoke all on function public.crm_user_has_resource_permission(text, text) from public;
grant execute on function public.crm_user_has_resource_permission(text, text) to authenticated;

alter table if exists public.credit_notes enable row level security;

drop policy if exists credit_notes_permission_insert on public.credit_notes;
create policy credit_notes_permission_insert
  on public.credit_notes
  for insert
  to authenticated
  with check (
    public.crm_user_has_resource_permission('credit_notes', 'create')
  );

drop policy if exists credit_notes_permission_update on public.credit_notes;
create policy credit_notes_permission_update
  on public.credit_notes
  for update
  to authenticated
  using (
    public.crm_user_has_resource_permission('credit_notes', 'create')
    or public.crm_user_has_resource_permission('credit_notes', 'cancel')
  )
  with check (
    public.crm_user_has_resource_permission('credit_notes', 'create')
    or public.crm_user_has_resource_permission('credit_notes', 'cancel')
  );

commit;

notify pgrst, 'reload schema';
