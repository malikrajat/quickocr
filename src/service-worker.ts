// Removed tesseract.js import - OCR now handled in offscreen document

interface OCRMessage {
  type: 'START_SELECTION' | 'PROCESS_OCR' | 'GET_SETTINGS' | 'UPDATE_SETTINGS' | 'CAPTURE_TAB';
  imageData?: string;
  settings?: UserSettings;
}

interface UserSettings {
  language: string;
  engineMode: 'fast' | 'accurate';
  confidenceThreshold: number;
  cloudOCREnabled: boolean;
  cloudOCRConsent: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  language: 'eng',
  engineMode: 'fast',
  confidenceThreshold: 60,
  cloudOCREnabled: false,
  cloudOCRConsent: false,
};

// Initialize context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ocr-selection',
    title: 'QuickOCR - Extract Text',
    contexts: ['page'],
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ocr-selection' && tab?.id) {
    injectContentScript(tab.id);
  }
});

// Handle toolbar button click
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    injectContentScript(tab.id);
  }
});

async function injectContentScript(tabId: number) {
  try {
    // Check if already injected
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window as any).__OCR_SELECTION_LOADED__,
    });
    
    if (results && results[0]?.result) {
      console.log('Content script already injected, skipping...');
      return;
    }
    
    // Inject the content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-selection.js'],
    });
  } catch (error) {
    console.error('Failed to inject content script:', error);
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message: OCRMessage, sender, sendResponse) => {
  console.log('Service worker received message:', message.type);
  
  if (message.type === 'PROCESS_OCR' && message.imageData) {
    processOCR(message.imageData)
      .then((result) => {
        console.log('Service worker sending OCR result:', result);
        sendResponse(result);
      })
      .catch((error) => {
        console.error('Service worker OCR error:', error);
        sendResponse({ text: '', confidence: 0, error: error.message });
      });
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'GET_SETTINGS') {
    getSettings().then(sendResponse);
    return true;
  }
  
  if (message.type === 'UPDATE_SETTINGS' && message.settings) {
    updateSettings(message.settings).then(sendResponse);
    return true;
  }

  if (message.type === 'CAPTURE_TAB') {
    captureTab(sender.tab?.id).then(sendResponse);
    return true;
  }
});

async function captureTab(tabId?: number): Promise<{ dataUrl: string }> {
  try {
    console.log('Capturing visible tab...');
    // captureVisibleTab captures the active tab in the current window
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
    console.log('Tab captured successfully, data URL length:', dataUrl.length);
    return { dataUrl };
  } catch (error) {
    console.error('Failed to capture tab:', error);
    throw new Error(`Capture failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get('ocrSettings');
  return (result.ocrSettings as UserSettings) || DEFAULT_SETTINGS;
}

async function updateSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.local.set({ ocrSettings: settings });
}

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS' as chrome.offscreen.Reason],
    justification: 'OCR processing using Tesseract.js requires Web Workers',
  });
}

async function processOCR(imageData: string): Promise<{ text: string; confidence: number }> {
  try {
    console.log('Starting OCR processing...');
    const settings = await getSettings();
    console.log('Using language:', settings.language);
    
    // Ensure offscreen document exists
    await ensureOffscreenDocument();
    console.log('Offscreen document ready');
    
    // Send OCR request to offscreen document
    const response = await chrome.runtime.sendMessage({
      type: 'PROCESS_OCR',
      imageData,
      language: settings.language,
    });
    
    console.log('Received response from offscreen:', response);
    
    if (!response) {
      throw new Error('No response from offscreen document');
    }
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    console.log('OCR complete, text length:', response.text?.length || 0, 'confidence:', response.confidence);
    
    return {
      text: response.text || 'No text detected',
      confidence: response.confidence || 0,
    };
  } catch (error) {
    console.error('OCR processing failed:', error);
    throw new Error(`OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
