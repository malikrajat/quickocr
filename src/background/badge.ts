import { countLevels } from '../core/ring-buffer.ts';
import type { LogEntry, LogLensSettings } from '../core/types.ts';
import { readEntries, readSettings } from './storage.ts';

export async function refreshBadge(entries?: LogEntry[], settings?: LogLensSettings): Promise<void> {
  const resolvedSettings = settings ?? (await readSettings());
  if (!resolvedSettings.showBadge) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'Log Lens' });
    return;
  }
  const resolvedEntries = entries ?? (await readEntries());
  const counts = countLevels(resolvedEntries);
  const text = counts.failures > 99 ? '99+' : counts.failures > 0 ? String(counts.failures) : '';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: counts.failures > 0 ? '#dc2626' : '#475569' });
  await chrome.action.setTitle({
    title: counts.failures > 0 ? `Log Lens - ${counts.failures} error/fatal log(s)` : 'Log Lens',
  });
}

export async function clearBadge(): Promise<void> {
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: 'Log Lens' });
}
