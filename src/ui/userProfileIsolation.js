/* Monitor Core — keep the Profile modal isolated from ERP module content. */
const UserProfileIsolation = (() => {
  const state = { bound: false, observer: null };

  function root() {
    return document.getElementById('userProfileRoot');
  }

  function isProfileOpen() {
    return Boolean(document.body?.classList.contains('user-profile-open'));
  }

  function hardHideIfClosed() {
    const node = root();
    if (!node) return;
    if (!isProfileOpen()) {
      node.hidden = true;
      node.setAttribute('aria-hidden', 'true');
    }
  }

  function closeProfile() {
    if (!isProfileOpen() && root()?.hidden !== false) return;
    try {
      window.UserProfile?.close?.();
    } catch (error) {
      console.warn('[UserProfileIsolation] close failed', error);
      document.body?.classList.remove('user-profile-open');
      const node = root();
      if (node) node.hidden = true;
    }
    hardHideIfClosed();
  }

  function isModuleNavigationTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('#userProfileRoot')) return false;
    return Boolean(target.closest(
      '.view-tab,[data-view],[data-rm-view],[data-ru-view],.sidebar-nav a,.sidebar-nav button,.grouped-view-tabs button'
    ));
  }

  function bind() {
    if (state.bound || !document.body) return;
    state.bound = true;
    hardHideIfClosed();

    document.addEventListener('click', event => {
      if (isProfileOpen() && isModuleNavigationTarget(event.target)) closeProfile();
    }, true);

    window.addEventListener('hashchange', () => {
      if (isProfileOpen()) closeProfile();
      else hardHideIfClosed();
    });

    window.addEventListener('popstate', () => {
      if (isProfileOpen()) closeProfile();
      else hardHideIfClosed();
    });

    if (typeof MutationObserver !== 'undefined') {
      state.observer = new MutationObserver(records => {
        // Navigation changes .active on ERP views. A profile modal must never
        // survive that transition and become visible below the next module.
        const activeViewChanged = records.some(record =>
          record.type === 'attributes' &&
          record.attributeName === 'class' &&
          record.target instanceof Element &&
          record.target.classList.contains('view')
        );
        if (activeViewChanged && isProfileOpen()) closeProfile();
        else hardHideIfClosed();
      });
      state.observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'hidden']
      });
    }

    // Cover late renders from session/profile hydration.
    setTimeout(hardHideIfClosed, 250);
    setTimeout(hardHideIfClosed, 900);
    setTimeout(hardHideIfClosed, 1800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  return Object.freeze({
    close: closeProfile,
    refresh: hardHideIfClosed
  });
})();

window.UserProfileIsolation = UserProfileIsolation;
