import { MESSAGE } from '../../core/constants.ts';
import type { LogEntry, LogLensSettings, LogState } from '../../core/types.ts';

export interface BaseResponse {
  ok: boolean;
  error?: string;
}

export interface SnapshotResponse extends BaseResponse {
  settings: LogLensSettings;
  entries: LogEntry[];
  state: LogState;
  pendingCount: number;
  version: string;
}

export interface PageStatus {
  needed: boolean;
  active: boolean;
  needsPermission: boolean;
}

export interface SaveSettingsResponse extends BaseResponse {
  settings: LogLensSettings;
  pageStatus: PageStatus;
  warnings: string[];
}

export interface PreviewResponse extends BaseResponse {
  preview: {
    enabled: boolean;
    endpoint: string;
    mode: LogLensSettings['autoSend']['mode'];
    entries: LogEntry[];
    payload: unknown;
  };
}

export interface OpenLogsResponse extends BaseResponse {
  mode: 'side-panel' | 'tab';
}

export interface ScreenshotResponse extends BaseResponse {
  dataUrl?: string;
  permissionRequired?: boolean;
}

export interface FlushResponse extends BaseResponse {
  result: { attempted: number; sent: number; failed: number; remaining: number };
}

export interface StorageUsageResponse extends BaseResponse {
  usage: { bytes: number; maxBytes: number; percent: number };
}

export function chromeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const match = /^Error:\s*(.*)$/.exec(error.message);
    return match?.[1] ?? error.message;
  }
  return typeof error === 'string' ? error : 'The extension did not respond.';
}

export async function send<T extends BaseResponse>(message: Record<string, unknown>): Promise<T> {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as T | undefined;
    if (!response) throw new Error('The extension did not respond.');
    return response;
  } catch (error) {
    throw new Error(chromeErrorMessage(error));
  }
}

export async function requestSnapshot(): Promise<SnapshotResponse> {
  const response = await send<SnapshotResponse>({ type: MESSAGE.getSnapshot });
  if (!response.ok) throw new Error(response.error ?? 'Could not read logs.');
  return response;
}

export async function saveSettings(settings: LogLensSettings): Promise<SaveSettingsResponse> {
  return send<SaveSettingsResponse>({ type: MESSAGE.saveSettings, settings });
}

export async function clearLogs(): Promise<BaseResponse> {
  return send<BaseResponse>({ type: MESSAGE.clearLogs });
}

export async function openLogs(source: 'manual' | 'popup' | 'command'): Promise<OpenLogsResponse> {
  return send<OpenLogsResponse>({ type: MESSAGE.openLogs, source });
}

export async function captureVisiblePage(): Promise<ScreenshotResponse> {
  return send<ScreenshotResponse>({ type: MESSAGE.capturePageScreenshot });
}

export async function previewSend(): Promise<PreviewResponse> {
  return send<PreviewResponse>({ type: MESSAGE.previewSend });
}

export async function sendNow(): Promise<FlushResponse> {
  return send<FlushResponse>({ type: MESSAGE.sendNow });
}

export async function getStorageUsage(): Promise<StorageUsageResponse> {
  return send<StorageUsageResponse>({ type: MESSAGE.getStorageUsage });
}

export function watchStorage(listener: () => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((key) => key.startsWith('ll_'))) listener();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
