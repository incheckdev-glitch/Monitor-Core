-- Fix role normalization used by RLS and workflow logic.
-- The previous regex treated the letter "s" as a character to replace,
-- turning values such as head_of_sales into head_of__ale_.

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select lower(regexp_replace(trim(coalesce(p.role_key, p.role, '')), '[[:space:]-]+', '_', 'g'))
  from public.profiles p
  where p.id = auth.uid()
    and coalesce(p.is_active, true) = true
  limit 1
$function$;
