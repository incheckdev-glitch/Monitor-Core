-- Repair Admin locked-proposal update RPC and replace the incompatible JSON object-length check.
-- Source migration only: apply to production Supabase separately.

begin;

create or replace function public.admin_update_locked_proposal(
  p_proposal_id uuid,
  p_changes jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_header jsonb := '{}'::jsonb;
  v_items jsonb := null;
  v_set_clause text;
  v_result jsonb;
  v_item_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active is distinct from false
      and lower(coalesce(p.role_key, '')) = 'admin'
  ) then
    raise exception 'Only admins can override a locked proposal.';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Reason for editing locked proposal is required.';
  end if;

  if p_changes is null or p_changes = '{}'::jsonb then
    raise exception 'No proposal changes were supplied.';
  end if;

  perform 1 from public.proposals where id = p_proposal_id for update;
  if not found then
    raise exception 'Proposal not found.';
  end if;

  if jsonb_typeof(p_changes -> 'proposal') = 'object' then
    v_header := p_changes -> 'proposal';
  else
    v_header := p_changes;
  end if;

  if jsonb_typeof(p_changes -> 'items') = 'array' then
    v_items := p_changes -> 'items';
  elsif jsonb_typeof(p_changes -> 'proposal_items') = 'array' then
    v_items := p_changes -> 'proposal_items';
  end if;

  v_header := v_header - 'proposal' - 'items' - 'proposal_items' - 'payload_version' - 'id' - 'created_at' - 'created_by';
  v_header := v_header || jsonb_build_object('updated_at', now(), 'updated_by', auth.uid());

  select string_agg(format('%I = x.%I', c.column_name, c.column_name), ', ' order by c.ordinal_position)
    into v_set_clause
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'proposals'
    and c.column_name not in ('id', 'created_at', 'created_by')
    and coalesce(c.is_generated, 'NEVER') = 'NEVER'
    and exists (select 1 from jsonb_object_keys(v_header) k(key) where k.key = c.column_name);

  perform set_config('app.admin_proposal_override', 'on', true);

  if nullif(v_set_clause, '') is not null then
    execute format(
      'update public.proposals p set %s from jsonb_populate_record(null::public.proposals, $1) x where p.id = $2 returning to_jsonb(p)',
      v_set_clause
    )
    using v_header, p_proposal_id
    into v_result;
  else
    select to_jsonb(p) into v_result from public.proposals p where p.id = p_proposal_id;
  end if;

  if v_items is not null then
    delete from public.proposal_items where proposal_id = p_proposal_id;
    if v_items <> '[]'::jsonb then
      insert into public.proposal_items (
        proposal_id, item_id, section, line_no, location_name, location_address, item_name,
        unit_price, discount_percent, discounted_unit_price, quantity, license_quantity,
        line_total, service_start_date, service_end_date, capability_name, capability_value, notes
      )
      select
        p_proposal_id, r.item_id, r.section, r.line_no, r.location_name, r.location_address, r.item_name,
        coalesce(r.unit_price, 0), coalesce(r.discount_percent, 0), coalesce(r.discounted_unit_price, 0),
        coalesce(r.quantity, 1), r.license_quantity, coalesce(r.line_total, 0), r.service_start_date,
        r.service_end_date, r.capability_name, r.capability_value, r.notes
      from jsonb_populate_recordset(null::public.proposal_items, v_items) r;
    end if;
  end if;

  select count(*) into v_item_count from public.proposal_items where proposal_id = p_proposal_id;
  return jsonb_build_object(
    'proposal', (select to_jsonb(p) from public.proposals p where p.id = p_proposal_id),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.line_no nulls last, i.created_at) from public.proposal_items i where i.proposal_id = p_proposal_id), '[]'::jsonb),
    'item_count', v_item_count,
    'override_reason', p_reason
  );
end;
$$;

revoke all on function public.admin_update_locked_proposal(uuid, jsonb, text) from public;
grant execute on function public.admin_update_locked_proposal(uuid, jsonb, text) to authenticated;

commit;

notify pgrst, 'reload schema';
