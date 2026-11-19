import { type CaptureKind, levelForHttpStatus, shouldCapture } from '../core/policy.ts';
import { errorToDiagnostic, sanitizeUrlForLog } from '../core/redact.ts';
import { createLogEntry, highestLevel, isFailureLevel } from '../core/ring-buffer.ts';
import { normalizeLevel } from '../core/settings.ts';
import type { CapturedLogInput, LogEntry, LogLensSettings, LogLevel, PageEvent } from '../core/types.ts';
import { maybeAutoOpen } from './auto-open.ts';
import { onEntriesStored } from './auto-send.ts';
import { refreshBadge } from './badge.ts';
import { notifyError } from './notifications.ts';
import { readSettings, storeEntries } from './storage.ts';

export interface CaptureOutcome {
  stored: number;
  entries: LogEntry[];
  ignored: boolean;
}

interface CaptureOptions {
  source: CapturedLogInput['source'];
  level?: LogLevel;
  url?: string;
  tabId?: number;
  extensionId?: string;
  details?: string;
  context?: Record<string, unknown>;
  message: string;
}

async function record(
  inputs: CapturedLogInput[],
  settings: LogLensSettings,
  awaitSend = true,
): Promise<CaptureOutcome> {
  if (inputs.length === 0) return { stored: 0, entries: [], ignored: true };
  const entries = inputs.map((input) => createLogEntry(input));
  const result = await storeEntries(entries);
  const ids = new Set(entries.map((entry) => entry.id));
  const stored = result.entries.filter((entry) => ids.has(entry.id));

  await refreshBadge(result.entries, settings);

  if (stored.length > 0) {
    const highest = highestLevel(stored) ?? 'error';
    const errorEntry = stored.find((entry) => isFailureLevel(entry.level)) ?? stored[0];
    if (errorEntry) {
      await notifyError(errorEntry, settings, result.state);
    }
    await maybeAutoOpen(settings, highest, result.state);
    if (awaitSend) {
      await onEntriesStored(stored);
    } else {
      // External callers need a fast response. The fetch still keeps the MV3
      // worker alive, and queued retries are backed by an alarm.
      void onEntriesStored(stored).catch(() => undefined);
    }
  }

  return { stored: stored.length, entries: stored, ignored: false };
}

function buildInput(options: CaptureOptions): CapturedLogInput {
  const input: CapturedLogInput = {
    level: options.level ?? 'error',
    source: options.source,
    message: options.message,
  };
  if (options.details) input.details = options.details;
  if (options.context) input.context = options.context;
  if (options.url) input.url = options.url;
  if (typeof options.tabId === 'number') input.tabId = options.tabId;
  if (options.extensionId) input.extensionId = options.extensionId;
  return input;
}

export async function captureExtensionError(
  error: unknown,
  mechanism: 'error' | 'rejection' | 'client-page' | 'api',
  context: Record<string, unknown> = {},
): Promise<CaptureOutcome> {
  const settings = await readSettings();
  const diagnostic = errorToDiagnostic(error);
  const level: LogLevel = 'error';
  const kind: CaptureKind = mechanism === 'rejection' ? 'rejection' : 'extension';
  if (!shouldCapture(settings, { kind, level })) {
    return { stored: 0, entries: [], ignored: true };
  }
  return record(
    [
      buildInput({
        message: diagnostic.message,
        details: diagnostic.details,
        level,
        source: 'extension',
        context: { mechanism, ...context },
      }),
    ],
    settings,
  );
}

export async function captureClientError(
  payload: { message?: unknown; details?: unknown; page?: unknown },
  senderUrl?: string,
): Promise<CaptureOutcome> {
  const settings = await readSettings();
  if (!shouldCapture(settings, { kind: 'extension', level: 'error' })) {
    return { stored: 0, entries: [], ignored: true };
  }
  const message = typeof payload.message === 'string' ? payload.message : 'Extension page error';
  const details = typeof payload.details === 'string' ? payload.details : undefined;
  const page = typeof payload.page === 'string' ? payload.page : 'extension-page';
  const input: CapturedLogInput = {
    level: 'error',
    source: 'extension',
    message,
    context: { mechanism: 'client-page', page },
  };
  if (details) input.details = details;
  const url = sanitizeUrlForLog(senderUrl);
  if (url) input.url = url;
  return record([input], settings);
}

export async function capturePageEvent(event: PageEvent, tabId?: number, pageUrl?: string): Promise<CaptureOutcome> {
  const settings = await readSettings();
  const status = typeof event.context?.status === 'number' ? event.context.status : undefined;
  const kind: CaptureKind = event.kind === 'network' ? 'network' : 'page';
  const level =
    event.kind === 'network'
      ? normalizeLevel(event.level, status !== undefined ? levelForHttpStatus(status) : 'error')
      : normalizeLevel(event.level, 'error');
  if (!shouldCapture(settings, { kind, level })) {
    return { stored: 0, entries: [], ignored: true };
  }
  const input: CapturedLogInput = {
    level,
    source: event.kind === 'network' ? 'network' : 'page',
    message: event.message,
    context: { mechanism: event.kind, ...event.context },
  };
  if (input.context) {
    if (typeof input.context.requestUrl === 'string') {
      input.context.requestUrl = sanitizeUrlForLog(input.context.requestUrl);
    }
    if (typeof input.context.filename === 'string') {
      input.context.filename = sanitizeUrlForLog(input.context.filename);
    }
  }
  if (event.details) input.details = event.details;
  const url = sanitizeUrlForLog(event.url ?? pageUrl);
  if (url) input.url = url;
  if (typeof tabId === 'number') input.tabId = tabId;
  return record([input], settings);
}

export async function captureApiLog(
  request: { message: string; level?: unknown; details?: string; context?: Record<string, unknown>; url?: string },
  sender: { id?: string; origin?: string },
): Promise<CaptureOutcome> {
  const settings = await readSettings();
  const level = normalizeLevel(request.level, 'error');
  if (!shouldCapture(settings, { kind: 'api', level })) {
    return { stored: 0, entries: [], ignored: true };
  }
  const context: Record<string, unknown> = { mechanism: 'external-api', ...request.context };
  if (sender.origin) context.senderOrigin = sender.origin;
  if (sender.id) context.senderId = sender.id;
  const input: CapturedLogInput = {
    level,
    source: 'api',
    message: request.message,
    context,
  };
  if (request.details) input.details = request.details;
  const url = sanitizeUrlForLog(request.url);
  if (url) input.url = url;
  if (sender.id) input.extensionId = sender.id;
  return record([input], settings, false);
}
