/**
 * MAIN-world page instrumentation. It is registered as an extension content
 * script with world: "MAIN" so it can patch the page's own fetch and
 * XMLHttpRequest and observe its uncaught errors. It talks to the isolated
 * bridge through window.postMessage and never touches chrome.* APIs.
 *
 * Privacy: only error messages/stacks and method + query-free URL + status +
 * duration are sent. Headers, bodies, cookies, form data and DOM text are
 * never read.
 */
import { isNetworkFailure, levelForHttpStatus } from '../core/policy.ts';
import { errorToDiagnostic, redactText, sanitizeUrlForLog } from '../core/redact.ts';
import type { LogLevel, PageEvent } from '../core/types.ts';

interface PageConfig {
  capturePageErrors: boolean;
  captureNetworkFailures: boolean;
  networkFailureMinStatus: number;
  levels: string[];
}

const SOURCE = 'loglens-main';
const BRIDGE_SOURCE = 'loglens-isolated';
const FLAG = '__logLensMainCaptureInstalled';
const DEFAULT_CONFIG: PageConfig = {
  capturePageErrors: false,
  captureNetworkFailures: false,
  networkFailureMinStatus: 400,
  levels: ['error', 'fatal'],
};
const MAX_BUFFER = 25;
const MAX_EVENTS_PER_MINUTE = 45;

let config: PageConfig = { ...DEFAULT_CONFIG };
let configKnown = false;
const buffered: PageEvent[] = [];
const eventTimes: number[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function absoluteUrl(raw: string): string {
  try {
    return new URL(raw, location.href).toString();
  } catch {
    return raw;
  }
}

function sanitizeRequestUrl(raw: string): string {
  return sanitizeUrlForLog(absoluteUrl(raw)) ?? 'unknown-url';
}

function rateAllowed(now = Date.now()): boolean {
  while (eventTimes.length > 0 && now - (eventTimes[0] as number) > 60_000) eventTimes.shift();
  if (eventTimes.length >= MAX_EVENTS_PER_MINUTE) return false;
  eventTimes.push(now);
  return true;
}

function levelAllowed(level: LogLevel): boolean {
  return config.levels.includes(level);
}

function shouldSend(event: PageEvent): boolean {
  if (event.kind === 'network') {
    if (!config.captureNetworkFailures) return false;
    const status = typeof event.context?.status === 'number' ? event.context.status : 0;
    if (!isNetworkFailure(status, config.networkFailureMinStatus)) return false;
  } else if (!config.capturePageErrors) {
    return false;
  }
  return levelAllowed(event.level ?? 'error');
}

function emit(event: PageEvent): void {
  if (!shouldSend(event) || !rateAllowed()) return;
  const payload: PageEvent = {
    ...event,
    message: redactText(event.message).slice(0, 4000),
    url: sanitizeUrlForLog(location.href),
  };
  if (event.details) payload.details = redactText(event.details).slice(0, 12000);
  if (event.context) {
    const context: Record<string, unknown> = {};
    let count = 0;
    for (const [key, value] of Object.entries(event.context)) {
      if (count >= 20) break;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
        context[key] = value;
        count += 1;
      }
    }
    payload.context = context;
  }
  window.postMessage({ source: SOURCE, type: 'event', event: payload }, '*');
}

function report(event: PageEvent): void {
  if (!configKnown) {
    buffered.push(event);
    if (buffered.length > MAX_BUFFER) buffered.shift();
    return;
  }
  emit(event);
}

function applyConfig(next: PageConfig): void {
  config = { ...DEFAULT_CONFIG, ...next };
  configKnown = true;
  const pending = buffered.splice(0, buffered.length);
  for (const event of pending) emit(event);
}

function installErrorCapture(): void {
  window.addEventListener('error', (event) => {
    if (!(event instanceof ErrorEvent) || !event.message) return;
    const stack = event.error instanceof Error ? event.error.stack : undefined;
    report({
      kind: 'page-error',
      level: 'error',
      message: event.message,
      details: stack,
      context: {
        filename: sanitizeUrlForLog(absoluteUrl(event.filename || location.href)),
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      const diagnostic = errorToDiagnostic(reason);
      report({
        kind: 'page-rejection',
        level: 'error',
        message: diagnostic.message,
        details: diagnostic.details,
        context: { reasonType: reason.name },
      });
      return;
    }
    if (typeof reason === 'string' || typeof reason === 'number' || typeof reason === 'boolean') {
      report({
        kind: 'page-rejection',
        level: 'error',
        message: `Unhandled rejection: ${String(reason)}`,
        context: { reasonType: typeof reason },
      });
      return;
    }
    // Never stringify unknown rejected objects: they may contain page data.
    report({
      kind: 'page-rejection',
      level: 'error',
      message: `Unhandled rejection: ${Object.prototype.toString.call(reason)}`,
      context: { reasonType: Object.prototype.toString.call(reason) },
    });
  });
}

function reportNetwork(input: {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  errorName?: string;
}): void {
  if (!isNetworkFailure(input.status, config.networkFailureMinStatus)) return;
  const method = input.method.toUpperCase();
  const message =
    input.status > 0
      ? `${method} ${input.url} returned HTTP ${input.status}`
      : `${method} ${input.url} failed before a response`;
  const context: Record<string, unknown> = {
    method,
    status: input.status,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    requestUrl: input.url,
  };
  if (input.errorName) context.requestError = input.errorName;
  report({
    kind: 'network',
    level: levelForHttpStatus(input.status),
    message,
    context,
  });
}

function installFetchCapture(): void {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = sanitizeRequestUrl(rawUrl);
    const start = performance.now();
    try {
      const response = await originalFetch(input, init);
      const durationMs = performance.now() - start;
      if (response.type !== 'opaque') {
        reportNetwork({ method, url, status: response.status, durationMs });
      }
      return response;
    } catch (error) {
      const diagnostic = errorToDiagnostic(error);
      reportNetwork({
        method,
        url,
        status: 0,
        durationMs: performance.now() - start,
        errorName: diagnostic.message.slice(0, 200),
      });
      throw error;
    }
  };
}

interface XhrMeta {
  method: string;
  url: string;
  start: number;
  reported: boolean;
}

function installXhrCapture(): void {
  const meta = new WeakMap<XMLHttpRequest, XhrMeta>();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    meta.set(this, {
      method: String(method).toUpperCase(),
      url: sanitizeRequestUrl(String(url)),
      start: 0,
      reported: false,
    });
    originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  };

  XMLHttpRequest.prototype.send = function send(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const metaValue = meta.get(this);
    if (metaValue) {
      metaValue.start = performance.now();
      this.addEventListener(
        'loadend',
        () => {
          if (!metaValue || metaValue.reported) return;
          metaValue.reported = true;
          reportNetwork({
            method: metaValue.method,
            url: metaValue.url,
            status: this.status,
            durationMs: performance.now() - metaValue.start,
          });
        },
        { once: true },
      );
    }
    originalSend.call(this, body);
  };
}

function install(): void {
  if (window.top !== window) return;
  if ((window as unknown as Record<string, unknown>)[FLAG]) return;
  Object.defineProperty(window, FLAG, { value: true, enumerable: false, configurable: false });

  window.addEventListener('message', (event) => {
    if (event.source !== window || !isRecord(event.data) || event.data.source !== BRIDGE_SOURCE) return;
    if (event.data.type === 'config' && isRecord(event.data.config)) {
      applyConfig(event.data.config as unknown as PageConfig);
    }
  });

  installErrorCapture();
  installFetchCapture();
  installXhrCapture();
  window.postMessage({ source: SOURCE, type: 'ready' }, '*');
  window.setTimeout(() => {
    if (!configKnown) window.postMessage({ source: SOURCE, type: 'ready' }, '*');
  }, 250);
  window.setTimeout(() => {
    if (!configKnown) window.postMessage({ source: SOURCE, type: 'ready' }, '*');
  }, 1200);
}

install();
