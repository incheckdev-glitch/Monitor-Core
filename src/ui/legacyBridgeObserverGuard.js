const IGNORE_SELECTOR = [
  '#icdsFavoritesGroup','.icds-command-overlay',
  '#employeeCalendarView','#employeeCalendar','.ec-calendar','.fc','.fullcalendar',
  '.scheduler','.scheduler-container','.gantt','.gantt-container','.timeline-widget',
  '.chart-container','.chart-wrap','.analytics-chart',
  '.monaco-editor','.cm-editor','.CodeMirror','.ql-container','.tox-tinymce','.ProseMirror',
  '.mapboxgl-map','.leaflet-container','.ic-module-grid-view','.ic-crm-grid-view',
  '.print-preview','[data-print-preview]','.pdf-preview'
].join(',');

function asElement(node) {
  if (node instanceof Element) return node;
  return node?.parentElement instanceof Element ? node.parentElement : null;
}

function ignoredNode(node) {
  const element = asElement(node);
  if (!element) return false;
  if (element.matches?.(IGNORE_SELECTOR) || element.closest?.(IGNORE_SELECTOR)) return true;
  return Boolean(element.querySelector?.(IGNORE_SELECTOR));
}

function isIgnoredMutation(record) {
  if (!record || record.type !== 'childList') return false;
  const target = asElement(record.target);
  if (target?.closest?.(IGNORE_SELECTOR)) return true;

  const nodes = [
    ...Array.from(record.addedNodes || []),
    ...Array.from(record.removedNodes || [])
  ].filter(node => node?.nodeType === 1);

  return nodes.length > 0 && nodes.every(ignoredNode);
}

export function installLegacyBridgeSafely(installFn) {
  if (typeof installFn !== 'function') return;
  const NativeObserver = globalThis.MutationObserver;
  if (typeof NativeObserver !== 'function') return installFn();

  function GuardedMutationObserver(callback) {
    return new NativeObserver((records, observer) => {
      const relevant = Array.from(records || []).filter(record => !isIgnoredMutation(record));
      if (relevant.length) callback(relevant, observer);
    });
  }

  GuardedMutationObserver.prototype = NativeObserver.prototype;
  try { Object.setPrototypeOf(GuardedMutationObserver, NativeObserver); } catch (_) {}

  globalThis.MutationObserver = GuardedMutationObserver;
  try {
    return installFn();
  } finally {
    globalThis.MutationObserver = NativeObserver;
  }
}
