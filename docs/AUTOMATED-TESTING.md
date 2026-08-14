# InCheck360 Automated Testing

## Commands

- `npm run test:smoke` — fast source/syntax/deployment-contract check.
- `npm run test:all` — syntax + SQL validation + all ERP regression tests + deployment contract + optional live read-only production checks.
- `npm run test:production` — live read-only checks only.

## GitHub Actions

Open **GitHub → repository → Actions → InCheck360 Full Automated Test → Run workflow**.

The workflow also runs on pushes and pull requests to `main`.

## Optional GitHub repository secrets

The test suite works without these secrets; live checks are reported as SKIP. Add them later under **Settings → Secrets and variables → Actions → Repository secrets** to enable live deployment validation.

- `TEST_APP_URL` — e.g. `https://monitor-core.vercel.app`
- `TEST_SUPABASE_URL` — target Supabase project URL
- `TEST_SUPABASE_ANON_KEY` — browser-safe anon/publishable key
- `TEST_SUPABASE_SERVICE_ROLE_KEY` — server-only service-role key; used only for read-only schema reachability checks
- `TEST_USER_EMAIL` — optional dedicated test user's email
- `TEST_USER_PASSWORD` — optional dedicated test user's password

Never commit any of these secret values to the repository.

## Safety

`test:production` is intentionally read-only. It does not create, edit, delete, approve, invoice, receive payment, or send email/push messages. It checks the production app/runtime configuration, required tables, authentication/profile/role when a test login is provided, and the existence of Edge Functions using `OPTIONS` requests.

Push/email delivery is intentionally not triggered by the automated production test, so missing VAPID/SMTP secrets do not generate external messages.

## Reports

JSON reports are written to `test-results/`. GitHub Actions uploads the directory as the `incheck360-test-results` artifact even when the workflow fails.
