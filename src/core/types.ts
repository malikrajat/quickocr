/** Public, DOM-free types shared by the service worker, pages, content script and tests. */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SOURCES = ['extension', 'page', 'network', 'api', 'system', 'manual'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export const AUTO_OPEN_MODES = ['never', 'on-error', 'always'] as const;
export type AutoOpenMode = (typeof AUTO_OPEN_MODES)[number];

export const SEND_MODES = ['immediate', 'scheduled'] as const;
export type SendMode = (typeof SEND_MODES)[number];

export const TIME_RANGES = ['15m', '1h', '6h', '24h', '7d', 'all'] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

export type ContextValue = string | number | boolean | null;

export interface LogEntry {
  /** Stable id, generated when the entry enters the ring buffer. */
  id: string;
  /** Unix epoch milliseconds. */
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  /** Stack trace or other diagnostic text. Redacted and truncated before storage. */
  details?: string;
  /** Small, structured, redacted diagnosis fields. Never request headers or bodies. */
  context?: Record<string, ContextValue>;
  /** Query string and fragment removed before storage. */
  url?: string;
  tabId?: number;
  extensionId?: string;
  /** Short stable hash used by the UI to group repeated messages. */
  fingerprint: string;
}

export interface AutoSendSettings {
  /** Explicit opt-in. Always false until the user turns it on. */
  enabled: boolean;
  /** Must be an HTTPS URL. */
  endpoint: string;
  mode: SendMode;
  /** Scheduled delivery interval, in minutes. */
  intervalMinutes: number;
  minLevel: LogLevel;
  /** Number of retries after the first attempt. */
  retryCount: number;
  retryDelaySeconds: number;
  batchSize: number;
  /** Timestamp of the explicit consent that enabled sending. Null means no consent. */
  consentAt: number | null;
}

export interface ExternalApiSettings {
  /** Chrome extension ids allowed to submit logs through onMessageExternal. */
  approvedExtensions: string[];
  /** Web origins (https://example.com) allowed to submit logs. */
  approvedOrigins: string[];
  /** When true, any installed extension may submit logs. Web origins are still checked. */
  allowAllExtensions: boolean;
}

export interface LogLensSettings {
  /** Levels that are persisted. Defaults to error and fatal only. */
  levels: LogLevel[];
  captureExtensionErrors: boolean;
  captureUnhandledRejections: boolean;
  /** Opt-in: requires a host permission and a registered content script. */
  capturePageErrors: boolean;
  /** Opt-in: requires a host permission and a registered content script. */
  captureNetworkFailures: boolean;
  /** HTTP status at or above which a response is treated as a network failure. */
  networkFailureMinStatus: number;
  maxEntries: number;
  retentionDays: number;
  autoOpen: AutoOpenMode;
  showBadge: boolean;
  notifyOnError: boolean;
  emailRecipient: string;
  autoSend: AutoSendSettings;
  externalApi: ExternalApiSettings;
}

export interface LogState {
  installedAt: number;
  lastErrorAt: number | null;
  lastOpenAt: number | null;
  lastNotifyAt: number | null;
  lastAutoSendAt: number | null;
  lastAutoSendStatus: 'idle' | 'ok' | 'error';
  lastAutoSendError: string | null;
  lastScheduledQueuedAt: number | null;
  lastScheduledCoveredThrough: number | null;
  pendingRetryAt: number | null;
}

export interface PendingSend {
  id: string;
  reason: 'immediate' | 'scheduled' | 'manual';
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  endpoint: string;
  entries: LogEntry[];
  lastError?: string;
}

export interface SendPayload {
  schema: 'loglens/v1';
  product: 'Log Lens';
  version: string;
  sentAt: string;
  reason: PendingSend['reason'];
  count: number;
  entries: LogEntry[];
}

export interface ExternalLogRequest {
  type: string;
  message?: unknown;
  level?: unknown;
  details?: unknown;
  context?: unknown;
  url?: unknown;
}

export interface CapturedLogInput {
  level?: unknown;
  source?: LogSource;
  message: string;
  details?: string;
  context?: Record<string, unknown>;
  url?: string;
  tabId?: number;
  extensionId?: string;
  timestamp?: number;
}

export type PageEventKind = 'page-error' | 'page-rejection' | 'network';

export interface PageEvent {
  kind: PageEventKind;
  level?: LogLevel;
  message: string;
  details?: string;
  context?: Record<string, unknown>;
  url?: string;
}

export interface FilterState {
  query: string;
  level: LogLevel | 'all';
  source: LogSource | 'all';
  timeRange: TimeRange;
}

export interface LogCounts {
  total: number;
  byLevel: Record<LogLevel, number>;
  failures: number;
}

export interface ExportMeta {
  exportedAt: string;
  version: string;
  count: number;
}

export interface ExternalApiDecision {
  allowed: boolean;
  reason: 'approved-extension' | 'approved-origin' | 'all-extensions' | 'not-approved' | 'missing-sender';
}
