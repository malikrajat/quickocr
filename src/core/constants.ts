export const APP_NAME = 'Log Lens';
export const APP_VERSION = '1.1.0';

export const STORAGE_KEYS = {
  settings: 'll_settings',
  logs: 'll_logs',
  state: 'll_state',
  pendingSends: 'll_pending_sends',
  openLogsTab: 'll_open_logs_tab',
} as const;

export const LIMITS = {
  maxEntries: { min: 50, max: 2000, default: 500 },
  retentionDays: { min: 1, max: 30, default: 7 },
  maxMessageChars: 4000,
  maxDetailsChars: 12000,
  maxContextChars: 6000,
  maxContextKeys: 20,
  maxUrlChars: 2000,
  maxEndpointChars: 2048,
  maxEmailChars: 254,
  networkStatus: { min: 400, max: 599, default: 400 },
  send: {
    intervalMinutes: { min: 5, max: 1440, default: 15 },
    retryCount: { min: 0, max: 5, default: 3 },
    retryDelaySeconds: { min: 5, max: 300, default: 30 },
    batchSize: { min: 1, max: 200, default: 50 },
    requestTimeoutMs: 15_000,
    maxPendingBatches: 20,
  },
  /** chrome.storage.local quota is 10 MB; stay comfortably below it. */
  storageBudgetBytes: 4_500_000,
  autoOpenCooldownMs: 30_000,
  notifyCooldownMs: 30_000,
} as const;

export const ALARMS = {
  maintenance: 'loglens-maintenance',
  scheduledSend: 'loglens-scheduled-send',
  retrySend: 'loglens-retry-send',
} as const;

export const CONTENT_SCRIPT_ID = 'loglens-page-capture';
export const CONTENT_SCRIPT_MAIN_ID = 'loglens-page-capture-main';
export const PAGE_MATCHES = ['http://*/*', 'https://*/*'];
export const PAGE_ORIGINS = ['http://*/*', 'https://*/*'];

export const MESSAGE = {
  captureClientError: 'LL_CAPTURE_CLIENT_ERROR',
  capturePageEvent: 'LL_PAGE_EVENT',
  clearLogs: 'LL_CLEAR_LOGS',
  exportSnapshot: 'LL_EXPORT_SNAPSHOT',
  getPageConfig: 'LL_GET_PAGE_CONFIG',
  getSnapshot: 'LL_GET_SNAPSHOT',
  getStorageUsage: 'LL_GET_STORAGE_USAGE',
  openLogs: 'LL_OPEN_LOGS',
  previewSend: 'LL_PREVIEW_SEND',
  capturePageScreenshot: 'LL_CAPTURE_PAGE_SCREENSHOT',
  saveSettings: 'LL_SAVE_SETTINGS',
  sendNow: 'LL_SEND_NOW',
  updatePageConfig: 'LL_UPDATE_PAGE_CONFIG',
  flushSends: 'LL_FLUSH_SENDS',
} as const;

export const EXTERNAL_MESSAGE = {
  ping: 'loglens.ping',
  log: 'loglens.log',
  getCapabilities: 'loglens.capabilities',
} as const;

export type MessageType = (typeof MESSAGE)[keyof typeof MESSAGE];
