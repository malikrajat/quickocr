import { APP_VERSION, MESSAGE, STORAGE_KEYS } from '../core/constants.ts';
import { isRecord } from '../core/guards.ts';
import { errorToDiagnostic } from '../core/redact.ts';
import { normalizeSettings, normalizeState } from '../core/settings.ts';
import type { LogLensSettings, PageEvent } from '../core/types.ts';
import { initLogsTabTracking, openLogsUi } from './auto-open.ts';
import {
  applyAutoSendSettings,
  flushQueued,
  initSendService,
  previewSend,
  runMaintenance,
  runScheduledTick,
  sendNow,
} from './auto-send.ts';
import { clearBadge, refreshBadge } from './badge.ts';
import { captureClientError, captureExtensionError, capturePageEvent } from './capture.ts';
import type { PageCaptureStatus } from './content-scripts.ts';
import { broadcastPageConfig, buildPageConfig, syncPageCaptureRegistration } from './content-scripts.ts';
import { initExternalApi } from './external-api.ts';
import { clearErrorNotification } from './notifications.ts';
import { clearLogs, ensureSettings, getStorageUsage, pruneNow, readSnapshot, saveSettings } from './storage.ts';

async function bootstrap(): Promise<LogLensSettings> {
  const settings = await ensureSettings();
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch {
    // sidePanel is unavailable on older Chrome builds; manifest requires 116+.
  }
  await syncPageCaptureRegistration(settings);
  await initSendService();
  await refreshBadge(undefined, settings);
  return settings;
}

async function initializeState(): Promise<void> {
  const existing = await chrome.storage.local.get(STORAGE_KEYS.state);
  if (existing[STORAGE_KEYS.state] === undefined) {
    const state = normalizeState({ installedAt: Date.now() });
    await chrome.storage.local.set({ [STORAGE_KEYS.state]: state });
  }
}

async function openOptions(): Promise<void> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html?welcome=1'), active: true });
  } catch {
    // Opening a tab can fail if the browser is shutting down.
  }
}

async function handleInstall(): Promise<void> {
  await initializeState();
  await bootstrap();
}

async function captureVisibleTab(): Promise<
  { ok: true; dataUrl: string } | { ok: false; error: string; permissionRequired: boolean }
> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return { ok: false, error: 'No active tab is available.', permissionRequired: false };
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { ok: true, dataUrl };
  } catch (error) {
    return {
      ok: false,
      error: errorToDiagnostic(error).message,
      permissionRequired: true,
    };
  }
}

async function handleMessage(message: unknown, sender: chrome.runtime.MessageSender): Promise<Record<string, unknown>> {
  if (sender.id !== chrome.runtime.id) return { ok: false, error: 'forbidden' };
  if (!isRecord(message) || typeof message.type !== 'string') return { ok: false, error: 'invalid-message' };

  switch (message.type) {
    case MESSAGE.getSnapshot: {
      const snapshot = await readSnapshot();
      return {
        ok: true,
        settings: snapshot.settings,
        entries: snapshot.entries,
        state: snapshot.state,
        pendingCount: snapshot.pending.length,
        version: APP_VERSION,
      };
    }
    case MESSAGE.getStorageUsage: {
      return { ok: true, usage: await getStorageUsage() };
    }
    case MESSAGE.saveSettings: {
      const previous = await ensureSettings();
      let next = normalizeSettings(message.settings);
      const warnings: string[] = [];

      if (next.autoSend.enabled && next.autoSend.endpoint) {
        try {
          const origin = new URL(next.autoSend.endpoint).origin;
          const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
          if (!granted) {
            warnings.push('Endpoint permission is missing. Auto-send stays off until the endpoint is approved.');
            next = normalizeSettings({
              ...next,
              autoSend: { ...next.autoSend, enabled: false, consentAt: null },
            });
          }
        } catch {
          warnings.push('The endpoint URL is invalid.');
          next = normalizeSettings({ ...next, autoSend: { ...next.autoSend, enabled: false, consentAt: null } });
        }
      }

      const saved = await saveSettings(next);
      let pageStatus: PageCaptureStatus;
      try {
        pageStatus = await syncPageCaptureRegistration(saved);
      } catch {
        pageStatus = {
          needed: saved.capturePageErrors || saved.captureNetworkFailures,
          active: false,
          needsPermission: false,
        };
        warnings.push('Page capture registration failed. Reload the extension and try again.');
      }
      await broadcastPageConfig(saved);
      await applyAutoSendSettings(previous, saved);
      await pruneNow();
      await refreshBadge(undefined, saved);
      if (pageStatus.needsPermission) {
        warnings.push('Page capture needs host permission before it can start.');
      }
      return { ok: true, settings: saved, pageStatus, warnings };
    }
    case MESSAGE.clearLogs: {
      await clearLogs();
      await clearBadge();
      await clearErrorNotification();
      return { ok: true };
    }
    case MESSAGE.openLogs: {
      const source = message.source === 'popup' || message.source === 'command' ? message.source : 'manual';
      const result = await openLogsUi(source);
      return { ok: true, mode: result.mode };
    }
    case MESSAGE.capturePageScreenshot: {
      return { ...(await captureVisibleTab()) };
    }
    case MESSAGE.previewSend: {
      return { ok: true, preview: await previewSend() };
    }
    case MESSAGE.sendNow: {
      return { ok: true, result: await sendNow() };
    }
    case MESSAGE.flushSends: {
      return { ok: true, result: await flushQueued() };
    }
    case MESSAGE.captureClientError: {
      const payload = isRecord(message.payload) ? message.payload : {};
      const outcome = await captureClientError(
        {
          message: payload.message,
          details: payload.details,
          page: payload.page,
        },
        sender.url,
      );
      return { ok: true, stored: outcome.stored };
    }
    case MESSAGE.getPageConfig: {
      return { ok: true, config: buildPageConfig(await ensureSettings()) };
    }
    case MESSAGE.capturePageEvent: {
      if (!sender.tab) return { ok: false, error: 'page-events-require-a-tab' };
      const payload = isRecord(message.payload) ? message.payload : {};
      if (typeof payload.message !== 'string' || !payload.message) {
        return { ok: false, error: 'invalid-page-event' };
      }
      const event: PageEvent = {
        kind:
          payload.kind === 'network' || payload.kind === 'page-rejection' || payload.kind === 'page-error'
            ? payload.kind
            : 'page-error',
        message: payload.message,
      };
      if (typeof payload.details === 'string') event.details = payload.details;
      if (typeof payload.level === 'string') event.level = payload.level as PageEvent['level'];
      if (isRecord(payload.context)) event.context = payload.context;
      if (typeof payload.url === 'string') event.url = payload.url;
      const outcome = await capturePageEvent(event, sender.tab.id, sender.tab.url);
      return { ok: true, stored: outcome.stored };
    }
    default:
      return { ok: false, error: 'unknown-message-type' };
  }
}

self.addEventListener('error', (event) => {
  const error = event.error ?? event.message;
  void captureExtensionError(error, 'error', {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  }).catch(() => undefined);
});

self.addEventListener('unhandledrejection', (event) => {
  void captureExtensionError(event.reason, 'rejection').catch(() => undefined);
});

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    void handleMessage(message, sender)
      .then((response) => sendResponse(response))
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: errorToDiagnostic(error).message });
      });
    return true;
  },
);

initExternalApi();
initLogsTabTracking();

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await handleInstall();
    if (details.reason === 'install') await openOptions();
  })().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await initializeState();
    await bootstrap();
    await flushQueued();
  })().catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void (async () => {
    if (alarm.name === 'loglens-maintenance') {
      await runMaintenance();
      await refreshBadge();
      return;
    }
    if (alarm.name === 'loglens-scheduled-send') {
      await runScheduledTick();
      return;
    }
    if (alarm.name === 'loglens-retry-send') {
      await flushQueued();
    }
  })().catch(() => undefined);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'open-logs') return;
  void (async () => {
    await openLogsUi('command');
  })().catch(() => undefined);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== 'loglens-error') return;
  void (async () => {
    await clearErrorNotification();
    await openLogsUi('notification');
  })().catch(() => undefined);
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId !== 'loglens-error' || buttonIndex !== 0) return;
  void (async () => {
    await clearErrorNotification();
    await openLogsUi('notification');
  })().catch(() => undefined);
});

chrome.permissions.onRemoved.addListener(() => {
  void (async () => {
    const snapshot = await readSnapshot();
    let settings = snapshot.settings;
    if (settings.autoSend.enabled && settings.autoSend.endpoint) {
      try {
        const origin = new URL(settings.autoSend.endpoint).origin;
        const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
        if (!granted) {
          settings = normalizeSettings({
            ...settings,
            autoSend: { ...settings.autoSend, enabled: false, consentAt: null },
          });
          await saveSettings(settings);
          await applyAutoSendSettings(snapshot.settings, settings);
          await refreshBadge(undefined, settings);
        }
      } catch {
        // Invalid endpoint settings are handled by the options page.
      }
    }
    await syncPageCaptureRegistration(settings);
  })().catch(() => undefined);
});

void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
