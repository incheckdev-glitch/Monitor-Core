(function installInCheck360LoginRecovery(global) {
  'use strict';

  let busy = false;

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
    if (!global.Session?.login) {
      setHint('Login service is still loading. Please refresh once and try again.', true);
      console.error('[login-recovery] Session.login is unavailable');
      return;
    }

    busy = true;
    setPending(true);
    setHint('Signing in…');

    try {
      const user = await global.Session.login(identifier, passcode);
      if (!user) throw new Error('Login did not return an authenticated user.');
      setHint('Signed in. Loading Operations Portal…');
      global.setTimeout(() => global.location.reload(), 60);
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
    form.addEventListener('submit', submitLogin, true);
    console.info('[login-recovery] emergency login handler active');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
