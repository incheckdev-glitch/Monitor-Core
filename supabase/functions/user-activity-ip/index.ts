import { withSupabase } from 'npm:@supabase/server@^1';

const PRIVILEGED_ROLES = new Set(['admin', 'gm', 'general_manager', 'generalmanager']);

const normalizeRole = (value: unknown) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[\s-]+/g, '_');

function normalizeIp(raw: string | null): string | null {
  if (!raw) return null;
  let value = raw.split(',')[0].trim();
  if (!value) return null;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end > 1) value = value.slice(1, end);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'));
  }
  if (value.length > 64 || !/^[0-9a-fA-F:.]+$/.test(value)) return null;
  return value;
}

function requestIp(req: Request): string | null {
  return normalizeIp(
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip')
  );
}

function validIso(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const userId = String(ctx.userClaims?.sub || ctx.userClaims?.id || '').trim();
    if (!userId) return Response.json({ error: 'Authenticated user not found' }, { status: 401 });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const action = String(body.action || 'capture').trim().toLowerCase();

    if (action === 'capture') {
      const sessionId = String(body.session_id || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
        return Response.json({ error: 'Valid session_id is required' }, { status: 400 });
      }

      const { data: session, error: sessionError } = await ctx.supabaseAdmin
        .from('user_activity_sessions')
        .select('id,user_id')
        .eq('id', sessionId)
        .eq('user_id', userId)
        .maybeSingle();

      if (sessionError) return Response.json({ error: sessionError.message }, { status: 400 });
      if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

      const ipAddress = requestIp(req);
      if (!ipAddress) return Response.json({ captured: false, reason: 'ip_unavailable' });

      const { error: upsertError } = await ctx.supabaseAdmin
        .from('user_activity_ip_log')
        .upsert({
          session_id: sessionId,
          user_id: userId,
          ip_address: ipAddress,
          captured_at: new Date().toISOString()
        }, { onConflict: 'session_id' });

      if (upsertError) return Response.json({ error: upsertError.message }, { status: 400 });
      return Response.json({ captured: true });
    }

    if (action === 'list') {
      const { data: profile, error: profileError } = await ctx.supabaseAdmin
        .from('profiles')
        .select('role_key,role,is_active')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) return Response.json({ error: profileError.message }, { status: 400 });
      const role = normalizeRole(profile?.role_key || profile?.role);
      if (!profile || profile.is_active === false || !PRIVILEGED_ROLES.has(role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }

      const start = validIso(body.start);
      const end = validIso(body.end);
      if (!start || !end || start >= end) {
        return Response.json({ error: 'Valid start and end timestamps are required' }, { status: 400 });
      }

      const { data: sessions, error: sessionsError } = await ctx.supabaseAdmin
        .from('user_activity_sessions')
        .select('id,user_id,started_at,last_seen_at')
        .gte('last_seen_at', start)
        .lt('started_at', end)
        .order('last_seen_at', { ascending: false })
        .limit(5000);

      if (sessionsError) return Response.json({ error: sessionsError.message }, { status: 400 });
      const sessionRows = sessions || [];
      const sessionIds = sessionRows.map(row => row.id).filter(Boolean);
      if (!sessionIds.length) return Response.json({ records: [] });

      const { data: ipRows, error: ipError } = await ctx.supabaseAdmin
        .from('user_activity_ip_log')
        .select('session_id,user_id,ip_address,captured_at')
        .in('session_id', sessionIds)
        .limit(5000);

      if (ipError) return Response.json({ error: ipError.message }, { status: 400 });
      const ipBySession = new Map((ipRows || []).map(row => [String(row.session_id), row]));
      const seenUsers = new Set<string>();
      const records: Array<Record<string, unknown>> = [];

      for (const session of sessionRows) {
        const sessionIp = ipBySession.get(String(session.id));
        const uid = String(session.user_id || '');
        if (!sessionIp || !uid || seenUsers.has(uid)) continue;
        seenUsers.add(uid);
        records.push({
          user_id: uid,
          session_id: session.id,
          ip_address: sessionIp.ip_address,
          captured_at: sessionIp.captured_at
        });
      }

      return Response.json({ records });
    }

    return Response.json({ error: 'Unsupported action' }, { status: 400 });
  })
};
