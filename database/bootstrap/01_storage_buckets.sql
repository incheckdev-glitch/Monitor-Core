-- InCheck360 clean master - storage buckets required by active modules.
-- Run after cloning the public schema into a NEW Supabase project.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('proposal-signed-documents','proposal-signed-documents',false,10485760,array['application/pdf']::text[]),
  ('agreement-signed-documents','agreement-signed-documents',false,10485760,array['application/pdf']::text[]),
  ('hr-employee-documents','hr-employee-documents',false,10485760,array['application/pdf']::text[]),
  ('company-documents','company-documents',false,20971520,array['application/pdf','image/png','image/jpeg','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]),
  ('ticket-attachments','ticket-attachments',false,26214400,null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Authenticated users can access these private ERP document buckets.
-- Application permissions remain the first authorization layer; customize these policies for stricter tenant rules if required.
do $$
declare bucket text;
begin
  foreach bucket in array array['proposal-signed-documents','agreement-signed-documents','hr-employee-documents','company-documents','ticket-attachments'] loop
    execute format('drop policy if exists %I on storage.objects', 'erp_auth_select_' || replace(bucket,'-','_'));
    execute format('drop policy if exists %I on storage.objects', 'erp_auth_insert_' || replace(bucket,'-','_'));
    execute format('drop policy if exists %I on storage.objects', 'erp_auth_update_' || replace(bucket,'-','_'));
    execute format('drop policy if exists %I on storage.objects', 'erp_auth_delete_' || replace(bucket,'-','_'));
    execute format('create policy %I on storage.objects for select to authenticated using (bucket_id = %L)', 'erp_auth_select_' || replace(bucket,'-','_'), bucket);
    execute format('create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L)', 'erp_auth_insert_' || replace(bucket,'-','_'), bucket);
    execute format('create policy %I on storage.objects for update to authenticated using (bucket_id = %L) with check (bucket_id = %L)', 'erp_auth_update_' || replace(bucket,'-','_'), bucket, bucket);
    execute format('create policy %I on storage.objects for delete to authenticated using (bucket_id = %L)', 'erp_auth_delete_' || replace(bucket,'-','_'), bucket);
  end loop;
end $$;
