import { UIComponents } from './components.js?v=20260904-ds1';

const OWNED_WIDGET_SELECTOR = [
  '#employeeCalendarView','#employeeCalendar','.ec-calendar','.fc','.fullcalendar',
  '.scheduler','.scheduler-container','.gantt','.gantt-container','.timeline-widget',
  '.chart-container','.chart-wrap','.analytics-chart',
  '.monaco-editor','.cm-editor','.CodeMirror','.ql-container','.tox-tinymce','.ProseMirror',
  '.mapboxgl-map','.leaflet-container','.ic-module-grid-view','.ic-crm-grid-view',
  '.print-preview','[data-print-preview]','.pdf-preview'
].join(',');

function isOwnedWidgetNode(element) {
  return Boolean(element instanceof Element && element.closest?.(OWNED_WIDGET_SELECTOR));
}

function guardAdopt(api, fallbackFactory) {
  if (!api || typeof api.adopt !== 'function' || api.adopt.__legacyWidgetIsolationPatched) return;
  const original = api.adopt;
  const guarded = function(element, ...args) {
    if (isOwnedWidgetNode(element)) return fallbackFactory(element);
    return original.call(this, element, ...args);
  };
  Object.defineProperty(guarded, '__legacyWidgetIsolationPatched', { value: true });
  api.adopt = guarded;
}

guardAdopt(UIComponents.PageLayout, element => element);
guardAdopt(UIComponents.PageHeader, element => element);
guardAdopt(UIComponents.ActionBar, element => element);
guardAdopt(UIComponents.FilterPanel, element => element);
guardAdopt(UIComponents.KpiGrid, element => element);
guardAdopt(UIComponents.KpiCard, element => element);
guardAdopt(UIComponents.FormSection, element => element);
guardAdopt(UIComponents.StatusBadge, element => element);
guardAdopt(UIComponents.Pagination, element => element);
guardAdopt(UIComponents.DropdownMenu, element => element);
guardAdopt(UIComponents.DataTable, table => ({ table, shell: null }));

export const LegacyWidgetIsolation = Object.freeze({ isOwnedWidgetNode });
