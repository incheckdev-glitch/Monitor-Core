import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, message: "Method not allowed." });
  }

  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse(401, { ok: false, message: "Missing or invalid auth token." });
    }

    const accessToken = authHeader.slice("bearer ".length).trim();
    if (!accessToken) {
      return jsonResponse(401, { ok: false, message: "Missing or invalid auth token." });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse(500, { ok: false, message: "Server is not configured." });
    }

    const body = await req.json().catch(() => null);
    const user_id = body?.user_id;
    const temporary_password = body?.temporary_password;

    if (!user_id || typeof user_id !== "string" || !temporary_password || typeof temporary_password !== "string") {
      return jsonResponse(400, { ok: false, message: "Missing user_id or temporary_password." });
    }

    const supabaseAnon = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerData, error: callerErr } = await supabaseAnon.auth.getUser();
    if (callerErr || !callerData?.user) {
      return jsonResponse(401, { ok: false, message: "Missing or invalid auth token." });
    }

    const callerId = callerData.user.id;
    const { data: profile, error: profileErr } = await supabaseAnon
      .from("profiles")
      .select("role_key,is_active")
      .eq("id", callerId)
      .maybeSingle();

    if (profileErr || profile?.role_key !== "admin" || profile?.is_active !== true) {
      return jsonResponse(403, { ok: false, message: "Caller is not admin." });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
      password: temporary_password,
    });

    if (updateErr) {
      return jsonResponse(500, { ok: false, message: "Supabase admin update failed." });
    }

    return jsonResponse(200, {
      ok: true,
      user_id,
      message: "Temporary password set successfully.",
    });
  } catch {
    return jsonResponse(500, { ok: false, message: "Internal server error." });
  }
});
