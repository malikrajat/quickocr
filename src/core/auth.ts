import type { ExternalApiDecision, ExternalApiSettings } from './types.ts';
import { normalizeApprovedOrigin, originFromUrl } from './url.ts';

export interface ExternalSender {
  id?: string;
  origin?: string;
  url?: string;
}

/**
 * Decides whether an external sender may submit a log. Web pages must match an
 * approved HTTPS origin. Extensions must match the approved id list unless the
 * user explicitly allowed all installed extensions.
 */
export function decideExternalSender(
  settings: ExternalApiSettings,
  sender: ExternalSender,
  ownExtensionId: string,
): ExternalApiDecision {
  const origin = sender.origin ?? (sender.url ? originFromUrl(sender.url) : null);
  if (origin) {
    const normalized = normalizeApprovedOrigin(origin);
    if (normalized && settings.approvedOrigins.includes(normalized)) {
      return { allowed: true, reason: 'approved-origin' };
    }
    // A web page sender must match an approved origin even if Chrome reports
    // the receiver's extension id in sender.id. Opaque/file/unknown origins
    // are rejected for the same reason.
    if (!origin.startsWith('chrome-extension://')) {
      return { allowed: false, reason: 'not-approved' };
    }
  }

  if (sender.id === ownExtensionId) {
    return { allowed: true, reason: 'approved-extension' };
  }

  if (sender.id) {
    if (settings.approvedExtensions.includes(sender.id)) {
      return { allowed: true, reason: 'approved-extension' };
    }
    if (settings.allowAllExtensions) {
      return { allowed: true, reason: 'all-extensions' };
    }
    return { allowed: false, reason: 'not-approved' };
  }

  return { allowed: false, reason: 'missing-sender' };
}

export function approvalSummary(settings: ExternalApiSettings): string {
  const extensionCount = settings.approvedExtensions.length;
  const originCount = settings.approvedOrigins.length;
  if (settings.allowAllExtensions) return `All installed extensions, ${originCount} approved origin(s)`;
  return `${extensionCount} approved extension(s), ${originCount} approved origin(s)`;
}
