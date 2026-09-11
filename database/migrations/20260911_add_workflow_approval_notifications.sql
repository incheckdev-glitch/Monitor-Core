-- Ensure every pending workflow approval creates an in-app notification for the approver role(s).
-- This also provides the RPC expected by supabase-data.js. Notification creation is
-- deduplicated by approval_id, so the insert trigger and frontend RPC can safely overlap.

create or replace function public.notify_workflow_approval_request(p_approval_id text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_approval public.workflow_approvals%rowtype;
  v_created integer := 0;
  v_label text;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  select wa.*
  into v_approval
  from public.workflow_approvals wa
  where wa.approval_id = trim(coalesce(p_approval_id, ''))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'approval_not_found');
  end if;

  if lower(coalesce(v_approval.status, '')) <> 'pending' then
    return jsonb_build_object('ok', true, 'created', 0, 'reason', 'approval_not_pending');
  end if;

  v_label := coalesce(
    nullif(trim(v_approval.record_reference), ''),
    nullif(trim(v_approval.record_id), ''),
    v_approval.approval_id
  );

  select count(*)::integer
  into v_created
  from public.create_notification_event(
    p_title => 'Approval request pending',
    p_message => format('%s requires your approval.', v_label),
    p_type => 'workflow_approval',
    p_resource => 'workflow',
    p_resource_id => v_approval.approval_id,
    p_priority => 'high',
    p_link_target => null,
    p_meta => jsonb_build_object(
      'action', 'approval_request',
      'approval_id', v_approval.approval_id,
      'approval_resource', v_approval.resource,
      'record_id', v_approval.record_id,
      'record_reference', v_approval.record_reference,
      'requester_user_id', v_approval.requester_user_id,
      'requester_role', v_approval.requester_role,
      'old_status', v_approval.old_status,
      'new_status', v_approval.new_status
    ),
    p_target_user_id => null,
    p_target_role => nullif(lower(trim(coalesce(v_approval.approval_role, ''))), ''),
    p_target_roles => v_approval.approval_roles,
    p_dedupe_key => 'workflow_approval_request:' || v_approval.approval_id
  );

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'approval_id', v_approval.approval_id
  );
end;
$function$;

create or replace function public.notify_workflow_approval_request_on_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if lower(coalesce(new.status, '')) = 'pending' then
    begin
      perform public.notify_workflow_approval_request(new.approval_id);
    exception when others then
      raise warning 'Unable to create workflow approval notification for %: %', new.approval_id, sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_notify_workflow_approval_request on public.workflow_approvals;
create trigger trg_notify_workflow_approval_request
after insert on public.workflow_approvals
for each row
execute function public.notify_workflow_approval_request_on_insert();

grant execute on function public.notify_workflow_approval_request(text) to authenticated;
