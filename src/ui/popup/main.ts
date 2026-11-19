import '../shared/base.css';
import './popup.css';

import { PAGE_ORIGINS } from '../../core/constants.ts';
import { exportJson, fileBaseName } from '../../core/payload.ts';
import { countLevels, isFailureLevel } from '../../core/ring-buffer.ts';
import type { LogEntry } from '../../core/types.ts';
import {
  closeDialog,
  debounce,
  formatClock,
  formatRelative,
  make,
  query,
  setBusy,
  showDialog,
  toast,
} from '../shared/dom.ts';
import { downloadDataUrl, downloadText } from '../shared/download.ts';
import { installPageErrorReporting } from '../shared/errors.ts';
import {
  captureVisiblePage,
  clearLogs,
  openLogs,
  requestSnapshot,
  type SnapshotResponse,
  watchStorage,
} from '../shared/messages.ts';

installPageErrorReporting('popup');

let snapshot: SnapshotResponse | null = null;

const elements = {
  statusLine: query<HTMLParagraphElement>('#status-line'),
  sendPill: query<HTMLSpanElement>('#send-pill'),
  statErrors: query<HTMLDivElement>('#stat-errors'),
  statWarnings: query<HTMLDivElement>('#stat-warnings'),
  statTotal: query<HTMLDivElement>('#stat-total'),
  latestList: query<HTMLDivElement>('#latest-list'),
  latestSubtitle: query<HTMLDivElement>('#latest-subtitle'),
  emptyState: query<HTMLDivElement>('#empty-state'),
  refresh: query<HTMLButtonElement>('#refresh-button'),
  openViewer: query<HTMLButtonElement>('#open-viewer'),
  openPage: query<HTMLButtonElement>('#open-page'),
  capturePage: query<HTMLButtonElement>('#capture-page'),
  exportJson: query<HTMLButtonElement>('#export-json'),
  emailLogs: query<HTMLButtonElement>('#email-logs'),
  clear: query<HTMLButtonElement>('#clear-logs'),
  options: query<HTMLButtonElement>('#options-button'),
  privacy: query<HTMLAnchorElement>('#privacy-link'),
  clearDialog: query<HTMLDialogElement>('#clear-dialog'),
  clearConfirm: query<HTMLButtonElement>('#clear-confirm'),
  clearCancel: query<HTMLButtonElement>('#clear-cancel'),
};

function renderEntry(entry: LogEntry): HTMLButtonElement {
  const button = make('button', 'popup-entry');
  button.type = 'button';
  button.dataset.entryId = entry.id;
  const badge = make('span', `level-badge ${entry.level}`, entry.level);
  const main = make('span', 'popup-entry-main');
  main.append(
    make('span', 'popup-entry-message', entry.message),
    make(
      'span',
      'popup-entry-meta',
      `${entry.source} · ${formatRelative(entry.timestamp)} · ${formatClock(entry.timestamp)}`,
    ),
  );
  button.append(badge, main);
  button.addEventListener('click', () => {
    void openViewer();
  });
  return button;
}

function render(data: SnapshotResponse): void {
  snapshot = data;
  const counts = countLevels(data.entries);
  elements.statErrors.textContent = String(counts.failures);
  elements.statWarnings.textContent = String(counts.byLevel.warn);
  elements.statTotal.textContent = String(counts.total);
  elements.statusLine.textContent = `${counts.total} stored · ${data.settings.levels.join('/')}`;

  elements.sendPill.textContent = data.settings.autoSend.enabled
    ? `Auto-send ${data.settings.autoSend.mode === 'immediate' ? 'immediate' : `every ${data.settings.autoSend.intervalMinutes}m`}`
    : 'Auto-send off';
  elements.sendPill.className = `pill ${data.settings.autoSend.enabled ? 'ok' : ''}`;

  const failures = data.entries
    .filter((entry) => isFailureLevel(entry.level))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);

  elements.latestList.replaceChildren(...failures.map(renderEntry));
  elements.emptyState.hidden = failures.length > 0;
  elements.latestSubtitle.textContent =
    failures.length > 0
      ? `${failures.length} recent failure${failures.length === 1 ? '' : 's'} · newest ${formatRelative(failures[0]?.timestamp ?? Date.now())}`
      : data.entries.length > 0
        ? 'No failures in the current buffer.'
        : 'Nothing captured yet.';
}

async function load(): Promise<void> {
  try {
    render(await requestSnapshot());
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not load logs.', { tone: 'error' });
  }
}

async function openViewer(): Promise<void> {
  try {
    await openLogs('popup');
    window.close();
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not open the viewer.', { tone: 'error' });
  }
}

async function openFullPage(): Promise<void> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('logs.html?source=popup'), active: true });
    window.close();
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not open the page.', { tone: 'error' });
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

async function exportLogs(): Promise<void> {
  setBusy(elements.exportJson, true);
  try {
    const data = snapshot ?? (await requestSnapshot());
    downloadText(exportJson(data.entries), `${fileBaseName()}.json`, 'application/json');
    toast(`Exported ${data.entries.length} entries.`, { tone: 'success' });
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Export failed.', { tone: 'error' });
  } finally {
    setBusy(elements.exportJson, false);
  }
}

async function emailLogs(): Promise<void> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('logs.html?action=email'), active: true });
    window.close();
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not open the email composer.', { tone: 'error' });
  }
}

async function clearAll(): Promise<void> {
  setBusy(elements.clearConfirm, true);
  try {
    const response = await clearLogs();
    if (!response.ok) throw new Error(response.error ?? 'Could not clear logs.');
    closeDialog(elements.clearDialog);
    await load();
    toast('All logs cleared.', { tone: 'success' });
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not clear logs.', { tone: 'error' });
  } finally {
    setBusy(elements.clearConfirm, false);
  }
}

elements.refresh.addEventListener('click', () => void load());
elements.openViewer.addEventListener('click', () => void openViewer());
elements.openPage.addEventListener('click', () => void openFullPage());
elements.capturePage.addEventListener('click', () => void capturePage());
elements.exportJson.addEventListener('click', () => void exportLogs());
elements.emailLogs.addEventListener('click', () => void emailLogs());
elements.clear.addEventListener('click', () => showDialog(elements.clearDialog));
elements.clearCancel.addEventListener('click', () => closeDialog(elements.clearDialog));
elements.clearConfirm.addEventListener('click', () => void clearAll());
elements.options.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});
elements.privacy.href = chrome.runtime.getURL('privacy_policy.html');

watchStorage(
  debounce(() => {
    void load();
  }, 180),
);

void load();
