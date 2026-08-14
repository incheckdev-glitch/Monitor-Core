# Deploy a New Client

## 1. Create an isolated Supabase project
Create a brand-new Supabase project for the client. Do not reuse another client's database.

## 2. Clone schema only
Install PostgreSQL client tools, then run from the project root:

```bash
export SOURCE_DATABASE_URL='postgresql://...'
export TARGET_DATABASE_URL='postgresql://...'
./scripts/clone-new-client-schema.sh
```

The script exports only the `public` schema and restores it to the target. It does not copy business data or Supabase Auth users. It preserves public-schema grants needed by Supabase/PostgREST, refuses a non-empty target by default, then removes retired AI/e-sign schema objects, creates the five private document/attachment buckets required by active modules, and seeds the baseline role/permission matrix.

If your reference database still contains retired AI/e-sign database objects, remove them from the reference first or review the generated schema before restore. Never copy client rows.

## 3. Create the first administrator
Create a fresh user in the target project's Supabase Authentication. Auth users are deliberately not cloned. Then create the matching app profile:

```bash
export TARGET_DATABASE_URL='postgresql://...'
export ADMIN_EMAIL='admin@client-domain.com'
./scripts/bootstrap-admin-profile.sh
```

Set the same email in the Vercel `BOOTSTRAP_ADMIN_EMAILS` variable for first-admin recovery/user-management access. After login, use the normal Users/Roles administration flow for additional users.

## 4. Configure the frontend
For Vercel deployments, `/runtime-config.js` is rewritten to the included `/api/runtime-config` endpoint. Set the target client's public values as Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` / publishable key
- optional `PUSH_VAPID_PUBLIC_KEY`
- optional `TICKET_REPLY_EMAIL`

For a non-Vercel/local static deployment, fill the same public values in `runtime-config.js`. Never put a service-role key, database password, SMTP password, or private VAPID key in browser files.

## 5. Configure Vercel server environment
Set the variables required by files under `api/`, including the target Supabase URL and service-role key where the server endpoint requires it. Set `APP_BASE_URL` (or `PUBLIC_APP_URL`) to the new client's production application URL for workflow notification links. For a fresh installation, set `BOOTSTRAP_ADMIN_EMAILS` to the first authorized administrator email before using user-management APIs. Keep all secret values in Vercel/Supabase secrets, never in Git.

## 6. Deploy active Supabase Edge Functions
Deploy only the folders present in `supabase/functions/`:

- daily-follow-up-reminders
- process-notification-queue
- process-payment-schedule-reminders
- send-web-push-v2
- send-workflow-approval-email

There is intentionally no AI Assistant function in this master.

**Workflow email dependency:** `send-workflow-approval-email` calls a separate Supabase Edge Function named `send-email`. That dependency was not present in the source repository, so deploy/provide your existing `send-email` function or disable workflow email delivery until it is available.

## 7. Verify before production
Run:

```bash
npm ci
npm run check:syntax
npm run check:migrations
npm test
```

Then test login, role visibility, proposals, agreements, manual signed-document upload, invoice/receipt flow, notification queue, HR, accounting and backups against the new Supabase project.
