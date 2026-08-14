// Client-specific public runtime configuration.
// Fill these values for each deployment. Never place service-role or database passwords here.
window.RUNTIME_CONFIG = Object.assign({}, window.RUNTIME_CONFIG || {}, {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  APP_BASE_URL: '',
  BUSINESS_TIMEZONE: 'UTC',
  PUSH_VAPID_PUBLIC_KEY: '',
  TICKET_REPLY_EMAIL: ''
});
