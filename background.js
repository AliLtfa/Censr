/* License watermark: CENSR_METHOD_WM_v1_7f3c2d9a (see NOTICE.txt) */
const __CENSR_WM = 'CENSR_METHOD_WM_v1_7f3c2d9a';
// Background Service Worker for Censr Extension v3.0

const DEFAULT_SETTINGS = {
  enabled: true,
  censorLabels: [
    "FEMALE_GENITALIA_COVERED", "FEMALE_GENITALIA_EXPOSED",
    "FEMALE_BREAST_COVERED", "FEMALE_BREAST_EXPOSED",
    "BUTTOCKS_EXPOSED", "BUTTOCKS_COVERED",
    "ANUS_EXPOSED", "ANUS_COVERED",
    "MALE_GENITALIA_EXPOSED"
  ],
  confidence: 15, censorStyle: 'black',
  useCustomLabels: false, customLabels: {},
  useImageOverlay: false, overlayImages: [],
  useVideoOverlay: false, overlayVideos: [],
  hideLabels: true, boxSizeMultiplier: 1.0, frameInterval: 11,
  boxBorderColor: '#ff0000', boxBorderOpacity: 0, labelBgColor: '#000000', labelTextColor: '#ffffff',
  blurPower: 10, metronomeEnabled: false, metronomeBpm: 120, metronomeVolume: 50,
  uiTheme: 'black', initialBlurEnabled: false,
  wordOverlayEnabled: false,
  wordOverlayWords: 'CENSORED,DENIED,BLOCKED,NO',
  wordOverlayColors: '#ff0000,#9b00ff,#ff00aa,#ff4400'
};

let offscreenReady = false;

async function setupOffscreen() {
  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (!hasDoc) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['WORKERS'],
        justification: 'Run ONNX model inference'
      });
    }
    offscreenReady = true;
  } catch (e) { console.error('Offscreen setup error:', e); }
}

setupOffscreen();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.local.get(null).then(stored => {
      const result = { ...DEFAULT_SETTINGS };
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (stored[key] !== undefined) result[key] = stored[key];
      }
      sendResponse(result);
    });
    return true;
  }
  
  if (message.type === 'FETCH_IMAGE') {
    fetch(message.url, { credentials: 'omit' })
      .then(r => r.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ success: true, data: reader.result });
        reader.onerror = () => sendResponse({ success: false, error: 'Read failed' });
        reader.readAsDataURL(blob);
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.type === 'PRELOAD_MODEL') {
    if (!offscreenReady) {
      setupOffscreen().then(() => { setTimeout(() => sendResponse({ success: true }), 500); });
    } else {
      chrome.runtime.sendMessage({ type: 'INIT_MODEL' }).then(() => {
        sendResponse({ success: true });
      }).catch(() => { sendResponse({ success: true }); });
    }
    return true;
  }
  
  if (message.type === 'DETECT_IMAGE') {
    const doDetect = () => {
      chrome.runtime.sendMessage({
        type: 'DETECT_IMAGE', imageData: message.imageData,
        imgWidth: message.imgWidth, imgHeight: message.imgHeight,
        confidence: message.confidence
      }).then(response => {
        sendResponse(response || { success: false, error: 'No response' });
      }).catch(err => { sendResponse({ success: false, error: err.message }); });
    };
    if (!offscreenReady) { setupOffscreen().then(() => setTimeout(doDetect, 300)); }
    else { doDetect(); }
    return true;
  }
  
  if (message.type === 'DETECT_URL') {
    const doDetect = () => {
      chrome.runtime.sendMessage({
        type: 'DETECT_URL', url: message.url,
        imgWidth: message.imgWidth, imgHeight: message.imgHeight,
        confidence: message.confidence
      }).then(response => {
        sendResponse(response || { success: false, error: 'No response' });
      }).catch(err => { sendResponse({ success: false, error: err.message }); });
    };
    if (!offscreenReady) { setupOffscreen().then(() => setTimeout(doDetect, 300)); }
    else { doDetect(); }
    return true;
  }
  
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['censorLabels']).then(result => {
    if (!result.censorLabels) { chrome.storage.local.set(DEFAULT_SETTINGS); }
  });
});
