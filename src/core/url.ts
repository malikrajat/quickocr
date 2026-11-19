/** URL helpers shared by redaction, settings and the content script. */

const MAX_URL_LENGTH = 2000;

export function isValidHttpsEndpoint(raw: string): boolean {
  const value = raw.trim();
  if (!value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Canonicalises an approved web origin. HTTPS is required; HTTP is accepted
 * only for localhost so developers can test locally.
 */
export function normalizeApprovedOrigin(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function originFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Removes query strings, fragments and credentials. Logs never need query
 * parameters, and those are a common place for tokens to leak.
 */
export function sanitizeUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  let value = raw.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    value = url.toString();
  } catch {
    // Relative or malformed URL: drop anything that resembles a query/fragment.
    const cut = value.search(/[?#]/);
    if (cut >= 0) value = value.slice(0, cut);
  }
  return value.length > MAX_URL_LENGTH ? `${value.slice(0, MAX_URL_LENGTH)}…` : value;
}

export function isExtensionId(value: string): boolean {
  return /^[a-p]{32}$/.test(value.trim());
}
