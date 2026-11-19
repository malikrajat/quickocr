import { LIMITS } from './constants.ts';
import {
  AUTO_OPEN_MODES,
  type AutoOpenMode,
  type AutoSendSettings,
  type ExternalApiSettings,
  LEVEL_RANK,
  LOG_LEVELS,
  type LogLensSettings,
  type LogLevel,
  type LogState,
  SEND_MODES,
  type SendMode,
} from './types.ts';
import { isExtensionId, isValidHttpsEndpoint, normalizeApprovedOrigin } from './url.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_SETTINGS: Readonly<LogLensSettings> = Object.freeze({
  levels: ['error', 'fatal'] as LogLevel[],
  captureExtensionErrors: true,
  captureUnhandledRejections: true,
  capturePageErrors: false,
  captureNetworkFailures: false,
  networkFailureMinStatus: 400,
  maxEntries: LIMITS.maxEntries.default,
  retentionDays: LIMITS.retentionDays.default,
  autoOpen: 'on-error',
  showBadge: true,
  notifyOnError: true,
  emailRecipient: '',
  autoSend: {
    enabled: false,
    endpoint: '',
    mode: 'immediate' as SendMode,
    intervalMinutes: LIMITS.send.intervalMinutes.default,
    minLevel: 'error' as LogLevel,
    retryCount: LIMITS.send.retryCount.default,
    retryDelaySeconds: LIMITS.send.retryDelaySeconds.default,
    batchSize: LIMITS.send.batchSize.default,
    consentAt: null,
  },
  externalApi: {
    approvedExtensions: [],
    approvedOrigins: [],
    allowAllExtensions: false,
  },
});

export const DEFAULT_STATE: Readonly<LogState> = Object.freeze({
  installedAt: 0,
  lastErrorAt: null,
  lastOpenAt: null,
  lastNotifyAt: null,
  lastAutoSendAt: null,
  lastAutoSendStatus: 'idle',
  lastAutoSendError: null,
  lastScheduledQueuedAt: null,
  lastScheduledCoveredThrough: null,
  pendingRetryAt: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asString(value: unknown, fallback: string, maxLength = 4000): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

function normalizeLevels(value: unknown): LogLevel[] {
  if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.levels];
  const valid = new Set<LogLevel>();
  for (const item of value) {
    if (typeof item === 'string' && (LOG_LEVELS as readonly string[]).includes(item)) valid.add(item as LogLevel);
  }
  const levels = LOG_LEVELS.filter((level) => valid.has(level));
  return levels.length > 0 ? levels : [...DEFAULT_SETTINGS.levels];
}

function normalizeExtensionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim().toLowerCase();
    if (isExtensionId(id)) ids.add(id);
  }
  return [...ids].sort();
}

function normalizeOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const origins = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const origin = normalizeApprovedOrigin(item);
    if (origin) origins.add(origin);
  }
  return [...origins].sort();
}

function normalizeAutoSend(value: unknown): AutoSendSettings {
  const raw = isRecord(value) ? value : {};
  const endpoint = asString(raw.endpoint, '', LIMITS.maxEndpointChars).trim();
  const consentAt =
    typeof raw.consentAt === 'number' && Number.isFinite(raw.consentAt) && raw.consentAt > 0 ? raw.consentAt : null;
  const enabled = asBoolean(raw.enabled, false) && consentAt !== null && isValidHttpsEndpoint(endpoint);
  return {
    enabled,
    endpoint,
    mode: oneOf<SendMode>(raw.mode, SEND_MODES, 'immediate'),
    intervalMinutes: clampInt(
      raw.intervalMinutes,
      LIMITS.send.intervalMinutes.min,
      LIMITS.send.intervalMinutes.max,
      LIMITS.send.intervalMinutes.default,
    ),
    minLevel: normalizeLevel(raw.minLevel, 'error'),
    retryCount: clampInt(
      raw.retryCount,
      LIMITS.send.retryCount.min,
      LIMITS.send.retryCount.max,
      LIMITS.send.retryCount.default,
    ),
    retryDelaySeconds: clampInt(
      raw.retryDelaySeconds,
      LIMITS.send.retryDelaySeconds.min,
      LIMITS.send.retryDelaySeconds.max,
      LIMITS.send.retryDelaySeconds.default,
    ),
    batchSize: clampInt(
      raw.batchSize,
      LIMITS.send.batchSize.min,
      LIMITS.send.batchSize.max,
      LIMITS.send.batchSize.default,
    ),
    consentAt,
  };
}

function normalizeAutoOpen(value: unknown): AutoOpenMode {
  return oneOf<AutoOpenMode>(value, AUTO_OPEN_MODES, DEFAULT_SETTINGS.autoOpen);
}

export function normalizeLevel(value: unknown, fallback: LogLevel = 'error'): LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value)
    ? (value as LogLevel)
    : fallback;
}

function normalizeExternalApi(value: unknown): ExternalApiSettings {
  const raw = isRecord(value) ? value : {};
  return {
    approvedExtensions: normalizeExtensionIds(raw.approvedExtensions),
    approvedOrigins: normalizeOrigins(raw.approvedOrigins),
    allowAllExtensions: asBoolean(raw.allowAllExtensions, false),
  };
}

/** Normalises arbitrary input (including corrupt storage) into a safe settings object. */
export function normalizeSettings(value: unknown): LogLensSettings {
  const raw = isRecord(value) ? value : {};
  const emailRecipient = asString(raw.emailRecipient, '', LIMITS.maxEmailChars).trim();
  return {
    levels: normalizeLevels(raw.levels),
    captureExtensionErrors: asBoolean(raw.captureExtensionErrors, DEFAULT_SETTINGS.captureExtensionErrors),
    captureUnhandledRejections: asBoolean(raw.captureUnhandledRejections, DEFAULT_SETTINGS.captureUnhandledRejections),
    capturePageErrors: asBoolean(raw.capturePageErrors, false),
    captureNetworkFailures: asBoolean(raw.captureNetworkFailures, false),
    networkFailureMinStatus: clampInt(
      raw.networkFailureMinStatus,
      LIMITS.networkStatus.min,
      LIMITS.networkStatus.max,
      LIMITS.networkStatus.default,
    ),
    maxEntries: clampInt(raw.maxEntries, LIMITS.maxEntries.min, LIMITS.maxEntries.max, LIMITS.maxEntries.default),
    retentionDays: clampInt(
      raw.retentionDays,
      LIMITS.retentionDays.min,
      LIMITS.retentionDays.max,
      LIMITS.retentionDays.default,
    ),
    autoOpen: normalizeAutoOpen(raw.autoOpen),
    showBadge: asBoolean(raw.showBadge, DEFAULT_SETTINGS.showBadge),
    notifyOnError: asBoolean(raw.notifyOnError, DEFAULT_SETTINGS.notifyOnError),
    emailRecipient: EMAIL_RE.test(emailRecipient) ? emailRecipient : '',
    autoSend: normalizeAutoSend(raw.autoSend),
    externalApi: normalizeExternalApi(raw.externalApi),
  };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeState(value: unknown): LogState {
  const raw = isRecord(value) ? value : {};
  return {
    installedAt: typeof raw.installedAt === 'number' && raw.installedAt > 0 ? raw.installedAt : Date.now(),
    lastErrorAt: nullableNumber(raw.lastErrorAt),
    lastOpenAt: nullableNumber(raw.lastOpenAt),
    lastNotifyAt: nullableNumber(raw.lastNotifyAt),
    lastAutoSendAt: nullableNumber(raw.lastAutoSendAt),
    lastAutoSendStatus: oneOf(raw.lastAutoSendStatus, ['idle', 'ok', 'error'] as const, 'idle'),
    lastAutoSendError: typeof raw.lastAutoSendError === 'string' ? raw.lastAutoSendError.slice(0, 500) : null,
    lastScheduledQueuedAt: nullableNumber(raw.lastScheduledQueuedAt),
    lastScheduledCoveredThrough: nullableNumber(raw.lastScheduledCoveredThrough),
    pendingRetryAt: nullableNumber(raw.pendingRetryAt),
  };
}

export interface SettingsValidationIssue {
  field: string;
  message: string;
}

/** Validation used by the options page. It never mutates the settings. */
export function validateSettings(settings: LogLensSettings): SettingsValidationIssue[] {
  const issues: SettingsValidationIssue[] = [];
  if (settings.levels.length === 0) {
    issues.push({ field: 'levels', message: 'Choose at least one level to capture.' });
  }
  if (settings.maxEntries < LIMITS.maxEntries.min || settings.maxEntries > LIMITS.maxEntries.max) {
    issues.push({
      field: 'maxEntries',
      message: `Maximum entries must be between ${LIMITS.maxEntries.min} and ${LIMITS.maxEntries.max}.`,
    });
  }
  if (settings.retentionDays < LIMITS.retentionDays.min || settings.retentionDays > LIMITS.retentionDays.max) {
    issues.push({
      field: 'retentionDays',
      message: `Retention must be between ${LIMITS.retentionDays.min} and ${LIMITS.retentionDays.max} days.`,
    });
  }
  if (settings.emailRecipient && !EMAIL_RE.test(settings.emailRecipient)) {
    issues.push({ field: 'emailRecipient', message: 'Enter a valid email address or leave it blank.' });
  }
  if (settings.autoSend.enabled) {
    if (!isValidHttpsEndpoint(settings.autoSend.endpoint)) {
      issues.push({ field: 'autoSend.endpoint', message: 'Auto-send requires a valid HTTPS endpoint.' });
    }
    if (settings.autoSend.consentAt === null) {
      issues.push({
        field: 'autoSend.consentAt',
        message: 'Explicit consent is required before auto-send can be enabled.',
      });
    }
  }
  return issues;
}

export function minLevelRank(level: LogLevel): number {
  return LEVEL_RANK[level];
}

export function cloneDefaultSettings(): LogLensSettings {
  return normalizeSettings(undefined);
}
