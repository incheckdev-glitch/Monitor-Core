-- Monitor Core Lead Intelligence
-- AI-assisted public-web prospect research with duplicate-safe CRM acceptance.

create table if not exists public.lead_intelligence_runs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid(),
  criteria jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('running','completed','failed')),
  model text,
  openai_response_id text,
  result_count integer not null default 0 check (result_count >= 0),
  usage jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_intelligence_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.lead_intelligence_runs(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  fingerprint text not null,
  status text not null default 'new' check (status in ('new','added','duplicate','dismissed')),
  person_name text not null,
  job_title text,
  person_email text,
  company_name text not null,
  company_website text,
  linkedin_url text,
  country text,
  city text,
  industry text,
  company_size text,
  estimated_locations integer check (estimated_locations is null or estimated_locations >= 0),
  fit_score smallint not null default 0 check (fit_score between 0 and 100),
  confidence text check (confidence is null or confidence in ('high','medium','low')),
  why_fit text,
  likely_pain_points text[] not null default '{}'::text[],
  public_evidence text[] not null default '{}'::text[],
  source_urls jsonb not null default '[]'::jsonb,
  suggested_connection_note text,
  suggested_follow_up text,
  matched_company_id uuid,
  matched_contact_id uuid,
  matched_lead_id uuid,
  accepted_at timestamptz,
  dismissed_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, fingerprint)
);

create index if not exists lead_intelligence_runs_created_at_idx on public.lead_intelligence_runs(created_at desc);
create index if not exists lead_intelligence_suggestions_run_idx on public.lead_intelligence_suggestions(run_id, fit_score desc, created_at desc);
create index if not exists lead_intelligence_suggestions_status_idx on public.lead_intelligence_suggestions(status, fit_score desc);
create index if not exists lead_intelligence_suggestions_company_idx on public.lead_intelligence_suggestions(lower(company_name));

create or replace function public.can_use_lead_intelligence()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then return false; end if;
  select lower(coalesce(nullif(role_key,''), nullif(role,''), ''))
    into v_role
    from public.profiles
   where id = auth.uid() and coalesce(is_active,true)
   limit 1;
  if v_role in ('admin','gm') then return true; end if;
  return exists (
    select 1
      from public.role_permissions rp
     where lower(rp.role_key) = v_role
       and rp.resource = 'leads'
       and rp.action in ('create','manage')
       and coalesce(rp.is_allowed,true)
       and coalesce(rp.is_active,true)
  );
end;
$$;

grant execute on function public.can_use_lead_intelligence() to authenticated;

alter table public.lead_intelligence_runs enable row level security;
alter table public.lead_intelligence_suggestions enable row level security;

drop policy if exists lead_intelligence_runs_select on public.lead_intelligence_runs;
create policy lead_intelligence_runs_select on public.lead_intelligence_runs for select to authenticated using (public.can_use_lead_intelligence());
drop policy if exists lead_intelligence_runs_insert on public.lead_intelligence_runs;
create policy lead_intelligence_runs_insert on public.lead_intelligence_runs for insert to authenticated with check (public.can_use_lead_intelligence() and created_by = auth.uid());
drop policy if exists lead_intelligence_runs_update on public.lead_intelligence_runs;
create policy lead_intelligence_runs_update on public.lead_intelligence_runs for update to authenticated using (public.can_use_lead_intelligence()) with check (public.can_use_lead_intelligence());
drop policy if exists lead_intelligence_runs_delete on public.lead_intelligence_runs;
create policy lead_intelligence_runs_delete on public.lead_intelligence_runs for delete to authenticated using (public.can_use_lead_intelligence());

drop policy if exists lead_intelligence_suggestions_select on public.lead_intelligence_suggestions;
create policy lead_intelligence_suggestions_select on public.lead_intelligence_suggestions for select to authenticated using (public.can_use_lead_intelligence());
drop policy if exists lead_intelligence_suggestions_insert on public.lead_intelligence_suggestions;
create policy lead_intelligence_suggestions_insert on public.lead_intelligence_suggestions for insert to authenticated with check (public.can_use_lead_intelligence() and created_by = auth.uid());
drop policy if exists lead_intelligence_suggestions_update on public.lead_intelligence_suggestions;
create policy lead_intelligence_suggestions_update on public.lead_intelligence_suggestions for update to authenticated using (public.can_use_lead_intelligence()) with check (public.can_use_lead_intelligence());
drop policy if exists lead_intelligence_suggestions_delete on public.lead_intelligence_suggestions;
create policy lead_intelligence_suggestions_delete on public.lead_intelligence_suggestions for delete to authenticated using (public.can_use_lead_intelligence());

create or replace function public.lead_intelligence_accept_suggestion(p_suggestion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.lead_intelligence_suggestions;
  v_company public.companies;
  v_contact public.contacts;
  v_lead public.leads;
  v_profile public.profiles;
  v_lead_code text;
  v_seq bigint;
  v_first_name text;
  v_last_name text;
  v_notes text;
begin
  if not public.can_use_lead_intelligence() then raise exception 'Not authorized to use Lead Intelligence'; end if;

  select * into s from public.lead_intelligence_suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'Suggested lead not found'; end if;
  if s.status = 'dismissed' then raise exception 'Dismissed suggestions cannot be added to CRM'; end if;
  if s.status in ('added','duplicate') and s.matched_lead_id is not null then
    select * into v_lead from public.leads where id = s.matched_lead_id;
    return jsonb_build_object('ok',true,'existing',s.status='duplicate','company_id',s.matched_company_id,'contact_id',s.matched_contact_id,'lead_id',s.matched_lead_id,'lead_code',v_lead.lead_id);
  end if;

  select * into v_profile from public.profiles where id = auth.uid() limit 1;

  select * into v_company
    from public.companies c
   where lower(btrim(coalesce(c.company_name,''))) = lower(btrim(s.company_name))
      or lower(btrim(coalesce(c.legal_name,''))) = lower(btrim(s.company_name))
   order by c.updated_at desc
   limit 1;

  if v_company.id is null then
    insert into public.companies(
      company_id, company_name, name, legal_name, industry, website, country, city,
      company_status, source, notes, created_by, created_by_email,
      documents_verified, documents_verification_status, is_verified, verified, company_verified
    ) values (
      '', s.company_name, s.company_name, s.company_name, nullif(s.industry,''), nullif(s.company_website,''),
      nullif(s.country,''), nullif(s.city,''), 'active', 'AI Prospecting',
      'Created from Lead Intelligence public-web research. Company details must be verified before commercial or contractual use.',
      auth.uid(), v_profile.email, false, 'not_verified', false, false, false
    ) returning * into v_company;
  end if;

  if nullif(btrim(s.person_email),'') is not null then
    select * into v_contact from public.contacts c
     where lower(btrim(coalesce(c.email,''))) = lower(btrim(s.person_email))
       and (c.company_id = v_company.id::text or lower(btrim(coalesce(c.company_name,''))) = lower(btrim(v_company.company_name)))
     order by c.updated_at desc limit 1;
  end if;
  if v_contact.id is null then
    select * into v_contact from public.contacts c
     where lower(btrim(coalesce(c.full_name,''))) = lower(btrim(s.person_name))
       and (c.company_id = v_company.id::text or lower(btrim(coalesce(c.company_name,''))) = lower(btrim(v_company.company_name)))
     order by c.updated_at desc limit 1;
  end if;

  if v_contact.id is null then
    v_first_name := split_part(btrim(s.person_name), ' ', 1);
    v_last_name := nullif(btrim(regexp_replace(btrim(s.person_name), '^\S+\s*', '')), '');
    insert into public.contacts(
      contact_id, company_id, company_name, first_name, last_name, full_name, job_title, email,
      contact_status, notes, created_by, created_by_email
    ) values (
      '', v_company.id::text, v_company.company_name, v_first_name, v_last_name, s.person_name,
      nullif(s.job_title,''), nullif(s.person_email,''), 'active',
      'Created from Lead Intelligence public-web research. Contact details must be verified before outreach.',
      auth.uid(), v_profile.email
    ) returning * into v_contact;
  end if;

  select * into v_lead
    from public.leads l
   where l.converted_at is null
     and (
       (l.contact_uuid = v_contact.id and l.company_uuid = v_company.id)
       or (nullif(btrim(s.person_email),'') is not null and lower(btrim(coalesce(l.email,''))) = lower(btrim(s.person_email)) and lower(btrim(coalesce(l.company_name,''))) = lower(btrim(s.company_name)))
       or (lower(btrim(coalesce(l.full_name,''))) = lower(btrim(s.person_name)) and lower(btrim(coalesce(l.company_name,''))) = lower(btrim(s.company_name)))
     )
   order by l.updated_at desc
   limit 1;

  if v_lead.id is not null then
    update public.lead_intelligence_suggestions
       set status='duplicate', matched_company_id=v_company.id, matched_contact_id=v_contact.id,
           matched_lead_id=v_lead.id, accepted_at=now(), updated_at=now()
     where id=s.id;
    return jsonb_build_object('ok',true,'existing',true,'company_id',v_company.id,'contact_id',v_contact.id,'lead_id',v_lead.id,'lead_code',v_lead.lead_id);
  end if;

  perform pg_advisory_xact_lock(hashtext('incheck360:lead-business-id'));
  select coalesce(max((regexp_match(lead_id, '^Lead#([0-9]+)$', 'i'))[1]::bigint),0)+1
    into v_seq from public.leads where lead_id ~* '^Lead#[0-9]+$';
  v_lead_code := 'Lead#' || lpad(v_seq::text,5,'0');

  v_notes := concat_ws(E'\n',
    'AI Suggested Lead — public-web research; verify details before outreach.',
    case when nullif(btrim(s.why_fit),'') is not null then 'Why it fits: ' || s.why_fit end,
    case when cardinality(s.likely_pain_points) > 0 then 'Potential pain points: ' || array_to_string(s.likely_pain_points, '; ') end,
    case when nullif(btrim(s.suggested_connection_note),'') is not null then 'Suggested opener: ' || s.suggested_connection_note end
  );

  insert into public.leads(
    lead_id, full_name, company_id, company_uuid, company_name, customer_name, customer_legal_name,
    contact_id, contact_uuid, contact_name, contact_email, email, country, lead_source, service_interest,
    status, priority, estimated_value, currency, assigned_to, owner_id, next_follow_up, next_follow_up_at,
    notes, created_by, updated_by, last_updated_by
  ) values (
    v_lead_code, s.person_name, v_company.id::text, v_company.id, v_company.company_name, v_company.company_name, v_company.legal_name,
    v_contact.id::text, v_contact.id, v_contact.full_name, v_contact.email, v_contact.email, s.country,
    'AI Prospecting', 'Software', 'not contacted yet', case when s.fit_score >= 85 then 'High' else 'Medium' end,
    0, 'USD', coalesce(nullif(v_profile.display_name,''),nullif(v_profile.full_name,''),nullif(v_profile.name,''),v_profile.email),
    auth.uid(), current_date + 2, now() + interval '2 days', v_notes, auth.uid(), auth.uid(), auth.uid()
  ) returning * into v_lead;

  update public.lead_intelligence_suggestions
     set status='added', matched_company_id=v_company.id, matched_contact_id=v_contact.id,
         matched_lead_id=v_lead.id, accepted_at=now(), updated_at=now()
   where id=s.id;

  return jsonb_build_object('ok',true,'existing',false,'company_id',v_company.id,'contact_id',v_contact.id,'lead_id',v_lead.id,'lead_code',v_lead.lead_id);
end;
$$;

grant execute on function public.lead_intelligence_accept_suggestion(uuid) to authenticated;
