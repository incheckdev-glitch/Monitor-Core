-- InCheck360 proposal lifecycle lock compatibility
-- Allows a Sent proposal to receive the required customer/provider signatures
-- and transition to Accepted. Accepted/expired/rejected/converted proposals
-- remain locked except for signed-document metadata and the existing secure
-- admin-override transaction context.
-- Safe to re-run.

begin;

create or replace function public.enforce_accepted_proposal_lock()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_allowed_fields text[] := array[
    'signed_document_path',
    'signed_document_name',
    'signed_document_uploaded_at',
    'signed_document_uploaded_by',
    'updated_at',
    'updated_by'
  ];
begin
  -- Preserve the existing SECURITY DEFINER admin override behavior.
  if current_setting('app.admin_proposal_override', true) = 'on' then
    return new;
  end if;

  -- IMPORTANT: Sent is intentionally NOT locked. The normal proposal workflow
  -- must be able to add both sign dates and change Sent -> Accepted.
  if lower(coalesce(old.status::text, '')) in (
      'accepted',
      'expired',
      'rejected',
      'converted',
      'converted_to_agreement'
    )
    and (to_jsonb(new) - v_allowed_fields) is distinct from (to_jsonb(old) - v_allowed_fields)
  then
    raise exception 'This proposal is locked.';
  end if;

  return new;
end;
$$;

-- Recreate the trigger to guarantee it points at the corrected function.
drop trigger if exists trg_enforce_accepted_proposal_lock on public.proposals;
create trigger trg_enforce_accepted_proposal_lock
before update on public.proposals
for each row
execute function public.enforce_accepted_proposal_lock();

commit;

notify pgrst, 'reload schema';
