begin;

-- Existing active customers pre-date Client Lifecycle tracking. Do not show them as 0% implementation.
-- Their historical implementation is intentionally treated as not applicable to this new workflow.
update public.client_lifecycle_checklist cl
set status='not_applicable',
    notes=coalesce(cl.notes,'Legacy active client: implementation predates Client Lifecycle tracking.'),
    updated_at=now()
from public.client_lifecycle_profiles lp
where lp.id=cl.lifecycle_id
  and lp.stage='active_success'
  and cl.phase in ('handover','setup','configuration','training','go_live')
  and cl.status='not_started';

commit;
