-- Preserve Unicode letters/numbers when normalizing company names for Market Check.
create or replace function private.reseller_norm(p_value text)
returns text
language sql
immutable
set search_path=pg_catalog
as $$
  select lower(regexp_replace(coalesce(p_value,''),'[^[:alnum:]]+','','g'));
$$;
