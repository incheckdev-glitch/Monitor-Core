Runtime config deployment fix

Replace index.html and vercel.json. Keep api/runtime-config.js (included). Delete runtime-config.js from the project root so it cannot shadow the API route.

Required Vercel env vars:
SUPABASE_URL
SUPABASE_ANON_KEY

Optional push vars:
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
PUSH_VAPID_PUBLIC_KEY (may equal VAPID_PUBLIC_KEY)
