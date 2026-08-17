import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Connection": "keep-alive",
    },
  });
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

interface RequestBody {
  email?: string;
  password?: string;
  name?: string;
  username?: string;
  role_key?: string;
  is_active?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) return jsonResponse({ error: "Unauthorized: missing Bearer token" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: callerData, error: callerAuthError } = await supabase.auth.getUser();
    if (callerAuthError || !callerData?.user) {
      return jsonResponse({ error: "Unauthorized: invalid token" }, 401);
    }

    const callerId = callerData.user.id;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, role_key, is_active")
      .eq("id", callerId)
      .maybeSingle();

    if (profileError) {
      return jsonResponse({ error: "Failed to verify admin permissions" }, 500);
    }

    const isAdmin = profile?.role_key === "admin" && profile?.is_active === true;
    if (!isAdmin) {
      return jsonResponse({ error: "Forbidden: admin access required" }, 403);
    }

    const body = (await req.json().catch(() => null)) as RequestBody | null;
    if (!body) return jsonResponse({ error: "Invalid JSON body" }, 400);

    const { email, password, name, username, role_key, is_active } = body;

    if (!email || !password || !name || !username || !role_key || typeof is_active !== "boolean") {
      return jsonResponse({
        error: "Bad Request: email, password, name, username, role_key, and is_active are required",
      }, 400);
    }

    const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, username, role_key },
    });

    if (createUserError || !createdUser?.user) {
      return jsonResponse({
        error: "Failed to create user",
        details: createUserError?.message ?? String(createUserError ?? "unknown"),
      }, 400);
    }

    const createdUserId = createdUser.user.id;

    const { error: upsertError } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { id: createdUserId, email, name, username, role_key, is_active },
        { onConflict: "id" }
      );

    if (upsertError) {
      return jsonResponse({
        error: "User created in Auth, but failed to upsert profile",
        details: upsertError.message,
      }, 500);
    }

    return jsonResponse({ ok: true, user_id: createdUserId, email, role_key }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "Unexpected error", details: message }, 500);
  }
});
