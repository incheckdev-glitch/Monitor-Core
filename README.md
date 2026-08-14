# InCheck360 Clean Deployment Master

This is the cleaned deployment baseline for a **new client with an isolated Supabase database**. Historical patch files, retired AI modules, retired electronic-signature routes/functions, client-specific SQL corrections, and sample employee data are excluded.

## Important database rule

The old repository did not contain the original foundational `CREATE TABLE` schema for all core ERP tables. Therefore, a blank Supabase project **cannot be recreated safely from the historical patch migrations alone**. The supported clean path is to clone the **public schema only** from a known-good reference database into the new client's Supabase project. This copies tables, views, functions, triggers and RLS definitions but does **not copy business rows or Auth users**.

Start with `docs/DEPLOY_NEW_CLIENT.md`, then use `docs/DEPLOYMENT_CHECKLIST.md`. Public/server configuration placeholders are in `.env.example`.

## Removed from this master

- AI Assistant and its Edge Function
- AI Insights tab/service
- public/electronic proposal and agreement signing flows
- electronic-signature notification workflow
- historical one-off/client-specific SQL patches
- old patch README/TXT files
- hard-coded Supabase project URL/key fallback
- hard-coded CS360 location corrections for previous clients
- sample HR employee

Manual signed proposal/agreement PDF upload remains active.
