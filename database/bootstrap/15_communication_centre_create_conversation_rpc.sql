-- InCheck360 Communication Centre create-conversation RPC restore
--
-- The production UI calls public.create_communication_centre_conversation(...),
-- while the current production database exposes the other secure Communication
-- Centre RPCs but not this create function. The live conversation table stores
-- assignment through communication_centre_participants; assigned_user_ids is not
-- a live column and must not be written.
--
-- Safe to re-run. Existing conversations and messages are not modified.

begin;

create or replace function public.create_communication_centre_conversation(
  p_title text,
  p_description text default null,
  p_category text default 'General',
  p_priority text default 'Normal',
  p_assigned_user_ids uuid[] default array[]::uuid[],
  p_assigned_role text default null,
  p_related_resource text default null,
  p_related_record_id text default null
)
returns public.communication_centre_conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_id uuid := gen_random_uuid();
  v_year text := to_char(current_date, 'YYYY');
  v_seq bigint;
  v_no text;
  v_conversation public.communication_centre_conversations;
  v_participant_count integer := 0;
begin
  if v_actor is null then
    raise exception 'Authentication is required to create a conversation';
  end if;

  if not public.cc_has_permission('manage') then
    raise exception 'You do not have permission to create Communication Centre conversations';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'Conversation title is required';
  end if;

  if coalesce(cardinality(p_assigned_user_ids), 0) = 0
     and nullif(btrim(coalesce(p_assigned_role, '')), '') is null then
    raise exception 'Assign at least one user or role';
  end if;

  v_role := case
    when nullif(btrim(coalesce(p_assigned_role, '')), '') is null then null
    else public.cc_normalize_role_key(p_assigned_role)
  end;

  -- Serialize business-number allocation so concurrent conversation creates
  -- cannot choose the same readable reference.
  perform pg_advisory_xact_lock(
    hashtext('incheck360:communication-centre-conversation-number'),
    extract(year from current_date)::integer
  );

  select coalesce(max(seq_value), 0) + 1
    into v_seq
    from (
      select (regexp_match(conversation_no, '^CC/' || v_year || '/([0-9]+)$', 'i'))[1]::bigint as seq_value
        from public.communication_centre_conversations
       where conversation_no ~* ('^CC/' || v_year || '/[0-9]+$')
    ) existing;

  v_no := 'CC/' || v_year || '/' || lpad(v_seq::text, 4, '0');

  insert into public.communication_centre_conversations(
    id,
    conversation_no,
    title,
    description,
    category,
    priority,
    status,
    assigned_role,
    participant_count,
    unread_count,
    is_assigned_to_me,
    is_pinned,
    is_archived,
    follow_up_status,
    is_escalated,
    related_resource,
    related_module,
    related_record_id,
    created_at,
    updated_at,
    created_by
  )
  values(
    v_id,
    v_no,
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(nullif(btrim(coalesce(p_category, '')), ''), 'General'),
    coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'Normal'),
    'Open',
    v_role,
    0,
    0,
    1,
    false,
    false,
    'none',
    false,
    nullif(btrim(coalesce(p_related_resource, '')), ''),
    nullif(btrim(coalesce(p_related_resource, '')), ''),
    nullif(btrim(coalesce(p_related_record_id, '')), ''),
    now(),
    now(),
    v_actor
  )
  returning * into v_conversation;

  -- Persist one canonical participant row per assigned user. The creator is
  -- always included so a newly created conversation remains visible to its
  -- author even when it is assigned to another user or role.
  with requested_users as (
    select distinct user_id
      from (
        select unnest(coalesce(p_assigned_user_ids, array[]::uuid[])) as user_id
        union all
        select v_actor
        union all
        select p.id
          from public.profiles p
         where v_role is not null
           and coalesce(p.is_active, true)
           and public.cc_normalize_role_key(p.role_key) = v_role
      ) users
     where user_id is not null
  )
  insert into public.communication_centre_participants(
    id,
    conversation_id,
    user_id,
    user_role,
    is_active,
    is_muted,
    joined_at,
    created_at,
    updated_at
  )
  select
    gen_random_uuid(),
    v_id,
    ru.user_id,
    p.role_key,
    true,
    false,
    now(),
    now(),
    now()
  from requested_users ru
  left join public.profiles p on p.id = ru.user_id
  on conflict do nothing;

  select count(*)::integer
    into v_participant_count
    from public.communication_centre_participants
   where conversation_id = v_id
     and coalesce(is_active, true);

  update public.communication_centre_conversations
     set participant_count = v_participant_count,
         updated_at = now()
   where id = v_id
  returning * into v_conversation;

  return v_conversation;
end;
$$;

revoke all on function public.create_communication_centre_conversation(text, text, text, text, uuid[], text, text, text) from public;
grant execute on function public.create_communication_centre_conversation(text, text, text, text, uuid[], text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
