const UserAvatarPersistence = (() => {
  const state = {
    observer: null,
    timer: null,
    syncing: false,
    bound: false
  };

  const isAuthenticatedUi = () => Boolean(document.body && !document.body.classList.contains('auth-locked'));

  function avatarNode() {
    return document.getElementById('currentUserAvatar');
  }

  function hasProfileAvatarMarkup(node) {
    if (!node) return false;
    return Boolean(
      node.querySelector('img,svg,.user-profile-avatar-initials')
    );
  }

  async function restore() {
    state.timer = null;
    if (state.syncing || !isAuthenticatedUi()) return;
    const node = avatarNode();
    if (!node || !window.UserProfile?.syncTopbarAvatar) return;
    state.syncing = true;
    try {
      await window.UserProfile.syncTopbarAvatar();
    } catch (error) {
      console.warn('[UserAvatarPersistence] unable to restore saved avatar', error);
    } finally {
      state.syncing = false;
    }
  }

  function schedule(delay = 40, force = false) {
    if (!isAuthenticatedUi()) return;
    const node = avatarNode();
    if (!force && node && hasProfileAvatarMarkup(node)) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => void restore(), delay);
  }

  function watch() {
    if (state.observer || typeof MutationObserver === 'undefined' || !document.body) return;
    state.observer = new MutationObserver(records => {
      if (!isAuthenticatedUi() || state.syncing) return;
      const node = avatarNode();
      if (!node) return;

      const avatarWasTouched = records.some(record =>
        record.target === node ||
        node.contains(record.target) ||
        Array.from(record.addedNodes || []).some(added => added === node || (added instanceof Element && added.contains?.(node)))
      );

      if (avatarWasTouched && !hasProfileAvatarMarkup(node)) schedule(25, true);
    });
    state.observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    watch();

    const refresh = () => schedule(30, true);
    window.addEventListener('incheck360:ui:ready', refresh);
    window.addEventListener('focus', () => schedule(20));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule(20);
    });

    window.Session?.subscribe?.((_user, detail = {}) => {
      if (detail.reason === 'signed_out') return;
      schedule(35, true);
    });

    // Cover the initial auth/UI race: legacy UI may write initials after the
    // profile module has already rendered the persisted avatar.
    setTimeout(() => schedule(0, true), 100);
    setTimeout(() => schedule(0, true), 500);
    setTimeout(() => schedule(0, true), 1200);
    setTimeout(() => schedule(0, true), 2200);
  }

  function init() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
    else bind();
  }

  init();
  return Object.freeze({ refresh: () => schedule(0, true) });
})();

window.UserAvatarPersistence = UserAvatarPersistence;
