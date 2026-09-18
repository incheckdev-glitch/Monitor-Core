-- Enhanced Reseller Market Check:
-- - preserves the existing exact global checks and public RPC contracts
-- - adds fuzzy company-name duplicate detection only when the exact result is Available
-- - returns only a masked similar-company hint; owner/contact/commercial details remain private

create extension if not exists pg_trgm with schema extensions;

create or replace function private.reseller_name_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(coalesce(p_value,'')),
          '[^[:alnum:]]+',
          ' ',
          'g'
        ),
        '\m(sal|sarl|llc|ltd|limited|inc|incorporated|plc|company|companies|co|holding|holdings|group)\M',
        ' ',
        'gi'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function private.reseller_mask_company_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select string_agg(
        case
          when length(w.word) <= 1 then left(w.word,1) || '*'
          else left(w.word,1) || repeat('*', greatest(length(w.word)-1,1))
        end,
        ' ' order by w.ord
      )
      from regexp_split_to_table(
        regexp_replace(trim(coalesce(p_value,'')), '[[:space:]]+', ' ', 'g'),
        ' '
      ) with ordinality as w(word,ord)
      where w.word <> ''
    ),
    ''
  );
$$;

create or replace function private.reseller_name_similarity(p_query text, p_candidate text)
returns numeric
language sql
immutable
set search_path = ''
as $$
with vals as (
  select
    private.reseller_name_key(p_query) as q,
    private.reseller_name_key(p_candidate) as c
),
scores as (
  select
    q,
    c,
    case
      when q = '' or c = '' then 0::numeric
      when q = c then 1::numeric
      when length(q) >= 5 and length(c) >= 5
           and (q like '%' || c || '%' or c like '%' || q || '%')
        then 0.95::numeric
      else greatest(
        extensions.similarity(q,c)::numeric,
        least(greatest(
          extensions.word_similarity(q,c),
          extensions.word_similarity(c,q)
        )::numeric, 0.88::numeric),
        case when exists (
          select 1
          from regexp_split_to_table(q,' ') qtok(token)
          join regexp_split_to_table(c,' ') ctok(token) using (token)
          where length(qtok.token) >= 5
            and qtok.token not in (
              'restaurant','restaurants','cafe','coffee','bakery',
              'food','foods','trading','services','service',
              'group','holding','holdings','company','companies',
              'limited','incorporated'
            )
        ) then 0.82::numeric else 0::numeric end
      )
    end as score
  from vals
)
select round(score,4) from scores;
$$;

create or replace function private.reseller_similar_company_match(p_company_name text)
returns table(masked_company_name text, match_score numeric, confidence text)
language sql
stable
security definer
set search_path = ''
as $$
with candidates as (
  select coalesce(c.company_name,c.client_name) as company_name
  from public.clients c
  where coalesce(lower(c.status),'active') not in ('inactive','archived','cancelled','lost','released')

  union all

  select c.company_name
  from public.reseller_companies c
  where coalesce(lower(c.company_status),'prospect') not in ('inactive','released','lost')

  union all

  select coalesce(c.company_name,c.name,c.legal_name)
  from public.companies c
  where coalesce(lower(c.company_status),'') not in ('inactive','archived','lost','released')

  union all

  select coalesce(l.company_name,l.customer_name,l.full_name)
  from public.leads l
  where coalesce(lower(l.status),'') not in ('lost','closed','inactive')

  union all

  select coalesce(d.company_name,d.customer_name,d.full_name)
  from public.deals d
  where coalesce(lower(d.stage),'') <> 'lost'
),
scored as (
  select
    company_name,
    private.reseller_name_similarity(p_company_name, company_name) as score
  from candidates
  where btrim(coalesce(company_name,'')) <> ''
    and length(private.reseller_name_key(p_company_name)) >= 4
),
best as (
  select company_name, score
  from scored
  where score >= 0.72
  order by score desc, length(company_name) asc
  limit 1
)
select
  private.reseller_mask_company_name(company_name),
  score,
  case when score >= 0.88 then 'high'::text else 'possible'::text end
from best;
$$;

revoke all on function private.reseller_name_key(text) from public, anon, authenticated;
revoke all on function private.reseller_mask_company_name(text) from public, anon, authenticated;
revoke all on function private.reseller_name_similarity(text,text) from public, anon, authenticated;
revoke all on function private.reseller_similar_company_match(text) from public, anon, authenticated;

create or replace function private.reseller_market_status_enhanced(
  p_company_name text,
  p_website text,
  p_email text,
  p_phone text
)
returns table(status text, status_label text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  m record;
begin
  select *
  into r
  from private.reseller_global_market_status(
    p_company_name,
    p_website,
    p_email,
    p_phone
  );

  if r.status = 'available'
     and btrim(coalesce(p_company_name,'')) <> '' then
    select *
    into m
    from private.reseller_similar_company_match(p_company_name);

    if found then
      return query
      select
        'already_engaged'::text,
        (
          case
            when m.confidence = 'high'
              then 'Strong similar company'
            else 'Possible similar company'
          end
          || ' · '
          || m.masked_company_name
          || ' · Full details protected'
        )::text;
      return;
    end if;
  end if;

  return query select r.status::text, r.status_label::text;
end;
$$;

revoke all on function private.reseller_market_status_enhanced(text,text,text,text) from public, anon, authenticated;

create or replace function private.reseller_market_check_impl(
  p_reseller_id uuid,
  p_company_name text,
  p_website text,
  p_email text,
  p_phone text
)
returns table(status text, status_label text)
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  if not private.reseller_is_admin() then
    raise exception 'Not authorized';
  end if;

  select *
  into r
  from private.reseller_market_status_enhanced(
    p_company_name,
    p_website,
    p_email,
    p_phone
  );

  insert into public.reseller_market_checks(
    reseller_id,company_name,website,email,phone,result_status,checked_by
  )
  values(
    p_reseller_id,p_company_name,p_website,p_email,p_phone,r.status,(select auth.uid())
  );

  return query select r.status::text,r.status_label::text;
end;
$$;

create or replace function private.reseller_user_market_check_impl(
  p_company_name text,
  p_website text,
  p_email text,
  p_phone text
)
returns table(status text, status_label text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid := private.reseller_current_reseller_id();
  r record;
begin
  if private.reseller_current_role() <> 'reseller_user' or rid is null then
    raise exception 'Reseller account is not linked.';
  end if;

  select *
  into r
  from private.reseller_market_status_enhanced(
    p_company_name,
    p_website,
    p_email,
    p_phone
  );

  insert into public.reseller_market_checks(
    reseller_id,company_name,website,email,phone,result_status,checked_by
  )
  values(
    rid,p_company_name,p_website,p_email,p_phone,r.status,(select auth.uid())
  );

  return query select r.status::text,r.status_label::text;
end;
$$;
