# InCheck360 Operations Portal — Release Process

## Branches

- `main` = production only.
- `staging` = integration and verification branch.
- Feature/fix work should land on `staging` first.
- Production promotion is done through a pull request from `staging` to `main`.

## Required release gate

Do not promote `staging` to `main` until all checks below pass on the Vercel Preview deployment.

### Core smoke test

1. Login page loads and remains responsive for at least 30 seconds.
2. Login succeeds and permissions load without redirecting back to login.
3. Logout returns to the light login page.
4. Dark mode does not affect the logged-out login page.
5. Collapsed sidebar expands/collapses correctly on desktop.
6. Tickets opens and scrolling does not reveal another module underneath.
7. Calendar opens, then disappears completely after switching modules.
8. Create / View / Edit forms open in the expected theme.
9. Notification tab opens and push controls are clickable.
10. Test This Device returns `attempted >= 1`, `sent >= 1`, `failed = 0` on a registered device.
11. Notification Setup loads templates, assignments and channel settings.
12. Backup Center opens for Admin only.
13. System Health runs without exposing secrets.
14. Management Command Center loads only after authentication and only for permitted management roles.

## Production promotion

1. Confirm the `staging` Vercel Preview deployment is successful.
2. Run the smoke test above against the Preview URL.
3. Open a PR: `staging` → `main`.
4. Review the changed-file list. Any unexpected auth/bootstrap/global-runtime change is a stop condition.
5. Merge the PR.
6. Confirm the new Vercel Production deployment is successful.
7. Repeat Login + Notifications + changed-module smoke tests on Production.

## Emergency rollback

- Identify the last confirmed production commit.
- Prefer a new forward commit using the known-good tree so Vercel creates a fresh deployment.
- Do not add emergency auth interceptors or weaken permission checks.
- Keep experimental UI work on a separate branch until production is stable.

## Files that require extra caution

Treat changes to these files as high-risk because they participate in startup/auth/navigation:

- `index.html`
- `app.js`
- `session.js`
- `permissions.js`
- `config.js`
- `supabase-client.js`
- `src/ui/index.js`
- service-worker/bootstrap files

UI-only work should prefer module-specific files and post-auth event hooks.
