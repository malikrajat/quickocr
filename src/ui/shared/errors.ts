import { MESSAGE } from '../../core/constants.ts';
import { errorToDiagnostic } from '../../core/redact.ts';

let installed = false;

function report(page: string, message: string, details?: string): void {
  try {
    void chrome.runtime
      .sendMessage({
        type: MESSAGE.captureClientError,
        payload: { page, message, details },
      })
      .catch(() => undefined);
  } catch {
    // The extension context can be invalidated by a reload. Nothing to do.
  }
}

/**
 * Captures uncaught errors and rejections in Log Lens' own pages. It never
 * reads page content and is careful not to report its own reporting failures.
 */
export function installPageErrorReporting(page: string): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    if (!event.message) return;
    const details = event.error instanceof Error ? event.error.stack : undefined;
    report(page, event.message, details);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      const diagnostic = errorToDiagnostic(reason);
      report(page, diagnostic.message, diagnostic.details);
      return;
    }
    if (typeof reason === 'string' || typeof reason === 'number' || typeof reason === 'boolean') {
      report(page, `Unhandled rejection in ${page}: ${String(reason)}`);
      return;
    }
    report(page, `Unhandled rejection in ${page}: ${Object.prototype.toString.call(reason)}`);
  });
}
