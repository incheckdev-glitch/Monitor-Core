-- Align Deal defaults with the current sales pipeline and preserve Lead/Deal note history.
alter table public.deals alter column stage set default 'In Progress';

update public.deals
set stage = 'In Progress'
where stage is null or btrim(stage) = '' or lower(btrim(stage)) = 'new';

create or replace function public.capture_lead_note_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(coalesce(new.notes, '')), '') is not null then
      insert into public.lead_note_logs(
        lead_uuid, lead_id, previous_note, old_note, new_note, note, created_by, created_at, updated_at
      ) values (
        new.id, new.lead_id, null, null, new.notes, new.notes,
        coalesce(new.updated_by, new.created_by, auth.uid()),
        coalesce(new.created_at, now()), coalesce(new.created_at, now())
      );
    end if;
  elsif new.notes is distinct from old.notes
        and nullif(btrim(coalesce(new.notes, '')), '') is not null then
    insert into public.lead_note_logs(
      lead_uuid, lead_id, previous_note, old_note, new_note, note, created_by, created_at, updated_at
    ) values (
      new.id, new.lead_id, old.notes, old.notes, new.notes, new.notes,
      coalesce(new.updated_by, auth.uid(), new.created_by), now(), now()
    );
  end if;
  return new;
end;
$$;

create or replace function public.capture_deal_note_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(coalesce(new.notes, '')), '') is not null then
      insert into public.deal_note_logs(
        deal_uuid, deal_id, previous_note, old_note, new_note, note, created_by, created_at, updated_at
      ) values (
        new.id, new.deal_id, null, null, new.notes, new.notes,
        coalesce(new.updated_by, new.created_by, auth.uid()),
        coalesce(new.created_at, now()), coalesce(new.created_at, now())
      );
    end if;
  elsif new.notes is distinct from old.notes
        and nullif(btrim(coalesce(new.notes, '')), '') is not null then
    insert into public.deal_note_logs(
      deal_uuid, deal_id, previous_note, old_note, new_note, note, created_by, created_at, updated_at
    ) values (
      new.id, new.deal_id, old.notes, old.notes, new.notes, new.notes,
      coalesce(new.updated_by, auth.uid(), new.created_by), now(), now()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.capture_lead_note_history() from public, anon, authenticated;
revoke all on function public.capture_deal_note_history() from public, anon, authenticated;

drop trigger if exists trg_leads_capture_note_history on public.leads;
create trigger trg_leads_capture_note_history
after insert or update of notes on public.leads
for each row execute function public.capture_lead_note_history();

drop trigger if exists trg_deals_capture_note_history on public.deals;
create trigger trg_deals_capture_note_history
after insert or update of notes on public.deals
for each row execute function public.capture_deal_note_history();

insert into public.lead_note_logs(
  lead_uuid, lead_id, previous_note, old_note, new_note, note, created_by, created_at, updated_at
)
select l.id, l.lead_id, null, null, l.notes, l.notes,
       coalesce(l.updated_by, l.created_by), coalesce(l.updated_at, l.created_at, now()), coalesce(l.updated_at, l.created_at, now())
from public.leads l
where nullif(btrim(coalesce(l.notes, '')), '') is not null
  and not exists (
    select 1 from public.lead_note_logs n
    where n.lead_uuid = l.id or (n.lead_id is not null and n.lead_id = l.lead_id)
  );

insert into public.deal_note_logs(
  deal_uuid, deal_id, previous_note, old_note, new_note, note, created_by, created_at, updated_at
)
select d.id, d.deal_id, null, null, d.notes, d.notes,
       coalesce(d.updated_by, d.created_by), coalesce(d.updated_at, d.created_at, now()), coalesce(d.updated_at, d.created_at, now())
from public.deals d
where nullif(btrim(coalesce(d.notes, '')), '') is not null
  and not exists (
    select 1 from public.deal_note_logs n
    where n.deal_uuid = d.id or (n.deal_id is not null and n.deal_id = d.deal_id)
  );

-- Repair the known lead whose Meeting Booked selection was lost by the old frontend normalizer.
update public.leads
set status = 'meeting booked'
where id = 'd927a07b-0948-40b0-8b18-af0b9c0e2086'::uuid
  and lead_id = 'Lead#00001'
  and lower(btrim(coalesce(notes, ''))) = 'meeting booked';
