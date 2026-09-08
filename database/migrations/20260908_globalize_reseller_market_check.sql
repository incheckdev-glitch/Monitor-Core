-- Global Market Check for Reseller Management.
-- A search checks InCheck 360 main CRM + clients + the full reseller network.
-- Reseller users still receive status only; no owner/reseller/contact details are exposed.

create or replace function private.reseller_global_market_status(
  p_company_name text,
  p_website text,
  p_email text,
  p_phone text
)
returns table(status text,status_label text)
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare
  n text := private.reseller_norm(p_company_name);
  website_domain text := private.reseller_domain(p_website);
  email_domain text := private.reseller_domain(p_email);
  d text := '';
  em text := lower(btrim(coalesce(p_email,'')));
  ph text := private.reseller_digits(p_phone);
  hit boolean := false;
begin
  if website_domain<>'' then
    d := website_domain;
  elsif email_domain<>'' and email_domain not in (
    'gmail.com','googlemail.com','yahoo.com','hotmail.com','outlook.com','live.com',
    'icloud.com','me.com','protonmail.com','proton.me','aol.com','gmx.com','mail.com','yandex.com'
  ) then
    d := email_domain;
  end if;

  if n='' and d='' and em='' and ph='' then
    raise exception 'Enter a company name, website, email, or phone';
  end if;

  -- 1) Existing customer anywhere in the InCheck ecosystem.
  select exists(
    select 1 from public.clients c
    where coalesce(lower(c.status),'active') not in ('inactive','archived','cancelled','lost','released')
      and (
        (n<>'' and private.reseller_norm(coalesce(c.company_name,c.client_name))=n)
        or (d<>'' and private.reseller_domain(c.primary_email)=d)
        or (em<>'' and lower(btrim(coalesce(c.primary_email,'')))=em)
        or (ph<>'' and private.reseller_digits(c.primary_phone)=ph)
      )
  ) into hit;

  if not hit then
    select exists(
      select 1
      from public.reseller_companies c
      left join public.reseller_activations a on a.company_id=c.id and a.status='activated'
      where (c.company_status='customer' or a.id is not null)
        and (
          (n<>'' and private.reseller_norm(c.company_name)=n)
          or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
          or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
          or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
        )
    ) into hit;
  end if;

  if not hit and (em<>'' or ph<>'') then
    select exists(
      select 1
      from public.reseller_contacts rc
      join public.reseller_companies c on c.id=rc.company_id
      left join public.reseller_activations a on a.company_id=c.id and a.status='activated'
      where (c.company_status='customer' or a.id is not null)
        and (
          (em<>'' and lower(btrim(coalesce(rc.email,'')))=em)
          or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph))
        )
    ) into hit;
  end if;

  if hit then
    return query select 'existing_customer'::text,'Existing Customer'::text;
    return;
  end if;

  -- 2) Pending registration anywhere in the reseller network.
  select exists(
    select 1 from public.reseller_ownerships o
    join public.reseller_companies c on c.id=o.company_id
    where o.status='pending'
      and (
        (n<>'' and private.reseller_norm(c.company_name)=n)
        or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
        or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
        or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
        or exists(
          select 1 from public.reseller_contacts rc
          where rc.company_id=c.id and coalesce(rc.contact_status,'active') not in ('inactive','left_company')
            and (
              (em<>'' and lower(btrim(coalesce(rc.email,'')))=em)
              or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph))
            )
        )
      )
  ) into hit;

  if hit then
    return query select 'pending_registration'::text,'Pending Registration'::text;
    return;
  end if;

  -- 3) Active reseller ownership or any active reseller CRM work.
  select exists(
    select 1 from public.reseller_ownerships o
    join public.reseller_companies c on c.id=o.company_id
    where o.status='approved' and (o.expires_at is null or o.expires_at>now())
      and (
        (n<>'' and private.reseller_norm(c.company_name)=n)
        or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
        or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
        or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
      )
  ) into hit;

  if not hit then
    select exists(
      select 1 from public.reseller_companies c
      where c.company_status not in ('inactive','released','lost')
        and (
          (n<>'' and private.reseller_norm(c.company_name)=n)
          or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
          or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
          or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
        )
    ) into hit;
  end if;

  if not hit and (em<>'' or ph<>'') then
    select exists(
      select 1 from public.reseller_contacts rc
      where coalesce(rc.contact_status,'active') not in ('inactive','left_company')
        and (
          (em<>'' and lower(btrim(coalesce(rc.email,'')))=em)
          or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph))
        )
    ) into hit;
  end if;

  if not hit then
    select exists(
      select 1 from public.reseller_leads l
      left join public.reseller_companies c on c.id=l.company_id
      left join public.reseller_contacts rc on rc.id=l.contact_id
      where coalesce(lower(l.status),'') not in ('lost','closed','inactive')
        and (
          (n<>'' and private.reseller_norm(c.company_name)=n)
          or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
          or (em<>'' and (lower(btrim(coalesce(rc.email,'')))=em or lower(btrim(coalesce(c.main_email,'')))=em))
          or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph or private.reseller_digits(c.main_phone)=ph))
        )
    ) into hit;
  end if;

  if not hit then
    select exists(
      select 1 from public.reseller_deals x
      left join public.reseller_companies c on c.id=x.company_id
      left join public.reseller_contacts rc on rc.id=x.contact_id
      where coalesce(lower(x.stage),'')<>'lost'
        and (
          (n<>'' and private.reseller_norm(c.company_name)=n)
          or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
          or (em<>'' and (lower(btrim(coalesce(rc.email,'')))=em or lower(btrim(coalesce(c.main_email,'')))=em))
          or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph or private.reseller_digits(c.main_phone)=ph))
        )
    ) into hit;
  end if;

  -- 4) InCheck 360 main CRM: companies, contacts, leads and deals.
  if not hit then
    select exists(
      select 1 from public.companies c
      where coalesce(lower(c.company_status),'') not in ('inactive','archived','lost','released')
        and (
          (n<>'' and private.reseller_norm(coalesce(c.company_name,c.name,c.legal_name))=n)
          or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
          or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
          or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
        )
    ) into hit;
  end if;

  if not hit and (em<>'' or ph<>'') then
    select exists(
      select 1 from public.contacts c
      where coalesce(lower(c.contact_status),'active') not in ('inactive','left_company')
        and (
          (em<>'' and lower(btrim(coalesce(c.email,'')))=em)
          or (ph<>'' and (private.reseller_digits(c.phone)=ph or private.reseller_digits(c.mobile)=ph))
        )
    ) into hit;
  end if;

  if not hit then
    select exists(
      select 1 from public.leads l
      where coalesce(lower(l.status),'') not in ('lost','closed','inactive')
        and (
          (n<>'' and private.reseller_norm(coalesce(l.company_name,l.customer_name,l.full_name))=n)
          or (d<>'' and private.reseller_domain(coalesce(l.contact_email,l.email))=d)
          or (em<>'' and lower(btrim(coalesce(l.contact_email,l.email,'')))=em)
          or (ph<>'' and private.reseller_digits(coalesce(l.contact_phone,l.phone))=ph)
        )
    ) into hit;
  end if;

  if not hit then
    select exists(
      select 1 from public.deals x
      where coalesce(lower(x.stage),'')<>'lost'
        and (
          (n<>'' and private.reseller_norm(coalesce(x.company_name,x.customer_name,x.full_name))=n)
          or (d<>'' and private.reseller_domain(coalesce(x.contact_email,x.email))=d)
          or (em<>'' and lower(btrim(coalesce(x.contact_email,x.email,'')))=em)
          or (ph<>'' and private.reseller_digits(coalesce(x.contact_phone,x.phone))=ph)
        )
    ) into hit;
  end if;

  if hit then
    return query select 'already_engaged'::text,'Already Engaged'::text;
    return;
  end if;

  -- 5) Released/inactive history can be shown without exposing who held it.
  select exists(
    select 1 from public.reseller_companies c
    where c.company_status in ('inactive','released','lost')
      and (
        (n<>'' and private.reseller_norm(c.company_name)=n)
        or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
        or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
        or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
      )
  ) into hit;

  if not hit then
    select exists(
      select 1 from public.companies c
      where coalesce(lower(c.company_status),'') in ('inactive','archived','lost','released')
        and (
          (n<>'' and private.reseller_norm(coalesce(c.company_name,c.name,c.legal_name))=n)
          or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
          or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
          or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
        )
    ) into hit;
  end if;

  if hit then
    return query select 'released'::text,'Inactive / Released'::text;
  else
    return query select 'available'::text,'Available'::text;
  end if;
end;
$$;

create or replace function private.reseller_market_check_impl(
  p_reseller_id uuid,
  p_company_name text,
  p_website text,
  p_email text,
  p_phone text
)
returns table(status text,status_label text)
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare r record;
begin
  if not private.reseller_is_admin() then raise exception 'Not authorized'; end if;
  select * into r from private.reseller_global_market_status(p_company_name,p_website,p_email,p_phone);
  insert into public.reseller_market_checks(reseller_id,company_name,website,email,phone,result_status,checked_by)
  values(p_reseller_id,p_company_name,p_website,p_email,p_phone,r.status,(select auth.uid()));
  return query select r.status::text,r.status_label::text;
end;
$$;

create or replace function private.reseller_user_market_check_impl(
  p_company_name text,
  p_website text,
  p_email text,
  p_phone text
)
returns table(status text,status_label text)
language plpgsql
security definer
set search_path=public,private,pg_temp
as $$
declare rid uuid:=private.reseller_current_reseller_id(); r record;
begin
  if private.reseller_current_role()<>'reseller_user' or rid is null then raise exception 'Reseller account is not linked.'; end if;
  select * into r from private.reseller_global_market_status(p_company_name,p_website,p_email,p_phone);
  insert into public.reseller_market_checks(reseller_id,company_name,website,email,phone,result_status,checked_by)
  values(rid,p_company_name,p_website,p_email,p_phone,r.status,(select auth.uid()));
  return query select r.status::text,r.status_label::text;
end;
$$;

revoke all on function private.reseller_global_market_status(text,text,text,text) from public,anon,authenticated;
revoke all on function private.reseller_market_check_impl(uuid,text,text,text,text) from public,anon;
revoke all on function private.reseller_user_market_check_impl(text,text,text,text) from public,anon;
grant execute on function private.reseller_market_check_impl(uuid,text,text,text,text) to authenticated;
grant execute on function private.reseller_user_market_check_impl(text,text,text,text) to authenticated;
