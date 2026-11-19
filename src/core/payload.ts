import { APP_VERSION } from './constants.ts';
import { redactContext, redactText, safeJsonStringify, sanitizeUrlForLog } from './redact.ts';
import { countLevels, entriesToText, formatTimestamp } from './ring-buffer.ts';
import type { ExportMeta, LogEntry, SendPayload } from './types.ts';

function sanitizeEntry(entry: LogEntry): LogEntry {
  const copy: LogEntry = {
    id: entry.id,
    timestamp: entry.timestamp,
    level: entry.level,
    source: entry.source,
    message: redactText(entry.message),
    fingerprint: entry.fingerprint,
  };
  if (entry.details) copy.details = redactText(entry.details);
  const context = entry.context ? redactContext(entry.context) : undefined;
  if (context) copy.context = context;
  const url = sanitizeUrlForLog(entry.url);
  if (url) copy.url = url;
  if (typeof entry.tabId === 'number') copy.tabId = entry.tabId;
  if (entry.extensionId) copy.extensionId = entry.extensionId;
  return copy;
}

export function buildSendPayload(
  entries: LogEntry[],
  reason: SendPayload['reason'],
  now = Date.now(),
  version = APP_VERSION,
): SendPayload {
  const safeEntries = entries.map(sanitizeEntry);
  return {
    schema: 'loglens/v1',
    product: 'Log Lens',
    version,
    sentAt: new Date(now).toISOString(),
    reason,
    count: safeEntries.length,
    entries: safeEntries,
  };
}

export interface ExportDocument {
  schema: 'loglens/export/v1';
  product: 'Log Lens';
  version: string;
  exportedAt: string;
  count: number;
  privacy: {
    redacted: true;
    cookiesCaptured: false;
    formDataCaptured: false;
    pageContentCaptured: false;
    requestHeadersCaptured: false;
    requestBodiesCaptured: false;
  };
  entries: LogEntry[];
}

export function buildExportDocument(entries: LogEntry[], now = Date.now(), version = APP_VERSION): ExportDocument {
  return {
    schema: 'loglens/export/v1',
    product: 'Log Lens',
    version,
    exportedAt: new Date(now).toISOString(),
    count: entries.length,
    privacy: {
      redacted: true,
      cookiesCaptured: false,
      formDataCaptured: false,
      pageContentCaptured: false,
      requestHeadersCaptured: false,
      requestBodiesCaptured: false,
    },
    entries: entries.map(sanitizeEntry),
  };
}

export function exportJson(entries: LogEntry[], now = Date.now()): string {
  return JSON.stringify(buildExportDocument(entries, now), null, 2);
}

export function fileBaseName(now = Date.now()): string {
  return `log-lens-${new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
}

export interface EmailParts {
  to: string;
  subject: string;
  body: string;
}

export function buildEmailParts(
  entries: LogEntry[],
  recipient: string,
  now = Date.now(),
  version = APP_VERSION,
): EmailParts {
  const safeEntries = entries.map(sanitizeEntry);
  const counts = countLevels(safeEntries);
  const recent = [...safeEntries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 40);
  const omitted = safeEntries.length - recent.length;
  const header = [
    'Log Lens error report',
    '',
    `Generated: ${new Date(now).toISOString()}`,
    `Extension version: ${version}`,
    `Entries: ${counts.total} (${counts.failures} error/fatal, ${counts.byLevel.warn} warning)`,
    '',
    'Privacy: tokens, API keys, passwords and bearer headers have been redacted.',
    'Log Lens never captures cookies, form data, request headers, request bodies or page content.',
    '',
    '--- Entries (newest first) ---',
    '',
  ].join('\n');
  const body = `${header}${entriesToText(recent)}${omitted > 0 ? `\n\n… ${omitted} older entries omitted. Export from Log Lens for the full file.` : ''}`;
  const dateLabel = new Date(now).toISOString().slice(0, 19).replace('T', ' ');
  return {
    to: recipient,
    subject: `Log Lens logs - ${counts.total} entries - ${dateLabel}`,
    body: body.length > 8_000 ? `${body.slice(0, 8_000)}\n\n[truncated - use Export Logs for the full file]` : body,
  };
}

export function buildMailtoUrl(parts: EmailParts): string {
  const params = new URLSearchParams();
  if (parts.subject) params.set('subject', parts.subject);
  if (parts.body) params.set('body', parts.body);
  return `mailto:${encodeURIComponent(parts.to)}?${params.toString()}`;
}

export function buildExportMeta(entries: LogEntry[], now = Date.now(), version = APP_VERSION): ExportMeta {
  return {
    exportedAt: new Date(now).toISOString(),
    version,
    count: entries.length,
  };
}

export function previewText(entries: LogEntry[]): string {
  const counts = countLevels(entries);
  return `Dry run only - nothing was sent.\n\n${counts.total} entry/entries selected (${counts.failures} error/fatal).\n\n${entriesToText(entries.slice(-10))}`;
}

export function entrySummary(entry: LogEntry): string {
  return `${formatTimestamp(entry.timestamp)} ${entry.level} ${entry.source}: ${entry.message}`;
}

export function prettyJson(value: unknown): string {
  return safeJsonStringify(value, 2);
}
