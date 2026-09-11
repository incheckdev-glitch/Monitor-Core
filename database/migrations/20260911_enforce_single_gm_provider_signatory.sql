-- Enforce a single provider signatory on every agreement.
-- Provider signer: Hanna Khattar, General Manager.
-- Secondary / financial-controller provider signature fields are cleared.

create or replace function public.enforce_single_gm_provider_signatory()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_gm_sign_date date;
begin
  v_gm_sign_date := case
    when lower(trim(coalesce(new.provider_official_signatory_1_name, ''))) = 'hanna khattar'
      then new.provider_official_signatory_1_sign_date
    when lower(trim(coalesce(new.provider_official_signatory_2_name, ''))) = 'hanna khattar'
      then new.provider_official_signatory_2_sign_date
    else new.provider_sign_date
  end;

  new.provider_official_signatory_1_name := 'Hanna Khattar';
  new.provider_official_signatory_1_title := 'General Manager';
  new.provider_official_signatory_1_sign_date := v_gm_sign_date;

  new.provider_official_signatory_2_name := null;
  new.provider_official_signatory_2_title := null;
  new.provider_official_signatory_2_sign_date := null;

  new.provider_signatory_name := 'Hanna Khattar';
  new.provider_signatory_title := 'General Manager';
  new.provider_primary_signatory_name := 'Hanna Khattar';
  new.provider_primary_signatory_title := 'General Manager';

  new.provider_signatory_secondary := null;
  new.provider_signatory_name_secondary := null;
  new.provider_signatory_title_secondary := null;
  new.provider_secondary_signatory_name := null;
  new.provider_secondary_signatory_title := null;

  new.provider_sign_date := v_gm_sign_date;
  new.financial_controller_signed := false;

  return new;
end;
$$;

drop trigger if exists trg_agreements_single_gm_provider_signatory on public.agreements;
create trigger trg_agreements_single_gm_provider_signatory
before insert or update on public.agreements
for each row execute function public.enforce_single_gm_provider_signatory();

-- Normalize existing agreements while preserving a GM signature date when one exists.
update public.agreements
set
  provider_official_signatory_1_sign_date = case
    when lower(trim(coalesce(provider_official_signatory_1_name,''))) = 'hanna khattar' then provider_official_signatory_1_sign_date
    when lower(trim(coalesce(provider_official_signatory_2_name,''))) = 'hanna khattar' then provider_official_signatory_2_sign_date
    else provider_sign_date
  end,
  provider_official_signatory_1_name = 'Hanna Khattar',
  provider_official_signatory_1_title = 'General Manager',
  provider_official_signatory_2_name = null,
  provider_official_signatory_2_title = null,
  provider_official_signatory_2_sign_date = null,
  provider_signatory_name = 'Hanna Khattar',
  provider_signatory_title = 'General Manager',
  provider_primary_signatory_name = 'Hanna Khattar',
  provider_primary_signatory_title = 'General Manager',
  provider_signatory_secondary = null,
  provider_signatory_name_secondary = null,
  provider_signatory_title_secondary = null,
  provider_secondary_signatory_name = null,
  provider_secondary_signatory_title = null,
  provider_sign_date = case
    when lower(trim(coalesce(provider_official_signatory_1_name,''))) = 'hanna khattar' then provider_official_signatory_1_sign_date
    when lower(trim(coalesce(provider_official_signatory_2_name,''))) = 'hanna khattar' then provider_official_signatory_2_sign_date
    else provider_sign_date
  end,
  financial_controller_signed = false,
  updated_at = now();