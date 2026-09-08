begin;

create table if not exists public.client_lifecycle_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  source_agreement_id uuid null references public.agreements(id) on delete set null,
  stage text not null default 'handover' check (stage in ('handover','setup','configuration','training','go_live','adoption','active_success','renewal')),
  status text not null default 'active' check (status in ('active','paused','completed','archived')),
  csm_user_id uuid null references public.profiles(id) on delete set null,
  csm_name text null,
  implementation_owner_id uuid null references public.profiles(id) on delete set null,
  implementation_owner_name text null,
  target_go_live_date date null,
  go_live_date date null,
  adoption_score numeric(5,2) null check (adoption_score is null or (adoption_score >= 0 and adoption_score <= 100)),
  health_score numeric(5,2) null check (health_score is null or (health_score >= 0 and health_score <= 100)),
  health_override text null check (health_override is null or health_override in ('healthy','watch','at_risk')),
  health_override_reason text null,
  renewal_risk text not null default 'unknown' check (renewal_risk in ('unknown','low','medium','high','confirmed','not_renewing')),
  renewal_due_date date null,
  renewal_status text not null default 'not_started' check (renewal_status in ('not_started','planning','review','commercial_confirmation','confirmed','not_renewing','renewed')),
  last_cs_contact_at timestamptz null,
  next_action text null,
  next_action_due date null,
  notes text null,
  created_by uuid null default auth.uid(),
  updated_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_lifecycle_checklist (
  id uuid primary key default gen_random_uuid(),
  lifecycle_id uuid not null references public.client_lifecycle_profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  phase text not null check (phase in ('handover','setup','configuration','training','go_live','adoption','success','renewal')),
  item_key text not null,
  item_label text not null,
  required boolean not null default true,
  status text not null default 'not_started' check (status in ('not_started','in_progress','blocked','completed','not_applicable')),
  owner_user_id uuid null references public.profiles(id) on delete set null,
  owner_name text null,
  due_date date null,
  completed_at timestamptz null,
  notes text null,
  sort_order integer not null default 0,
  created_by uuid null default auth.uid(),
  updated_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id,item_key)
);

create table if not exists public.client_success_plans (
  id uuid primary key default gen_random_uuid(),
  lifecycle_id uuid not null references public.client_lifecycle_profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  objective text not null,
  metric text null,
  target_value text null,
  current_value text null,
  owner_user_id uuid null references public.profiles(id) on delete set null,
  owner_name text null,
  due_date date null,
  status text not null default 'open' check (status in ('open','on_track','at_risk','completed','cancelled')),
  notes text null,
  created_by uuid null default auth.uid(),
  updated_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_training_sessions (
  id uuid primary key default gen_random_uuid(),
  lifecycle_id uuid not null references public.client_lifecycle_profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  training_type text not null default 'admin' check (training_type in ('admin','end_user','refresher','operational','other')),
  training_date date not null,
  trainer_user_id uuid null references public.profiles(id) on delete set null,
  trainer_name text null,
  attendees text null,
  attendee_count integer null check (attendee_count is null or attendee_count >= 0),
  status text not null default 'planned' check (status in ('planned','completed','cancelled','reschedule_required')),
  material_sent boolean not null default false,
  notes text null,
  created_by uuid null default auth.uid(),
  updated_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  lifecycle_id uuid not null references public.client_lifecycle_profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  event_type text not null,
  title text not null,
  detail text null,
  event_at timestamptz not null default now(),
  source_table text null,
  source_id text null,
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists client_lifecycle_profiles_stage_idx on public.client_lifecycle_profiles(stage,status);
create index if not exists client_lifecycle_profiles_renewal_idx on public.client_lifecycle_profiles(renewal_due_date);
create index if not exists client_lifecycle_checklist_client_phase_idx on public.client_lifecycle_checklist(client_id,phase,sort_order);
create index if not exists client_success_plans_client_idx on public.client_success_plans(client_id,status);
create index if not exists client_training_sessions_client_idx on public.client_training_sessions(client_id,training_date desc);
create index if not exists client_lifecycle_events_client_idx on public.client_lifecycle_events(client_id,event_at desc);

create or replace function public.client_lifecycle_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_table_name = 'client_lifecycle_checklist' then
    if new.status = 'completed' and (old.status is distinct from 'completed' or old.completed_at is null) then
      new.completed_at := coalesce(new.completed_at, now());
    elsif new.status <> 'completed' then
      new.completed_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_client_lifecycle_profiles_touch on public.client_lifecycle_profiles;
create trigger trg_client_lifecycle_profiles_touch before update on public.client_lifecycle_profiles for each row execute function public.client_lifecycle_touch_updated_at();
drop trigger if exists trg_client_lifecycle_checklist_touch on public.client_lifecycle_checklist;
create trigger trg_client_lifecycle_checklist_touch before update on public.client_lifecycle_checklist for each row execute function public.client_lifecycle_touch_updated_at();
drop trigger if exists trg_client_success_plans_touch on public.client_success_plans;
create trigger trg_client_success_plans_touch before update on public.client_success_plans for each row execute function public.client_lifecycle_touch_updated_at();
drop trigger if exists trg_client_training_sessions_touch on public.client_training_sessions;
create trigger trg_client_training_sessions_touch before update on public.client_training_sessions for each row execute function public.client_lifecycle_touch_updated_at();

create or replace function public.seed_client_lifecycle_checklist(p_lifecycle_id uuid, p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_lifecycle_checklist(lifecycle_id,client_id,phase,item_key,item_label,required,sort_order)
  values
    (p_lifecycle_id,p_client_id,'handover','agreement_confirmed','Signed agreement / commercial scope confirmed',true,10),
    (p_lifecycle_id,p_client_id,'handover','primary_contact_confirmed','Primary customer contact confirmed internally',true,20),
    (p_lifecycle_id,p_client_id,'handover','locations_confirmed','Sold locations / scope confirmed',true,30),
    (p_lifecycle_id,p_client_id,'handover','commercial_notes_handover','Sales promises and commercial notes handed over',true,40),
    (p_lifecycle_id,p_client_id,'setup','client_record_verified','ERP client record verified',true,10),
    (p_lifecycle_id,p_client_id,'setup','csm_assigned','CSM assigned',true,20),
    (p_lifecycle_id,p_client_id,'setup','implementation_owner_assigned','Internal implementation owner assigned',true,30),
    (p_lifecycle_id,p_client_id,'setup','location_setup_plan','Location setup plan prepared',true,40),
    (p_lifecycle_id,p_client_id,'configuration','locations_configured','Customer locations configured on InCheck 360 platform',true,10),
    (p_lifecycle_id,p_client_id,'configuration','modules_checklists_configured','Purchased modules / checklists configured',true,20),
    (p_lifecycle_id,p_client_id,'configuration','notification_escalation_reviewed','Notification / escalation setup reviewed',true,30),
    (p_lifecycle_id,p_client_id,'configuration','hardware_requirement_reviewed','Hardware requirement reviewed',false,40),
    (p_lifecycle_id,p_client_id,'training','admin_training','Admin / management training completed',true,10),
    (p_lifecycle_id,p_client_id,'training','end_user_training','Operational / end-user training completed',true,20),
    (p_lifecycle_id,p_client_id,'go_live','go_live_readiness_review','Go-live readiness review completed',true,10),
    (p_lifecycle_id,p_client_id,'go_live','launch_date_confirmed','Go-live date confirmed internally',true,20),
    (p_lifecycle_id,p_client_id,'adoption','first_adoption_review','First adoption review completed',true,10),
    (p_lifecycle_id,p_client_id,'adoption','inactive_usage_review','Inactive users / locations reviewed',false,20),
    (p_lifecycle_id,p_client_id,'success','success_objective_defined','At least one customer success objective defined',false,10),
    (p_lifecycle_id,p_client_id,'success','regular_cs_cadence','Ongoing CS contact cadence established',false,20),
    (p_lifecycle_id,p_client_id,'renewal','renewal_health_review','Renewal health review completed',true,10),
    (p_lifecycle_id,p_client_id,'renewal','renewal_decision_recorded','Renewal decision / confidence recorded',true,20)
  on conflict (client_id,item_key) do nothing;
end;
$$;

create or replace function public.client_lifecycle_after_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_client_lifecycle_checklist(new.id,new.client_id);
  return new;
end;
$$;

drop trigger if exists trg_client_lifecycle_seed_checklist on public.client_lifecycle_profiles;
create trigger trg_client_lifecycle_seed_checklist after insert on public.client_lifecycle_profiles for each row execute function public.client_lifecycle_after_profile_insert();

create or replace function public.client_lifecycle_after_client_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end date;
begin
  if new.source_agreement_id is not null then
    select a.service_end_date into v_end from public.agreements a where a.id = new.source_agreement_id;
  end if;
  insert into public.client_lifecycle_profiles(client_id,source_agreement_id,stage,renewal_due_date,created_by,updated_by)
  values(new.id,new.source_agreement_id,'handover',v_end,new.created_by,new.updated_by)
  on conflict (client_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_client_lifecycle_from_client on public.clients;
create trigger trg_client_lifecycle_from_client after insert on public.clients for each row execute function public.client_lifecycle_after_client_insert();

create or replace function public.client_lifecycle_log_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.stage is distinct from new.stage then
    insert into public.client_lifecycle_events(lifecycle_id,client_id,event_type,title,detail,source_table,source_id,created_by)
    values(new.id,new.client_id,'stage_change','Lifecycle stage changed',coalesce(old.stage,'') || ' → ' || coalesce(new.stage,''),'client_lifecycle_profiles',new.id::text,auth.uid());
  end if;
  if old.health_override is distinct from new.health_override then
    insert into public.client_lifecycle_events(lifecycle_id,client_id,event_type,title,detail,source_table,source_id,created_by)
    values(new.id,new.client_id,'health_change','Health override changed',coalesce(old.health_override,'system') || ' → ' || coalesce(new.health_override,'system'),'client_lifecycle_profiles',new.id::text,auth.uid());
  end if;
  if old.go_live_date is distinct from new.go_live_date and new.go_live_date is not null then
    insert into public.client_lifecycle_events(lifecycle_id,client_id,event_type,title,detail,event_at,source_table,source_id,created_by)
    values(new.id,new.client_id,'go_live','Go-live confirmed','Internal go-live confirmed for ' || new.go_live_date::text,new.go_live_date::timestamptz,'client_lifecycle_profiles',new.id::text,auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_client_lifecycle_profile_event on public.client_lifecycle_profiles;
create trigger trg_client_lifecycle_profile_event after update on public.client_lifecycle_profiles for each row execute function public.client_lifecycle_log_profile_change();

create or replace function public.client_lifecycle_log_checklist_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.client_lifecycle_events(lifecycle_id,client_id,event_type,title,detail,source_table,source_id,created_by)
    values(new.lifecycle_id,new.client_id,'checklist',new.item_label,coalesce(old.status,'') || ' → ' || coalesce(new.status,''),'client_lifecycle_checklist',new.id::text,auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_client_lifecycle_checklist_event on public.client_lifecycle_checklist;
create trigger trg_client_lifecycle_checklist_event after update on public.client_lifecycle_checklist for each row execute function public.client_lifecycle_log_checklist_change();

insert into public.client_lifecycle_profiles(client_id,source_agreement_id,stage,status,renewal_due_date,last_cs_contact_at,created_by,updated_by)
select c.id,
       c.source_agreement_id,
       case when lower(coalesce(c.status,'active'))='active' then 'active_success' else 'renewal' end,
       'active',
       coalesce((select max(r.renewal_date) from public.renewals r where r.client_id=c.id and coalesce(r.is_active,true)=true), a.service_end_date),
       (select max(ca.created_at) from public.csm_activities ca where ca.client_id=c.id),
       c.created_by,
       c.updated_by
from public.clients c
left join public.agreements a on a.id=c.source_agreement_id
on conflict (client_id) do nothing;

insert into public.role_permissions(role_key,resource,action,is_allowed,is_active)
select v.role_key,'client_lifecycle',v.action,true,true
from (values
  ('admin','view'),('admin','create'),('admin','update'),('admin','delete'),('admin','manage'),
  ('dev','view'),('dev','create'),('dev','update'),('dev','delete'),('dev','manage'),
  ('csm','view'),('csm','create'),('csm','update'),('csm','manage'),
  ('hoo','view'),('hoo','create'),('hoo','update'),('hoo','manage'),
  ('gm','view'),('gm','create'),('gm','update'),('gm','manage'),
  ('head_of_sales','view'),('head_of_sales','create'),('head_of_sales','update'),
  ('sales_executive','view'),('sales_executive','create'),('sales_executive','update'),
  ('accounting','view'),('sfc','view'),('hod','view'),('viewer','view')
) as v(role_key,action)
where not exists (
  select 1 from public.role_permissions rp
  where lower(rp.role_key)=lower(v.role_key)
    and lower(rp.resource)='client_lifecycle'
    and lower(rp.action)=lower(v.action)
);

alter table public.client_lifecycle_profiles enable row level security;
alter table public.client_lifecycle_checklist enable row level security;
alter table public.client_success_plans enable row level security;
alter table public.client_training_sessions enable row level security;
alter table public.client_lifecycle_events enable row level security;

revoke all on public.client_lifecycle_profiles, public.client_lifecycle_checklist, public.client_success_plans, public.client_training_sessions, public.client_lifecycle_events from anon;
grant select,insert,update,delete on public.client_lifecycle_profiles, public.client_lifecycle_checklist, public.client_success_plans, public.client_training_sessions, public.client_lifecycle_events to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['client_lifecycle_profiles','client_lifecycle_checklist','client_success_plans','client_training_sessions','client_lifecycle_events']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.app_has_permission(''client_lifecycle'',''view'') or public.app_has_permission(''client_lifecycle'',''manage''))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.app_has_permission(''client_lifecycle'',''create'') or public.app_has_permission(''client_lifecycle'',''manage''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.app_has_permission(''client_lifecycle'',''update'') or public.app_has_permission(''client_lifecycle'',''manage'')) with check (public.app_has_permission(''client_lifecycle'',''update'') or public.app_has_permission(''client_lifecycle'',''manage''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.app_has_permission(''client_lifecycle'',''delete'') or public.app_has_permission(''client_lifecycle'',''manage''))', t || '_delete', t);
  end loop;
end $$;

commit;
