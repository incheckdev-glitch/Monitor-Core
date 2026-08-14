-- InCheck360 clean master - remove retired schema objects after a schema-only clone.
-- Safe to re-run on the NEW target database.

begin;

-- Retired AI Assistant persistence.
drop table if exists public.ai_chat_messages cascade;
drop table if exists public.ai_chat_sessions cascade;

-- Retired public/electronic proposal/agreement signing audit tables.
drop table if exists public.proposal_guest_activity_logs cascade;
drop table if exists public.agreement_guest_activity_logs cascade;
drop table if exists public.agreement_internal_signatures cascade;

-- Retired E-Proposal / E-Agreement RPC functions.
do $$
declare r record;
begin
  for r in
    select n.nspname schema_name, p.proname function_name,
           pg_get_function_identity_arguments(p.oid) identity_args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and (
         p.proname like 'eproposal\_%' escape '\'
         or p.proname like 'eagreement\_%' escape '\'
         or p.proname in (
           'generate_e_proposal_link','disable_e_proposal_link','get_e_proposal_by_token',
           'accept_e_proposal','reject_e_proposal','log_e_proposal_activity',
           'agreement_internal_sign','normalize_agreement_signer_role','refresh_agreement_signature_status'
         )
       )
  loop
    execute format('drop function if exists %I.%I(%s) cascade', r.schema_name, r.function_name, r.identity_args);
  end loop;
end $$;

-- Keep ordinary/manual lifecycle fields used by the active app.
alter table if exists public.proposals
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by_name text,
  add column if not exists accepted_by_email text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;

alter table if exists public.agreements
  add column if not exists customer_signed_at timestamptz;

-- Remove retired E-Proposal columns.
alter table if exists public.proposals
  drop column if exists e_proposal_token,
  drop column if exists e_proposal_token_expires_at,
  drop column if exists e_proposal_link_enabled,
  drop column if exists e_proposal_generated_at,
  drop column if exists e_proposal_generated_by,
  drop column if exists e_proposal_accepted_comment,
  drop column if exists viewed_at,
  drop column if exists e_signature_type,
  drop column if exists e_signature_text,
  drop column if exists e_signature_image_data_url,
  drop column if exists e_signed_document_data_url,
  drop column if exists e_signed_document_file_name,
  drop column if exists e_signed_document_mime_type,
  drop column if exists e_signature_signed_at,
  drop column if exists e_signature_customer_name,
  drop column if exists e_signature_customer_email,
  drop column if exists e_signature_ip_address,
  drop column if exists e_signature_confirmed;

-- Remove retired E-Agreement public/customer electronic-signature columns.
alter table if exists public.agreements
  drop column if exists accepted_at,
  drop column if exists customer_signature_date,
  drop column if exists e_agreement_token,
  drop column if exists e_agreement_token_expires_at,
  drop column if exists e_agreement_link_enabled,
  drop column if exists e_agreement_generated_at,
  drop column if exists e_agreement_generated_by,
  drop column if exists e_agreement_viewed_at,
  drop column if exists e_agreement_accepted_at,
  drop column if exists e_agreement_accepted_by_name,
  drop column if exists e_agreement_accepted_by_email,
  drop column if exists e_agreement_accepted_comment,
  drop column if exists e_agreement_rejected_at,
  drop column if exists e_agreement_rejection_reason,
  drop column if exists e_agreement_signature_type,
  drop column if exists e_agreement_signature_text,
  drop column if exists e_agreement_signature_image_data_url,
  drop column if exists e_agreement_signed_document_data_url,
  drop column if exists e_agreement_signed_document_file_name,
  drop column if exists e_agreement_signed_document_mime_type,
  drop column if exists e_agreement_signature_signed_at,
  drop column if exists e_agreement_signature_customer_name,
  drop column if exists e_agreement_signature_customer_email,
  drop column if exists e_agreement_signature_ip_address,
  drop column if exists e_agreement_signature_confirmed,
  drop column if exists customer_signature_confirmed,
  drop column if exists customer_accepted_at,
  drop column if exists customer_signed_by_name,
  drop column if exists customer_signed_by_email,
  drop column if exists customer_signature_type,
  drop column if exists customer_signature_text,
  drop column if exists customer_signature_image_data_url,
  drop column if exists customer_signed_document_data_url,
  drop column if exists customer_signed_document_file_name,
  drop column if exists customer_signed_document_mime_type,
  drop column if exists customer_signature_ip_address,
  drop column if exists e_signature_type,
  drop column if exists e_signature_text,
  drop column if exists e_signature_image_data_url,
  drop column if exists e_signed_document_data_url,
  drop column if exists e_signed_document_file_name,
  drop column if exists e_signed_document_mime_type,
  drop column if exists e_signature_signed_at,
  drop column if exists e_signature_customer_name,
  drop column if exists e_signature_customer_email,
  drop column if exists e_signature_ip_address,
  drop column if exists e_signature_confirmed;

notify pgrst, 'reload schema';
commit;
