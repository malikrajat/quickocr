import { decideExternalSender } from '../core/auth.ts';
import { APP_VERSION, EXTERNAL_MESSAGE } from '../core/constants.ts';
import type { ExternalApiDecision, ExternalLogRequest } from '../core/types.ts';
import { LOG_LEVELS } from '../core/types.ts';
import { captureApiLog } from './capture.ts';
import { readSettings } from './storage.ts';

interface RateBucket {
  windowStart: number;
  count: number;
}

const RATE_LIMIT_PER_MINUTE = 60;
const buckets = new Map<string, RateBucket>();

function rateLimited(key: string, now = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    buckets.set(key, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_PER_MINUTE;
}

function senderKey(sender: chrome.runtime.MessageSender): string {
  if (sender.origin && (sender.origin.startsWith('http://') || sender.origin.startsWith('https://'))) {
    return sender.origin;
  }
  return sender.id ?? sender.origin ?? 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLogRequest(message: unknown): { ok: true; request: ExternalLogRequest } | { ok: false; error: string } {
  if (!isRecord(message)) return { ok: false, error: 'Message must be an object.' };
  if (message.type !== EXTERNAL_MESSAGE.log)
    return { ok: false, error: `Unsupported message type. Use "${EXTERNAL_MESSAGE.log}".` };
  if (typeof message.message !== 'string' || message.message.trim().length === 0) {
    return { ok: false, error: 'A non-empty message string is required.' };
  }
  if (message.message.length > 4000) return { ok: false, error: 'Message is too long (max 4000 characters).' };
  if (message.details !== undefined && typeof message.details !== 'string') {
    return { ok: false, error: 'details must be a string when present.' };
  }
  if (message.context !== undefined && !isRecord(message.context)) {
    return { ok: false, error: 'context must be an object when present.' };
  }
  return { ok: true, request: message as unknown as ExternalLogRequest };
}

function decisionPayload(decision: ExternalApiDecision): Record<string, unknown> {
  return {
    ok: decision.allowed,
    ...(decision.allowed ? {} : { error: 'not-approved', reason: decision.reason }),
  };
}

export function initExternalApi(): void {
  chrome.runtime.onMessageExternal.addListener(
    (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      void (async () => {
        try {
          const type = isRecord(message) ? message.type : undefined;
          if (type === EXTERNAL_MESSAGE.ping) {
            sendResponse({ ok: true, product: 'Log Lens', version: APP_VERSION, schema: 'loglens/v1' });
            return;
          }
          if (type === EXTERNAL_MESSAGE.getCapabilities) {
            sendResponse({
              ok: true,
              product: 'Log Lens',
              version: APP_VERSION,
              schema: 'loglens/v1',
              accepts: EXTERNAL_MESSAGE.log,
              levels: LOG_LEVELS,
              privacy: {
                redaction: true,
                cookies: false,
                formData: false,
                requestHeaders: false,
                requestBodies: false,
                pageContent: false,
              },
            });
            return;
          }

          const settings = await readSettings();
          const decision = decideExternalSender(settings.externalApi, sender, chrome.runtime.id);
          if (!decision.allowed) {
            sendResponse(decisionPayload(decision));
            return;
          }

          const key = senderKey(sender);
          if (rateLimited(key)) {
            sendResponse({ ok: false, error: 'rate-limited', limitPerMinute: RATE_LIMIT_PER_MINUTE });
            return;
          }

          const parsed = parseLogRequest(message);
          if (!parsed.ok) {
            sendResponse({ ok: false, error: parsed.error });
            return;
          }

          const outcome = await captureApiLog(
            {
              message: parsed.request.message as string,
              level: parsed.request.level,
              details: parsed.request.details as string | undefined,
              context: parsed.request.context as Record<string, unknown> | undefined,
              url: parsed.request.url as string | undefined,
            },
            { id: sender.id, origin: sender.origin },
          );
          sendResponse({
            ok: true,
            stored: outcome.stored,
            ignored: outcome.ignored,
            ids: outcome.entries.map((entry) => entry.id),
            source: decision.reason,
          });
        } catch {
          sendResponse({ ok: false, error: 'internal-error' });
        }
      })();
      return true;
    },
  );
}
