-- Monitor Core ERP: make Reseller Market Check contact-aware while keeping results status-only.
-- This replacement also covers standalone CRM contacts and reseller contacts without exposing owner/contact data.

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
declare
  n text := private.reseller_norm(p_company_name);
  d text := private.reseller_domain(coalesce(nullif(p_website,''), p_email));
  em text := lower(btrim(coalesce(p_email,'')));
  ph text := private.reseller_digits(p_phone);
  result text := 'available';
  label text := 'Available';
begin
  if not private.reseller_is_admin() then
    raise exception 'Not authorized';
  end if;

  if n='' and d='' and em='' and ph='' then
    raise exception 'Enter a company name, website/email domain, email, or phone';
  end if;

  -- Existing customers: direct client match, activated reseller company match,
  -- or a reseller contact attached to an activated reseller customer.
  if exists(
      select 1 from public.clients c
       where (n<>'' and private.reseller_norm(coalesce(c.company_name,c.client_name))=n)
          or (d<>'' and private.reseller_domain(c.primary_email)=d)
          or (em<>'' and lower(btrim(coalesce(c.primary_email,'')))=em)
          or (ph<>'' and private.reseller_digits(c.primary_phone)=ph)
    )
    or exists(
      select 1
        from public.reseller_activations a
        join public.reseller_companies c on c.id=a.company_id
       where a.status='activated'
         and (
           (n<>'' and private.reseller_norm(c.company_name)=n)
           or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
           or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
           or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
         )
    )
    or exists(
      select 1
        from public.reseller_contacts rc
        join public.reseller_activations a on a.company_id=rc.company_id and a.status='activated'
       where (em<>'' and lower(btrim(coalesce(rc.email,'')))=em)
          or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph))
    ) then
    result := 'existing_customer';
    label := 'Existing Customer';

  -- Pending registration, including a contact already registered under that pending company.
  elsif exists(
      select 1
        from public.reseller_ownerships o
        join public.reseller_companies c on c.id=o.company_id
       where o.status='pending'
         and (
           (n<>'' and private.reseller_norm(c.company_name)=n)
           or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
           or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
           or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
         )
    )
    or exists(
      select 1
        from public.reseller_contacts rc
        join public.reseller_ownerships o on o.company_id=rc.company_id and o.status='pending'
       where (em<>'' and lower(btrim(coalesce(rc.email,'')))=em)
          or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph))
    ) then
    result := 'pending_registration';
    label := 'Pending Registration';

  -- Any active ownership/direct CRM/contact/lead/deal means somebody is already working it.
  elsif exists(
      select 1
        from public.reseller_ownerships o
        join public.reseller_companies c on c.id=o.company_id
       where o.status='approved'
         and (o.expires_at is null or o.expires_at>now())
         and (
           (n<>'' and private.reseller_norm(c.company_name)=n)
           or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
           or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
           or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
         )
    )
    or exists(
      select 1
        from public.reseller_contacts rc
        join public.reseller_ownerships o on o.company_id=rc.company_id
       where o.status='approved'
         and (o.expires_at is null or o.expires_at>now())
         and (
           (em<>'' and lower(btrim(coalesce(rc.email,'')))=em)
           or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph))
         )
    )
    or exists(
      select 1 from public.companies c
       where coalesce(lower(c.company_status),'') not in ('inactive','archived','lost','released')
         and (
           (n<>'' and private.reseller_norm(coalesce(c.company_name,c.name,c.legal_name))=n)
           or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
           or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
           or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
         )
    )
    or exists(
      select 1 from public.contacts c
       where coalesce(lower(c.contact_status),'active') not in ('inactive','left_company')
         and (
           (em<>'' and lower(btrim(coalesce(c.email,'')))=em)
           or (ph<>'' and (private.reseller_digits(c.phone)=ph or private.reseller_digits(c.mobile)=ph))
         )
    )
    or exists(
      select 1 from public.leads l
       where coalesce(lower(l.status),'') not in ('lost','closed','converted','inactive')
         and (
           (n<>'' and private.reseller_norm(coalesce(l.company_name,l.customer_name,l.full_name))=n)
           or (d<>'' and private.reseller_domain(coalesce(l.contact_email,l.email))=d)
           or (em<>'' and lower(btrim(coalesce(l.contact_email,l.email,'')))=em)
           or (ph<>'' and private.reseller_digits(coalesce(l.contact_phone,l.phone))=ph)
         )
    )
    or exists(
      select 1 from public.deals x
       where coalesce(lower(x.stage),'') not in ('lost')
         and (
           (n<>'' and private.reseller_norm(coalesce(x.company_name,x.customer_name,x.full_name))=n)
           or (d<>'' and private.reseller_domain(coalesce(x.contact_email,x.email))=d)
           or (em<>'' and lower(btrim(coalesce(x.contact_email,x.email,'')))=em)
           or (ph<>'' and private.reseller_digits(coalesce(x.contact_phone,x.phone))=ph)
         )
    ) then
    result := 'already_engaged';
    label := 'Already Engaged';

  -- Previously held records can be surfaced as released without revealing owner/history.
  elsif exists(
      select 1 from public.reseller_companies c
       where c.company_status in ('released','inactive','lost')
         and (
           (n<>'' and private.reseller_norm(c.company_name)=n)
           or (d<>'' and (private.reseller_domain(c.website)=d or private.reseller_domain(c.main_email)=d))
           or (em<>'' and lower(btrim(coalesce(c.main_email,'')))=em)
           or (ph<>'' and private.reseller_digits(c.main_phone)=ph)
         )
    )
    or exists(
      select 1
        from public.reseller_contacts rc
        join public.reseller_companies c on c.id=rc.company_id
       where c.company_status in ('released','inactive','lost')
         and (
           (em<>'' and lower(btrim(coalesce(rc.email,'')))=em)
           or (ph<>'' and (private.reseller_digits(rc.phone)=ph or private.reseller_digits(rc.mobile)=ph))
         )
    ) then
    result := 'released';
    label := 'Inactive / Released';
  end if;

  insert into public.reseller_market_checks(
    reseller_id,company_name,website,email,phone,result_status,checked_by
  ) values(
    p_reseller_id,p_company_name,p_website,p_email,p_phone,result,auth.uid()
  );

  return query select result,label;
end;
$$;

revoke all on function private.reseller_market_check_impl(uuid,text,text,text,text) from public,anon;
grant execute on function private.reseller_market_check_impl(uuid,text,text,text,text) to authenticated;
