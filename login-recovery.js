(function installInCheck360LoginRecovery(global) {
  'use strict';

  let busy = false;
  const RELOAD_FLAG = 'incheck360.loginRecoveryReloaded';

  function setHint(message, isError = false) {
    const hint = document.getElementById('loginHint');
    if (!hint) return;
    hint.textContent = String(message || '');
    hint.style.color = isError ? '#dc2626' : '';
  }

  function setPending(pending) {
    const button = document.getElementById('loginBtn');
    if (!button) return;
    button.disabled = !!pending;
    button.setAttribute('aria-busy', pending ? 'true' : 'false');
    button.textContent = pending ? 'SIGNING IN…' : 'LOG IN';
  }

  function sleep(ms) {
    return new Promise(resolve => global.setTimeout(resolve, ms));
  }

  async function waitForSessionService(timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (global.Session?.login) return global.Session;
      await sleep(50);
    }
    return null;
  }

  async function waitForAppUnlock(timeoutMs = 5000) {
    if (!document.body?.classList.contains('auth-locked') || global.__APP_UNLOCKED__ === true) return true;
    return new Promise(resolve => {
      let finished = false;
      let timer = 0;
      let interval = 0;
      const done = value => {
        if (finished) return;
        finished = true;
        global.removeEventListener('incheck360:auth-ready', onReady);
        if (timer) global.clearTimeout(timer);
        if (interval) global.clearInterval(interval);
        resolve(Boolean(value));
      };
      const onReady = () => done(true);
      global.addEventListener('incheck360:auth-ready', onReady, { once: true });
      interval = global.setInterval(() => {
        if (!document.body?.classList.contains('auth-locked') || global.__APP_UNLOCKED__ === true) done(true);
      }, 100);
      timer = global.setTimeout(() => done(false), timeoutMs);
    });
  }

  function clearRecoveryReloadFlag() {
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch (_) {}
  }

  function useSingleReloadFallback() {
    let alreadyReloaded = false;
    try { alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1'; } catch (_) {}
    if (alreadyReloaded) return false;
    try { sessionStorage.setItem(RELOAD_FLAG, '1'); } catch (_) {}
    global.location.reload();
    return true;
  }

  async function submitLogin(event) {
    if (!document.body?.classList.contains('auth-locked')) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;

    const identifier = String(document.getElementById('loginIdentifier')?.value || '').trim();
    const passcode = String(document.getElementById('loginPasscode')?.value || '');

    if (!identifier) {
      setHint('Email is required.', true);
      document.getElementById('loginIdentifier')?.focus();
      return;
    }
    if (!passcode) {
      setHint('Password is required.', true);
      document.getElementById('loginPasscode')?.focus();
      return;
    }

    busy = true;
    setPending(true);
    setHint('Connecting to login service…');

    try {
      const sessionService = await waitForSessionService();
      if (!sessionService?.login) throw new Error('Login service did not initialize. Please refresh the page once.');

      setHint('Signing in…');
      const user = await sessionService.login(identifier, passcode);
      if (!user || !sessionService.isAuthenticated?.()) {
        throw new Error('Login did not return an authenticated user.');
      }

      setHint('Signed in. Verifying permissions…');
      const unlocked = await waitForAppUnlock();
      if (unlocked) {
        clearRecoveryReloadFlag();
        const identifierInput = document.getElementById('loginIdentifier');
        const passcodeInput = document.getElementById('loginPasscode');
        if (identifierInput) identifierInput.value = '';
        if (passcodeInput) passcodeInput.value = '';
        setHint('Signed in.');
        busy = false;
        setPending(false);
        return;
      }

      // The session is valid but the dashboard bootstrap did not finish. Reload once so
      // the normal Session.restore()/permission bootstrap can start from a clean document.
      setHint('Signed in. Reloading the Operations Portal…');
      if (!useSingleReloadFallback()) {
        throw new Error('Authentication succeeded, but the app could not finish loading. Please hard refresh once.');
      }
    } catch (error) {
      console.error('[login-recovery] Login failed', error);
      setHint(error?.message || 'Login failed. Please try again.', true);
      busy = false;
      setPending(false);
    }
  }

  function boot() {
    const form = document.getElementById('loginForm');
    if (!form || form.dataset.loginRecoveryBound === 'true') return;
    form.dataset.loginRecoveryBound = 'true';
    form.noValidate = true;
    form.addEventListener('submit', submitLogin, true);
    if (!document.body?.classList.contains('auth-locked')) clearRecoveryReloadFlag();
    console.info('[login-recovery] emergency login handler active');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
