(function attachAdminOverride(global) {
  'use strict';

  // GM is intentionally authorization-equivalent to Admin while retaining the
  // GM role key for display, audit, and reporting purposes.
  const ADMIN_OVERRIDE_ROLES = new Set([
    'admin',
    'gm',
    'general_manager',
    'generalmanager'
  ]);

  function normalizeRole(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/-/g, '_')
      .replace(/_+/g, '_');
  }

  function isAdminEquivalentRole(value) {
    return ADMIN_OVERRIDE_ROLES.has(normalizeRole(value));
  }

  function getSessionUser() {
    try {
      if (global.Session && typeof global.Session.user === 'function') return global.Session.user() || {};
    } catch (_) {}
    return {};
  }

  function getCurrentRole() {
    const sessionUser = getSessionUser();
    const sessionState = global.Session?.state || {};
    const authContext = typeof global.Session?.authContext === 'function' ? global.Session.authContext() : {};
    const profile = sessionState.profile || sessionUser.profile || authContext.profile || {};
    return normalizeRole(
      (typeof global.Session?.role === 'function' ? global.Session.role() : '') ||
      sessionState.role ||
      sessionUser.role ||
      sessionUser.role_key ||
      sessionUser.roleKey ||
      profile.role_key ||
      profile.roleKey ||
      profile.role ||
      ''
    );
  }

  function isAdminOverrideUser() {
    return isAdminEquivalentRole(getCurrentRole());
  }

  function getCurrentUserInfo() {
    const sessionUser = getSessionUser();
    const sessionState = global.Session?.state || {};
    const authContext = typeof global.Session?.authContext === 'function' ? global.Session.authContext() : {};
    const authUser = authContext.user || sessionState.user || sessionUser.user || {};
    const profile = sessionState.profile || sessionUser.profile || authContext.profile || {};
    return {
      user_id: String(sessionState.user_id || sessionUser.user_id || profile.id || authUser.id || '').trim(),
      user_email: String(sessionState.email || sessionUser.email || profile.email || authUser.email || '').trim(),
      user_role: getCurrentRole(),
      user_name: String(sessionState.name || sessionUser.name || profile.name || profile.full_name || '').trim()
    };
  }

  function canOverride() {
    return isAdminOverrideUser();
  }

  function shouldBypassWorkflow() {
    return canOverride();
  }

  function shouldBypassLocks() {
    return canOverride();
  }

  function shouldBypassValidation() {
    return canOverride();
  }

  function patchAdminEquivalentHelpers() {
    // Some legacy modules call Session.isAdmin() or Permissions.isAdmin()
    // directly instead of the central permission matrix. Keep those paths in
    // sync with the Admin-equivalent authorization contract as well.
    if (global.Session) {
      global.Session.isAdmin = function isAdmin() {
        return isAdminEquivalentRole(
          (typeof this.role === 'function' ? this.role() : '') || this.state?.role || this.state?.role_key || ''
        );
      };
    }

    if (global.Permissions) {
      global.Permissions.isAdmin = function isAdmin() {
        return isAdminEquivalentRole(getCurrentRole());
      };
      global.Permissions.hasAdminOverride = function hasAdminOverride() {
        return this.isAdmin() || canOverride();
      };
      global.Permissions.isAdminLike = function isAdminLike() {
        return this.hasAdminOverride();
      };
      global.Permissions.canManageRolesPermissions = function canManageRolesPermissions() {
        return this.isAdmin();
      };
    }
  }

  function applyBanner(container, { active = true, message = '' } = {}) {
    if (!container || !active || !canOverride()) return;
    let banner = container.querySelector('[data-admin-override-banner]');
    if (!banner) {
      banner = document.createElement('div');
      banner.setAttribute('data-admin-override-banner', 'true');
      banner.className = 'admin-override-banner';
      banner.style.cssText = 'margin:0 0 12px 0;padding:10px 12px;border-radius:12px;border:1px solid rgba(245,158,11,.35);background:rgba(245,158,11,.10);color:#92400e;font-size:13px;font-weight:600;';
      container.prepend(banner);
    }
    banner.textContent = message || 'Admin Override Mode: you can edit normally locked or restricted records. Changes should be used carefully.';
    banner.style.display = '';
  }

  function collectOldValues(resource, record) {
    if (!record || typeof record !== 'object') return null;
    const safe = { ...record };
    delete safe._raw;
    delete safe.items;
    return safe;
  }

  async function logOverride({ resource, recordId, action = 'override', oldValues = null, newValues = null, reason = '' } = {}) {
    if (!canOverride()) return;
    const client = global.SupabaseClient?.getClient?.();
    if (!client?.from) return;
    const user = getCurrentUserInfo();
    const payload = {
      user_id: user.user_id || null,
      user_email: user.user_email || null,
      user_role: user.user_role || null,
      resource: String(resource || 'unknown').trim() || 'unknown',
      record_id: String(recordId || '').trim() || null,
      action: String(action || 'override').trim() || 'override',
      old_values: oldValues && typeof oldValues === 'object' ? oldValues : null,
      new_values: newValues && typeof newValues === 'object' ? newValues : null,
      reason: String(reason || 'Admin override').trim() || 'Admin override'
    };
    try {
      await client.from('admin_override_audit_log').insert(payload);
    } catch (error) {
      console.warn('[AdminOverride] audit log insert failed', error?.message || error);
    }
  }

  function setupKhaledBirthdayPopup() {
    const targetDate = '2026-09-17';
    let shownThisPageLoad = false;

    const getBeirutDate = () => {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Beirut',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(new Date());
        const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${map.year}-${map.month}-${map.day}`;
      } catch (_) {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    };

    const showPopup = () => {
      if (getBeirutDate() !== targetDate || shownThisPageLoad) return;
      if (document.body.classList.contains('auth-locked')) return;
      if (document.getElementById('khaledBirthdayOverlay')) return;

      shownThisPageLoad = true;

      const overlay = document.createElement('div');
      overlay.id = 'khaledBirthdayOverlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'khaledBirthdayTitle');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(2,6,23,.62);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);';

      const card = document.createElement('div');
      card.style.cssText = 'position:relative;width:min(520px,100%);overflow:hidden;border-radius:28px;padding:38px 30px 30px;text-align:center;background:linear-gradient(145deg,#ffffff 0%,#f7fbff 60%,#edf6ff 100%);border:1px solid rgba(59,130,246,.18);box-shadow:0 28px 80px rgba(2,6,23,.34);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;';

      card.innerHTML = `
        <div aria-hidden="true" style="font-size:54px;line-height:1;margin-bottom:14px;">🎉🎂🎈</div>
        <div style="font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#2563eb;margin-bottom:10px;">A special day at InCheck 360</div>
        <h2 id="khaledBirthdayTitle" style="margin:0;font-size:clamp(30px,7vw,46px);line-height:1.05;font-weight:800;letter-spacing:-.035em;">Happy Birthday Khaled!</h2>
        <p style="margin:16px auto 0;max-width:410px;font-size:16px;line-height:1.65;color:#475569;">Wishing you a fantastic birthday and a great year ahead. 🎉</p>
        <button id="khaledBirthdayClose" type="button" style="margin-top:26px;border:0;border-radius:14px;padding:12px 22px;background:#2563eb;color:#fff;font:700 14px/1 Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 24px rgba(37,99,235,.26);">Celebrate 🎉</button>
        <div aria-hidden="true" style="position:absolute;left:-24px;top:-22px;font-size:54px;transform:rotate(-18deg);opacity:.72;">🎊</div>
        <div aria-hidden="true" style="position:absolute;right:-18px;bottom:-20px;font-size:58px;transform:rotate(15deg);opacity:.68;">🎈</div>
      `;

      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const close = () => overlay.remove();
      card.querySelector('#khaledBirthdayClose')?.addEventListener('click', close);
      overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
      });
      document.addEventListener('keydown', function onBirthdayEscape(event) {
        if (event.key !== 'Escape') return;
        document.removeEventListener('keydown', onBirthdayEscape);
        close();
      });
    };

    const observer = new MutationObserver(() => {
      if (!document.body.classList.contains('auth-locked')) showPopup();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showPopup, { once: true });
    } else {
      showPopup();
    }
  }

  global.AdminOverride = {
    normalizeRole,
    isAdminEquivalentRole,
    getCurrentRole,
    isAdminOverrideUser,
    canOverride,
    shouldBypassWorkflow,
    shouldBypassLocks,
    shouldBypassValidation,
    getCurrentUserInfo,
    patchAdminEquivalentHelpers,
    collectOldValues,
    applyBanner,
    logOverride
  };

  patchAdminEquivalentHelpers();
  setupKhaledBirthdayPopup();
})(window);