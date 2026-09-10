create or replace function public.employee_calendar_sync_reminders()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_offset integer;
  v_due_at timestamptz;
begin
  delete from public.employee_calendar_reminders
  where event_id = new.id and status = 'pending';

  if lower(coalesce(new.status,'')) in ('cancelled','canceled','completed','done') then
    return new;
  end if;

  -- Outlook-origin events sync silently. Outlook remains responsible for their reminders.
  if coalesce(new.outlook_origin, 'erp') = 'outlook' then
    return new;
  end if;

  foreach v_offset in array coalesce(new.reminder_offsets, '{}'::integer[]) loop
    if v_offset is null then
      continue;
    end if;

    v_due_at := new.start_at - make_interval(mins => v_offset);

    -- Never create an already-overdue reminder after edits/imports/backfills.
    if v_due_at <= now() then
      continue;
    end if;

    insert into public.employee_calendar_reminders(event_id, recipient_user_id, offset_minutes, due_at)
    values (new.id, new.owner_user_id, v_offset, v_due_at)
    on conflict (event_id, recipient_user_id, offset_minutes)
    do update set due_at = excluded.due_at, status = 'pending', sent_at = null, updated_at = now();
  end loop;

  return new;
end;
$$;

delete from public.employee_calendar_reminders r
using public.employee_calendar_events e
where r.event_id = e.id
  and e.outlook_origin = 'outlook'
  and r.status = 'pending';

delete from public.employee_calendar_reminders
where status = 'pending'
  and due_at <= now();
