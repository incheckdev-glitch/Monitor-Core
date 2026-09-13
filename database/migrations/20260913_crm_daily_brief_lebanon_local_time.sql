do $$
begin
  if to_regprocedure('public.crm_daily_brief_source_snapshot_utc(timestamp with time zone)') is null then
    execute 'alter function public.crm_daily_brief_source_snapshot(timestamp with time zone) rename to crm_daily_brief_source_snapshot_utc';
  end if;
end $$;

create or replace function public.crm_daily_brief_localize_json(
  p_value jsonb,
  p_timezone text default 'Asia/Beirut'
)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_key text;
  v_value jsonb;
  v_output jsonb;
  v_text text;
  v_ts timestamptz;
begin
  if p_value is null then
    return null;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    v_output := '{}'::jsonb;
    for v_key, v_value in select key, value from jsonb_each(p_value)
    loop
      if jsonb_typeof(v_value) = 'string'
         and (v_key = 'as_of' or v_key ~ '(_at|_time)$' or v_key in ('start_at','end_at','changed_at','converted_at')) then
        v_text := v_value #>> '{}';
        begin
          if v_text ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
            v_ts := v_text::timestamptz;
            v_value := to_jsonb(
              to_char(v_ts at time zone p_timezone, 'YYYY-MM-DD HH24:MI:SS')
              || ' ' || p_timezone
            );
          end if;
        exception when others then
          null;
        end;
      elsif jsonb_typeof(v_value) in ('object','array') then
        v_value := public.crm_daily_brief_localize_json(v_value, p_timezone);
      end if;
      v_output := v_output || jsonb_build_object(v_key, v_value);
    end loop;
    return v_output;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    select coalesce(
      jsonb_agg(public.crm_daily_brief_localize_json(value, p_timezone)),
      '[]'::jsonb
    )
    into v_output
    from jsonb_array_elements(p_value);
    return v_output;
  end if;

  return p_value;
end;
$$;

revoke all on function public.crm_daily_brief_localize_json(jsonb,text) from public;
revoke all on function public.crm_daily_brief_localize_json(jsonb,text) from anon;
revoke all on function public.crm_daily_brief_localize_json(jsonb,text) from authenticated;

create or replace function public.crm_daily_brief_source_snapshot(p_as_of timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_raw jsonb;
  v_local jsonb;
begin
  v_raw := public.crm_daily_brief_source_snapshot_utc(p_as_of);
  v_local := public.crm_daily_brief_localize_json(v_raw, 'Asia/Beirut');

  return v_local || jsonb_build_object(
    'time_context', jsonb_build_object(
      'display_timezone', 'Asia/Beirut',
      'display_label', 'Lebanon local time',
      'database_storage', 'UTC',
      'utc_storage_is_internal_only', true,
      'reporting_rule', 'All timestamp strings in this snapshot are converted from UTC storage to Asia/Beirut local time. Use these local times in the CRM Daily Brief and do not label them UTC.',
      'example', '2026-09-14 10:00 UTC = 2026-09-14 13:00 Asia/Beirut'
    )
  );
end;
$$;

revoke all on function public.crm_daily_brief_source_snapshot(timestamptz) from public;
revoke all on function public.crm_daily_brief_source_snapshot(timestamptz) from anon;
grant execute on function public.crm_daily_brief_source_snapshot(timestamptz) to authenticated;
