# Clean Master Report

Prepared as a reusable deployment baseline for a new client with an isolated Supabase project.

## Removed

- AI Assistant frontend and Edge Function
- AI Insights tab/service
- public/electronic proposal and agreement signing flows
- retired e-sign notification workflow
- historical one-off/client-specific SQL patch archive
- old client-specific CS360 mappings/sample records
- hard-coded previous Supabase project fallback
- hard-coded personal administrator email fallback
- hard-coded previous production application URL fallback

## Retained

- normal proposal/agreement lifecycle
- manual signed proposal/agreement PDF upload
- accounting, invoicing, receipts, credit notes and payment schedules
- CRM, CSM, HR, notifications, backups and active analytics
- InCheck360 provider branding/signatory defaults

## Database package

Four organized SQL files remain:

1. `database/bootstrap/00_remove_retired_features.sql`
2. `database/bootstrap/01_storage_buckets.sql`
3. `database/seeds/01_roles_and_permissions.sql`
4. `database/seeds/02_bootstrap_admin_profile.sql`

Historical patches are intentionally excluded. Because the original repository did not include the foundational schema for every core ERP table, the supported new-database path is a **schema-only clone from a known-good reference Supabase project** using `scripts/clone-new-client-schema.sh`. No business rows or Auth users are copied.

## Validation status

- JavaScript syntax: passed
- SQL package safety validation: passed
- Active regression suite: 32 passed / 0 failed
- Shell deployment scripts: syntax checked
- Hard-coded previous Supabase project reference: not present
- Hard-coded previous production app URL: not present
- Hard-coded personal admin email: not present

Dependency vulnerability audit should also be run in the deployment/CI environment with registry network access.
