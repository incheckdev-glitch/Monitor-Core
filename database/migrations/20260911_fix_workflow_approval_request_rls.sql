-- Allow users who are explicitly permitted to request approvals to create
-- workflow approval rows. The previous RLS policy only checked workflow
-- create/manage permissions, which blocked sales_executive/head_of_sales even
-- though those roles have workflow.request_approval permission.

alter policy incheck360_core_insert_workflow_approvals
on public.workflow_approvals
to authenticated
with check (
  (current_app_role() = any (array['admin'::text, 'dev'::text]))
  or app_has_permission('workflow'::text, 'request_approval'::text)
  or app_has_permission('workflow'::text, 'create'::text)
  or app_has_permission('workflow'::text, 'manage'::text)
  or app_has_permission('workflow'::text, 'manage_all'::text)
);
