create or replace function public.crm_daily_brief_source_snapshot(p_as_of timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_since_24h timestamptz := p_as_of - interval '24 hours';
  v_since_7d timestamptz := p_as_of - interval '7 days';
  v_result jsonb;
begin
  if not public.crm_daily_brief_is_admin() then
    raise exception 'Admin or GM access is required.';
  end if;

  select jsonb_build_object(
    'as_of', p_as_of,
    'source_policy', jsonb_build_object(
      'structured_crm_only', true,
      'salesperson_notes_excluded', true,
      'chat_history_excluded', true,
      'free_text_notes_excluded', true
    ),
    'summary', jsonb_build_object(
      'open_leads', (select count(*) from public.leads l where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won')),
      'qualified_leads', (select count(*) from public.leads l where l.converted_at is null and lower(coalesce(l.status,'')) in ('qualified','meeting booked','meeting_booked')),
      'open_deals', (select count(*) from public.deals d where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won')),
      'sent_or_pending_proposals', (select count(*) from public.proposals p where lower(coalesce(p.status,'')) in ('sent','pending_approval','pending approval')),
      'new_leads_24h', (select count(*) from public.leads l where l.created_at >= v_since_24h),
      'new_deals_24h', (select count(*) from public.deals d where d.created_at >= v_since_24h),
      'converted_leads_7d', (select count(*) from public.leads l where l.converted_at >= v_since_7d),
      'accepted_proposals_7d', (select count(*) from public.proposals p where p.accepted_at >= v_since_7d),
      'rejected_proposals_7d', (select count(*) from public.proposals p where p.rejected_at >= v_since_7d),
      'overdue_lead_followups', (select count(*) from public.leads l where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won') and coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) <= p_as_of),
      'overdue_deal_followups', (select count(*) from public.deals d where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won') and d.next_follow_up_at is not null and d.next_follow_up_at <= p_as_of),
      'active_leads_without_followup', (select count(*) from public.leads l where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won') and coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) is null),
      'active_deals_without_followup', (select count(*) from public.deals d where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won') and d.next_follow_up_at is null),
      'stale_leads_7d', (select count(*) from public.leads l where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won') and coalesce(l.last_contact, l.updated_at, l.created_at) < p_as_of - interval '7 days'),
      'stale_deals_7d', (select count(*) from public.deals d where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won') and coalesce(d.last_contacted_date::timestamptz, d.updated_at, d.created_at) < p_as_of - interval '7 days'),
      'crm_events_next_7d', (select count(*) from public.employee_calendar_events e where e.start_at >= p_as_of and e.start_at <= p_as_of + interval '7 days' and (lower(coalesce(e.related_resource,'')) in ('lead','leads','deal','deals','proposal','proposals','company','companies','contact','contacts') or lower(coalesce(e.event_type,'')) in ('meeting','call','follow_up','follow-up','crm')))
    ),
    'pipeline_by_currency', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.currency)
      from (
        select coalesce(nullif(trim(d.currency),''),'Unknown') as currency,
               count(*) as open_deal_count,
               coalesce(sum(d.estimated_value),0) as open_deal_value
        from public.deals d
        where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won')
        group by coalesce(nullif(trim(d.currency),''),'Unknown')
      ) x
    ), '[]'::jsonb),
    'lead_status_distribution', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.record_count desc)
      from (
        select coalesce(nullif(trim(l.status),''),'Unspecified') as status, count(*) as record_count
        from public.leads l
        where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won')
        group by coalesce(nullif(trim(l.status),''),'Unspecified')
      ) x
    ), '[]'::jsonb),
    'deal_stage_distribution', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.record_count desc)
      from (
        select coalesce(nullif(trim(d.stage),''),'Unspecified') as stage, count(*) as record_count
        from public.deals d
        where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won')
        group by coalesce(nullif(trim(d.stage),''),'Unspecified')
      ) x
    ), '[]'::jsonb),
    'overdue_followups', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.follow_up_at asc)
      from (
        select 'lead'::text as entity_type, l.id::text as entity_id, l.lead_id as entity_number,
               coalesce(nullif(l.company_name,''), nullif(l.customer_name,''), l.full_name, l.lead_id) as label,
               l.status as pipeline_status, l.priority, l.assigned_to as owner,
               coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) as follow_up_at,
               l.last_contact as last_contact_at, l.estimated_value, l.currency
        from public.leads l
        where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won')
          and coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) <= p_as_of
        union all
        select 'deal'::text, d.id::text, d.deal_id,
               coalesce(nullif(d.company_name,''), nullif(d.customer_name,''), d.full_name, d.deal_id),
               d.stage, d.priority, d.assigned_to,
               d.next_follow_up_at, d.last_contacted_date::timestamptz, d.estimated_value, d.currency
        from public.deals d
        where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won')
          and d.next_follow_up_at is not null and d.next_follow_up_at <= p_as_of
        order by follow_up_at asc
        limit 35
      ) x
    ), '[]'::jsonb),
    'followup_gaps', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.updated_at asc)
      from (
        select 'lead'::text as entity_type, l.id::text as entity_id, l.lead_id as entity_number,
               coalesce(nullif(l.company_name,''), nullif(l.customer_name,''), l.full_name, l.lead_id) as label,
               l.status as pipeline_status, l.priority, l.assigned_to as owner,
               l.last_contact as last_contact_at, l.updated_at, l.estimated_value, l.currency
        from public.leads l
        where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won')
          and coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) is null
        union all
        select 'deal'::text, d.id::text, d.deal_id,
               coalesce(nullif(d.company_name,''), nullif(d.customer_name,''), d.full_name, d.deal_id),
               d.stage, d.priority, d.assigned_to,
               d.last_contacted_date::timestamptz, d.updated_at, d.estimated_value, d.currency
        from public.deals d
        where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won')
          and d.next_follow_up_at is null
        order by updated_at asc
        limit 35
      ) x
    ), '[]'::jsonb),
    'stale_pipeline', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.last_activity_at asc)
      from (
        select 'lead'::text as entity_type, l.id::text as entity_id, l.lead_id as entity_number,
               coalesce(nullif(l.company_name,''), nullif(l.customer_name,''), l.full_name, l.lead_id) as label,
               l.status as pipeline_status, l.priority, l.assigned_to as owner,
               coalesce(l.last_contact, l.updated_at, l.created_at) as last_activity_at,
               l.estimated_value, l.currency
        from public.leads l
        where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won')
          and coalesce(l.last_contact, l.updated_at, l.created_at) < p_as_of - interval '7 days'
        union all
        select 'deal'::text, d.id::text, d.deal_id,
               coalesce(nullif(d.company_name,''), nullif(d.customer_name,''), d.full_name, d.deal_id),
               d.stage, d.priority, d.assigned_to,
               coalesce(d.last_contacted_date::timestamptz, d.updated_at, d.created_at),
               d.estimated_value, d.currency
        from public.deals d
        where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won')
          and coalesce(d.last_contacted_date::timestamptz, d.updated_at, d.created_at) < p_as_of - interval '7 days'
        order by last_activity_at asc
        limit 35
      ) x
    ), '[]'::jsonb),
    'opportunity_watch', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.updated_at desc)
      from (
        select 'lead'::text as entity_type, l.id::text as entity_id, l.lead_id as entity_number,
               coalesce(nullif(l.company_name,''), nullif(l.customer_name,''), l.full_name, l.lead_id) as label,
               l.status as pipeline_status, l.priority, l.assigned_to as owner,
               coalesce(l.next_follow_up_at, l.next_follow_up::timestamptz) as next_follow_up_at,
               l.estimated_value, l.currency, l.updated_at,
               l.proposal_needed, l.agreement_needed
        from public.leads l
        where l.converted_at is null
          and (lower(coalesce(l.status,'')) in ('qualified','meeting booked','meeting_booked') or lower(coalesce(l.priority,''))='high')
        order by l.updated_at desc
        limit 30
      ) x
    ), '[]'::jsonb),
    'proposal_watch', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.valid_until asc nulls last)
      from (
        select p.id::text as entity_id,
               coalesce(nullif(p.proposal_id,''), p.ref_number) as entity_number,
               coalesce(nullif(p.company_name,''), nullif(p.customer_name,''), p.proposal_title, p.proposal_id, p.ref_number) as label,
               p.status, p.grand_total, p.currency, p.proposal_date,
               coalesce(p.proposal_valid_until, p.valid_until) as valid_until,
               (coalesce(p.proposal_valid_until, p.valid_until) - p_as_of::date) as days_to_expiry,
               p.is_poc, p.deal_id::text as deal_id, p.created_at, p.updated_at
        from public.proposals p
        where lower(coalesce(p.status,'')) in ('sent','pending_approval','pending approval','accepted','rejected')
          and (lower(coalesce(p.status,'')) in ('sent','pending_approval','pending approval') or p.accepted_at >= v_since_7d or p.rejected_at >= v_since_7d)
        order by coalesce(p.proposal_valid_until, p.valid_until) asc nulls last
        limit 30
      ) x
    ), '[]'::jsonb),
    'status_movements_24h', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.changed_at desc)
      from (
        select s.entity_type, s.entity_id, s.entity_number, s.title,
               s.status_field, s.old_status, s.new_status, s.changed_at
        from public.lifecycle_status_logs s
        where lower(coalesce(s.entity_type,'')) in ('lead','leads','deal','deals','proposal','proposals','company','companies','contact','contacts')
          and s.changed_at >= v_since_24h
        order by s.changed_at desc
        limit 40
      ) x
    ), '[]'::jsonb),
    'recent_conversions_7d', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.converted_at desc)
      from (
        select l.id::text as entity_id, l.lead_id as entity_number,
               coalesce(nullif(l.company_name,''), nullif(l.customer_name,''), l.full_name, l.lead_id) as label,
               l.status, l.assigned_to as owner, l.converted_at, l.converted_to_deal_id::text as converted_to_deal_id,
               l.estimated_value, l.currency
        from public.leads l
        where l.converted_at >= v_since_7d
        order by l.converted_at desc
        limit 25
      ) x
    ), '[]'::jsonb),
    'team_execution', coalesce((
      select jsonb_agg(to_jsonb(x) order by (x.overdue_followups + x.no_followup) desc, x.owner)
      from (
        with owners as (
          select coalesce(nullif(trim(l.assigned_to),''),'Unassigned') as owner,
                 count(*) filter (where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won')) as active_leads,
                 0::bigint as active_deals,
                 count(*) filter (where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won') and coalesce(l.next_follow_up_at,l.next_follow_up::timestamptz) <= p_as_of) as overdue_followups,
                 count(*) filter (where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won') and coalesce(l.next_follow_up_at,l.next_follow_up::timestamptz) is null) as no_followup,
                 count(*) filter (where l.converted_at is null and lower(coalesce(l.status,'')) in ('qualified','meeting booked','meeting_booked')) as qualified_items
          from public.leads l group by 1
          union all
          select coalesce(nullif(trim(d.assigned_to),''),'Unassigned'), 0::bigint,
                 count(*) filter (where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won')),
                 count(*) filter (where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won') and d.next_follow_up_at is not null and d.next_follow_up_at <= p_as_of),
                 count(*) filter (where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won') and d.next_follow_up_at is null),
                 count(*) filter (where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won') and lower(coalesce(d.priority,''))='high')
          from public.deals d group by 1
        )
        select owner, sum(active_leads)::bigint as active_leads, sum(active_deals)::bigint as active_deals,
               sum(overdue_followups)::bigint as overdue_followups, sum(no_followup)::bigint as no_followup,
               sum(qualified_items)::bigint as qualified_or_high_priority
        from owners group by owner
      ) x
    ), '[]'::jsonb),
    'data_quality', jsonb_build_object(
      'active_leads_missing_owner', (select count(*) from public.leads l where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won') and nullif(trim(coalesce(l.assigned_to,'')),'') is null),
      'active_leads_missing_contact_method', (select count(*) from public.leads l where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won') and nullif(trim(coalesce(l.contact_email,l.email,'')),'') is null and nullif(trim(coalesce(l.contact_phone,l.phone,'')),'') is null),
      'active_leads_missing_estimated_value', (select count(*) from public.leads l where l.converted_at is null and lower(coalesce(l.status,'')) not in ('lost','closed','converted','won') and l.estimated_value is null),
      'active_deals_missing_owner', (select count(*) from public.deals d where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won') and nullif(trim(coalesce(d.assigned_to,'')),'') is null),
      'active_deals_missing_contact_method', (select count(*) from public.deals d where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won') and nullif(trim(coalesce(d.contact_email,d.email,'')),'') is null and nullif(trim(coalesce(d.contact_phone,d.phone,'')),'') is null),
      'active_deals_missing_estimated_value', (select count(*) from public.deals d where lower(coalesce(d.stage,'')) not in ('lost','closed','closed won','closed lost','won') and d.estimated_value is null)
    ),
    'upcoming_crm_calendar_7d', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.start_at asc)
      from (
        select e.id::text as entity_id, e.title, e.event_type, e.status, e.start_at, e.end_at,
               e.related_resource, e.related_id, e.related_label, e.location,
               e.owner_user_id::text as owner_user_id, e.outlook_origin, e.outlook_teams_enabled
        from public.employee_calendar_events e
        where e.start_at >= p_as_of and e.start_at <= p_as_of + interval '7 days'
          and (lower(coalesce(e.related_resource,'')) in ('lead','leads','deal','deals','proposal','proposals','company','companies','contact','contacts') or lower(coalesce(e.event_type,'')) in ('meeting','call','follow_up','follow-up','crm'))
        order by e.start_at asc
        limit 40
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.crm_daily_brief_source_snapshot(timestamptz) from anon;
grant execute on function public.crm_daily_brief_source_snapshot(timestamptz) to authenticated;
