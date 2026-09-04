import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired HTTP wrapper. Employee Calendar reminders are processed internally
// by pg_cron through public.process_employee_calendar_reminders().
Deno.serve(() => {
  return new Response(
    JSON.stringify({
      ok: false,
      disabled: true,
      message: "Calendar reminders are processed by the database scheduler."
    }),
    {
      status: 410,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
});
