(function installOutlookCalendarRealtime(global) {
  'use strict';

  if (global.InCheck360OutlookCalendarRealtime) return;

  const state = {
    channel: null,
    userId: '',
    refreshTimer: null,
    retryCount: 0
  };

  function client() {
    return global.SupabaseClient?.getClient?.() || global.supabaseClient || global.supabase || null;
  }

  function calendarVisible() {
    const view = document.getElementById('employeeCalendarView');
    return Boolean(view && !view.hidden && view.classList.contains('active') && document.visibilityState !== 'hidden');
  }

  function scheduleRefresh() {
    if (!calendarVisible()) return;
    global.clearTimeout(state.refreshTimer);
    state.refreshTimer = global.setTimeout(async () => {
      try {
        await global.InCheck360EmployeeCalendar?.refresh?.();
      } catch (error) {
        console.warn('[outlook-calendar-realtime] Calendar refresh failed', error);
      }
    }, 300);
  }

  async function currentUserId(sb) {
    try {
      const result = await sb.auth.getSession();
      return String(result?.data?.session?.user?.id || '').trim();
    } catch (_) {
      return '';
    }
  }

  async function ensure() {
    const sb = client();
    if (!sb?.channel || !sb?.auth?.getSession) return false;

    const userId = await currentUserId(sb);
    if (!userId) return false;
    if (state.channel && state.userId === userId) return true;

    if (state.channel) {
      try { await sb.removeChannel(state.channel); } catch (_) {}
      state.channel = null;
      state.userId = '';
    }

    const channel = sb
      .channel(`employee-calendar-outlook-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'employee_calendar_events',
        filter: `owner_user_id=eq.${userId}`
      }, scheduleRefresh)
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[outlook-calendar-realtime] Realtime subscription status:', status);
        }
      });

    state.channel = channel;
    state.userId = userId;
    return true;
  }

  function boot() {
    ensure().then(ok => {
      if (!ok && state.retryCount++ < 20) global.setTimeout(boot, 500);
    }).catch(() => {
      if (state.retryCount++ < 20) global.setTimeout(boot, 500);
    });
  }

  global.addEventListener('focus', () => ensure());
  global.addEventListener('hashchange', () => {
    if (global.location.hash.startsWith('#employee-calendar')) ensure().then(scheduleRefresh);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensure();
  });

  global.InCheck360OutlookCalendarRealtime = Object.freeze({
    ensure,
    refresh: scheduleRefresh
  });

  boot();
})(window);
