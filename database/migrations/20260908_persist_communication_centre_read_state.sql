-- Persist per-user Communication Centre read state.
--
-- The frontend already calls mark_communication_centre_read() and
-- get_communication_centre_unread_counts(), but production previously had
-- neither RPC. The direct fallback could SELECT read receipts but could not
-- INSERT/UPDATE them because the table intentionally exposes only a SELECT
-- RLS policy. As a result, conversations became unread again after refresh.

create or replace function public.mark_communication_centre_read(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := public.cc_current_app_user_id();
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_conversation_id is null or not public.can_view_communication_centre_conversation(p_conversation_id) then
    raise exception 'Conversation not available';
  end if;

  insert into public.communication_centre_read_receipts (
    conversation_id,
    user_id,
    last_read_at,
    created_at,
    updated_at
  )
  values (
    p_conversation_id,
    v_user_id,
    v_now,
    v_now,
    v_now
  )
  on conflict (conversation_id, user_id)
  do update set
    last_read_at = greatest(public.communication_centre_read_receipts.last_read_at, excluded.last_read_at),
    updated_at = excluded.updated_at;

  return v_now;
end;
$$;

revoke all on function public.mark_communication_centre_read(uuid) from public;
grant execute on function public.mark_communication_centre_read(uuid) to authenticated, service_role;

create or replace function public.get_communication_centre_unread_counts(p_conversation_ids uuid[])
returns table (
  conversation_id uuid,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with current_user_ctx as (
    select public.cc_current_app_user_id() as user_id
  ),
  requested as (
    select distinct conversation_id
    from unnest(coalesce(p_conversation_ids, array[]::uuid[])) as requested_ids(conversation_id)
    where conversation_id is not null
  ),
  visible as (
    select r.conversation_id
    from requested r
    cross join current_user_ctx u
    where u.user_id is not null
      and public.can_view_communication_centre_conversation(r.conversation_id)
  ),
  receipts as (
    select rr.conversation_id, rr.last_read_at
    from public.communication_centre_read_receipts rr
    cross join current_user_ctx u
    where rr.user_id = u.user_id
      and rr.conversation_id in (select conversation_id from visible)
  )
  select
    v.conversation_id,
    count(m.id)::bigint as unread_count
  from visible v
  cross join current_user_ctx u
  left join receipts rr
    on rr.conversation_id = v.conversation_id
  left join public.communication_centre_messages m
    on m.conversation_id = v.conversation_id
   and coalesce(m.is_system_message, false) = false
   and coalesce(m.is_deleted, false) = false
   and m.sender_id is distinct from u.user_id
   and m.created_at > coalesce(rr.last_read_at, '-infinity'::timestamptz)
  group by v.conversation_id;
$$;

revoke all on function public.get_communication_centre_unread_counts(uuid[]) from public;
grant execute on function public.get_communication_centre_unread_counts(uuid[]) to authenticated, service_role;
