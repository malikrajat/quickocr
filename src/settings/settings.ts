// Settings page logic
interface UserSettings {
  language: string;
  engineMode: 'fast' | 'accurate';
  confidenceThreshold: number;
  cloudOCREnabled: boolean;
  cloudOCRConsent: boolean;
}

const SETTINGS_DEFAULTS: UserSettings = {
  language: 'eng',
  engineMode: 'fast',
  confidenceThreshold: 60,
  cloudOCREnabled: false,
  cloudOCRConsent: false,
};

// DOM elements
const languageSelect = document.getElementById('language') as HTMLSelectElement;
const engineModeSelect = document.getElementById('engineMode') as HTMLSelectElement;
const confidenceInput = document.getElementById('confidenceThreshold') as HTMLInputElement;
const cloudOCRCheckbox = document.getElementById('cloudOCREnabled') as HTMLInputElement;
const cloudWarning = document.getElementById('cloudWarning') as HTMLDivElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
const clearDataBtn = document.getElementById('clearDataBtn') as HTMLButtonElement;

// Load settings on page load
async function loadSettings() {
  const result = await chrome.storage.local.get('ocrSettings');
  const settings: UserSettings = (result.ocrSettings as UserSettings) || SETTINGS_DEFAULTS;
  
  languageSelect.value = settings.language;
  engineModeSelect.value = settings.engineMode;
  confidenceInput.value = settings.confidenceThreshold.toString();
  cloudOCRCheckbox.checked = settings.cloudOCREnabled;
  
  updateCloudWarning();
}

// Update cloud warning visibility
function updateCloudWarning() {
  cloudWarning.style.display = cloudOCRCheckbox.checked ? 'block' : 'none';
}

// Save settings
async function saveSettings() {
  const settings: UserSettings = {
    language: languageSelect.value,
    engineMode: engineModeSelect.value as 'fast' | 'accurate',
    confidenceThreshold: parseInt(confidenceInput.value),
    cloudOCREnabled: cloudOCRCheckbox.checked,
    cloudOCRConsent: cloudOCRCheckbox.checked,
  };
  
  await chrome.storage.local.set({ ocrSettings: settings });
  showToast('Settings saved successfully!');
}

// Reset to defaults
async function resetSettings() {
  if (confirm('Reset all settings to defaults?')) {
    await chrome.storage.local.set({ ocrSettings: SETTINGS_DEFAULTS });
    await loadSettings();
    showToast('Settings reset to defaults');
  }
}

// Clear all data
async function clearAllData() {
  if (confirm('Clear all stored data? This cannot be undone.')) {
    await chrome.storage.local.clear();
    await loadSettings();
    showToast('All data cleared');
  }
}

// Show toast notification
function showToast(message: string) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Event listeners
cloudOCRCheckbox.addEventListener('change', updateCloudWarning);
saveBtn.addEventListener('click', saveSettings);
resetBtn.addEventListener('click', resetSettings);
clearDataBtn.addEventListener('click', clearAllData);

// Initialize
loadSettings();
