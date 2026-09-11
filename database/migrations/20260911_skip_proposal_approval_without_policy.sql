-- Proposal approvals must never be created from hard-coded fallback thresholds.
-- If no active Proposal workflow policy exists, approval is not required.

create or replace function public.create_workflow_approval(p_resource text, p_record_id text, p_workflow_rule_id uuid default null::uuid, p_requester_user_id uuid default null::uuid, p_requester_role text default null::text, p_approval_role text default null::text, p_old_status text default null::text, p_new_status text default null::text, p_requested_changes jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a public.workflow_approvals;
  v_role text;
  v_rule_id uuid;
begin
  if lower(trim(coalesce(p_resource, ''))) in ('proposal','proposals') then
    if p_workflow_rule_id is not null then
      select wr.id into v_rule_id from public.workflow_rules wr
      where wr.id = p_workflow_rule_id and coalesce(wr.is_active, true) = true
        and lower(trim(coalesce(wr.resource, ''))) in ('proposal','proposals') limit 1;
    else
      select wr.id into v_rule_id from public.workflow_rules wr
      where coalesce(wr.is_active, true) = true
        and lower(trim(coalesce(wr.resource, ''))) in ('proposal','proposals')
        and (nullif(trim(coalesce(wr.current_status, '')), '') is null or lower(trim(wr.current_status)) = lower(trim(coalesce(p_old_status, ''))))
        and (nullif(trim(coalesce(wr.next_status, '')), '') is null or lower(trim(wr.next_status)) = lower(trim(coalesce(p_new_status, ''))))
      order by wr.created_at desc limit 1;
    end if;
    if v_rule_id is null then
      return jsonb_build_object('ok',true,'created',false,'reused',false,'skipped',true,'no_policy',true,'approval_id','','approval_role','','status','not_required','resource',p_resource,'record_id',p_record_id);
    end if;
    p_workflow_rule_id := v_rule_id;
  end if;

  v_role := coalesce(nullif(lower(trim(p_approval_role)), ''), 'admin');
  select * into a from public.workflow_approvals
  where resource=p_resource and record_id=p_record_id and status='pending'
    and lower(coalesce(approval_role,''))=v_role order by created_at desc limit 1;
  if found then
    return jsonb_build_object('ok',true,'created',false,'reused',true,'approval_id',coalesce(a.approval_id,a.id::text),'approval_role',a.approval_role,'status',a.status,'resource',a.resource,'record_id',a.record_id);
  end if;

  insert into public.workflow_approvals(approval_id,resource,record_id,workflow_rule_id,requester_user_id,requester_role,approval_role,approval_roles,old_status,new_status,requested_changes,status,requested_at)
  values('WFA/'||to_char(current_date,'YYYY')||'/'||lpad((select count(*)+1 from public.workflow_approvals)::text,5,'0'),p_resource,p_record_id,p_workflow_rule_id,coalesce(p_requester_user_id,auth.uid()),coalesce(p_requester_role,public.current_app_role()),v_role,array[v_role],p_old_status,p_new_status,coalesce(p_requested_changes,'{}'::jsonb),'pending',now()) returning * into a;
  return jsonb_build_object('ok',true,'created',true,'reused',false,'approval_id',coalesce(a.approval_id,a.id::text),'approval_role',a.approval_role,'status',a.status,'resource',a.resource,'record_id',a.record_id);
end
$function$;
