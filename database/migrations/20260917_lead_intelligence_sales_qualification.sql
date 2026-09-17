-- Selective second-stage Lead Intelligence qualification and LinkedIn messaging.
-- Cheap initial prospect research remains unchanged. Users explicitly qualify individual leads.

alter table public.lead_intelligence_suggestions
  add column if not exists qualification_status text not null default 'not_requested',
  add column if not exists qualified_at timestamptz,
  add column if not exists refined_fit_score smallint,
  add column if not exists qualification_fit_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists decision_authority text,
  add column if not exists location_verification text,
  add column if not exists verified_locations integer,
  add column if not exists role_verification text,
  add column if not exists data_conflicts text[] not null default '{}'::text[],
  add column if not exists why_now text,
  add column if not exists why_now_verified boolean not null default false,
  add column if not exists sales_action text,
  add column if not exists qualification_sources jsonb not null default '[]'::jsonb,
  add column if not exists linkedin_connection_note text,
  add column if not exists linkedin_after_acceptance text,
  add column if not exists linkedin_no_reply_followup text,
  add column if not exists linkedin_meeting_request text,
  add column if not exists qualification_usage jsonb not null default '{}'::jsonb,
  add column if not exists qualification_web_searches smallint not null default 0,
  add column if not exists qualification_estimated_cost_usd numeric(12,6) not null default 0,
  add column if not exists qualification_error text;

alter table public.lead_intelligence_suggestions
  drop constraint if exists lead_intelligence_suggestions_qualification_status_check,
  drop constraint if exists lead_intelligence_suggestions_refined_fit_score_check,
  drop constraint if exists lead_intelligence_suggestions_decision_authority_check,
  drop constraint if exists lead_intelligence_suggestions_location_verification_check,
  drop constraint if exists lead_intelligence_suggestions_role_verification_check,
  drop constraint if exists lead_intelligence_suggestions_sales_action_check,
  drop constraint if exists lead_intelligence_suggestions_qualification_web_searches_check;

alter table public.lead_intelligence_suggestions
  add constraint lead_intelligence_suggestions_qualification_status_check
    check (qualification_status in ('not_requested','running','completed','failed')),
  add constraint lead_intelligence_suggestions_refined_fit_score_check
    check (refined_fit_score is null or refined_fit_score between 0 and 100),
  add constraint lead_intelligence_suggestions_decision_authority_check
    check (decision_authority is null or decision_authority in ('high','medium','low','unknown')),
  add constraint lead_intelligence_suggestions_location_verification_check
    check (location_verification is null or location_verification in ('verified','estimated','conflict','unknown')),
  add constraint lead_intelligence_suggestions_role_verification_check
    check (role_verification is null or role_verification in ('verified','estimated','conflict','unknown')),
  add constraint lead_intelligence_suggestions_sales_action_check
    check (sales_action is null or sales_action in ('pursue_now','nurture','low_priority')),
  add constraint lead_intelligence_suggestions_qualification_web_searches_check
    check (qualification_web_searches between 0 and 2);

create table if not exists public.lead_intelligence_qualifications (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.lead_intelligence_suggestions(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'running' check (status in ('running','completed','failed')),
  model text,
  openai_response_id text,
  web_search_cap smallint not null default 0 check (web_search_cap between 0 and 2),
  refined_fit_score smallint check (refined_fit_score is null or refined_fit_score between 0 and 100),
  fit_breakdown jsonb not null default '{}'::jsonb,
  decision_authority text check (decision_authority is null or decision_authority in ('high','medium','low','unknown')),
  location_verification text check (location_verification is null or location_verification in ('verified','estimated','conflict','unknown')),
  verified_locations integer,
  role_verification text check (role_verification is null or role_verification in ('verified','estimated','conflict','unknown')),
  data_conflicts text[] not null default '{}'::text[],
  why_now text,
  why_now_verified boolean not null default false,
  sales_action text check (sales_action is null or sales_action in ('pursue_now','nurture','low_priority')),
  source_urls jsonb not null default '[]'::jsonb,
  linkedin_connection_note text,
  linkedin_after_acceptance text,
  linkedin_no_reply_followup text,
  linkedin_meeting_request text,
  usage jsonb not null default '{}'::jsonb,
  web_searches_used smallint not null default 0 check (web_searches_used between 0 and 2),
  estimated_cost_usd numeric(12,6) not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_li_qualifications_user_started
  on public.lead_intelligence_qualifications(created_by, started_at desc);
create index if not exists idx_li_qualifications_suggestion_started
  on public.lead_intelligence_qualifications(suggestion_id, started_at desc);
create unique index if not exists uq_li_qualification_one_running
  on public.lead_intelligence_qualifications(suggestion_id)
  where status = 'running';

alter table public.lead_intelligence_qualifications enable row level security;
revoke all on public.lead_intelligence_qualifications from anon;
grant select, insert, update on public.lead_intelligence_qualifications to authenticated;

drop policy if exists lead_intelligence_qualifications_select on public.lead_intelligence_qualifications;
create policy lead_intelligence_qualifications_select
  on public.lead_intelligence_qualifications for select to authenticated
  using (public.can_use_lead_intelligence() and created_by = auth.uid());

drop policy if exists lead_intelligence_qualifications_insert on public.lead_intelligence_qualifications;
create policy lead_intelligence_qualifications_insert
  on public.lead_intelligence_qualifications for insert to authenticated
  with check (
    public.can_use_lead_intelligence()
    and created_by = auth.uid()
    and exists (
      select 1 from public.lead_intelligence_suggestions s
      where s.id = suggestion_id and s.created_by = auth.uid()
    )
  );

drop policy if exists lead_intelligence_qualifications_update on public.lead_intelligence_qualifications;
create policy lead_intelligence_qualifications_update
  on public.lead_intelligence_qualifications for update to authenticated
  using (public.can_use_lead_intelligence() and created_by = auth.uid())
  with check (public.can_use_lead_intelligence() and created_by = auth.uid());

comment on table public.lead_intelligence_qualifications is
  'Selective second-stage prospect qualification. Strong leads may use up to two web searches; weaker leads are analysed without web search. Stores refined fit, verification, LinkedIn messages and estimated AI cost.';
comment on column public.lead_intelligence_suggestions.qualification_estimated_cost_usd is
  'Estimated incremental OpenAI cost for the latest selective qualification pass, including actual web-search calls when measurable.';
