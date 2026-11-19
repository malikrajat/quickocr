import { LIMITS } from '../core/constants.ts';
import { shouldNotify } from '../core/policy.ts';
import { redactText } from '../core/redact.ts';
import type { LogEntry, LogLensSettings, LogState } from '../core/types.ts';
import { updateState } from './storage.ts';

const NOTIFICATION_ID = 'loglens-error';

export async function notifyError(
  entry: LogEntry,
  settings: LogLensSettings,
  state: LogState,
  now = Date.now(),
): Promise<boolean> {
  if (!shouldNotify(settings, entry.level, state.lastNotifyAt, now, LIMITS.notifyCooldownMs)) return false;
  try {
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `Log Lens captured ${entry.level === 'fatal' ? 'a fatal error' : 'an error'}`,
      message: redactText(entry.message).slice(0, 180),
      contextMessage: entry.source,
      priority: 2,
      buttons: [{ title: 'Open log viewer' }],
    });
    await updateState({ lastNotifyAt: now });
    return true;
  } catch {
    return false;
  }
}

export async function clearErrorNotification(): Promise<void> {
  try {
    await chrome.notifications.clear(NOTIFICATION_ID);
  } catch {
    // Notifications can be unavailable in narrow enterprise profiles.
  }
}
