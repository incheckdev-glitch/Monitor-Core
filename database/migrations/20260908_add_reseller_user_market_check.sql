-- Status-only Market Check for reseller_user.
-- The reseller id is resolved from the authenticated user's reseller link and is never accepted from the browser.

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
declare
  rid uuid := private.reseller_current_reseller_id();
  n text := private.reseller_norm(p_company_name);
  d text := private.reseller_domain(coalesce(nullif(p_website,''),p_email));
  em text := lower(btrim(coalesce(p_email,'')));
  ph text := private.reseller_digits(p_phone);
  hit boolean := false;
  result text := 'available';
  label text := 'Available';
begin
  if private.reseller_current_role()<>'reseller_user' or rid is null then
    raise exception 'Reseller account is not linked.';
  end if;
  if n='' and d='' and em='' and ph='' then
    raise exception 'Enter a company name, website/email domain, email, or phone';
  end if;

  select exists(
    select 1 from public.clients c
    where (n<>'' and private.reseller_norm(coalesce(c.company_name,c.client_name))=n)
       or (d<>'' and private.reseller_domain(c.primary_email)=d)
       or (em<>'' and lower(btrim(coalesce(c.primary_email,'')))=em)
       or (ph<>'' and private.reseller_digits(c.primary_phone)=ph)
  ) into hit;

  if not hit then
    select exists(
      select 1 from public.reseller_activations a
      join public.reseller_companies c on c.id=a.company_id
      where a.status='activated' and (
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
      join public.reseller_activations a on a.company_id=rc.company_id and a.status='activated'
      where (em<>'' and lower(btrim(coalesce(rc.email,'')))=em)
         or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph))
    ) into hit;
  end if;

  if hit then
    result:='existing_customer'; label:='Existing Customer';
  else
    select exists(
      select 1 from public.reseller_ownerships o
      join public.reseller_companies c on c.id=o.company_id
      where o.status='pending' and (
        (n<>'' and private.reseller_norm(c.company_name)=n)
        or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
        or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
        or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
      )
    ) into hit;

    if not hit and (em<>'' or ph<>'') then
      select exists(
        select 1 from public.reseller_contacts rc
        join public.reseller_ownerships o on o.company_id=rc.company_id and o.status='pending'
        where (em<>'' and lower(btrim(coalesce(rc.email,'')))=em)
           or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph))
      ) into hit;
    end if;

    if hit then
      result:='pending_registration'; label:='Pending Registration';
    else
      select exists(
        select 1 from public.reseller_ownerships o
        join public.reseller_companies c on c.id=o.company_id
        where o.status='approved' and (o.expires_at is null or o.expires_at>now()) and (
          (n<>'' and private.reseller_norm(c.company_name)=n)
          or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
          or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
          or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
        )
      ) into hit;

      if not hit and (em<>'' or ph<>'') then
        select exists(
          select 1 from public.reseller_contacts rc
          join public.reseller_ownerships o on o.company_id=rc.company_id
          where o.status='approved' and (o.expires_at is null or o.expires_at>now()) and (
            (em<>'' and lower(btrim(coalesce(rc.email,'')))=em)
            or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph))
          )
        ) into hit;
      end if;

      if not hit then
        select exists(
          select 1 from public.companies c
          where coalesce(lower(c.company_status),'') not in ('inactive','archived','lost','released') and (
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
          where coalesce(lower(c.contact_status),'active') not in ('inactive','left_company') and (
            (em<>'' and lower(btrim(coalesce(c.email,'')))=em)
            or (ph<>'' and (private.reseller_digits(c.phone)=ph or private.reseller_digits(c.mobile)=ph))
          )
        ) into hit;
      end if;

      if not hit then
        select exists(
          select 1 from public.leads l
          where coalesce(lower(l.status),'') not in ('lost','closed','converted','inactive') and (
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
          where coalesce(lower(x.stage),'')<>'lost' and (
            (n<>'' and private.reseller_norm(coalesce(x.company_name,x.customer_name,x.full_name))=n)
            or (d<>'' and private.reseller_domain(coalesce(x.contact_email,x.email))=d)
            or (em<>'' and lower(btrim(coalesce(x.contact_email,x.email,'')))=em)
            or (ph<>'' and private.reseller_digits(coalesce(x.contact_phone,x.phone))=ph)
          )
        ) into hit;
      end if;

      if hit then
        result:='already_engaged'; label:='Already Engaged';
      else
        select exists(
          select 1 from public.reseller_companies c
          where c.company_status in ('released','inactive','lost') and (
            (n<>'' and private.reseller_norm(c.company_name)=n)
            or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
            or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
            or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
          )
        ) into hit;
        if hit then result:='released'; label:='Inactive / Released'; end if;
      end if;
    end if;
  end if;

  insert into public.reseller_market_checks(reseller_id,company_name,website,email,phone,result_status,checked_by)
  values(rid,p_company_name,p_website,p_email,p_phone,result,(select auth.uid()));

  return query select result,label;
end;
$$;

create or replace function public.reseller_user_market_check(
  p_company_name text default null,
  p_website text default null,
  p_email text default null,
  p_phone text default null
)
returns table(status text,status_label text)
language sql
security invoker
set search_path=public,private,pg_temp
as $$
  select * from private.reseller_user_market_check_impl(p_company_name,p_website,p_email,p_phone);
$$;

revoke all on function private.reseller_user_market_check_impl(text,text,text,text) from public,anon;
revoke all on function public.reseller_user_market_check(text,text,text,text) from public,anon;
grant execute on function private.reseller_user_market_check_impl(text,text,text,text) to authenticated;
grant execute on function public.reseller_user_market_check(text,text,text,text) to authenticated;
