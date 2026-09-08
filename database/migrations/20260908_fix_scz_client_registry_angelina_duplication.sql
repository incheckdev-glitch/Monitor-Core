-- Fix SCZ SAL. / Angelina duplicate source in Client Success 360
-- Applied to legacy Monitor Core Supabase project on 2026-09-08.
--
-- Issue:
-- The Clients registry row for SCZ SAL. was linked to Company#00038 / The Table Set.
-- CS360 therefore merged SCZ SAL. with The Table Set and generated two Angelina targets:
--   1) SCZ SAL. -> Angelina
--   2) The Table Set -> Angelina
--
-- Fix:
-- Relink the SCZ SAL. client registry row to Company#00311 and make all client-name
-- snapshots consistent with SCZ SAL. This keeps Angelina owned only by SCZ SAL.

begin;

update public.clients
set company_id = 'Company#00311',
    company_name = 'SCZ SAL.',
    customer_name = 'SCZ SAL.',
    customer_legal_name = 'SCZ SAL.',
    legal_name = coalesce(nullif(trim(legal_name), ''), 'SCZ SAL.'),
    updated_at = now()
where id = 'c322f337-7d73-4bae-9f7e-0c3e3f1c74a4'
  and client_name = 'SCZ SAL.'
  and (
    company_id is distinct from 'Company#00311'
    or company_name is distinct from 'SCZ SAL.'
    or customer_name is distinct from 'SCZ SAL.'
    or customer_legal_name is distinct from 'SCZ SAL.'
  );

-- Safety cleanup: no saved completion row should keep Angelina under The Table Set.
update public.cs_location_completions
set company_id = '714ec0aa-9ba5-4774-9e13-dc06aa6f9bf9',
    company_name_snapshot = 'SCZ SAL.',
    group_name = 'Boubes Group',
    brand_name = null,
    updated_at = now()
where lower(trim(location_name)) = 'angelina'
  and company_id = 'da503398-6a0c-4d3e-9bac-42efc1def2a2';

commit;
