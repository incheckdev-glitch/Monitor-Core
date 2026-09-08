-- Fix ERP in-app notification visibility and Communication Centre reply notifications.
-- Applied to the Monitor Core Supabase project on 2026-09-08.
--
-- Root causes:
-- 1. public.notifications had RLS enabled but no SELECT/UPDATE policies, so signed-in
--    users could not read or mark their own bell / Notification Hub rows as read.
-- 2. Communication Centre reply notification creation depended on a secondary browser
--    dispatch after the message write. The durable message RPC itself did not create a
--    notification, so saved replies could exist with no corresponding notification row.

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
on public.notifications
for select
to authenticated
using (
  (select auth.uid()) = recipient_user_id
  or (select auth.uid()) = target_user_id
  or (select auth.uid()) = user_id
);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
on public.notifications
for update
to authenticated
using (
  (select auth.uid()) = recipient_user_id
  or (select auth.uid()) = target_user_id
  or (select auth.uid()) = user_id
)
with check (
  (select auth.uid()) = recipient_user_id
  or (select auth.uid()) = target_user_id
  or (select auth.uid()) = user_id
);

-- Generate reply notifications in the same database transaction as the message insert.
-- The first message in a conversation is excluded because conversation_created has its
-- own notification rule. A notification failure must never prevent the message itself
-- from being saved.
create or replace function public.notify_communication_centre_reply_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior_count integer := 0;
  v_conversation record;
  v_rule record;
  v_recipient_ids text[] := array[]::text[];
  v_channels text[] := array[]::text[];
  v_payload jsonb;
  v_link text;
  v_body text;
begin
  if coalesce(new.is_system_message, false) or coalesce(new.is_deleted, false) then
    return new;
  end if;

  select count(*)
    into v_prior_count
    from public.communication_centre_messages m
   where m.conversation_id = new.conversation_id
     and m.id <> new.id
     and coalesce(m.is_deleted, false) = false;

  if v_prior_count < 1 then
    return new;
  end if;

  select c.conversation_no, c.title, c.related_module, c.related_record_id
    into v_conversation
    from public.communication_centre_conversations c
   where c.id = new.conversation_id;

  if not found then
    return new;
  end if;

  select r.*
    into v_rule
    from public.notification_rules r
   where lower(coalesce(r.resource, '')) = 'communication_centre'
     and lower(coalesce(r.action, '')) = 'reply_added'
     and coalesce(r.is_enabled, true) = true
     and coalesce(r.is_active, true) = true
   order by coalesce(r.priority, 0) desc, r.updated_at desc nulls last
   limit 1;

  if not found then
    return new;
  end if;

  select coalesce(
           array_agg(x.recipient_user_id::text) filter (where x.recipient_user_id is not null),
           array[]::text[]
         )
    into v_recipient_ids
    from public.resolve_communication_centre_notification_recipients(
      new.conversation_id::text,
      new.sender_id,
      coalesce(nullif(v_rule.recipient_mode, ''), 'participants_except_actor')
    ) x;

  if coalesce(array_length(v_recipient_ids, 1), 0) = 0 then
    return new;
  end if;

  if coalesce(v_rule.in_app_enabled, true) then
    v_channels := array_append(v_channels, 'in_app');
  end if;
  if coalesce(v_rule.pwa_enabled, false) then
    v_channels := array_append(v_channels, 'pwa');
  end if;
  if coalesce(v_rule.email_enabled, false) then
    v_channels := array_append(v_channels, 'email');
  end if;

  if coalesce(array_length(v_channels, 1), 0) = 0 then
    return new;
  end if;

  v_link := '/#communication_centre?conversation_id=' || new.conversation_id::text;
  v_body := concat(
    coalesce(nullif(new.sender_name, ''), 'A participant'),
    ' replied in ',
    coalesce(nullif(v_conversation.conversation_no, ''), nullif(v_conversation.title, ''), 'a conversation'),
    case
      when nullif(trim(coalesce(new.message_body, '')), '') is not null
        then ': ' || left(trim(new.message_body), 240)
      else ''
    end
  );

  v_payload := jsonb_build_object(
    'title', 'New Communication Centre reply',
    'body', v_body,
    'message', v_body,
    'resource', 'communication_centre',
    'action', 'reply_added',
    'record_id', new.conversation_id::text,
    'conversation_id', new.conversation_id::text,
    'conversation_no', v_conversation.conversation_no,
    'conversation_title', v_conversation.title,
    'related_module', v_conversation.related_module,
    'related_record_id', v_conversation.related_record_id,
    'actor_user_id', new.sender_id,
    'actor_name', new.sender_name,
    'message_id', new.id::text,
    'message_preview', left(coalesce(new.message_body, ''), 240),
    'channels', to_jsonb(v_channels),
    'url', v_link,
    'deep_link', v_link
  );

  perform 1
    from public.dispatch_notification(
      coalesce(nullif(v_rule.event_key, ''), 'communication_centre.reply_added'),
      v_recipient_ids,
      v_payload,
      'communication_centre',
      new.conversation_id::text,
      v_link
    );

  return new;
exception
  when others then
    raise warning 'Communication Centre reply notification failed for message %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_communication_centre_reply_insert() from public;
revoke all on function public.notify_communication_centre_reply_insert() from anon;
revoke all on function public.notify_communication_centre_reply_insert() from authenticated;

drop trigger if exists trg_notify_communication_centre_reply_insert on public.communication_centre_messages;
create trigger trg_notify_communication_centre_reply_insert
after insert on public.communication_centre_messages
for each row
execute function public.notify_communication_centre_reply_insert();
