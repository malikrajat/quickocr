import { isFailureLevel, meetsLevel } from './ring-buffer.ts';
import type { AutoOpenMode, LogEntry, LogLensSettings, LogLevel } from './types.ts';
import { LEVEL_RANK } from './types.ts';

export type CaptureKind = 'extension' | 'rejection' | 'page' | 'network' | 'api' | 'manual';

export interface CaptureDescriptor {
  kind: CaptureKind;
  level: LogLevel;
}

export function levelAllowed(settings: LogLensSettings, level: LogLevel): boolean {
  return settings.levels.includes(level);
}

export function shouldCapture(settings: LogLensSettings, descriptor: CaptureDescriptor): boolean {
  if (!levelAllowed(settings, descriptor.level)) return false;
  switch (descriptor.kind) {
    case 'extension':
      return settings.captureExtensionErrors;
    case 'rejection':
      return settings.captureUnhandledRejections;
    case 'page':
      return settings.capturePageErrors;
    case 'network':
      return settings.captureNetworkFailures;
    case 'api':
    case 'manual':
      return true;
  }
}

export function shouldAutoOpen(
  mode: AutoOpenMode,
  level: LogLevel,
  lastOpenAt: number | null,
  now: number,
  cooldownMs: number,
): boolean {
  if (mode === 'never') return false;
  if (mode === 'on-error' && !isFailureLevel(level)) return false;
  return lastOpenAt === null || now - lastOpenAt >= cooldownMs;
}

export function shouldNotify(
  settings: LogLensSettings,
  level: LogLevel,
  lastNotifyAt: number | null,
  now: number,
  cooldownMs: number,
): boolean {
  if (!settings.notifyOnError || !isFailureLevel(level)) return false;
  return lastNotifyAt === null || now - lastNotifyAt >= cooldownMs;
}

export function shouldAutoSend(settings: LogLensSettings, level: LogLevel): boolean {
  const auto = settings.autoSend;
  if (!auto.enabled || auto.consentAt === null) return false;
  return meetsLevel(level, auto.minLevel);
}

export function entriesForAutoSend(settings: LogLensSettings, entries: LogEntry[]): LogEntry[] {
  if (!settings.autoSend.enabled) return [];
  return entries
    .filter((entry) => meetsLevel(entry.level, settings.autoSend.minLevel))
    .slice(-settings.autoSend.batchSize);
}

/** attemptsAlreadyMade is the number of failed attempts, starting at 1. */
export function computeRetryDelayMs(attemptsAlreadyMade: number, retryDelaySeconds: number): number {
  const exponent = Math.max(0, attemptsAlreadyMade - 1);
  const delaySeconds = Math.min(retryDelaySeconds * 2 ** exponent, 15 * 60);
  return Math.max(1, Math.round(delaySeconds)) * 1000;
}

export function canRetry(attemptsAlreadyMade: number, retryCount: number): boolean {
  return attemptsAlreadyMade <= retryCount;
}

export function isNetworkFailure(status: number, minStatus: number): boolean {
  return status === 0 || status >= minStatus;
}

export function levelForHttpStatus(status: number): LogLevel {
  if (status === 0 || status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export function sortBySeverity(entries: LogEntry[]): LogEntry[] {
  return [...entries].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.timestamp - a.timestamp);
}

export function scheduledTickDue(settings: LogLensSettings, lastQueuedAt: number | null, now: number): boolean {
  if (!settings.autoSend.enabled || settings.autoSend.mode !== 'scheduled') return false;
  if (lastQueuedAt === null) return true;
  return now - lastQueuedAt >= settings.autoSend.intervalMinutes * 60 * 1000;
}

export function needsImmediateSend(settings: LogLensSettings, entries: LogEntry[]): boolean {
  if (!settings.autoSend.enabled || settings.autoSend.mode !== 'immediate') return false;
  return entries.some((entry) => meetsLevel(entry.level, settings.autoSend.minLevel));
}
