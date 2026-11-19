import { LIMITS, STORAGE_KEYS } from '../core/constants.ts';
import { redactContext, redactText, sanitizeUrlForLog } from '../core/redact.ts';
import { appendEntries, fingerprint, isFailureLevel, pruneLogs } from '../core/ring-buffer.ts';
import { normalizeSettings, normalizeState } from '../core/settings.ts';
import type { LogEntry, LogLensSettings, LogState, PendingSend } from '../core/types.ts';
import { LOG_LEVELS, LOG_SOURCES } from '../core/types.ts';
import { isValidHttpsEndpoint } from '../core/url.ts';

export interface Snapshot {
  settings: LogLensSettings;
  entries: LogEntry[];
  state: LogState;
  pending: PendingSend[];
}

export interface StoreResult {
  settings: LogLensSettings;
  entries: LogEntry[];
  state: LogState;
  added: number;
}

let writeChain: Promise<unknown> = Promise.resolve();

/** Serialises mutations so concurrent messages cannot lose ring-buffer writes. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = writeChain.then(task, task);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeStoredEntry(value: unknown): LogEntry | null {
  const raw = asRecord(value);
  const message = typeof raw.message === 'string' ? redactText(raw.message).slice(0, LIMITS.maxMessageChars) : '';
  if (!message) return null;
  const level =
    typeof raw.level === 'string' && (LOG_LEVELS as readonly string[]).includes(raw.level) ? raw.level : 'error';
  const source =
    typeof raw.source === 'string' && (LOG_SOURCES as readonly string[]).includes(raw.source)
      ? raw.source
      : 'extension';
  const timestamp =
    typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp) && raw.timestamp > 0
      ? raw.timestamp
      : Date.now();
  const entry: LogEntry = {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 128) : makeId(),
    timestamp,
    level: level as LogEntry['level'],
    source: source as LogEntry['source'],
    message,
    fingerprint:
      typeof raw.fingerprint === 'string'
        ? raw.fingerprint.slice(0, 32)
        : fingerprint(level as LogEntry['level'], source as LogEntry['source'], message),
  };
  if (typeof raw.details === 'string' && raw.details)
    entry.details = redactText(raw.details).slice(0, LIMITS.maxDetailsChars);
  const context = raw.context ? redactContext(raw.context) : undefined;
  if (context) entry.context = context;
  const url = typeof raw.url === 'string' ? sanitizeUrlForLog(raw.url) : undefined;
  if (url) entry.url = url;
  if (typeof raw.tabId === 'number' && Number.isFinite(raw.tabId) && raw.tabId >= 0)
    entry.tabId = Math.floor(raw.tabId);
  if (typeof raw.extensionId === 'string' && raw.extensionId) entry.extensionId = raw.extensionId.slice(0, 128);
  return entry;
}

function sanitizeStoredEntries(value: unknown): LogEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: LogEntry[] = [];
  for (const item of value) {
    const entry = sanitizeStoredEntry(item);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

function sanitizePendingSends(value: unknown): PendingSend[] {
  if (!Array.isArray(value)) return [];
  const pending: PendingSend[] = [];
  for (const item of value) {
    const raw = asRecord(item);
    const entries = sanitizeStoredEntries(raw.entries);
    if (!entries.length) continue;
    const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 128) : makeId();
    const reason =
      raw.reason === 'scheduled' || raw.reason === 'manual' || raw.reason === 'immediate' ? raw.reason : 'immediate';
    const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.slice(0, LIMITS.maxEndpointChars) : '';
    if (!endpoint || !isValidHttpsEndpoint(endpoint)) continue;
    pending.push({
      id,
      reason,
      createdAt: typeof raw.createdAt === 'number' && raw.createdAt > 0 ? raw.createdAt : Date.now(),
      attempts: typeof raw.attempts === 'number' && raw.attempts >= 0 ? Math.floor(raw.attempts) : 0,
      nextAttemptAt: typeof raw.nextAttemptAt === 'number' && raw.nextAttemptAt > 0 ? raw.nextAttemptAt : Date.now(),
      endpoint,
      entries,
      ...(typeof raw.lastError === 'string' ? { lastError: raw.lastError.slice(0, 500) } : {}),
    });
    if (pending.length >= LIMITS.send.maxPendingBatches) break;
  }
  return pending;
}

async function rawGet(keys: string | string[]): Promise<Record<string, unknown>> {
  const value = await chrome.storage.local.get(keys);
  return asRecord(value);
}

export async function readSettings(): Promise<LogLensSettings> {
  const raw = await rawGet(STORAGE_KEYS.settings);
  return normalizeSettings(raw[STORAGE_KEYS.settings]);
}

export async function ensureSettings(): Promise<LogLensSettings> {
  const raw = await rawGet(STORAGE_KEYS.settings);
  if (raw[STORAGE_KEYS.settings] === undefined) {
    const settings = normalizeSettings(undefined);
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
    return settings;
  }
  return normalizeSettings(raw[STORAGE_KEYS.settings]);
}

export async function saveSettings(input: unknown): Promise<LogLensSettings> {
  const settings = normalizeSettings(input);
  return serial(async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
    return settings;
  });
}

export async function readEntries(): Promise<LogEntry[]> {
  const raw = await rawGet(STORAGE_KEYS.logs);
  return sanitizeStoredEntries(raw[STORAGE_KEYS.logs]);
}

export async function readState(): Promise<LogState> {
  const raw = await rawGet(STORAGE_KEYS.state);
  return normalizeState(raw[STORAGE_KEYS.state]);
}

export async function readPendingSends(): Promise<PendingSend[]> {
  const raw = await rawGet(STORAGE_KEYS.pendingSends);
  return sanitizePendingSends(raw[STORAGE_KEYS.pendingSends]);
}

export async function readSnapshot(): Promise<Snapshot> {
  const raw = await rawGet([STORAGE_KEYS.settings, STORAGE_KEYS.logs, STORAGE_KEYS.state, STORAGE_KEYS.pendingSends]);
  return {
    settings: normalizeSettings(raw[STORAGE_KEYS.settings]),
    entries: sanitizeStoredEntries(raw[STORAGE_KEYS.logs]),
    state: normalizeState(raw[STORAGE_KEYS.state]),
    pending: sanitizePendingSends(raw[STORAGE_KEYS.pendingSends]),
  };
}

export async function storeEntries(entries: LogEntry[], now = Date.now()): Promise<StoreResult> {
  return serial(async () => {
    const raw = await rawGet([STORAGE_KEYS.settings, STORAGE_KEYS.logs, STORAGE_KEYS.state]);
    const settings = normalizeSettings(raw[STORAGE_KEYS.settings]);
    const existing = sanitizeStoredEntries(raw[STORAGE_KEYS.logs]);
    const state = normalizeState(raw[STORAGE_KEYS.state]);
    const next = appendEntries(existing, entries, settings, now);
    if (entries.some((entry) => isFailureLevel(entry.level))) state.lastErrorAt = now;
    await chrome.storage.local.set({
      [STORAGE_KEYS.logs]: next,
      [STORAGE_KEYS.state]: state,
    });
    return { settings, entries: next, state, added: entries.length };
  });
}

export async function updateState(patch: Partial<LogState>): Promise<LogState> {
  return serial(async () => {
    const raw = await rawGet(STORAGE_KEYS.state);
    const state = { ...normalizeState(raw[STORAGE_KEYS.state]), ...patch };
    await chrome.storage.local.set({ [STORAGE_KEYS.state]: state });
    return state;
  });
}

export async function clearLogs(): Promise<void> {
  return serial(async () => {
    const raw = await rawGet(STORAGE_KEYS.state);
    const state = normalizeState(raw[STORAGE_KEYS.state]);
    state.lastErrorAt = null;
    state.pendingRetryAt = null;
    await chrome.storage.local.set({
      [STORAGE_KEYS.logs]: [],
      [STORAGE_KEYS.state]: state,
      [STORAGE_KEYS.pendingSends]: [],
    });
    await chrome.storage.session.remove(STORAGE_KEYS.openLogsTab);
  });
}

export async function pruneNow(now = Date.now()): Promise<LogEntry[]> {
  return serial(async () => {
    const raw = await rawGet([STORAGE_KEYS.settings, STORAGE_KEYS.logs]);
    const settings = normalizeSettings(raw[STORAGE_KEYS.settings]);
    const entries = sanitizeStoredEntries(raw[STORAGE_KEYS.logs]);
    const pruned = pruneLogs(entries, settings, now);
    if (pruned.length !== entries.length) {
      await chrome.storage.local.set({ [STORAGE_KEYS.logs]: pruned });
    }
    return pruned;
  });
}

export async function setPendingSends(pending: PendingSend[]): Promise<void> {
  return serial(async () => {
    await chrome.storage.local.set({ [STORAGE_KEYS.pendingSends]: pending.slice(0, LIMITS.send.maxPendingBatches) });
  });
}

export async function mutatePending<T>(
  mutator: (pending: PendingSend[]) => { pending: PendingSend[]; result: T },
): Promise<T> {
  return serial(async () => {
    const raw = await rawGet(STORAGE_KEYS.pendingSends);
    const current = sanitizePendingSends(raw[STORAGE_KEYS.pendingSends]);
    const { pending, result } = mutator(current);
    await chrome.storage.local.set({ [STORAGE_KEYS.pendingSends]: pending.slice(0, LIMITS.send.maxPendingBatches) });
    return result;
  });
}

export async function getStorageUsage(): Promise<{ bytes: number; maxBytes: number; percent: number }> {
  const bytes = await chrome.storage.local.getBytesInUse(null);
  const maxBytes = chrome.storage.local.QUOTA_BYTES ?? 10_485_760;
  return { bytes, maxBytes, percent: maxBytes > 0 ? Math.min(100, (bytes / maxBytes) * 100) : 0 };
}

export async function getOpenLogsTabId(): Promise<number | null> {
  const raw = await chrome.storage.session.get(STORAGE_KEYS.openLogsTab);
  const value = raw[STORAGE_KEYS.openLogsTab];
  return typeof value === 'number' && value >= 0 ? value : null;
}

export async function setOpenLogsTabId(tabId: number | null): Promise<void> {
  if (tabId === null) {
    await chrome.storage.session.remove(STORAGE_KEYS.openLogsTab);
  } else {
    await chrome.storage.session.set({ [STORAGE_KEYS.openLogsTab]: tabId });
  }
}
