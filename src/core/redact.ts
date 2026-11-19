import type { ContextValue } from './types.ts';
import { sanitizeUrl } from './url.ts';

const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_NAMES = new Set([
  'auth',
  'authorization',
  'proxyauthorization',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'token',
  'apikey',
  'xapikey',
  'secret',
  'clientsecret',
  'secretkey',
  'password',
  'passwd',
  'pwd',
  'pass',
  'session',
  'sessionid',
  'cookie',
  'setcookie',
  'csrf',
  'xsrf',
  'jwt',
  'bearer',
  'credential',
  'credentials',
  'privatekey',
  'accesskey',
  'signature',
  'sig',
]);

const KEY_VALUE_RE =
  /(["']?)\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|secret[_-]?key|password|passwd|pwd|session[_-]?id|csrf|xsrf|credential|private[_-]?key|access[_-]?key)\b(["']?)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi;

const AUTH_HEADER_RE = /\b(proxy-authorization|authorization)\s*:\s*(?:(?:Bearer|Basic|Token)\s+)?[^\s,;]+/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]{8,}=*/gi;
const BASIC_RE = /\bBasic\s+(?=[A-Za-z0-9+/=]*[0-9+/=])[A-Za-z0-9\-._~+/]{8,}=*/gi;
const TOKEN_SCHEME_RE = /\bToken\s+[A-Za-z0-9\-._~+/]{12,}=*/gi;
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const URL_CREDENTIALS_RE = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-(?:live|test|proj)?[-_]?[A-Za-z0-9_-]{16,}\b/g,
  /\brk_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bya29\.[0-9A-Za-z_-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SENSITIVE_KEY_NAMES.has(normalized)) return true;
  // Prefixes such as my_api_key or headers.Authorization.
  for (const name of SENSITIVE_KEY_NAMES) {
    if (normalized.endsWith(name) && normalized.length <= name.length + 16) return true;
  }
  return false;
}

/** Redacts credentials, tokens, API keys and authorization headers from free text. */
export function redactText(input: string): string {
  if (!input) return input;
  let value = input;
  value = value.replace(PRIVATE_KEY_RE, '[REDACTED PRIVATE KEY]');
  value = value.replace(URL_CREDENTIALS_RE, '$1[REDACTED]@');
  value = value.replace(AUTH_HEADER_RE, '$1: [REDACTED]');
  value = value.replace(BEARER_RE, 'Bearer [REDACTED]');
  value = value.replace(BASIC_RE, 'Basic [REDACTED]');
  value = value.replace(TOKEN_SCHEME_RE, 'Token [REDACTED]');
  value = value.replace(KEY_VALUE_RE, '$1$2$3$4[REDACTED]');
  for (const pattern of TOKEN_PATTERNS) {
    value = value.replace(pattern, '[REDACTED_TOKEN]');
  }
  return value;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function toContextValue(value: unknown, depth: number): ContextValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return truncate(redactText(value), 1000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return truncate(redactText(`${value.name}: ${value.message}`), 1000);
  if (depth <= 0) return '[truncated]';
  if (Array.isArray(value)) {
    const items = value.slice(0, 10).map((item) => toContextValue(item, depth - 1));
    return truncate(redactText(safeJsonStringify(items)), 1500);
  }
  if (typeof value === 'object') {
    const redacted = redactRecord(value, depth - 1);
    return truncate(redactText(safeJsonStringify(redacted)), 2000);
  }
  return undefined;
}

function redactRecord(value: object, depth: number): Record<string, ContextValue> {
  const output = Object.create(null) as Record<string, ContextValue>;
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (rawKey === '__proto__' || rawKey === 'constructor' || rawKey === 'prototype') continue;
    if (count >= 20) {
      output.truncated = true;
      break;
    }
    const key = rawKey.slice(0, 60);
    if (isSensitiveKey(key)) {
      output[key] = REDACTED;
      count += 1;
      continue;
    }
    const next = toContextValue(rawValue, depth);
    if (next !== undefined) {
      output[key] = next;
      count += 1;
    }
  }
  return output;
}

/** Produces a small, flat, redacted context object suitable for storage and export. */
export function redactContext(value: unknown): Record<string, ContextValue> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const redacted = redactRecord(value, 3);
  return Object.keys(redacted).length > 0 ? redacted : undefined;
}

export function safeJsonStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (typeof item === 'bigint') return item.toString();
        if (typeof item === 'function' || typeof item === 'symbol') return undefined;
        if (typeof item === 'object' && item !== null) {
          if (seen.has(item)) return '[circular]';
          seen.add(item);
        }
        return item;
      },
      space,
    );
  } catch {
    return '"[unserialisable]"';
  }
}

/** Converts an unknown thrown value into redacted diagnostic text without capturing page content. */
export function errorToDiagnostic(error: unknown): { message: string; details?: string } {
  if (error instanceof Error) {
    return {
      message: truncate(redactText(error.message || error.name || 'Unknown error'), 4000),
      details: error.stack ? truncate(redactText(error.stack), 12000) : undefined,
    };
  }
  if (typeof error === 'string') {
    return { message: truncate(redactText(error), 4000) };
  }
  if (typeof error === 'object' && error !== null) {
    const asRecord = error as { message?: unknown; stack?: unknown; name?: unknown };
    const message =
      typeof asRecord.message === 'string'
        ? asRecord.message
        : typeof asRecord.name === 'string'
          ? asRecord.name
          : safeJsonStringify(error);
    const details = typeof asRecord.stack === 'string' ? asRecord.stack : undefined;
    return {
      message: truncate(redactText(message), 4000),
      details: details ? truncate(redactText(details), 12000) : undefined,
    };
  }
  return { message: truncate(redactText(String(error)), 4000) };
}

/** Sanitises a URL for storage: no query, fragment, username or password. */
export function sanitizeUrlForLog(raw: string | undefined | null): string | undefined {
  const sanitized = sanitizeUrl(raw);
  return sanitized ? redactText(sanitized) : undefined;
}

export { REDACTED };
