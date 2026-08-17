-- InCheck360 Communication Centre secure message mutation RPCs
--
-- Message table RLS intentionally remains SELECT-only. Mutations are performed
-- through SECURITY DEFINER RPCs that enforce conversation visibility, sender
-- ownership, non-system/non-deleted state, and the five-minute edit/delete window.

begin;

create or replace function public.edit_communication_centre_message_secure(
  p_message_id uuid,
  p_message_body text
)
returns public.communication_centre_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.cc_current_app_user_id();
  v_message public.communication_centre_messages;
  v_body text := btrim(coalesce(p_message_body, ''));
begin
  if v_actor is null then raise exception 'Authentication is required to edit a message'; end if;
  if v_body = '' then raise exception 'Updated message cannot be empty'; end if;

  select * into v_message
    from public.communication_centre_messages
   where id = p_message_id
   for update;

  if not found then raise exception 'Communication Centre message was not found'; end if;
  if not public.can_view_communication_centre_conversation(v_message.conversation_id) then raise exception 'Access denied'; end if;
  if v_message.sender_id is distinct from v_actor then raise exception 'Only the message sender can edit this message'; end if;
  if coalesce(v_message.is_system_message, false) then raise exception 'System messages cannot be edited'; end if;
  if coalesce(v_message.is_deleted, false) or v_message.deleted_at is not null then raise exception 'Deleted messages cannot be edited'; end if;
  if v_message.created_at < now() - interval '5 minutes' then raise exception 'Messages can only be edited within 5 minutes of sending'; end if;

  update public.communication_centre_messages
     set message_body = v_body,
         edited_at = now(),
         edited_by = v_actor,
         updated_at = now()
   where id = p_message_id
  returning * into v_message;

  if not exists (
    select 1 from public.communication_centre_messages newer
     where newer.conversation_id = v_message.conversation_id
       and newer.created_at > v_message.created_at
  ) then
    update public.communication_centre_conversations
       set last_message_preview = left(v_body, 240), updated_at = now()
     where id = v_message.conversation_id;
  end if;

  return v_message;
end;
$$;

create or replace function public.soft_delete_communication_centre_message_secure(
  p_message_id uuid
)
returns public.communication_centre_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.cc_current_app_user_id();
  v_message public.communication_centre_messages;
  v_preview text;
  v_last_at timestamptz;
begin
  if v_actor is null then raise exception 'Authentication is required to delete a message'; end if;

  select * into v_message
    from public.communication_centre_messages
   where id = p_message_id
   for update;

  if not found then raise exception 'Communication Centre message was not found'; end if;
  if not public.can_view_communication_centre_conversation(v_message.conversation_id) then raise exception 'Access denied'; end if;
  if v_message.sender_id is distinct from v_actor then raise exception 'Only the message sender can delete this message'; end if;
  if coalesce(v_message.is_system_message, false) then raise exception 'System messages cannot be deleted'; end if;
  if coalesce(v_message.is_deleted, false) or v_message.deleted_at is not null then return v_message; end if;
  if v_message.created_at < now() - interval '5 minutes' then raise exception 'Messages can only be deleted within 5 minutes of sending'; end if;

  update public.communication_centre_messages
     set is_deleted = true,
         deleted_at = now(),
         deleted_by = v_actor,
         updated_at = now()
   where id = p_message_id
  returning * into v_message;

  select left(coalesce(m.message_body, ''), 240), m.created_at
    into v_preview, v_last_at
    from public.communication_centre_messages m
   where m.conversation_id = v_message.conversation_id
     and coalesce(m.is_deleted, false) = false
   order by m.created_at desc
   limit 1;

  update public.communication_centre_conversations
     set last_message_preview = coalesce(nullif(v_preview, ''), 'Message deleted'),
         last_message_at = coalesce(v_last_at, updated_at),
         updated_at = now()
   where id = v_message.conversation_id;

  return v_message;
end;
$$;

revoke all on function public.edit_communication_centre_message_secure(uuid, text) from public;
grant execute on function public.edit_communication_centre_message_secure(uuid, text) to authenticated;
revoke all on function public.soft_delete_communication_centre_message_secure(uuid) from public;
grant execute on function public.soft_delete_communication_centre_message_secure(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
