-- Restore sales/management permissions that existed in the pre-clean ERP.
-- The clean-master permission seed intentionally simplified historical role behavior;
-- this migration restores the operational Sales / Head of Sales matrix without
-- granting HR/accounting administration to sales roles.

with restored(role_key, resource, action) as (
  values
    -- Head of Sales: sales management lifecycle.
    ('head_of_sales','companies','list'),
    ('head_of_sales','companies','get'),
    ('head_of_sales','companies','view'),
    ('head_of_sales','companies','create'),
    ('head_of_sales','companies','update'),
    ('head_of_sales','companies','export'),
    ('head_of_sales','company_documents','list'),
    ('head_of_sales','company_documents','get'),
    ('head_of_sales','company_documents','create'),
    ('head_of_sales','company_documents','update'),
    ('head_of_sales','contacts','list'),
    ('head_of_sales','contacts','get'),
    ('head_of_sales','contacts','create'),
    ('head_of_sales','contacts','update'),
    ('head_of_sales','contacts','export'),
    ('head_of_sales','leads','list'),
    ('head_of_sales','leads','get'),
    ('head_of_sales','leads','view'),
    ('head_of_sales','leads','create'),
    ('head_of_sales','leads','update'),
    ('head_of_sales','leads','delete'),
    ('head_of_sales','leads','convert'),
    ('head_of_sales','leads','convert_to_deal'),
    ('head_of_sales','leads','export'),
    ('head_of_sales','deals','list'),
    ('head_of_sales','deals','get'),
    ('head_of_sales','deals','view'),
    ('head_of_sales','deals','create'),
    ('head_of_sales','deals','update'),
    ('head_of_sales','deals','delete'),
    ('head_of_sales','deals','export'),
    ('head_of_sales','proposal_catalog','list'),
    ('head_of_sales','proposal_catalog','get'),
    ('head_of_sales','proposals','list'),
    ('head_of_sales','proposals','get'),
    ('head_of_sales','proposals','view'),
    ('head_of_sales','proposals','create'),
    ('head_of_sales','proposals','update'),
    ('head_of_sales','proposals','delete'),
    ('head_of_sales','proposals','create_from_deal'),
    ('head_of_sales','proposals','generate_proposal_html'),
    ('head_of_sales','proposals','preview'),
    ('head_of_sales','proposals','export'),
    ('head_of_sales','agreements','list'),
    ('head_of_sales','agreements','get'),
    ('head_of_sales','agreements','view'),
    ('head_of_sales','agreements','create'),
    ('head_of_sales','agreements','update'),
    ('head_of_sales','agreements','delete'),
    ('head_of_sales','agreements','create_from_proposal'),
    ('head_of_sales','agreements','generate_agreement_html'),
    ('head_of_sales','agreements','preview'),
    ('head_of_sales','agreements','export'),
    ('head_of_sales','clients','list'),
    ('head_of_sales','clients','get'),
    ('head_of_sales','clients','view_renewals'),
    ('head_of_sales','clients','view_statement'),
    ('head_of_sales','clients','statement_view'),
    ('head_of_sales','clients','statement_export'),
    ('head_of_sales','invoices','list'),
    ('head_of_sales','invoices','get'),
    ('head_of_sales','invoices','view'),
    ('head_of_sales','invoices','generate_invoice_html'),
    ('head_of_sales','receipts','list'),
    ('head_of_sales','receipts','get'),
    ('head_of_sales','receipts','view'),
    ('head_of_sales','receipts','generate_receipt_html'),
    ('head_of_sales','credit_notes','view'),
    ('head_of_sales','credit_notes','list'),
    ('head_of_sales','credit_notes','get'),
    ('head_of_sales','credit_notes','print'),
    ('head_of_sales','workflow','list'),
    ('head_of_sales','workflow','get'),
    ('head_of_sales','workflow','view'),
    ('head_of_sales','workflow','request_approval'),
    ('head_of_sales','workflow','approve'),
    ('head_of_sales','workflow','reject'),
    ('head_of_sales','workflow','list_pending_approvals'),
    ('head_of_sales','workflow','list_audit'),
    ('head_of_sales','notifications','list'),
    ('head_of_sales','notifications','get_unread_count'),
    ('head_of_sales','notifications','mark_read'),
    ('head_of_sales','notifications','mark_all_read'),

    -- Sales Executive: operational sales lifecycle.
    ('sales_executive','companies','list'),
    ('sales_executive','companies','get'),
    ('sales_executive','companies','view'),
    ('sales_executive','companies','create'),
    ('sales_executive','company_documents','list'),
    ('sales_executive','company_documents','get'),
    ('sales_executive','company_documents','create'),
    ('sales_executive','contacts','list'),
    ('sales_executive','contacts','get'),
    ('sales_executive','contacts','create'),
    ('sales_executive','contacts','update'),
    ('sales_executive','leads','list'),
    ('sales_executive','leads','get'),
    ('sales_executive','leads','view'),
    ('sales_executive','leads','create'),
    ('sales_executive','leads','update'),
    ('sales_executive','leads','delete'),
    ('sales_executive','leads','convert'),
    ('sales_executive','leads','convert_to_deal'),
    ('sales_executive','deals','list'),
    ('sales_executive','deals','get'),
    ('sales_executive','deals','view'),
    ('sales_executive','deals','create'),
    ('sales_executive','deals','update'),
    ('sales_executive','deals','delete'),
    ('sales_executive','proposal_catalog','list'),
    ('sales_executive','proposal_catalog','get'),
    ('sales_executive','proposals','list'),
    ('sales_executive','proposals','get'),
    ('sales_executive','proposals','view'),
    ('sales_executive','proposals','create'),
    ('sales_executive','proposals','update'),
    ('sales_executive','proposals','delete'),
    ('sales_executive','proposals','create_from_deal'),
    ('sales_executive','proposals','generate_proposal_html'),
    ('sales_executive','proposals','preview'),
    ('sales_executive','agreements','list'),
    ('sales_executive','agreements','get'),
    ('sales_executive','agreements','view'),
    ('sales_executive','agreements','create'),
    ('sales_executive','agreements','update'),
    ('sales_executive','agreements','create_from_proposal'),
    ('sales_executive','agreements','generate_agreement_html'),
    ('sales_executive','agreements','preview'),
    ('sales_executive','clients','list'),
    ('sales_executive','clients','get'),
    ('sales_executive','invoices','list'),
    ('sales_executive','invoices','get'),
    ('sales_executive','invoices','view'),
    ('sales_executive','invoices','generate_invoice_html'),
    ('sales_executive','receipts','list'),
    ('sales_executive','receipts','get'),
    ('sales_executive','receipts','view'),
    ('sales_executive','receipts','generate_receipt_html'),
    ('sales_executive','credit_notes','view'),
    ('sales_executive','credit_notes','list'),
    ('sales_executive','credit_notes','get'),
    ('sales_executive','credit_notes','print'),
    ('sales_executive','workflow','list'),
    ('sales_executive','workflow','get'),
    ('sales_executive','workflow','view'),
    ('sales_executive','workflow','request_approval'),
    ('sales_executive','workflow','list_pending_approvals'),
    ('sales_executive','notifications','list'),
    ('sales_executive','notifications','get_unread_count'),
    ('sales_executive','notifications','mark_read'),
    ('sales_executive','notifications','mark_all_read'),

    -- Historical invoice-to-onboarding grants.
    ('sales_executive','operations_onboarding','create'),
    ('sales_executive','operations_onboarding','list'),
    ('sales_executive','operations_onboarding','get'),
    ('sales_executive','operations_onboarding','update'),
    ('sales_executive','technical_admin_requests','create'),
    ('sales_executive','technical_admin_requests','list'),
    ('sales_executive','technical_admin_requests','get'),
    ('accounting','operations_onboarding','create'),
    ('accounting','operations_onboarding','list'),
    ('accounting','operations_onboarding','get'),
    ('accounting','operations_onboarding','update'),
    ('accounting','technical_admin_requests','create'),
    ('accounting','technical_admin_requests','list'),
    ('accounting','technical_admin_requests','get'),

    -- Historical Credit Note matrix: operational roles could read/print;
    -- Developer also retained accounting-document write actions.
    ('dev','credit_notes','view'),
    ('dev','credit_notes','list'),
    ('dev','credit_notes','get'),
    ('dev','credit_notes','create'),
    ('dev','credit_notes','cancel'),
    ('dev','credit_notes','print'),
    ('dev','credit_notes','export'),
    ('viewer','credit_notes','view'),
    ('viewer','credit_notes','list'),
    ('viewer','credit_notes','get'),
    ('viewer','credit_notes','print'),
    ('hoo','credit_notes','view'),
    ('hoo','credit_notes','list'),
    ('hoo','credit_notes','get'),
    ('hoo','credit_notes','print'),
    ('csm','credit_notes','view'),
    ('csm','credit_notes','list'),
    ('csm','credit_notes','get'),
    ('csm','credit_notes','print')
)
insert into public.role_permissions(
  permission_id, role_key, resource, action, is_allowed, is_active, allowed_roles, created_at, updated_at
)
select gen_random_uuid(), r.role_key, r.resource, r.action, true, true, array[r.role_key]::text[], now(), now()
from restored r
join public.roles roles on roles.role_key = r.role_key
on conflict (role_key, resource, action)
do update set
  is_allowed = true,
  is_active = true,
  allowed_roles = excluded.allowed_roles,
  updated_at = now();

-- Preserve old operational read access to Credit Notes without opening write
-- actions to non-finance roles.
create or replace function public.incheck360_credit_note_read_role_allowed()
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and coalesce(p.is_active, true) = true
       and lower(btrim(coalesce(p.role_key, ''))) in (
         'admin','dev','viewer','hoo','csm','sales_executive','head_of_sales',
         'accounting','accountant','senior_financial_controller','financial_controller',
         'senior_fc','sfc','general_manager','gm'
       )
  );
$$;

create or replace function public.incheck360_credit_note_financial_role_allowed()
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and coalesce(p.is_active, true) = true
       and lower(btrim(coalesce(p.role_key, ''))) in (
         'admin','dev','accounting','accountant','senior_financial_controller',
         'financial_controller','senior_fc','sfc','general_manager','gm'
       )
  );
$$;

drop policy if exists credit_notes_financial_roles_select on public.credit_notes;
create policy credit_notes_financial_roles_select
on public.credit_notes for select
to authenticated
using (public.incheck360_credit_note_read_role_allowed());

notify pgrst, 'reload schema';
