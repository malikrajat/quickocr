import '../shared/base.css';
import './logs.css';

import { PAGE_ORIGINS } from '../../core/constants.ts';
import { buildEmailParts, buildMailtoUrl, exportJson, fileBaseName } from '../../core/payload.ts';
import {
  countLevels,
  entriesToCsv,
  entriesToText,
  entryToText,
  filterEntries,
  isFailureLevel,
} from '../../core/ring-buffer.ts';
import type { FilterState, LogEntry, LogLevel, LogSource, TimeRange } from '../../core/types.ts';
import { copyText } from '../shared/clipboard.ts';
import {
  clear,
  closeDialog,
  debounce,
  formatClock,
  formatRelative,
  make,
  openExternal,
  query,
  setBusy,
  showDialog,
  toast,
} from '../shared/dom.ts';
import { elementToPng } from '../shared/dom-to-image.ts';
import { downloadBlob, downloadDataUrl, downloadText } from '../shared/download.ts';
import { installPageErrorReporting } from '../shared/errors.ts';
import {
  captureVisiblePage,
  clearLogs,
  previewSend,
  requestSnapshot,
  type SnapshotResponse,
  watchStorage,
} from '../shared/messages.ts';

installPageErrorReporting('logs');

const PAGE_SIZE = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let snapshot: SnapshotResponse | null = null;
let filtered: LogEntry[] = [];
let visibleCount = PAGE_SIZE;
let loading = false;
let loadQueued = false;
let focusHandled = false;
let pendingEmailAction = new URLSearchParams(location.search).get('action') === 'email';
let emailEntries: LogEntry[] = [];
let previewPayloadText = '';

const expanded = new Set<string>();
const filter: FilterState = { query: '', level: 'all', source: 'all', timeRange: 'all' };

const elements = {
  shell: query<HTMLElement>('#log-shell'),
  statusLine: query<HTMLParagraphElement>('#status-line'),
  sendPill: query<HTMLSpanElement>('#send-pill'),
  statErrors: query<HTMLDivElement>('#stat-errors'),
  statWarnings: query<HTMLDivElement>('#stat-warnings'),
  statTotal: query<HTMLDivElement>('#stat-total'),
  statLast: query<HTMLDivElement>('#stat-last'),
  search: query<HTMLInputElement>('#search-input'),
  level: query<HTMLSelectElement>('#level-filter'),
  source: query<HTMLSelectElement>('#source-filter'),
  time: query<HTMLSelectElement>('#time-filter'),
  resetFilters: query<HTMLButtonElement>('#reset-filters'),
  email: query<HTMLButtonElement>('#email-logs'),
  exportFormat: query<HTMLSelectElement>('#export-format'),
  exportButton: query<HTMLButtonElement>('#export-logs'),
  capturePanel: query<HTMLButtonElement>('#capture-panel'),
  capturePage: query<HTMLButtonElement>('#capture-page'),
  copyAll: query<HTMLButtonElement>('#copy-all'),
  preview: query<HTMLButtonElement>('#preview-send'),
  clearButton: query<HTMLButtonElement>('#clear-logs'),
  resultCount: query<HTMLSpanElement>('#result-count'),
  sendAlert: query<HTMLDivElement>('#send-alert'),
  permissionAlert: query<HTMLDivElement>('#permission-alert'),
  logList: query<HTMLElement>('#log-list'),
  emptyState: query<HTMLDivElement>('#empty-state'),
  emptyTitle: query<HTMLElement>('#empty-title'),
  emptyText: query<HTMLElement>('#empty-text'),
  loadMore: query<HTMLButtonElement>('#load-more'),
  shownCount: query<HTMLSpanElement>('#shown-count'),
  refresh: query<HTMLButtonElement>('#refresh-button'),
  options: query<HTMLButtonElement>('#options-button'),
  privacy: query<HTMLAnchorElement>('#privacy-link'),
  clearDialog: query<HTMLDialogElement>('#clear-dialog'),
  clearCancel: query<HTMLButtonElement>('#clear-cancel'),
  clearConfirm: query<HTMLButtonElement>('#clear-confirm'),
  emailDialog: query<HTMLDialogElement>('#email-dialog'),
  emailClose: query<HTMLButtonElement>('#email-close'),
  emailRecipient: query<HTMLInputElement>('#email-recipient'),
  emailPreview: query<HTMLPreElement>('#email-preview'),
  emailCopy: query<HTMLButtonElement>('#email-copy'),
  emailOpen: query<HTMLButtonElement>('#email-open'),
  previewDialog: query<HTMLDialogElement>('#preview-dialog'),
  previewClose: query<HTMLButtonElement>('#preview-close'),
  previewSubtitle: query<HTMLParagraphElement>('#preview-subtitle'),
  previewEndpoint: query<HTMLElement>('#preview-endpoint'),
  previewPayload: query<HTMLPreElement>('#preview-payload'),
  previewCopy: query<HTMLButtonElement>('#preview-copy'),
  previewDownload: query<HTMLButtonElement>('#preview-download'),
};

function sourceLabel(source: LogSource): string {
  switch (source) {
    case 'extension':
      return 'extension';
    case 'page':
      return 'page';
    case 'network':
      return 'network';
    case 'api':
      return 'public API';
    case 'system':
      return 'system';
    case 'manual':
      return 'manual';
  }
}

function addRow(list: HTMLDListElement, label: string, value: string): void {
  if (!value) return;
  list.append(make('dt', undefined, label), make('dd', undefined, value));
}

function renderEntry(entry: LogEntry): HTMLElement {
  const article = make('article', 'log-entry');
  article.dataset.entryId = entry.id;
  const open = expanded.has(entry.id);
  article.classList.toggle('is-open', open);

  const head = make('button', 'log-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(open));

  const badge = make('span', `level-badge ${entry.level}`, entry.level);
  const main = make('span', 'log-main');
  const message = make('span', 'log-message', entry.message);
  const meta = make('span', 'log-meta');
  meta.append(
    make('span', 'source-chip', sourceLabel(entry.source)),
    make('span', undefined, formatRelative(entry.timestamp)),
    make('span', undefined, formatClock(entry.timestamp)),
  );
  if (typeof entry.context?.status === 'number') {
    meta.append(make('span', undefined, `HTTP ${entry.context.status}`));
  }
  main.append(message, meta);
  const chevron = make('span', 'log-chevron', '\u203A');
  chevron.setAttribute('aria-hidden', 'true');
  head.append(badge, main, chevron);

  const body = make('div', 'log-body');
  const list = make('dl');
  addRow(list, 'Level', entry.level);
  addRow(list, 'Source', sourceLabel(entry.source));
  addRow(list, 'Time', formatClock(entry.timestamp));
  addRow(list, 'URL', entry.url ?? '');
  addRow(list, 'Tab', entry.tabId === undefined ? '' : String(entry.tabId));
  addRow(list, 'Extension', entry.extensionId ?? '');
  addRow(list, 'Fingerprint', entry.fingerprint);
  if (entry.context) {
    for (const [key, value] of Object.entries(entry.context)) {
      addRow(list, key, value === null ? 'null' : String(value));
    }
  }
  body.append(list);

  if (entry.details) {
    const details = make('pre', 'details');
    details.textContent = entry.details;
    body.append(details);
  }

  const actions = make('div', 'entry-actions');
  const copyButton = make('button', 'btn btn-sm', 'Copy entry');
  copyButton.type = 'button';
  copyButton.addEventListener('click', (event) => {
    event.stopPropagation();
    void copyText(entryToText(entry)).then((copied) => {
      toast(copied ? 'Entry copied.' : 'Could not copy the entry.', { tone: copied ? 'success' : 'error' });
    });
  });
  actions.append(copyButton, make('span', 'entry-id', entry.id));
  body.append(actions);

  head.addEventListener('click', () => {
    const isOpen = article.classList.toggle('is-open');
    head.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) expanded.add(entry.id);
    else expanded.delete(entry.id);
  });

  article.append(head, body);
  return article;
}

function visibleEntries(): LogEntry[] {
  return filtered.slice(0, visibleCount);
}

function updateFilterUi(): void {
  elements.search.value = filter.query;
  elements.level.value = filter.level;
  elements.source.value = filter.source;
  elements.time.value = filter.timeRange;
}

function renderList(): void {
  if (!snapshot) return;
  const rows = visibleEntries();
  clear(elements.logList);
  elements.logList.append(...rows.map(renderEntry));

  const hasRows = rows.length > 0;
  elements.emptyState.hidden = hasRows;
  if (!hasRows) {
    if (snapshot.entries.length === 0) {
      elements.emptyTitle.textContent = 'No logs captured yet';
      elements.emptyText.textContent =
        'Log Lens captures extension errors and unhandled rejections by default. Page and network capture are opt-in.';
    } else {
      elements.emptyTitle.textContent = 'No matching logs';
      elements.emptyText.textContent = 'Clear the search or widen the filters to see the rest of the buffer.';
    }
  }

  elements.loadMore.hidden = visibleCount >= filtered.length;
  elements.shownCount.textContent = hasRows
    ? `Showing ${rows.length.toLocaleString()} of ${filtered.length.toLocaleString()} matching entries`
    : '';
  elements.resultCount.textContent = `${filtered.length.toLocaleString()} matching \u00b7 ${snapshot.entries.length.toLocaleString()} in buffer`;
  document.title = `Log Lens - ${snapshot.entries.filter((entry) => isFailureLevel(entry.level)).length} failures`;
}

function applyFilters(resetVisible = true): void {
  if (!snapshot) return;
  filtered = filterEntries(snapshot.entries, filter);
  if (resetVisible) visibleCount = PAGE_SIZE;
  renderList();
}

function updateSummary(data: SnapshotResponse): void {
  const counts = countLevels(data.entries);
  const settings = data.settings;
  elements.statErrors.textContent = String(counts.failures);
  elements.statWarnings.textContent = String(counts.byLevel.warn);
  elements.statTotal.textContent = String(counts.total);
  const lastFailure = data.entries
    .filter((entry) => isFailureLevel(entry.level))
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  const lastTimestamp = lastFailure?.timestamp ?? data.state.lastErrorAt ?? null;
  elements.statLast.textContent = lastTimestamp ? formatRelative(lastTimestamp) : '-';
  elements.statLast.title = lastTimestamp ? formatClock(lastTimestamp) : 'No failure recorded';

  elements.statusLine.textContent = `${counts.total} entries \u00b7 retention ${settings.retentionDays}d \u00b7 auto-open ${settings.autoOpen}`;
  elements.sendPill.textContent = settings.autoSend.enabled
    ? `Auto-send ${settings.autoSend.mode === 'immediate' ? 'immediate' : `every ${settings.autoSend.intervalMinutes}m`}`
    : 'Auto-send off';
  elements.sendPill.className = `pill ${settings.autoSend.enabled ? 'ok' : ''}`;
}

function updateSendAlert(data: SnapshotResponse): void {
  const messages: string[] = [];
  if (data.pendingCount > 0) {
    messages.push(
      `${data.pendingCount} auto-send batch${data.pendingCount === 1 ? '' : 'es'} waiting to be delivered.`,
    );
  }
  if (data.settings.autoSend.enabled && data.state.lastAutoSendStatus === 'error' && data.state.lastAutoSendError) {
    messages.push(`Last auto-send failed: ${data.state.lastAutoSendError}`);
  }
  elements.sendAlert.hidden = messages.length === 0;
  elements.sendAlert.textContent = messages.join(' ');
  elements.sendAlert.className = `notice ${data.state.lastAutoSendStatus === 'error' ? 'danger' : 'warn'}`;
}

async function checkPagePermission(data: SnapshotResponse): Promise<void> {
  const needed = data.settings.capturePageErrors || data.settings.captureNetworkFailures;
  if (!needed) {
    elements.permissionAlert.hidden = true;
    return;
  }
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ origins: PAGE_ORIGINS });
  } catch {
    granted = false;
  }
  elements.permissionAlert.hidden = granted;
  if (!granted) {
    elements.permissionAlert.className = 'notice warn';
    elements.permissionAlert.textContent =
      'Page capture is enabled but the site-access permission is missing. Open Settings and save again to grant it.';
  }
}

function handleFocusEntry(): void {
  const focusId = new URLSearchParams(location.search).get('entry');
  if (!focusId || focusHandled || !snapshot) return;
  focusHandled = true;
  const index = filtered.findIndex((entry) => entry.id === focusId);
  if (index < 0) return;
  expanded.add(focusId);
  visibleCount = Math.max(visibleCount, index + 1);
  renderList();
  const node = Array.from(elements.logList.querySelectorAll<HTMLElement>('.log-entry')).find(
    (element) => element.dataset.entryId === focusId,
  );
  node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function render(data: SnapshotResponse): void {
  snapshot = data;
  updateSummary(data);
  updateSendAlert(data);
  applyFilters(false);
  updateFilterUi();
  handleFocusEntry();
  void checkPagePermission(data);
  if (pendingEmailAction) {
    pendingEmailAction = false;
    openEmailDialog();
  }
}

async function load(): Promise<void> {
  if (loading) {
    loadQueued = true;
    return;
  }
  loading = true;
  try {
    render(await requestSnapshot());
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not load logs.', { tone: 'error' });
  } finally {
    loading = false;
    if (loadQueued) {
      loadQueued = false;
      void load();
    }
  }
}

function actionEntries(): LogEntry[] {
  return filtered;
}

function openEmailDialog(): void {
  const entries = actionEntries();
  if (entries.length === 0) {
    toast('There are no matching entries to email.', { tone: 'error' });
    return;
  }
  emailEntries = entries;
  const recipient = snapshot?.settings.emailRecipient ?? '';
  const parts = buildEmailParts(entries, recipient);
  elements.emailRecipient.value = recipient;
  elements.emailPreview.textContent = parts.body;
  showDialog(elements.emailDialog);
}

function recipientValue(): string | null {
  const value = elements.emailRecipient.value.trim();
  if (value && !EMAIL_RE.test(value)) {
    toast('Enter a valid email address, or leave the field blank.', { tone: 'error' });
    return null;
  }
  return value;
}

function exportLogs(): void {
  const entries = actionEntries();
  if (entries.length === 0) {
    toast('There are no matching entries to export.', { tone: 'error' });
    return;
  }
  const format = elements.exportFormat.value;
  if (format === 'csv') {
    downloadText(entriesToCsv(entries), `${fileBaseName()}.csv`, 'text/csv;charset=utf-8');
  } else if (format === 'txt') {
    downloadText(entriesToText(entries), `${fileBaseName()}.txt`, 'text/plain;charset=utf-8');
  } else {
    downloadText(exportJson(entries), `${fileBaseName()}.json`, 'application/json');
  }
  toast(`Exported ${entries.length} entries.`, { tone: 'success' });
}

async function copyAll(): Promise<void> {
  const entries = actionEntries();
  if (entries.length === 0) {
    toast('There are no matching entries to copy.', { tone: 'error' });
    return;
  }
  const copied = await copyText(entriesToText(entries));
  toast(copied ? `${entries.length} entries copied.` : 'Could not copy to the clipboard.', {
    tone: copied ? 'success' : 'error',
  });
}

async function capturePanel(): Promise<void> {
  setBusy(elements.capturePanel, true);
  try {
    await document.fonts.ready;
    const blob = await elementToPng(elements.shell, { scale: 2, viewportOnly: true });
    downloadBlob(blob, `log-lens-panel-${Date.now()}.png`);
    toast('Panel saved as PNG.', { tone: 'success' });
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not capture the panel.', { tone: 'error' });
  } finally {
    setBusy(elements.capturePanel, false);
  }
}

async function capturePage(): Promise<void> {
  setBusy(elements.capturePage, true);
  try {
    let response = await captureVisiblePage();
    if (!response.ok && response.permissionRequired) {
      const granted = await chrome.permissions.request({ origins: PAGE_ORIGINS });
      if (granted) response = await captureVisiblePage();
    }
    if (!response.ok || !response.dataUrl) {
      throw new Error(response.error ?? 'Could not capture the visible page.');
    }
    downloadDataUrl(response.dataUrl, `log-lens-page-${Date.now()}.png`);
    toast('Visible page saved as PNG.', { tone: 'success' });
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not capture the page.', { tone: 'error' });
  } finally {
    setBusy(elements.capturePage, false);
  }
}

async function openPreview(): Promise<void> {
  setBusy(elements.preview, true);
  try {
    const response = await previewSend();
    if (!response.ok) throw new Error(response.error ?? 'Could not build a preview.');
    const preview = response.preview;
    previewPayloadText = JSON.stringify(preview.payload, null, 2);
    elements.previewEndpoint.textContent = preview.endpoint || 'Not configured';
    elements.previewPayload.textContent = previewPayloadText;
    elements.previewSubtitle.textContent = preview.enabled
      ? `Auto-send is enabled (${preview.mode}). This is a dry run - nothing was sent.`
      : 'Auto-send is disabled. This payload is local only and cannot be sent.';
    showDialog(elements.previewDialog);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not build a preview.', { tone: 'error' });
  } finally {
    setBusy(elements.preview, false);
  }
}

async function clearAll(): Promise<void> {
  setBusy(elements.clearConfirm, true);
  try {
    const response = await clearLogs();
    if (!response.ok) throw new Error(response.error ?? 'Could not clear logs.');
    closeDialog(elements.clearDialog);
    expanded.clear();
    await load();
    toast('All logs cleared.', { tone: 'success' });
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not clear logs.', { tone: 'error' });
  } finally {
    setBusy(elements.clearConfirm, false);
  }
}

function resetFilters(): void {
  filter.query = '';
  filter.level = 'all';
  filter.source = 'all';
  filter.timeRange = 'all';
  updateFilterUi();
  applyFilters();
}

elements.search.addEventListener(
  'input',
  debounce(() => {
    filter.query = elements.search.value;
    applyFilters();
  }, 150),
);
elements.level.addEventListener('change', () => {
  filter.level = elements.level.value as LogLevel | 'all';
  applyFilters();
});
elements.source.addEventListener('change', () => {
  filter.source = elements.source.value as LogSource | 'all';
  applyFilters();
});
elements.time.addEventListener('change', () => {
  filter.timeRange = elements.time.value as TimeRange;
  applyFilters();
});
elements.resetFilters.addEventListener('click', resetFilters);
elements.refresh.addEventListener('click', () => void load());
elements.loadMore.addEventListener('click', () => {
  visibleCount += PAGE_SIZE;
  renderList();
});
elements.email.addEventListener('click', openEmailDialog);
elements.exportButton.addEventListener('click', exportLogs);
elements.copyAll.addEventListener('click', () => void copyAll());
elements.capturePanel.addEventListener('click', () => void capturePanel());
elements.capturePage.addEventListener('click', () => void capturePage());
elements.preview.addEventListener('click', () => void openPreview());
elements.clearButton.addEventListener('click', () => showDialog(elements.clearDialog));
elements.clearCancel.addEventListener('click', () => closeDialog(elements.clearDialog));
elements.clearConfirm.addEventListener('click', () => void clearAll());
elements.emailClose.addEventListener('click', () => closeDialog(elements.emailDialog));
elements.emailOpen.addEventListener('click', () => {
  const recipient = recipientValue();
  if (recipient === null) return;
  const parts = buildEmailParts(emailEntries, recipient);
  openExternal(buildMailtoUrl(parts));
  toast('Opening your email app...', { tone: 'info' });
});
elements.emailCopy.addEventListener('click', () => {
  const parts = buildEmailParts(emailEntries, elements.emailRecipient.value.trim());
  void copyText(parts.body).then((copied) => {
    toast(copied ? 'Email body copied.' : 'Could not copy the email body.', { tone: copied ? 'success' : 'error' });
  });
});
elements.previewClose.addEventListener('click', () => closeDialog(elements.previewDialog));
elements.previewCopy.addEventListener('click', () => {
  void copyText(previewPayloadText).then((copied) => {
    toast(copied ? 'Payload copied.' : 'Could not copy the payload.', { tone: copied ? 'success' : 'error' });
  });
});
elements.previewDownload.addEventListener('click', () => {
  downloadText(previewPayloadText, `log-lens-preview-${Date.now()}.json`, 'application/json');
});
elements.options.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});
elements.privacy.href = chrome.runtime.getURL('privacy_policy.html');

document.addEventListener('keydown', (event) => {
  if (
    event.key === '/' &&
    !(event.target instanceof HTMLInputElement) &&
    !(event.target instanceof HTMLTextAreaElement)
  ) {
    event.preventDefault();
    elements.search.focus();
  }
  if (event.key === 'Escape' && document.activeElement === elements.search) {
    elements.search.value = '';
    filter.query = '';
    applyFilters();
  }
});

watchStorage(
  debounce(() => {
    void load();
  }, 220),
);

setInterval(() => {
  if (!snapshot) return;
  for (const node of elements.logList.querySelectorAll<HTMLElement>('.log-entry')) {
    const entryId = node.dataset.entryId;
    const entry = snapshot.entries.find((item) => item.id === entryId);
    const timeNode = node.querySelector<HTMLElement>('.log-meta span:nth-child(2)');
    if (entry && timeNode) timeNode.textContent = formatRelative(entry.timestamp);
  }
}, 30_000);

void load();
