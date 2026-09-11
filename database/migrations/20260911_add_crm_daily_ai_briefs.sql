create table if not exists public.crm_daily_briefs (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  generated_at timestamptz not null default now(),
  generated_by uuid null references public.profiles(id) on delete set null,
  generated_by_name text null,
  status text not null default 'completed' check (status in ('generating','completed','failed')),
  model text null,
  prompt_version text not null default 'crm-daily-brief-v1',
  report jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  estimated_cost_usd numeric(12,6) not null default 0,
  generation_count integer not null default 1 check (generation_count >= 1),
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_daily_briefs is 'One shared saved AI CRM brief per day. CRM users may read; Admin/GM may generate or regenerate.';

create index if not exists crm_daily_briefs_generated_at_idx
  on public.crm_daily_briefs (generated_at desc);

alter table public.crm_daily_briefs enable row level security;

create or replace function public.crm_daily_brief_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.current_app_role(), '') in ('admin','gm','general_manager','generalmanager');
$$;

create or replace function public.can_view_crm_daily_brief()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (
    select coalesce(public.current_app_role(), '') as role_key
  )
  select
    (select role_key from me) in ('admin','gm','general_manager','generalmanager')
    or exists (
      select 1
      from public.role_permissions rp
      where lower(regexp_replace(trim(coalesce(rp.role_key,'')), '[[:space:]-]+', '_', 'g')) = (select role_key from me)
        and lower(coalesce(rp.resource,'')) in ('leads','deals')
        and lower(coalesce(rp.action,'')) in ('view','get','list','manage','manage_all')
        and coalesce(rp.is_active,true) = true
        and coalesce(rp.is_allowed,false) = true
    );
$$;

drop policy if exists crm_daily_briefs_select on public.crm_daily_briefs;
create policy crm_daily_briefs_select
on public.crm_daily_briefs
for select
to authenticated
using ((select public.can_view_crm_daily_brief()));

drop policy if exists crm_daily_briefs_insert on public.crm_daily_briefs;
create policy crm_daily_briefs_insert
on public.crm_daily_briefs
for insert
to authenticated
with check ((select public.crm_daily_brief_is_admin()) and generated_by = (select auth.uid()));

drop policy if exists crm_daily_briefs_update on public.crm_daily_briefs;
create policy crm_daily_briefs_update
on public.crm_daily_briefs
for update
to authenticated
using ((select public.crm_daily_brief_is_admin()))
with check ((select public.crm_daily_brief_is_admin()));

revoke all on table public.crm_daily_briefs from anon;
grant select, insert, update on table public.crm_daily_briefs to authenticated;

revoke all on function public.crm_daily_brief_is_admin() from public, anon;
grant execute on function public.crm_daily_brief_is_admin() to authenticated;
revoke all on function public.can_view_crm_daily_brief() from public, anon;
grant execute on function public.can_view_crm_daily_brief() to authenticated;

create or replace function public.crm_daily_brief_source_snapshot(p_as_of timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_since timestamptz := p_as_of - interval '24 hours';
  v_result jsonb;
begin
  if not public.crm_daily_brief_is_admin() then
    raise exception 'Admin or GM access is required.';
  end if;

  select jsonb_build_object(
    'as_of', p_as_of,
    'recent_window_hours', 24,
    'summary', jsonb_build_object(
      'new_leads_24h', (select count(*) from public.leads l where l.created_at >= v_since),
      'updated_leads_24h', (select count(*) from public.leads l where l.updated_at >= v_since),
      'new_deals_24h', (select count(*) from public.deals d where d.created_at >= v_since),
      'updated_deals_24h', (select count(*) from public.deals d where d.updated_at >= v_since),
      'proposal_changes_24h', (select count(*) from public.proposals p where p.updated_at >= v_since),
      'overdue_lead_followups', (select count(*) from public.leads l where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won') and coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) <= p_as_of),
      'overdue_deal_followups', (select count(*) from public.deals d where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won') and d.next_follow_up_at is not null and d.next_follow_up_at <= p_as_of),
      'crm_events_next_48h', (select count(*) from public.employee_calendar_events e where e.start_at >= p_as_of and e.start_at <= p_as_of + interval '48 hours' and (lower(coalesce(e.related_resource,'')) in ('lead','leads','deal','deals','proposal','proposals','company','companies','contact','contacts') or lower(coalesce(e.event_type,'')) in ('meeting','call','follow_up','follow-up','crm')))
    ),
    'overdue_lead_followups', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.follow_up_at asc nulls last)
      from (
        select l.id::text as entity_id, l.lead_id as entity_number,
               coalesce(nullif(l.company_name,''), nullif(l.customer_name,''), l.full_name, l.lead_id) as label,
               l.full_name as contact_name, l.status, l.priority, l.assigned_to,
               coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) as follow_up_at,
               l.last_contact, l.estimated_value, l.currency,
               left(coalesce(l.notes,''), 240) as notes
        from public.leads l
        where l.converted_at is null
          and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won')
          and coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) <= p_as_of
        order by coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) asc nulls last
        limit 25
      ) x
    ), '[]'::jsonb),
    'stale_leads', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.last_touch asc)
      from (
        select l.id::text as entity_id, l.lead_id as entity_number,
               coalesce(nullif(l.company_name,''), nullif(l.customer_name,''), l.full_name, l.lead_id) as label,
               l.full_name as contact_name, l.status, l.priority, l.assigned_to,
               coalesce(l.last_contact, l.created_at) as last_touch,
               coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) as next_follow_up_at,
               l.estimated_value, l.currency
        from public.leads l
        where l.converted_at is null
          and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won')
          and coalesce(l.last_contact, l.created_at) < p_as_of - interval '4 days'
        order by coalesce(l.last_contact, l.created_at) asc
        limit 20
      ) x
    ), '[]'::jsonb),
    'lead_opportunities', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.updated_at desc)
      from (
        select l.id::text as entity_id, l.lead_id as entity_number,
               coalesce(nullif(l.company_name,''), nullif(l.customer_name,''), l.full_name, l.lead_id) as label,
               l.full_name as contact_name, l.status, l.priority, l.assigned_to,
               l.estimated_value, l.currency, l.updated_at,
               coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) as next_follow_up_at
        from public.leads l
        where l.converted_at is null
          and (lower(coalesce(l.status,'')) in ('qualified','meeting booked','meeting_booked') or lower(coalesce(l.priority,'')) = 'high')
        order by l.updated_at desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'overdue_deal_followups', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.next_follow_up_at asc)
      from (
        select d.id::text as entity_id, d.deal_id as entity_number,
               coalesce(nullif(d.company_name,''), nullif(d.customer_name,''), d.full_name, d.deal_id) as label,
               d.contact_name, d.stage, d.priority, d.assigned_to, d.next_follow_up_at,
               d.last_contacted_date, d.estimated_value, d.currency,
               left(coalesce(d.notes,''), 240) as notes
        from public.deals d
        where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won')
          and d.next_follow_up_at is not null
          and d.next_follow_up_at <= p_as_of
        order by d.next_follow_up_at asc
        limit 20
      ) x
    ), '[]'::jsonb),
    'open_deals', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.updated_at desc)
      from (
        select d.id::text as entity_id, d.deal_id as entity_number,
               coalesce(nullif(d.company_name,''), nullif(d.customer_name,''), d.full_name, d.deal_id) as label,
               d.contact_name, d.stage, d.priority, d.assigned_to, d.next_follow_up_at,
               d.last_contacted_date, d.estimated_value, d.currency, d.updated_at
        from public.deals d
        where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won')
        order by d.updated_at desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'proposal_attention', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.valid_until asc nulls last)
      from (
        select p.id::text as entity_id, coalesce(nullif(p.proposal_id,''), p.ref_number) as entity_number,
               coalesce(nullif(p.company_name,''), nullif(p.customer_name,''), p.proposal_title, p.proposal_id, p.ref_number) as label,
               p.status, p.grand_total, p.currency,
               coalesce(p.proposal_valid_until, p.valid_until) as valid_until,
               p.updated_at
        from public.proposals p
        where lower(coalesce(p.status,'')) in ('sent','pending_approval','pending approval')
          and coalesce(p.proposal_valid_until, p.valid_until) is not null
          and coalesce(p.proposal_valid_until, p.valid_until) <= (p_as_of::date + 7)
        order by coalesce(p.proposal_valid_until, p.valid_until) asc
        limit 15
      ) x
    ), '[]'::jsonb),
    'recent_activity', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.changed_at desc)
      from (
        select s.entity_type, s.entity_id, s.entity_number, s.title,
               s.old_status, s.new_status, s.change_reason,
               left(coalesce(s.notes,''), 220) as notes,
               s.changed_by_email, s.changed_at
        from public.lifecycle_status_logs s
        where lower(coalesce(s.entity_type,'')) in ('lead','leads','deal','deals','proposal','proposals','company','companies','contact','contacts')
          and s.changed_at >= v_since
        order by s.changed_at desc
        limit 30
      ) x
    ), '[]'::jsonb),
    'recent_notes', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select 'lead'::text as entity_type, n.lead_uuid::text as entity_id, n.lead_id as entity_number,
               left(coalesce(nullif(n.note,''), nullif(n.new_note,''), ''), 240) as note,
               n.created_at
        from public.lead_note_logs n
        where n.created_at >= v_since
        union all
        select 'deal'::text as entity_type, n.deal_uuid::text as entity_id, n.deal_id as entity_number,
               left(coalesce(nullif(n.note,''), nullif(n.new_note,''), ''), 240) as note,
               n.created_at
        from public.deal_note_logs n
        where n.created_at >= v_since
        order by created_at desc
        limit 25
      ) x
    ), '[]'::jsonb),
    'new_leads', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select l.id::text as entity_id, l.lead_id as entity_number,
               coalesce(nullif(l.company_name,''), nullif(l.customer_name,''), l.full_name, l.lead_id) as label,
               l.full_name as contact_name, l.status, l.priority, l.assigned_to, l.created_at
        from public.leads l
        where l.created_at >= v_since
        order by l.created_at desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'new_deals', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select d.id::text as entity_id, d.deal_id as entity_number,
               coalesce(nullif(d.company_name,''), nullif(d.customer_name,''), d.full_name, d.deal_id) as label,
               d.contact_name, d.stage, d.priority, d.assigned_to, d.estimated_value, d.currency, d.created_at
        from public.deals d
        where d.created_at >= v_since
        order by d.created_at desc
        limit 20
      ) x
    ), '[]'::jsonb),
    'upcoming_crm_calendar', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.start_at asc)
      from (
        select e.id::text as entity_id, e.title, e.event_type, e.status, e.start_at, e.end_at,
               e.related_resource, e.related_id, e.related_label, e.location,
               e.owner_user_id::text as owner_user_id
        from public.employee_calendar_events e
        where e.start_at >= p_as_of
          and e.start_at <= p_as_of + interval '48 hours'
          and (
            lower(coalesce(e.related_resource,'')) in ('lead','leads','deal','deals','proposal','proposals','company','companies','contact','contacts')
            or lower(coalesce(e.event_type,'')) in ('meeting','call','follow_up','follow-up','crm')
          )
        order by e.start_at asc
        limit 25
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.crm_daily_brief_source_snapshot(timestamptz) from public, anon;
grant execute on function public.crm_daily_brief_source_snapshot(timestamptz) to authenticated;
