# New Client Deployment Checklist

Use this checklist for every isolated client deployment.

## Before deployment

- [ ] Create a new Supabase project for the client.
- [ ] Confirm the target `public` schema is empty.
- [ ] Obtain the Postgres connection strings for a known-good reference project and the new target project.
- [ ] Review `.env.example` and create client-specific Vercel/Supabase secrets.
- [ ] Set `APP_BASE_URL` / `PUBLIC_APP_URL` to the new client's production application URL.

## Database

- [ ] Run `scripts/clone-new-client-schema.sh` with `SOURCE_DATABASE_URL` and `TARGET_DATABASE_URL`.
- [ ] Confirm the script completes all 5 stages.
- [ ] Confirm no source business rows or Supabase Auth users exist in the target.
- [ ] Confirm the five private Storage buckets exist.
- [ ] Confirm baseline roles and permissions were seeded.
- [ ] Create the first target Supabase Auth user.
- [ ] Run `scripts/bootstrap-admin-profile.sh` for that user's email.

## Application configuration

- [ ] Set the new target `SUPABASE_URL`.
- [ ] Set the new target publishable/anon key.
- [ ] Set the server-only service-role key only in Vercel/server secrets.
- [ ] Set `BOOTSTRAP_ADMIN_EMAILS`.
- [ ] Configure VAPID/push secrets if push notifications are enabled.
- [ ] Configure workflow/notification email secrets if email delivery is enabled.
- [ ] Do not put database passwords, service-role keys, SMTP passwords, or private VAPID keys in browser files.

## Edge Functions

Deploy only the active functions present in `supabase/functions/`:

- [ ] `daily-follow-up-reminders`
- [ ] `process-notification-queue`
- [ ] `process-payment-schedule-reminders`
- [ ] `send-web-push-v2`
- [ ] `send-workflow-approval-email`

`send-workflow-approval-email` depends on a separate `send-email` Edge Function that was not present in the source repository. Either provide that dependency or disable workflow email delivery.

## Validation

- [ ] Run `npm ci`.
- [ ] Run `npm run check`.
- [ ] Verify login and first-admin access.
- [ ] Verify role/menu visibility with a non-admin test user.
- [ ] Verify proposals and manual signed-proposal PDF upload.
- [ ] Verify agreements and manual signed-agreement PDF upload.
- [ ] Verify invoices, receipts, credit notes and payment schedules.
- [ ] Verify company and ticket attachments.
- [ ] Verify HR document upload if HR is enabled.
- [ ] Verify notification queue/email/push only for the channels enabled for this client.
- [ ] Verify backups before production data is entered.

## Production gate

- [ ] No retired AI Assistant or AI Insights UI/functions are deployed.
- [ ] No public/electronic proposal/agreement signing routes are deployed.
- [ ] No old client business data is present.
- [ ] No old Supabase project URL/key is present.
- [ ] No personal administrator email is hard-coded.
- [ ] Production app URL points to this client only.
