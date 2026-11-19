import '../shared/base.css';
import './options.css';

import { LIMITS, PAGE_ORIGINS } from '../../core/constants.ts';
import { normalizeSettings, validateSettings } from '../../core/settings.ts';
import type { AutoOpenMode, LogLensSettings, LogLevel, SendMode } from '../../core/types.ts';
import { isExtensionId, isValidHttpsEndpoint, normalizeApprovedOrigin } from '../../core/url.ts';
import { copyText } from '../shared/clipboard.ts';
import { closeDialog, debounce, formatBytes, formatClock, query, setBusy, showDialog, toast } from '../shared/dom.ts';
import { downloadText } from '../shared/download.ts';
import { installPageErrorReporting } from '../shared/errors.ts';
import {
  clearLogs as clearLogsRequest,
  getStorageUsage,
  previewSend,
  requestSnapshot,
  type SnapshotResponse,
  saveSettings as saveSettingsRequest,
  sendNow as sendNowRequest,
  watchStorage,
} from '../shared/messages.ts';

installPageErrorReporting('options');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let snapshot: SnapshotResponse | null = null;
let settings: LogLensSettings = normalizeSettings(undefined);
let rendering = false;
let dirty = false;
let previewPayloadText = '';

const levelInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="levels"]'));

const elements = {
  form: query<HTMLFormElement>('#settings-form'),
  welcome: query<HTMLDivElement>('#welcome'),
  modePill: query<HTMLSpanElement>('#mode-pill'),
  viewLogs: query<HTMLButtonElement>('#view-logs'),
  captureExtension: query<HTMLInputElement>('#capture-extension'),
  captureRejections: query<HTMLInputElement>('#capture-rejections'),
  capturePage: query<HTMLInputElement>('#capture-page'),
  captureNetwork: query<HTMLInputElement>('#capture-network'),
  networkStatus: query<HTMLInputElement>('#network-status'),
  pagePermissionText: query<HTMLSpanElement>('#page-permission-text'),
  grantPageAccess: query<HTMLButtonElement>('#grant-page-access'),
  removePageAccess: query<HTMLButtonElement>('#remove-page-access'),
  maxEntries: query<HTMLInputElement>('#max-entries'),
  retentionDays: query<HTMLInputElement>('#retention-days'),
  usageText: query<HTMLSpanElement>('#usage-text'),
  usageBar: query<HTMLDivElement>('#usage-bar'),
  clearLogs: query<HTMLButtonElement>('#clear-logs'),
  autoOpen: query<HTMLSelectElement>('#auto-open'),
  emailRecipient: query<HTMLInputElement>('#email-recipient'),
  notifyOnError: query<HTMLInputElement>('#notify-on-error'),
  showBadge: query<HTMLInputElement>('#show-badge'),
  autosendEnabled: query<HTMLInputElement>('#autosend-enabled'),
  autosendPill: query<HTMLSpanElement>('#autosend-pill'),
  autosendFields: query<HTMLFieldSetElement>('#autosend-fields'),
  endpoint: query<HTMLInputElement>('#autosend-endpoint'),
  endpointPermissionText: query<HTMLSpanElement>('#endpoint-permission-text'),
  grantEndpoint: query<HTMLButtonElement>('#grant-endpoint'),
  mode: query<HTMLSelectElement>('#autosend-mode'),
  interval: query<HTMLInputElement>('#autosend-interval'),
  level: query<HTMLSelectElement>('#autosend-level'),
  batch: query<HTMLInputElement>('#autosend-batch'),
  retries: query<HTMLInputElement>('#autosend-retries'),
  delay: query<HTMLInputElement>('#autosend-delay'),
  consent: query<HTMLInputElement>('#autosend-consent'),
  preview: query<HTMLButtonElement>('#preview-send'),
  sendNow: query<HTMLButtonElement>('#send-now'),
  sendStatus: query<HTMLSpanElement>('#send-status'),
  allowAllExtensions: query<HTMLInputElement>('#allow-all-extensions'),
  approvedExtensions: query<HTMLTextAreaElement>('#approved-extensions'),
  approvedOrigins: query<HTMLTextAreaElement>('#approved-origins'),
  apiExample: query<HTMLPreElement>('#api-example'),
  privacyLink: query<HTMLAnchorElement>('#privacy-link'),
  footerPrivacy: query<HTMLAnchorElement>('#footer-privacy'),
  resetSettings: query<HTMLButtonElement>('#reset-settings'),
  resetButton: query<HTMLButtonElement>('#reset-button'),
  saveButton: query<HTMLButtonElement>('#save-button'),
  saveStatus: query<HTMLSpanElement>('#save-status'),
  previewDialog: query<HTMLDialogElement>('#preview-dialog'),
  previewClose: query<HTMLButtonElement>('#preview-close'),
  previewEndpoint: query<HTMLElement>('#preview-endpoint'),
  previewPayload: query<HTMLPreElement>('#preview-payload'),
  previewCopy: query<HTMLButtonElement>('#preview-copy'),
  previewDownload: query<HTMLButtonElement>('#preview-download'),
  clearDialog: query<HTMLDialogElement>('#clear-dialog'),
  clearCancel: query<HTMLButtonElement>('#clear-cancel'),
  clearConfirm: query<HTMLButtonElement>('#clear-confirm'),
  resetDialog: query<HTMLDialogElement>('#reset-dialog'),
  resetCancel: query<HTMLButtonElement>('#reset-cancel'),
  resetConfirm: query<HTMLButtonElement>('#reset-confirm'),
};

function setDirty(value: boolean): void {
  dirty = value;
  elements.saveStatus.classList.toggle('dirty', value);
  elements.saveStatus.textContent = value ? 'Unsaved changes.' : 'Settings loaded.';
}

function setSaveStatus(message: string, tone: 'normal' | 'error' = 'normal'): void {
  elements.saveStatus.textContent = message;
  elements.saveStatus.classList.toggle('dirty', tone === 'error');
}

function renderForm(next: LogLensSettings): void {
  rendering = true;
  settings = next;
  for (const input of levelInputs) input.checked = next.levels.includes(input.value as LogLevel);
  elements.captureExtension.checked = next.captureExtensionErrors;
  elements.captureRejections.checked = next.captureUnhandledRejections;
  elements.capturePage.checked = next.capturePageErrors;
  elements.captureNetwork.checked = next.captureNetworkFailures;
  elements.networkStatus.value = String(next.networkFailureMinStatus);
  elements.maxEntries.value = String(next.maxEntries);
  elements.retentionDays.value = String(next.retentionDays);
  elements.autoOpen.value = next.autoOpen;
  elements.emailRecipient.value = next.emailRecipient;
  elements.notifyOnError.checked = next.notifyOnError;
  elements.showBadge.checked = next.showBadge;
  elements.autosendEnabled.checked = next.autoSend.enabled;
  elements.endpoint.value = next.autoSend.endpoint;
  elements.mode.value = next.autoSend.mode;
  elements.interval.value = String(next.autoSend.intervalMinutes);
  elements.level.value = next.autoSend.minLevel;
  elements.batch.value = String(next.autoSend.batchSize);
  elements.retries.value = String(next.autoSend.retryCount);
  elements.delay.value = String(next.autoSend.retryDelaySeconds);
  elements.consent.checked = next.autoSend.consentAt !== null;
  elements.allowAllExtensions.checked = next.externalApi.allowAllExtensions;
  elements.approvedExtensions.value = next.externalApi.approvedExtensions.join('\n');
  elements.approvedOrigins.value = next.externalApi.approvedOrigins.join('\n');
  elements.privacyLink.href = chrome.runtime.getURL('privacy_policy.html');
  elements.footerPrivacy.href = chrome.runtime.getURL('privacy_policy.html');
  elements.apiExample.textContent = `await chrome.runtime.sendMessage('${chrome.runtime.id}', {
  type: 'loglens.log',
  level: 'error',
  message: 'Checkout failed',
  details: error.stack,
  context: { route: '/checkout', status: 500 }
});`;
  rendering = false;
  syncAutoSendState();
  setDirty(false);
  updateModePill();
}

function syncAutoSendState(): void {
  const enabled = elements.autosendEnabled.checked;
  elements.autosendFields.disabled = !enabled;
  elements.autosendPill.textContent = enabled ? 'Enabled' : 'Disabled';
  elements.autosendPill.className = `pill ${enabled ? 'ok' : ''}`;
  elements.sendNow.disabled = !enabled || !(snapshot?.settings.autoSend.enabled ?? false);
}

function updateModePill(): void {
  const enabled = settings.autoSend.enabled;
  elements.modePill.textContent = enabled ? 'Auto-send on' : 'Local only';
  elements.modePill.className = `pill ${enabled ? 'warn' : 'ok'}`;
}

function updateSendStatus(data: SnapshotResponse): void {
  const auto = data.settings.autoSend;
  const state = data.state;
  if (!auto.enabled) {
    elements.sendStatus.textContent = 'Auto-send is off. Preview is available without sending.';
    return;
  }
  const pieces: string[] = [];
  if (state.lastAutoSendAt) {
    pieces.push(
      `Last attempt ${formatClock(state.lastAutoSendAt)}: ${state.lastAutoSendStatus === 'ok' ? 'delivered' : 'failed'}.`,
    );
  } else {
    pieces.push('No auto-send attempt yet.');
  }
  if (data.pendingCount > 0) pieces.push(`${data.pendingCount} batch(es) queued.`);
  if (state.lastAutoSendStatus === 'error' && state.lastAutoSendError) pieces.push(state.lastAutoSendError);
  elements.sendStatus.textContent = pieces.join(' ');
}

async function updatePermissionUi(): Promise<void> {
  let pageGranted = false;
  try {
    pageGranted = await chrome.permissions.contains({ origins: PAGE_ORIGINS });
  } catch {
    pageGranted = false;
  }
  elements.pagePermissionText.textContent = pageGranted ? 'Site access granted.' : 'Site access not granted.';
  elements.grantPageAccess.hidden = pageGranted;
  elements.removePageAccess.hidden = !pageGranted;

  const endpoint = elements.endpoint.value.trim();
  if (!isValidHttpsEndpoint(endpoint)) {
    elements.endpointPermissionText.textContent = endpoint
      ? 'The endpoint must be a valid HTTPS URL.'
      : 'Enter an endpoint first.';
    elements.grantEndpoint.hidden = false;
    return;
  }
  let endpointGranted = false;
  try {
    const origin = new URL(endpoint).origin;
    endpointGranted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    endpointGranted = false;
  }
  elements.endpointPermissionText.textContent = endpointGranted ? 'Endpoint approved.' : 'Endpoint not approved.';
  elements.grantEndpoint.hidden = endpointGranted;
}

async function updateUsage(): Promise<void> {
  try {
    const response = await getStorageUsage();
    if (!response.ok) return;
    const { bytes, maxBytes, percent } = response.usage;
    elements.usageText.textContent = `${formatBytes(bytes)} / ${formatBytes(maxBytes)}`;
    elements.usageBar.style.width = `${percent.toFixed(1)}%`;
    elements.usageBar.classList.toggle('high', percent >= 80);
  } catch {
    elements.usageText.textContent = 'Unavailable';
  }
}

async function load(): Promise<void> {
  try {
    const data = await requestSnapshot();
    snapshot = data;
    renderForm(data.settings);
    updateSendStatus(data);
    await updatePermissionUi();
    await updateUsage();
    if (new URLSearchParams(location.search).get('welcome') === '1') elements.welcome.hidden = false;
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not load settings.', { tone: 'error' });
  }
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

interface CollectedSettings {
  ok: true;
  settings: LogLensSettings;
  needsPagePermission: boolean;
  needsEndpointPermission: boolean;
  endpointOrigin: string | null;
}

interface CollectionError {
  ok: false;
  message: string;
  field?: HTMLElement;
}

function collectSettings(): CollectedSettings | CollectionError {
  const levels = levelInputs.filter((input) => input.checked).map((input) => input.value as LogLevel);
  if (levels.length === 0) {
    return { ok: false, message: 'Choose at least one level to capture.', field: levelInputs[0] };
  }

  const maxEntries = Number(elements.maxEntries.value);
  if (!Number.isFinite(maxEntries) || maxEntries < LIMITS.maxEntries.min || maxEntries > LIMITS.maxEntries.max) {
    return {
      ok: false,
      message: `Maximum entries must be between ${LIMITS.maxEntries.min} and ${LIMITS.maxEntries.max}.`,
      field: elements.maxEntries,
    };
  }
  const retentionDays = Number(elements.retentionDays.value);
  if (
    !Number.isFinite(retentionDays) ||
    retentionDays < LIMITS.retentionDays.min ||
    retentionDays > LIMITS.retentionDays.max
  ) {
    return {
      ok: false,
      message: `Retention must be between ${LIMITS.retentionDays.min} and ${LIMITS.retentionDays.max} days.`,
      field: elements.retentionDays,
    };
  }
  const networkStatus = Number(elements.networkStatus.value);
  if (
    !Number.isFinite(networkStatus) ||
    networkStatus < LIMITS.networkStatus.min ||
    networkStatus > LIMITS.networkStatus.max
  ) {
    return {
      ok: false,
      message: `Network threshold must be between ${LIMITS.networkStatus.min} and ${LIMITS.networkStatus.max}.`,
      field: elements.networkStatus,
    };
  }
  const emailRecipient = elements.emailRecipient.value.trim();
  if (emailRecipient && !EMAIL_RE.test(emailRecipient)) {
    return { ok: false, message: 'Enter a valid email address or leave it blank.', field: elements.emailRecipient };
  }

  const extensionLines = parseLines(elements.approvedExtensions.value).map((line) => line.toLowerCase());
  const invalidIds = extensionLines.filter((line) => !isExtensionId(line));
  if (invalidIds.length > 0) {
    return {
      ok: false,
      message: `Invalid extension ID: ${invalidIds[0]}. IDs are 32 characters using a-p.`,
      field: elements.approvedExtensions,
    };
  }
  const originLines = parseLines(elements.approvedOrigins.value);
  const invalidOrigins = originLines.filter((line) => normalizeApprovedOrigin(line) === null);
  if (invalidOrigins.length > 0) {
    return {
      ok: false,
      message: `Invalid origin: ${invalidOrigins[0]}. Use an HTTPS origin such as https://app.example.com.`,
      field: elements.approvedOrigins,
    };
  }

  const autoEnabled = elements.autosendEnabled.checked;
  const endpoint = elements.endpoint.value.trim();
  if (autoEnabled) {
    if (!isValidHttpsEndpoint(endpoint)) {
      return {
        ok: false,
        message: 'Auto-send requires a valid HTTPS endpoint without credentials.',
        field: elements.endpoint,
      };
    }
    if (!elements.consent.checked) {
      return {
        ok: false,
        message: 'Tick the explicit consent checkbox before enabling auto-send.',
        field: elements.consent,
      };
    }
  }

  const intervalMinutes = Number(elements.interval.value);
  const retryCount = Number(elements.retries.value);
  const retryDelaySeconds = Number(elements.delay.value);
  const batchSize = Number(elements.batch.value);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1440) {
    return { ok: false, message: 'Schedule interval must be between 5 and 1440 minutes.', field: elements.interval };
  }
  if (!Number.isFinite(retryCount) || retryCount < 0 || retryCount > 5) {
    return { ok: false, message: 'Retries must be between 0 and 5.', field: elements.retries };
  }
  if (!Number.isFinite(retryDelaySeconds) || retryDelaySeconds < 5 || retryDelaySeconds > 300) {
    return { ok: false, message: 'Retry delay must be between 5 and 300 seconds.', field: elements.delay };
  }
  if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 200) {
    return { ok: false, message: 'Batch size must be between 1 and 200.', field: elements.batch };
  }

  const consentAt = autoEnabled && elements.consent.checked ? (settings.autoSend.consentAt ?? Date.now()) : null;
  const next = normalizeSettings({
    ...settings,
    levels,
    captureExtensionErrors: elements.captureExtension.checked,
    captureUnhandledRejections: elements.captureRejections.checked,
    capturePageErrors: elements.capturePage.checked,
    captureNetworkFailures: elements.captureNetwork.checked,
    networkFailureMinStatus: networkStatus,
    maxEntries,
    retentionDays,
    autoOpen: elements.autoOpen.value as AutoOpenMode,
    emailRecipient,
    notifyOnError: elements.notifyOnError.checked,
    showBadge: elements.showBadge.checked,
    autoSend: {
      ...settings.autoSend,
      enabled: autoEnabled,
      endpoint,
      mode: elements.mode.value as SendMode,
      intervalMinutes,
      minLevel: elements.level.value as LogLevel,
      retryCount,
      retryDelaySeconds,
      batchSize,
      consentAt,
    },
    externalApi: {
      approvedExtensions: extensionLines,
      approvedOrigins: originLines,
      allowAllExtensions: elements.allowAllExtensions.checked,
    },
  });

  const issues = validateSettings(next);
  if (issues.length > 0) {
    return { ok: false, message: issues[0]?.message ?? 'Settings are invalid.' };
  }

  return {
    ok: true,
    settings: next,
    needsPagePermission: next.capturePageErrors || next.captureNetworkFailures,
    needsEndpointPermission: next.autoSend.enabled,
    endpointOrigin: next.autoSend.enabled ? new URL(next.autoSend.endpoint).origin : null,
  };
}

function focusField(field: HTMLElement | undefined): void {
  field?.focus();
  field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function save(): Promise<void> {
  const collected = collectSettings();
  if (!collected.ok) {
    toast(collected.message, { tone: 'error', timeout: 6000 });
    focusField(collected.field);
    setSaveStatus(collected.message, 'error');
    return;
  }

  setBusy(elements.saveButton, true);
  try {
    const requestedOrigins: string[] = [];
    if (collected.needsPagePermission) requestedOrigins.push(...PAGE_ORIGINS);
    if (collected.needsEndpointPermission && collected.endpointOrigin) {
      requestedOrigins.push(`${collected.endpointOrigin}/*`);
    }
    if (requestedOrigins.length > 0) {
      const granted = await chrome.permissions.request({ origins: requestedOrigins });
      if (!granted) {
        const message =
          collected.needsPagePermission && collected.needsEndpointPermission
            ? 'Site access and endpoint permission are both required to save these settings.'
            : collected.needsPagePermission
              ? 'Site access is required for page errors and network failures.'
              : 'Endpoint permission is required before Log Lens can POST.';
        toast(message, { tone: 'error' });
        setSaveStatus(message, 'error');
        return;
      }
    }

    const response = await saveSettingsRequest(collected.settings);
    if (!response.ok) throw new Error(response.error ?? 'Could not save settings.');
    if (response.warnings.length > 0) {
      toast(response.warnings.join(' '), { tone: 'info', timeout: 7000 });
    } else {
      toast('Settings saved.', { tone: 'success' });
    }
    await load();
    setSaveStatus(response.warnings[0] ?? 'Settings saved.');
    elements.welcome.hidden = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save settings.';
    toast(message, { tone: 'error' });
    setSaveStatus(message, 'error');
  } finally {
    setBusy(elements.saveButton, false);
  }
}

async function preview(): Promise<void> {
  setBusy(elements.preview, true);
  try {
    const response = await previewSend();
    if (!response.ok) throw new Error(response.error ?? 'Could not build a preview.');
    previewPayloadText = JSON.stringify(response.preview.payload, null, 2);
    elements.previewEndpoint.textContent = response.preview.endpoint || 'Not configured';
    elements.previewPayload.textContent = previewPayloadText;
    showDialog(elements.previewDialog);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not build a preview.', { tone: 'error' });
  } finally {
    setBusy(elements.preview, false);
  }
}

async function sendNow(): Promise<void> {
  if (!snapshot?.settings.autoSend.enabled) {
    toast('Enable and save auto-send before sending.', { tone: 'error' });
    return;
  }
  if (!window.confirm('Send every queued redacted batch to the configured endpoint now?')) return;
  setBusy(elements.sendNow, true);
  try {
    const response = await sendNowRequest();
    if (!response.ok) throw new Error(response.error ?? 'Could not send.');
    toast(
      `Attempted ${response.result.attempted}; sent ${response.result.sent}, failed ${response.result.failed}, ${response.result.remaining} remaining.`,
      { tone: response.result.failed > 0 ? 'error' : 'success', timeout: 5000 },
    );
    await load();
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not send.', { tone: 'error' });
  } finally {
    setBusy(elements.sendNow, false);
  }
}

async function clearLogs(): Promise<void> {
  setBusy(elements.clearConfirm, true);
  try {
    const response = await clearLogsRequest();
    if (!response.ok) throw new Error(response.error ?? 'Could not clear logs.');
    closeDialog(elements.clearDialog);
    toast('All logs cleared.', { tone: 'success' });
    await load();
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not clear logs.', { tone: 'error' });
  } finally {
    setBusy(elements.clearConfirm, false);
  }
}

async function resetAll(): Promise<void> {
  setBusy(elements.resetConfirm, true);
  try {
    const defaults = normalizeSettings(undefined);
    const response = await saveSettingsRequest(defaults);
    if (!response.ok) throw new Error(response.error ?? 'Could not reset settings.');
    closeDialog(elements.resetDialog);
    toast('Settings reset to defaults.', { tone: 'success' });
    elements.welcome.hidden = true;
    await load();
    setSaveStatus('Settings reset to defaults.');
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not reset settings.', { tone: 'error' });
  } finally {
    setBusy(elements.resetConfirm, false);
  }
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void save();
});
elements.form.addEventListener('input', () => {
  if (!rendering) setDirty(true);
});
elements.form.addEventListener('change', () => {
  if (!rendering) setDirty(true);
});
elements.autosendEnabled.addEventListener('change', () => {
  syncAutoSendState();
});
elements.endpoint.addEventListener(
  'input',
  debounce(() => {
    void updatePermissionUi();
  }, 220),
);
elements.grantPageAccess.addEventListener('click', () => {
  void (async () => {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: PAGE_ORIGINS });
    } catch {
      granted = false;
    }
    toast(granted ? 'Site access granted.' : 'Site access was not granted.', { tone: granted ? 'success' : 'error' });
    await updatePermissionUi();
  })();
});
elements.removePageAccess.addEventListener('click', () => {
  void (async () => {
    try {
      await chrome.permissions.remove({ origins: PAGE_ORIGINS });
      toast('Site access removed. Page capture is paused.', { tone: 'info' });
    } catch {
      toast('Could not remove site access.', { tone: 'error' });
    }
    await updatePermissionUi();
  })();
});
elements.grantEndpoint.addEventListener('click', () => {
  void (async () => {
    const endpoint = elements.endpoint.value.trim();
    if (!isValidHttpsEndpoint(endpoint)) {
      toast('Enter a valid HTTPS endpoint first.', { tone: 'error' });
      return;
    }
    let granted = false;
    try {
      const origin = new URL(endpoint).origin;
      granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    } catch {
      granted = false;
    }
    toast(granted ? 'Endpoint approved.' : 'Endpoint permission was not granted.', {
      tone: granted ? 'success' : 'error',
    });
    await updatePermissionUi();
  })();
});
elements.preview.addEventListener('click', () => void preview());
elements.sendNow.addEventListener('click', () => void sendNow());
elements.clearLogs.addEventListener('click', () => showDialog(elements.clearDialog));
elements.clearCancel.addEventListener('click', () => closeDialog(elements.clearDialog));
elements.clearConfirm.addEventListener('click', () => void clearLogs());
elements.resetSettings.addEventListener('click', () => showDialog(elements.resetDialog));
elements.resetCancel.addEventListener('click', () => closeDialog(elements.resetDialog));
elements.resetConfirm.addEventListener('click', () => void resetAll());
elements.resetButton.addEventListener('click', () => {
  renderForm(settings);
  toast('Form reset to the saved settings.', { tone: 'info' });
});
elements.viewLogs.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('logs.html?source=options'), active: true });
});
elements.previewClose.addEventListener('click', () => closeDialog(elements.previewDialog));
elements.previewCopy.addEventListener('click', () => {
  void copyText(previewPayloadText).then((copied) => {
    toast(copied ? 'Payload copied.' : 'Could not copy the payload.', { tone: copied ? 'success' : 'error' });
  });
});
elements.previewDownload.addEventListener('click', () => {
  downloadText(previewPayloadText, `log-lens-preview-${Date.now()}.json`, 'application/json');
});

watchStorage(
  debounce(() => {
    if (!dirty) void load();
    else void updateUsage();
  }, 300),
);

void load();
