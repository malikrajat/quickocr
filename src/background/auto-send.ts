import { ALARMS, LIMITS } from '../core/constants.ts';
import { buildSendPayload } from '../core/payload.ts';
import { canRetry, computeRetryDelayMs, scheduledTickDue } from '../core/policy.ts';
import { errorToDiagnostic } from '../core/redact.ts';
import { meetsLevel } from '../core/ring-buffer.ts';
import type { LogEntry, LogLensSettings, PendingSend } from '../core/types.ts';
import { isValidHttpsEndpoint } from '../core/url.ts';
import {
  mutatePending,
  pruneNow,
  readEntries,
  readPendingSends,
  readSettings,
  readState,
  setPendingSends,
  updateState,
} from './storage.ts';

export interface PreviewResult {
  enabled: boolean;
  endpoint: string;
  mode: LogLensSettings['autoSend']['mode'];
  entries: LogEntry[];
  payload: ReturnType<typeof buildSendPayload>;
}

export interface FlushResult {
  attempted: number;
  sent: number;
  failed: number;
  remaining: number;
}

let sendChain: Promise<unknown> = Promise.resolve();

function withSendLock<T>(task: () => Promise<T>): Promise<T> {
  const result = sendChain.then(task, task);
  sendChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeBatch(entries: LogEntry[], reason: PendingSend['reason'], endpoint: string, now: number): PendingSend {
  return {
    id: makeId(),
    reason,
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
    endpoint,
    entries,
  };
}

async function enqueueEntries(entries: LogEntry[], reason: PendingSend['reason'], now = Date.now()): Promise<void> {
  if (entries.length === 0) return;
  const settings = await readSettings();
  if (!settings.autoSend.enabled || !isValidHttpsEndpoint(settings.autoSend.endpoint)) return;
  const endpoint = settings.autoSend.endpoint;
  const chunkSize = settings.autoSend.batchSize;
  const chunks: LogEntry[][] = [];
  for (let index = 0; index < entries.length; index += chunkSize) {
    chunks.push(entries.slice(index, index + chunkSize));
  }
  await mutatePending((pending) => {
    const next = [...pending];
    for (const chunk of chunks) {
      const last = next[next.length - 1];
      if (
        reason === 'immediate' &&
        last &&
        last.reason === 'immediate' &&
        last.endpoint === endpoint &&
        now - last.createdAt <= 5000
      ) {
        next[next.length - 1] = {
          ...last,
          entries: [...last.entries, ...chunk].slice(-chunkSize),
        };
      } else {
        if (next.length >= LIMITS.send.maxPendingBatches) next.shift();
        next.push(makeBatch(chunk, reason, endpoint, now));
      }
    }
    return { pending: next, result: undefined };
  });
}

interface PostResult {
  ok: boolean;
  error?: string;
}

async function postBatch(batch: PendingSend, timeoutMs = LIMITS.send.requestTimeoutMs): Promise<PostResult> {
  if (!isValidHttpsEndpoint(batch.endpoint)) return { ok: false, error: 'Endpoint is not a valid HTTPS URL' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(batch.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSendPayload(batch.entries, batch.reason)),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    // Never read the response body: it is not log data and may contain
    // sensitive error details from a third-party collector.
    if (response.body) void response.body.cancel().catch(() => undefined);
    if (!response.ok) return { ok: false, error: `Endpoint returned HTTP ${response.status}` };
    return { ok: true };
  } catch (error) {
    const diagnostic = errorToDiagnostic(error);
    return { ok: false, error: controller.signal.aborted ? 'Request timed out' : diagnostic.message };
  } finally {
    clearTimeout(timer);
  }
}

async function flushInternal(): Promise<FlushResult> {
  const settings = await readSettings();
  if (!settings.autoSend.enabled || !isValidHttpsEndpoint(settings.autoSend.endpoint)) {
    const pending = await readPendingSends();
    if (pending.length > 0) await setPendingSends([]);
    await updateState({ pendingRetryAt: null });
    await syncSendAlarms(settings, []);
    return { attempted: 0, sent: 0, failed: 0, remaining: 0 };
  }

  let attempted = 0;
  let sent = 0;
  let failed = 0;

  for (let step = 0; step < 5; step += 1) {
    const pending = await readPendingSends();
    const now = Date.now();
    const due = pending
      .filter((batch) => batch.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt)[0];
    if (!due) break;
    attempted += 1;
    const result = await postBatch(due);
    if (result.ok) {
      sent += 1;
      await mutatePending((current) => ({
        pending: current.filter((batch) => batch.id !== due.id),
        result: undefined,
      }));
      await updateState({ lastAutoSendAt: Date.now(), lastAutoSendStatus: 'ok', lastAutoSendError: null });
      continue;
    }

    failed += 1;
    const attempts = due.attempts + 1;
    if (canRetry(attempts, settings.autoSend.retryCount)) {
      const nextAttemptAt = Date.now() + computeRetryDelayMs(attempts, settings.autoSend.retryDelaySeconds);
      await mutatePending((current) => ({
        pending: current.map((batch) =>
          batch.id === due.id
            ? {
                ...batch,
                attempts,
                nextAttemptAt,
                lastError: result.error ?? 'Request failed',
              }
            : batch,
        ),
        result: undefined,
      }));
      await updateState({
        lastAutoSendAt: Date.now(),
        lastAutoSendStatus: 'error',
        lastAutoSendError: result.error ?? 'Request failed',
      });
    } else {
      await mutatePending((current) => ({
        pending: current.filter((batch) => batch.id !== due.id),
        result: undefined,
      }));
      await updateState({
        lastAutoSendAt: Date.now(),
        lastAutoSendStatus: 'error',
        lastAutoSendError: `Gave up after ${attempts} attempt(s): ${result.error ?? 'Request failed'}`,
      });
    }
  }

  const remaining = await readPendingSends();
  const nextRetryAt = remaining.length > 0 ? Math.min(...remaining.map((batch) => batch.nextAttemptAt)) : null;
  await updateState({ pendingRetryAt: nextRetryAt });
  await syncSendAlarms(settings, remaining);
  return { attempted, sent, failed, remaining: remaining.length };
}

export function flushQueued(): Promise<FlushResult> {
  return withSendLock(flushInternal);
}

export async function onEntriesStored(entries: LogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await withSendLock(async () => {
    const settings = await readSettings();
    if (!settings.autoSend.enabled || settings.autoSend.mode !== 'immediate') return;
    const eligible = entries.filter((entry) => meetsLevel(entry.level, settings.autoSend.minLevel));
    if (eligible.length === 0) return;
    await enqueueEntries(eligible, 'immediate');
    await flushInternal();
  });
}

async function runScheduledTickInternal(): Promise<void> {
  const settings = await readSettings();
  const state = await readState();
  const now = Date.now();
  if (!scheduledTickDue(settings, state.lastScheduledQueuedAt, now)) return;

  const coveredThrough = state.lastScheduledCoveredThrough ?? now;
  const entries = await readEntries();
  const eligible = entries
    .filter((entry) => entry.timestamp > coveredThrough && meetsLevel(entry.level, settings.autoSend.minLevel))
    .slice(-settings.autoSend.batchSize);

  if (eligible.length > 0) {
    await enqueueEntries(eligible, 'scheduled', now);
    await updateState({
      lastScheduledQueuedAt: now,
      lastScheduledCoveredThrough: Math.max(...eligible.map((entry) => entry.timestamp)),
    });
  } else {
    await updateState({ lastScheduledQueuedAt: now });
  }
  await flushInternal();
}

export function runScheduledTick(): Promise<void> {
  return withSendLock(runScheduledTickInternal);
}

export async function previewSend(): Promise<PreviewResult> {
  const settings = await readSettings();
  const entries = await readEntries();
  const selected = entries
    .filter((entry) => meetsLevel(entry.level, settings.autoSend.minLevel))
    .slice(-settings.autoSend.batchSize);
  return {
    enabled: settings.autoSend.enabled,
    endpoint: settings.autoSend.endpoint,
    mode: settings.autoSend.mode,
    entries: selected,
    payload: buildSendPayload(selected, 'manual'),
  };
}

export async function sendNow(): Promise<FlushResult> {
  return withSendLock(async () => {
    const settings = await readSettings();
    if (!settings.autoSend.enabled || settings.autoSend.consentAt === null) {
      return { attempted: 0, sent: 0, failed: 0, remaining: 0 };
    }
    return flushInternal();
  });
}

export async function syncSendAlarms(settings: LogLensSettings, pending: PendingSend[]): Promise<void> {
  try {
    await chrome.alarms.clear(ALARMS.scheduledSend);
    await chrome.alarms.clear(ALARMS.retrySend);
  } catch {
    // Alarms may be unavailable during shutdown.
  }

  if (settings.autoSend.enabled && settings.autoSend.mode === 'scheduled') {
    chrome.alarms.create(ALARMS.scheduledSend, {
      periodInMinutes: settings.autoSend.intervalMinutes,
      delayInMinutes: settings.autoSend.intervalMinutes,
    });
  }

  if (settings.autoSend.enabled && pending.length > 0) {
    const nextAttemptAt = Math.min(...pending.map((batch) => batch.nextAttemptAt));
    chrome.alarms.create(ALARMS.retrySend, {
      when: Math.max(Date.now() + 30_000, nextAttemptAt),
    });
  }
}

export async function ensureMaintenanceAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARMS.maintenance);
  if (!existing) {
    chrome.alarms.create(ALARMS.maintenance, { periodInMinutes: 60, delayInMinutes: 5 });
  }
}

export async function initSendService(): Promise<void> {
  await ensureMaintenanceAlarm();
  const settings = await readSettings();
  if (settings.autoSend.enabled) {
    const pending = await readPendingSends();
    await syncSendAlarms(settings, pending);
    await withSendLock(flushInternal);
  } else {
    const pending = await readPendingSends();
    if (pending.length > 0) await setPendingSends([]);
    await syncSendAlarms(settings, []);
  }
}

/** Called after the options page saves settings. */
export async function applyAutoSendSettings(previous: LogLensSettings, next: LogLensSettings): Promise<void> {
  if (!next.autoSend.enabled || next.autoSend.endpoint !== previous.autoSend.endpoint) {
    await setPendingSends([]);
    await updateState({
      pendingRetryAt: null,
      lastAutoSendError: null,
      ...(next.autoSend.enabled ? {} : { lastAutoSendStatus: 'idle' as const }),
    });
  }
  if (next.autoSend.enabled && (!previous.autoSend.enabled || next.autoSend.mode !== previous.autoSend.mode)) {
    await updateState({ lastScheduledCoveredThrough: Date.now(), lastScheduledQueuedAt: null });
  }
  await syncSendAlarms(next, await readPendingSends());
}

export async function runMaintenance(): Promise<void> {
  await pruneNow();
}
