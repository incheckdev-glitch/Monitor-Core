# Environment and Secrets

## Browser/public configuration
On Vercel, the included `/api/runtime-config` endpoint exposes only approved public values from environment variables. For local/non-Vercel static hosting, set the same values in `runtime-config.js`:
- Supabase project URL
- Supabase publishable/anon key
- optional public VAPID key
- `BUSINESS_TIMEZONE` (IANA timezone for this client; defaults to `UTC`)

These are browser-visible values.

## Server/secret configuration
Keep service-role keys, database passwords, SMTP credentials and private VAPID keys only in Vercel environment variables or Supabase Edge Function secrets.

The clean master intentionally contains no fallback Supabase project URL/key, so a missing client configuration fails instead of silently connecting to another client's project.

## Common Vercel server variables
Depending on enabled features, the included API routes reference:
- `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `NOTIFICATION_QUEUE_WORKER_SECRET`, `CRON_SECRET`
- `BOOTSTRAP_ADMIN_EMAILS` (set at least one first-admin email for a fresh client), plus optional `ADMIN_EMAILS` / `USER_MANAGEMENT_ADMIN_EMAILS` allowlists
- `APP_BASE_URL` or `PUBLIC_APP_URL` (the new client production URL; required for Supabase workflow-email/deep-link generation)
- optional `APPROVAL_EMAIL_FALLBACK_TO` (comma-separated fallback workflow recipients; no recipient is hard-coded in the master)

Only set variables for the features you deploy. Never commit their secret values.

## Supabase Edge Function secrets
The included functions may use `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, push/VAPID secrets, public app URL/timezone settings, and workflow-email secrets. Configure them per client with Supabase secrets. For `send-workflow-approval-email`, set `APP_BASE_URL` (or `PUBLIC_APP_URL`) to this client's production application URL so generated links never point at another deployment.
