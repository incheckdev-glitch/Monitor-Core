import { UIComponents as UIComponentsV2 } from './components.js?v=20260904-ds2';
import { UIComponents as UIComponentsV1 } from './components.js?v=20260904-ds1';

const OWNED_WIDGET_SELECTOR = [
  '#employeeCalendarView','#employeeCalendar','.ec-calendar','.fc','.fullcalendar',
  '.scheduler','.scheduler-container','.gantt','.gantt-container','.timeline-widget',
  '.chart-container','.chart-wrap','.analytics-chart',
  '.monaco-editor','.cm-editor','.CodeMirror','.ql-container','.tox-tinymce','.ProseMirror',
  '.mapboxgl-map','.leaflet-container','.ic-module-grid-view','.ic-crm-grid-view',
  '.print-preview','[data-print-preview]','.pdf-preview'
].join(',');

function isOwnedWidgetNode(element) {
  return Boolean(element instanceof Element && element.closest(OWNED_WIDGET_SELECTOR));
}

function guardAdopt(api, fallbackFactory) {
  if (!api || typeof api.adopt !== 'function' || api.adopt.__widgetIsolationPatched) return;
  const original = api.adopt;
  const guarded = function(element, ...args) {
    if (isOwnedWidgetNode(element)) return fallbackFactory(element);
    return original.call(this, element, ...args);
  };
  Object.defineProperty(guarded, '__widgetIsolationPatched', { value: true });
  api.adopt = guarded;
}

function patchComponents(components) {
  guardAdopt(components?.ActionBar, element => element);
  guardAdopt(components?.FormSection, element => element);
  guardAdopt(components?.StatusBadge, element => element);
  guardAdopt(components?.Pagination, element => element);
  guardAdopt(components?.DropdownMenu, element => element);
  guardAdopt(components?.DataTable, table => ({ table, shell: null }));
}

patchComponents(UIComponentsV2);
patchComponents(UIComponentsV1);

export const WidgetIsolation = Object.freeze({ isOwnedWidgetNode });
