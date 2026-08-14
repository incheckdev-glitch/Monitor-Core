INCheck360 GitHub automated test package — UPDATED FILES ONLY

Upload/copy the contents of this ZIP into the ROOT of your GitHub repository, preserving folders.

Files added/updated:
- package.json
- scripts/test-utils.js
- scripts/deployment-contract-test.js
- scripts/production-readonly-test.js
- scripts/smoke-test.js
- scripts/full-system-test.js
- .github/workflows/test-all.yml
- docs/AUTOMATED-TESTING.md
- supabase/functions/send-email/index.ts

After merging to GitHub:
1. Open Actions.
2. Select "InCheck360 Full Automated Test".
3. Click "Run workflow".

Without GitHub secrets, source/regression tests run and live tests are SKIPPED.
Add the optional TEST_* repository secrets later to enable production read-only validation.
