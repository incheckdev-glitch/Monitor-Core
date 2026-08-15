-- InCheck360 credit-note RLS alignment
--
-- The production UI/API allows Admin, Accounting, Senior Financial Controller,
-- Financial Controller and General Manager role aliases to manage credit notes.
-- The live production financial E2E proved that the current credit_notes RLS
-- policy still rejects an authenticated Admin INSERT.
--
-- This migration aligns database RLS with the application permission matrix.
-- It grants authenticated financial roles SELECT / INSERT / UPDATE only.
-- Credit-note cancellation remains an UPDATE; direct DELETE is intentionally
-- not granted by this migration.
--
-- Safe to re-run. No existing credit-note data is modified.

begin;

create or replace function public.incheck360_credit_note_financial_role_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and coalesce(p.is_active, true) = true
       and lower(btrim(coalesce(p.role_key, ''))) in (
         'admin',
         'accounting',
         'accountant',
         'senior_financial_controller',
         'financial_controller',
         'senior_fc',
         'sfc',
         'general_manager',
         'gm'
       )
  );
$$;

revoke all on function public.incheck360_credit_note_financial_role_allowed() from public;
grant execute on function public.incheck360_credit_note_financial_role_allowed() to authenticated;

alter table if exists public.credit_notes enable row level security;

drop policy if exists credit_notes_financial_roles_select on public.credit_notes;
create policy credit_notes_financial_roles_select
on public.credit_notes
for select
to authenticated
using (public.incheck360_credit_note_financial_role_allowed());

drop policy if exists credit_notes_financial_roles_insert on public.credit_notes;
create policy credit_notes_financial_roles_insert
on public.credit_notes
for insert
to authenticated
with check (
  public.incheck360_credit_note_financial_role_allowed()
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists credit_notes_financial_roles_update on public.credit_notes;
create policy credit_notes_financial_roles_update
on public.credit_notes
for update
to authenticated
using (public.incheck360_credit_note_financial_role_allowed())
with check (public.incheck360_credit_note_financial_role_allowed());

commit;

notify pgrst, 'reload schema';
