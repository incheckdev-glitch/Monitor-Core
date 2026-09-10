# Lead Intelligence

Lead Intelligence is Monitor Core's AI-assisted prospect research workspace. It uses the OpenAI Responses API with built-in web search to find and score real public prospects for the customer-facing InCheck 360 platform.

## Security model

- `OPENAI_API_KEY` is server-only and must never be added to `runtime-config.js`, browser JavaScript, Supabase rows, GitHub, or client-visible logs.
- Every `/api/lead-intelligence` request requires a valid Supabase user access token and the database `can_use_lead_intelligence()` permission check.
- Only the prospect-search criteria are sent to OpenAI. Existing Monitor Core companies, contacts, leads and deals are not included in the OpenAI request.
- The model is instructed to use public evidence, never infer email addresses, and never invent LinkedIn URLs or citations.
- No LinkedIn connection request, message, email, or other outreach is sent automatically.

## Vercel environment

Required server secret:

- `OPENAI_API_KEY`

Optional:

- `OPENAI_LEAD_MODEL` (defaults to `gpt-5.6-sol`)

After adding or changing the secret, redeploy the production project so the serverless function receives it.

## Workflow

1. User selects countries, industries, target roles, company profile, location threshold and optional keywords/exclusions.
2. The server verifies the Supabase session and CRM permission.
3. OpenAI researches the public web and returns schema-validated suggested prospects with evidence, source URLs, fit score, likely pain points and draft outreach copy.
4. Results are saved into `lead_intelligence_runs` and `lead_intelligence_suggestions` for review and auditability.
5. `Add to CRM` calls the database RPC `lead_intelligence_accept_suggestion`.
6. The RPC reuses matching companies/contacts/leads when available and creates only missing CRM records. New leads start as `not contacted yet` and are assigned to the accepting ERP user.
7. Dismissed suggestions remain in research history and can be restored.

## Duplicate protection

`lead_intelligence_accept_suggestion` performs exact normalized checks against existing companies, contacts and active leads before creating CRM records. When a matching lead exists, the suggestion is marked `duplicate` and linked to that record instead of creating another lead.

## Data quality

AI suggestions are research leads, not verified master data. Newly created companies are intentionally left unverified. Users should verify company/contact information before outreach, pricing, proposals or agreements.
