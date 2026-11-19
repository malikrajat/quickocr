/**
 * Isolated-world bridge. The actual page instrumentation runs in the MAIN
 * world (see page-capture-main.ts) because content scripts cannot patch the
 * page's fetch/XMLHttpRequest or observe its uncaught errors reliably. This
 * bridge receives sanitized events, applies the saved capture policy and
 * forwards them to the service worker.
 */
import { MESSAGE } from '../core/constants.ts';
import { isRecord } from '../core/guards.ts';
import { isNetworkFailure } from '../core/policy.ts';
import type { LogLevel, PageEvent } from '../core/types.ts';

interface PageConfig {
  capturePageErrors: boolean;
  captureNetworkFailures: boolean;
  networkFailureMinStatus: number;
  levels: string[];
}

const SOURCE = 'loglens-main';
const BRIDGE_SOURCE = 'loglens-isolated';
const DEFAULT_CONFIG: PageConfig = {
  capturePageErrors: false,
  captureNetworkFailures: false,
  networkFailureMinStatus: 400,
  levels: ['error', 'fatal'],
};
const MAX_EVENTS_PER_MINUTE = 45;

let config: PageConfig = { ...DEFAULT_CONFIG };
let configKnown = false;
const eventTimes: number[] = [];

function rateAllowed(now = Date.now()): boolean {
  while (eventTimes.length > 0 && now - (eventTimes[0] as number) > 60_000) eventTimes.shift();
  if (eventTimes.length >= MAX_EVENTS_PER_MINUTE) return false;
  eventTimes.push(now);
  return true;
}

function levelAllowed(level: LogLevel): boolean {
  return config.levels.includes(level);
}

function shouldForward(event: PageEvent): boolean {
  if (event.kind === 'network') {
    if (!config.captureNetworkFailures) return false;
    const status = typeof event.context?.status === 'number' ? event.context.status : 0;
    if (!isNetworkFailure(status, config.networkFailureMinStatus)) return false;
  } else if (!config.capturePageErrors) {
    return false;
  }
  return levelAllowed(event.level ?? 'error');
}

function postConfig(): void {
  if (!configKnown) return;
  window.postMessage({ source: BRIDGE_SOURCE, type: 'config', config }, '*');
}

function applyConfig(next: PageConfig): void {
  config = { ...DEFAULT_CONFIG, ...next };
  configKnown = true;
  postConfig();
}

function requestConfig(): void {
  try {
    void chrome.runtime
      .sendMessage({ type: MESSAGE.getPageConfig })
      .then((response: unknown) => {
        if (isRecord(response) && response.ok === true && isRecord(response.config)) {
          applyConfig(response.config as unknown as PageConfig);
        } else {
          applyConfig(DEFAULT_CONFIG);
        }
      })
      .catch(() => applyConfig(DEFAULT_CONFIG));
  } catch {
    applyConfig(DEFAULT_CONFIG);
  }
}

function forward(event: PageEvent): void {
  if (!configKnown || !shouldForward(event) || !rateAllowed()) return;
  const payload: PageEvent = {
    kind: event.kind,
    level: event.level,
    message: typeof event.message === 'string' ? event.message.slice(0, 4000) : 'Page event',
  };
  if (typeof event.details === 'string') payload.details = event.details.slice(0, 12000);
  if (event.context && isRecord(event.context)) payload.context = event.context;
  if (typeof event.url === 'string') payload.url = event.url;
  void chrome.runtime.sendMessage({ type: MESSAGE.capturePageEvent, payload }).catch(() => undefined);
}

function install(): void {
  if (window.top !== window) return;

  window.addEventListener('message', (event) => {
    if (event.source !== window || !isRecord(event.data) || event.data.source !== SOURCE) return;
    if (event.data.type === 'ready') {
      if (configKnown) postConfig();
      return;
    }
    if (event.data.type === 'event' && isRecord(event.data.event)) {
      forward(event.data.event as unknown as PageEvent);
    }
  });

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!isRecord(message) || message.type !== MESSAGE.updatePageConfig || !isRecord(message.config)) return;
    applyConfig(message.config as unknown as PageConfig);
  });

  requestConfig();
}

install();
