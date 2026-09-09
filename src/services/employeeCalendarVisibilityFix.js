(function installEmployeeCalendarVisibilityFix(global) {
  'use strict';

  const PATCH_FLAG = '__incheckEmployeeCalendarVisibilityPatched';
  const CALENDAR_ID = 'employeeCalendar';
  const LIST_ID = 'ecCalendarList';
  const STORAGE_PREFIX = 'monitorCore.employeeCalendar.visibleOwners:';
  let observer = null;
  let restoreTimer = 0;
  let currentUserId = '';
  let calendarInstance = null;

  const clean = value => String(value ?? '').trim();

  function supabaseClient() {
    try {
      return global.SupabaseClient?.getClient?.() || global.supabaseClient || global.supabase || null;
    } catch (_) {
      return null;
    }
  }

  async function resolveUserId() {
    if (currentUserId) return currentUserId;
    try {
      const client = supabaseClient();
      const response = await client?.auth?.getUser?.();
      currentUserId = clean(response?.data?.user?.id);
    } catch (_) {}
    return currentUserId;
  }

  function storageKey() {
    return `${STORAGE_PREFIX}${currentUserId || 'current'}`;
  }

  function ownerInputs() {
    return Array.from(document.querySelectorAll(`#${LIST_ID} input[data-owner]`));
  }

  function selectedOwnerIds() {
    return new Set(ownerInputs().filter(input => input.checked).map(input => clean(input.dataset.owner)).filter(Boolean));
  }

  function ownInput(inputs = ownerInputs()) {
    return inputs.find(input => /my calendar/i.test(clean(input.closest('.ec-owner')?.querySelector('small')?.textContent)))
      || inputs.find(input => clean(input.dataset.owner) === currentUserId)
      || inputs[0]
      || null;
  }

  function readStoredSelection(allowedIds) {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return new Set(parsed.map(clean).filter(id => allowedIds.has(id)));
    } catch (_) {
      return null;
    }
  }

  function saveSelection() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(Array.from(selectedOwnerIds())));
    } catch (_) {}
  }

  function forceCalendarRefetch() {
    try {
      calendarInstance?.removeAllEvents?.();
      calendarInstance?.refetchEvents?.();
    } catch (_) {}
  }

  function syncUpcomingVisibility() {
    const selectedNames = new Set(
      ownerInputs()
        .filter(input => input.checked)
        .map(input => clean(input.closest('.ec-owner')?.querySelector('strong')?.textContent))
        .filter(Boolean)
    );

    document.querySelectorAll('#ecUpcoming .ec-upcoming').forEach(row => {
      const ownerName = clean(row.querySelector('em')?.textContent);
      row.hidden = selectedNames.size > 0 && !selectedNames.has(ownerName);
    });
  }

  function bindInputs() {
    const inputs = ownerInputs();
    if (!inputs.length) return false;

    inputs.forEach(input => {
      if (input.dataset.visibilityFixBound === 'true') return;
      input.dataset.visibilityFixBound = 'true';
      input.addEventListener('change', () => {
        if (!ownerInputs().some(item => item.checked)) {
          const mine = ownInput();
          if (mine) {
            mine.checked = true;
            mine.dispatchEvent(new Event('change', { bubbles: false }));
            return;
          }
        }
        saveSelection();
        forceCalendarRefetch();
        requestAnimationFrame(syncUpcomingVisibility);
      });
    });

    return true;
  }

  async function restoreSelection() {
    clearTimeout(restoreTimer);
    const inputs = ownerInputs();
    if (!inputs.length) return;

    await resolveUserId();
    const allowed = new Set(inputs.map(input => clean(input.dataset.owner)).filter(Boolean));
    const mine = ownInput(inputs);
    let desired = readStoredSelection(allowed);

    // Safe default: receiving a shared calendar never makes it automatically visible.
    // A user sees My Calendar until they explicitly select another calendar.
    if (!desired || !desired.size) {
      desired = new Set(mine ? [clean(mine.dataset.owner)] : [clean(inputs[0]?.dataset.owner)].filter(Boolean));
    }

    const changedInputs = [];
    inputs.forEach(input => {
      const shouldBeChecked = desired.has(clean(input.dataset.owner));
      if (input.checked !== shouldBeChecked) {
        input.checked = shouldBeChecked;
        changedInputs.push(input);
      }
    });

    // Keep the original calendar module's private S.owners set synchronized with the UI.
    changedInputs.forEach(input => input.dispatchEvent(new Event('change', { bubbles: false })));

    bindInputs();
    saveSelection();
    forceCalendarRefetch();
    requestAnimationFrame(syncUpcomingVisibility);
  }

  function scheduleRestore(delay = 40) {
    clearTimeout(restoreTimer);
    restoreTimer = global.setTimeout(() => restoreSelection().catch(() => {}), delay);
  }

  function wrapFullCalendar() {
    const FullCalendar = global.FullCalendar;
    const OriginalCalendar = FullCalendar?.Calendar;
    if (!OriginalCalendar || OriginalCalendar[PATCH_FLAG]) return;

    class VisibilityAwareCalendar extends OriginalCalendar {
      constructor(el, options = {}) {
        if (el?.id === CALENDAR_ID && typeof options.events === 'function') {
          const originalEvents = options.events;
          options = {
            ...options,
            events(info, success, failure) {
              return originalEvents(info, events => {
                const selected = selectedOwnerIds();
                const rows = Array.isArray(events) ? events : [];
                const filtered = rows.filter(event => {
                  const ownerId = clean(event?.extendedProps?.row?.owner_user_id);
                  return selected.size === 0 || selected.has(ownerId);
                });
                success(filtered);
              }, failure);
            }
          };
        }
        super(el, options);
        if (el?.id === CALENDAR_ID) calendarInstance = this;
      }
    }

    Object.defineProperty(VisibilityAwareCalendar, PATCH_FLAG, { value: true });
    try {
      FullCalendar.Calendar = VisibilityAwareCalendar;
    } catch (_) {}
  }

  function observeCalendarUi() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(records => {
      const needsRestore = records.some(record =>
        Array.from(record.addedNodes || []).some(node =>
          node?.nodeType === 1 && (
            node.id === LIST_ID ||
            node.querySelector?.(`#${LIST_ID}`)
          )
        )
      );
      if (needsRestore) scheduleRestore(60);
      requestAnimationFrame(syncUpcomingVisibility);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function boot() {
    wrapFullCalendar();
    observeCalendarUi();
    scheduleRestore(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  global.InCheck360EmployeeCalendarVisibilityFix = Object.freeze({
    refresh: () => scheduleRestore(0),
    selectedOwners: () => Array.from(selectedOwnerIds())
  });
})(window);
