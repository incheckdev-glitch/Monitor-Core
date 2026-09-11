revoke select on table public.crm_daily_briefs from authenticated;
grant select (
  id, report_date, generated_at, generated_by_name, status, model,
  prompt_version, report, usage, estimated_cost_usd, generation_count,
  error_message, created_at, updated_at
) on table public.crm_daily_briefs to authenticated;
