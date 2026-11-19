import { LIMITS } from '../core/constants.ts';
import { shouldAutoOpen } from '../core/policy.ts';
import type { LogLensSettings, LogLevel, LogState } from '../core/types.ts';
import { getOpenLogsTabId, setOpenLogsTabId, updateState } from './storage.ts';

const LOGS_PAGE = 'logs.html';

export function logsPageUrl(source: 'auto' | 'manual' | 'command' | 'popup' | 'notification'): string {
  return chrome.runtime.getURL(`${LOGS_PAGE}?source=${source}`);
}

async function activateExistingLogsTab(): Promise<boolean> {
  const tabId = await getOpenLogsTabId();
  if (tabId === null) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.id) return false;
    await chrome.tabs.update(tab.id, { active: true });
    if (typeof tab.windowId === 'number') {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return true;
  } catch {
    await setOpenLogsTabId(null);
    return false;
  }
}

export async function openLogsTab(source: 'auto' | 'manual' | 'command' | 'popup' | 'notification'): Promise<void> {
  if (await activateExistingLogsTab()) return;
  const tab = await chrome.tabs.create({ url: logsPageUrl(source), active: true });
  if (typeof tab.id === 'number') await setOpenLogsTabId(tab.id);
}

async function tryOpenSidePanel(): Promise<boolean> {
  if (!chrome.sidePanel?.open) return false;
  try {
    await chrome.sidePanel.setOptions({ path: LOGS_PAGE, enabled: true });
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) {
      await chrome.sidePanel.open({ tabId: tab.id });
      return true;
    }
    const window = await chrome.windows.getLastFocused();
    if (window.id !== undefined) {
      await chrome.sidePanel.open({ windowId: window.id });
      return true;
    }
    return false;
  } catch {
    // Chrome requires a user gesture for sidePanel.open. Auto-open falls back
    // to a normal tab so the user still sees the captured error.
    return false;
  }
}

/**
 * Prefers the native side panel. If Chrome refuses to open it without a user
 * gesture (the common case for automatic opens), opens logs.html in a tab.
 */
export async function openLogsUi(
  source: 'auto' | 'manual' | 'command' | 'popup' | 'notification',
  options: { preferSidePanel?: boolean } = {},
): Promise<{ mode: 'side-panel' | 'tab' }> {
  const preferSidePanel = options.preferSidePanel ?? true;
  if (preferSidePanel && (await tryOpenSidePanel())) {
    return { mode: 'side-panel' };
  }
  await openLogsTab(source);
  return { mode: 'tab' };
}

export async function maybeAutoOpen(
  settings: LogLensSettings,
  level: LogLevel,
  state: LogState,
  now = Date.now(),
): Promise<{ opened: boolean; mode: 'side-panel' | 'tab' | null }> {
  if (!shouldAutoOpen(settings.autoOpen, level, state.lastOpenAt, now, LIMITS.autoOpenCooldownMs)) {
    return { opened: false, mode: null };
  }
  await updateState({ lastOpenAt: now });
  try {
    const result = await openLogsUi('auto');
    return { opened: true, mode: result.mode };
  } catch {
    return { opened: false, mode: null };
  }
}

export function initLogsTabTracking(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const tracked = await getOpenLogsTabId();
      if (tracked === tabId) await setOpenLogsTabId(null);
    })().catch(() => undefined);
  });
}
