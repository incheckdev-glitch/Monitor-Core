# Clean Master Scope

The deployment master excludes:
- all historical root `.sql` patch files
- the old `sql/` migration/seed tree
- patch-era README/TXT notes
- `ai-assistant.js`, `ai-insights-service.js`, `insights.js`
- `supabase/functions/incheck360-ai-assistant/`
- retired e-proposal/e-agreement tests and public-signing assets
- unreferenced patch/snippet JS/HTML files
- duplicate root Edge Function source copies

The active application modules remain at the root because `index.html` intentionally loads them directly.
