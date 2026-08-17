(function initSupabaseClient(global) {
  const runtimeConfig = global.RUNTIME_CONFIG || {};

  const supabaseUrl = String(
    runtimeConfig.SUPABASE_URL || runtimeConfig.NEXT_PUBLIC_SUPABASE_URL || global.SUPABASE_URL || ''
  ).trim();
  const supabaseAnonKey = String(
    runtimeConfig.SUPABASE_ANON_KEY || runtimeConfig.NEXT_PUBLIC_SUPABASE_ANON_KEY || global.SUPABASE_ANON_KEY || ''
  ).trim();

  let cachedClient = null;
  const COMMUNICATION_CREATE_RPC = 'create_communication_centre_conversation';

  function isMissingRpcError(error, rpcName) {
    const code = String(error?.code || '').trim().toUpperCase();
    const message = String(error?.message || error?.details || error?.hint || '').toLowerCase();
    const name = String(rpcName || '').toLowerCase();
    if (code === 'PGRST202') return true;
    if (!name || !message.includes(name)) return false;
    return (
      message.includes('could not find the function') ||
      message.includes('function') && message.includes('does not exist') ||
      message.includes('schema cache')
    );
  }

  async function createCommunicationViaServerFallback(client, args = {}) {
    let accessToken = '';
    try {
      const sessionResult = await client.auth.getSession();
      accessToken = String(sessionResult?.data?.session?.access_token || '').trim();
    } catch (_error) {}

    if (!accessToken) {
      return {
        data: null,
        error: {
          code: 'COMM_CREATE_FALLBACK_AUTH',
          message: 'Your session expired. Please log in again.'
        }
      };
    }

    try {
      const response = await fetch('/api/communication-centre-create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(args || {})
      });
      let payload = {};
      try { payload = await response.json(); } catch (_error) {}
      if (!response.ok || payload?.ok === false) {
        return {
          data: null,
          error: {
            code: 'COMM_CREATE_FALLBACK',
            message: String(payload?.error || `Communication Centre fallback failed with HTTP ${response.status}.`),
            details: String(payload?.details || '')
          }
        };
      }
      return { data: payload?.data ?? null, error: null };
    } catch (error) {
      return {
        data: null,
        error: {
          code: 'COMM_CREATE_FALLBACK_NETWORK',
          message: String(error?.message || error || 'Unable to reach the Communication Centre create endpoint.')
        }
      };
    }
  }

  function installCommunicationCreateFallback(client) {
    if (!client || typeof client.rpc !== 'function' || client.__incheckCommunicationCreateFallback) return client;
    const nativeRpc = client.rpc.bind(client);
    client.rpc = function rpcWithCommunicationCreateFallback(fn, args, options) {
      if (String(fn || '') !== COMMUNICATION_CREATE_RPC) {
        return nativeRpc(fn, args, options);
      }
      return (async () => {
        const nativeResult = await nativeRpc(fn, args, options);
        if (!nativeResult?.error || !isMissingRpcError(nativeResult.error, COMMUNICATION_CREATE_RPC)) {
          return nativeResult;
        }
        console.warn('[SupabaseClient] Communication create RPC is unavailable; using authenticated server fallback.', {
          code: nativeResult.error?.code || '',
          message: nativeResult.error?.message || ''
        });
        return createCommunicationViaServerFallback(client, args || {});
      })();
    };
    client.__incheckCommunicationCreateFallback = true;
    return client;
  }

  function ensureBrowserClient() {
    if (cachedClient) return cachedClient;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in runtime config.');
    }
    const createClient = global.supabase?.createClient;
    if (typeof createClient !== 'function') {
      throw new Error('Supabase SDK is unavailable. Ensure supabase-js is loaded before app scripts.');
    }
    cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    installCommunicationCreateFallback(cachedClient);
    return cachedClient;
  }

  global.SupabaseClient = {
    getUrl() {
      return supabaseUrl;
    },
    hasConfig() {
      return Boolean(supabaseUrl && supabaseAnonKey);
    },
    getClient() {
      return ensureBrowserClient();
    }
  };
  console.info('[SupabaseClient] Active runtime client: supabase-client.js');
})(window);
