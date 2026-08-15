-- InCheck360 production write runtime alignment
-- Fixes schema mismatches exposed by the live production write E2E.
-- Safe to re-run.

begin;

-- --------------------------------------------------------------------------
-- 1) Invoice payment schedule compatibility
-- --------------------------------------------------------------------------
-- supabase-data.js writes and reads schedule_label for automatic/manual plans.
alter table if exists public.invoice_payment_schedule
  add column if not exists schedule_label text;

-- The runtime schedule recalculation accepts legacy total aliases in addition to
-- the canonical invoice_total. Keep the aliases synchronized so PostgREST can
-- select them without schema-cache errors and they never diverge from invoice_total.
alter table if exists public.invoices
  add column if not exists grand_total numeric(14,2),
  add column if not exists total_amount numeric(14,2);

update public.invoices
set
  grand_total = invoice_total,
  total_amount = invoice_total
where grand_total is distinct from invoice_total
   or total_amount is distinct from invoice_total;

create or replace function public.sync_invoice_total_compatibility_aliases()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.grand_total := new.invoice_total;
  new.total_amount := new.invoice_total;
  return new;
end;
$$;

drop trigger if exists trg_sync_invoice_total_compatibility_aliases on public.invoices;
create trigger trg_sync_invoice_total_compatibility_aliases
before insert or update of invoice_total, grand_total, total_amount
on public.invoices
for each row
execute function public.sync_invoice_total_compatibility_aliases();

-- --------------------------------------------------------------------------
-- 2) Operations onboarding compatibility
-- --------------------------------------------------------------------------
-- The invoice-batch onboarding path includes these useful source snapshots.
-- They were being removed by the schema-retry layer because the current DB did
-- not yet contain the columns.
alter table if exists public.operations_onboarding
  add column if not exists company_name text,
  add column if not exists source_agreement_id text;

commit;

-- Refresh PostgREST so the new columns are immediately visible to the app.
notify pgrst, 'reload schema';
