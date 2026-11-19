import { CONTENT_SCRIPT_ID, CONTENT_SCRIPT_MAIN_ID, MESSAGE, PAGE_MATCHES, PAGE_ORIGINS } from '../core/constants.ts';
import type { LogLensSettings } from '../core/types.ts';

export interface PageCaptureStatus {
  needed: boolean;
  active: boolean;
  needsPermission: boolean;
}

export interface PageConfig {
  capturePageErrors: boolean;
  captureNetworkFailures: boolean;
  networkFailureMinStatus: number;
  levels: string[];
}

export function buildPageConfig(settings: LogLensSettings): PageConfig {
  return {
    capturePageErrors: settings.capturePageErrors,
    captureNetworkFailures: settings.captureNetworkFailures,
    networkFailureMinStatus: settings.networkFailureMinStatus,
    levels: settings.levels,
  };
}

export async function hasPageHostPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: PAGE_ORIGINS });
  } catch {
    return false;
  }
}

export async function syncPageCaptureRegistration(settings: LogLensSettings): Promise<PageCaptureStatus> {
  const needed = settings.capturePageErrors || settings.captureNetworkFailures;
  const ids = [CONTENT_SCRIPT_ID, CONTENT_SCRIPT_MAIN_ID];
  let registered: chrome.scripting.RegisteredContentScript[] = [];
  try {
    registered = await chrome.scripting.getRegisteredContentScripts({ ids });
  } catch {
    registered = [];
  }

  if (!needed) {
    if (registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids });
    }
    return { needed, active: false, needsPermission: false };
  }

  const permission = await hasPageHostPermission();
  if (!permission) {
    if (registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids });
    }
    return { needed, active: false, needsPermission: true };
  }

  if (registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids });
  }
  await chrome.scripting.registerContentScripts([
    {
      id: CONTENT_SCRIPT_ID,
      matches: PAGE_MATCHES,
      js: ['page-capture.js'],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
      world: 'ISOLATED',
    },
    {
      id: CONTENT_SCRIPT_MAIN_ID,
      matches: PAGE_MATCHES,
      js: ['page-capture-main.js'],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
      world: 'MAIN',
    },
  ]);
  return { needed, active: true, needsPermission: false };
}

export async function broadcastPageConfig(settings: LogLensSettings): Promise<void> {
  const config = buildPageConfig(settings);
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  await Promise.allSettled(
    tabs
      .filter((tab) => typeof tab.id === 'number')
      .map((tab) => chrome.tabs.sendMessage(tab.id as number, { type: MESSAGE.updatePageConfig, config })),
  );
}

export async function requestPageHostPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: PAGE_ORIGINS });
  } catch {
    return false;
  }
}

export async function removePageHostPermission(): Promise<void> {
  try {
    await chrome.permissions.remove({ origins: PAGE_ORIGINS });
  } catch {
    // Permission may not be granted.
  }
}
