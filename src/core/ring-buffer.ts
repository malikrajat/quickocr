import { LIMITS } from './constants.ts';
import { errorToDiagnostic, redactContext, redactText, safeJsonStringify, sanitizeUrlForLog } from './redact.ts';
import { normalizeLevel } from './settings.ts';
import {
  type CapturedLogInput,
  type FilterState,
  LEVEL_RANK,
  LOG_LEVELS,
  LOG_SOURCES,
  type LogCounts,
  type LogEntry,
  type LogLensSettings,
  type LogLevel,
  type LogSource,
} from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSource(value: unknown): LogSource {
  return typeof value === 'string' && (LOG_SOURCES as readonly string[]).includes(value)
    ? (value as LogSource)
    : 'extension';
}

/** FNV-1a, used only for a small grouping key. It is not a security primitive. */
export function fingerprint(level: LogLevel, source: LogSource, message: string): string {
  const input = `${level}|${source}|${message.slice(0, 240)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Creates a sanitised log entry. Every text field passes through the redactor. */
export function createLogEntry(input: CapturedLogInput, now = Date.now()): LogEntry {
  const level = normalizeLevel(input.level, 'error');
  const source = normalizeSource(input.source);
  const fallback = errorToDiagnostic(input.message);
  const message = truncate(
    redactText((input.message || fallback.message || 'Unknown error').trim()) || 'Unknown error',
    LIMITS.maxMessageChars,
  );
  const details = input.details
    ? truncate(redactText(input.details), LIMITS.maxDetailsChars)
    : fallback.details
      ? truncate(redactText(fallback.details), LIMITS.maxDetailsChars)
      : undefined;
  const context = redactContext(input.context);
  const url = sanitizeUrlForLog(input.url);
  const timestamp =
    typeof input.timestamp === 'number' && Number.isFinite(input.timestamp) && input.timestamp > 0
      ? input.timestamp
      : now;
  const entry: LogEntry = {
    id: makeId(),
    timestamp,
    level,
    source,
    message,
    fingerprint: fingerprint(level, source, message),
  };
  if (details) entry.details = details;
  if (context) entry.context = context;
  if (url) entry.url = url;
  if (typeof input.tabId === 'number' && input.tabId >= 0) entry.tabId = input.tabId;
  if (typeof input.extensionId === 'string' && input.extensionId) entry.extensionId = input.extensionId.slice(0, 128);
  return entry;
}

export function isFailureLevel(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK.error;
}

export function meetsLevel(level: LogLevel, minimum: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minimum];
}

export function highestLevel(entries: LogEntry[]): LogLevel | null {
  let highest: LogLevel | null = null;
  for (const entry of entries) {
    if (!highest || LEVEL_RANK[entry.level] > LEVEL_RANK[highest]) highest = entry.level;
  }
  return highest;
}

function approximateSize(entry: LogEntry): number {
  return safeJsonStringify(entry).length + 1;
}

/**
 * Applies the retention window, the entry cap and a byte budget. The oldest
 * entries are removed first, which is what makes this a ring buffer.
 */
export function pruneLogs(
  entries: LogEntry[],
  settings: Pick<LogLensSettings, 'retentionDays' | 'maxEntries'>,
  now = Date.now(),
): LogEntry[] {
  const cutoff = now - Math.max(1, settings.retentionDays) * DAY_MS;
  const kept = entries.filter((entry) => Number.isFinite(entry.timestamp) && entry.timestamp >= cutoff);
  kept.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  let pruned = kept.length > settings.maxEntries ? kept.slice(kept.length - settings.maxEntries) : kept;

  let total = pruned.reduce((sum, entry) => sum + approximateSize(entry), 0);
  let start = 0;
  while (total > LIMITS.storageBudgetBytes && start < pruned.length - 1) {
    total -= approximateSize(pruned[start] as LogEntry);
    start += 1;
  }
  if (start > 0) pruned = pruned.slice(start);
  return pruned;
}

export function appendEntries(
  existing: LogEntry[],
  incoming: LogEntry[],
  settings: Pick<LogLensSettings, 'retentionDays' | 'maxEntries'>,
  now = Date.now(),
): LogEntry[] {
  return pruneLogs([...existing, ...incoming], settings, now);
}

export function countLevels(entries: LogEntry[]): LogCounts {
  const byLevel = Object.fromEntries(LOG_LEVELS.map((level) => [level, 0])) as Record<LogLevel, number>;
  for (const entry of entries) byLevel[entry.level] += 1;
  return {
    total: entries.length,
    byLevel,
    failures: byLevel.error + byLevel.fatal,
  };
}

const RANGE_MS: Record<Exclude<FilterState['timeRange'], 'all'>, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function filterEntries(entries: LogEntry[], filter: FilterState, now = Date.now()): LogEntry[] {
  const query = filter.query.trim().toLowerCase();
  const cutoff = filter.timeRange === 'all' ? 0 : now - RANGE_MS[filter.timeRange];
  const filtered = entries.filter((entry) => {
    if (entry.timestamp < cutoff) return false;
    if (filter.level !== 'all' && entry.level !== filter.level) return false;
    if (filter.source !== 'all' && entry.source !== filter.source) return false;
    if (!query) return true;
    const haystack = [
      entry.message,
      entry.details ?? '',
      entry.url ?? '',
      entry.source,
      entry.level,
      entry.context ? safeJsonStringify(entry.context) : '',
    ]
      .join('\n')
      .toLowerCase();
    return haystack.includes(query);
  });
  return filtered.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
}

export function formatTimestamp(timestamp: number, iso = true): string {
  const date = new Date(timestamp);
  return iso ? date.toISOString() : date.toLocaleString();
}

export function entryToText(entry: LogEntry): string {
  const lines = [
    `[${formatTimestamp(entry.timestamp)}] ${entry.level.toUpperCase()} (${entry.source}) ${entry.message}`,
  ];
  if (entry.url) lines.push(`URL: ${entry.url}`);
  if (entry.context && Object.keys(entry.context).length > 0) {
    lines.push(`Context: ${safeJsonStringify(entry.context)}`);
  }
  if (entry.details) lines.push(entry.details);
  return lines.join('\n');
}

export function entriesToText(entries: LogEntry[]): string {
  if (entries.length === 0) return 'No log entries.';
  return entries.map(entryToText).join('\n\n');
}

function csvCell(value: string): string {
  // Spreadsheet apps may execute cells beginning with a formula sigil. Prefix
  // a quote so exported logs cannot become a CSV-injection payload.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function entriesToCsv(entries: LogEntry[]): string {
  const header = ['timestamp', 'level', 'source', 'message', 'url', 'context', 'details'];
  const rows = entries.map((entry) =>
    [
      formatTimestamp(entry.timestamp),
      entry.level,
      entry.source,
      entry.message,
      entry.url ?? '',
      entry.context ? safeJsonStringify(entry.context) : '',
      entry.details ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.map(csvCell).join(','), ...rows].join('\r\n');
}
