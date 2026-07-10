// Popup JavaScript for Censr v2.7 - Beautiful layout with auto-save

const LABELS = [
  { id: 0, name: "FEMALE_GENITALIA_COVERED", display: "Female Genitalia (Covered)", exposed: false },
  { id: 1, name: "FACE_FEMALE", display: "Face (Female)", exposed: false },
  { id: 2, name: "BUTTOCKS_EXPOSED", display: "Buttocks (Exposed)", exposed: true },
  { id: 3, name: "FEMALE_BREAST_EXPOSED", display: "Female Breast (Exposed)", exposed: true },
  { id: 4, name: "FEMALE_GENITALIA_EXPOSED", display: "Female Genitalia (Exposed)", exposed: true },
  { id: 5, name: "MALE_BREAST_EXPOSED", display: "Male Breast (Exposed)", exposed: true },
  { id: 6, name: "ANUS_EXPOSED", display: "Anus (Exposed)", exposed: true },
  { id: 7, name: "FEET_EXPOSED", display: "Feet (Exposed)", exposed: true },
  { id: 8, name: "BELLY_COVERED", display: "Belly (Covered)", exposed: false },
  { id: 9, name: "FEET_COVERED", display: "Feet (Covered)", exposed: false },
  { id: 10, name: "ARMPITS_COVERED", display: "Armpits (Covered)", exposed: false },
  { id: 11, name: "ARMPITS_EXPOSED", display: "Armpits (Exposed)", exposed: true },
  { id: 12, name: "FACE_MALE", display: "Face (Male)", exposed: false },
  { id: 13, name: "BELLY_EXPOSED", display: "Belly (Exposed)", exposed: true },
  { id: 14, name: "MALE_GENITALIA_EXPOSED", display: "Male Genitalia (Exposed)", exposed: true },
  { id: 15, name: "ANUS_COVERED", display: "Anus (Covered)", exposed: false },
  { id: 16, name: "FEMALE_BREAST_COVERED", display: "Female Breast (Covered)", exposed: false },
  { id: 17, name: "BUTTOCKS_COVERED", display: "Buttocks (Covered)", exposed: false }
];

const DEFAULT_ENABLED = [
  "FEMALE_GENITALIA_COVERED", "FEMALE_GENITALIA_EXPOSED",
  "FEMALE_BREAST_COVERED", "FEMALE_BREAST_EXPOSED",
  "BUTTOCKS_EXPOSED", "BUTTOCKS_COVERED",
  "ANUS_EXPOSED", "ANUS_COVERED",
  "MALE_GENITALIA_EXPOSED"
];

async function loadSettings() {
  const result = await chrome.storage.local.get(null);
  return {
    enabled: result.enabled !== undefined ? result.enabled : true,
    censorLabels: result.censorLabels || DEFAULT_ENABLED,
    confidence: result.confidence !== undefined ? result.confidence : 15,
    censorStyle: result.censorStyle || 'black',
    useCustomLabels: result.useCustomLabels || false,
    customLabels: result.customLabels || {},
    useImageOverlay: result.useImageOverlay || false,
    initialBlurEnabled: result.initialBlurEnabled === true,
    overlayImages: result.overlayImages || [],
    hideLabels: result.hideLabels !== undefined ? result.hideLabels : true,
    boxSizeMultiplier: result.boxSizeMultiplier || 1.0,
    frameInterval: result.frameInterval || 150,
    uiTheme: result.uiTheme || 'black'
  };
}

const LABEL_ICONS = {
  "FEMALE_GENITALIA_COVERED":"🩲","FEMALE_GENITALIA_EXPOSED":"🔻",
  "FEMALE_BREAST_COVERED":"👙","FEMALE_BREAST_EXPOSED":"🍒",
  "BUTTOCKS_COVERED":"🍑","BUTTOCKS_EXPOSED":"🍑",
  "ANUS_COVERED":"⭕","ANUS_EXPOSED":"⭕",
  "BELLY_COVERED":"🫄","BELLY_EXPOSED":"🫃",
  "FEET_COVERED":"👟","FEET_EXPOSED":"🦶",
  "ARMPITS_COVERED":"💪","ARMPITS_EXPOSED":"💪",
  "FACE_FEMALE":"👩","FACE_MALE":"👨",
  "MALE_BREAST_EXPOSED":"👤","MALE_GENITALIA_EXPOSED":"🍆"
};
function getLabelIcon(n) { return LABEL_ICONS[n] || "❓"; }

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme || 'black');
}

async function saveSettings(settings) {
  await chrome.storage.local.set(settings);
  // Notify content scripts
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_UPDATED', settings });
    }
  } catch (e) {}
}

function createToggleItem(label, isEnabled) {
  const div = document.createElement('div');
  div.className = `toggle-item ${label.exposed ? 'exposed' : 'covered'}`;
  div.innerHTML = `
    <div class="toggle-label">
      <span class="toggle-icon">${getLabelIcon(label.name)}</span>
      <label for="toggle-${label.id}">${label.display}</label>
    </div>
    <label class="switch">
      <input type="checkbox" id="toggle-${label.id}" data-label="${label.name}" ${isEnabled ? 'checked' : ''}>
      <span class="slider"></span>
    </label>
  `;
  return div;
}

async function init() {
  const settings = await loadSettings();
  applyTheme(settings.uiTheme);
  
  document.getElementById('masterToggle').checked = settings.enabled;
  document.getElementById('confidenceSlider').value = settings.confidence;
  document.getElementById('confidenceValue').textContent = settings.confidence + '%';
  document.getElementById('censorStyle').value = settings.censorStyle || 'black';
  document.getElementById('useCustomLabels').checked = settings.useCustomLabels || false;
  document.getElementById('useImageOverlay').checked = settings.useImageOverlay || false;
  document.getElementById('initialBlurEnabled').checked = settings.initialBlurEnabled === true;
  
  const exposedGroup = document.getElementById('exposedGroup');
  const coveredGroup = document.getElementById('coveredGroup');
  
  LABELS.forEach(label => {
    const isEnabled = settings.censorLabels.includes(label.name);
    const toggle = createToggleItem(label, isEnabled);
    if (label.exposed) exposedGroup.appendChild(toggle);
    else coveredGroup.appendChild(toggle);
  });
  
  updateStatus('Ready', 'ready');
  
  // Master toggle
  document.getElementById('masterToggle').addEventListener('change', async (e) => {
    const newSettings = await loadSettings();
    newSettings.enabled = e.target.checked;
    await saveSettings(newSettings);
    updateStatus(e.target.checked ? '✓ Enabled' : '⏸ Disabled', 'ready');
  });
  
  // Confidence
  document.getElementById('confidenceSlider').addEventListener('input', (e) => {
    document.getElementById('confidenceValue').textContent = e.target.value + '%';
  });
  document.getElementById('confidenceSlider').addEventListener('change', async (e) => {
    const newSettings = await loadSettings();
    newSettings.confidence = parseInt(e.target.value);
    await saveSettings(newSettings);
    updateStatus('Confidence: ' + e.target.value + '%', 'ready');
  });
  
  // Censor style
  document.getElementById('censorStyle').addEventListener('change', async (e) => {
    const newSettings = await loadSettings();
    newSettings.censorStyle = e.target.value;
    await saveSettings(newSettings);
    updateStatus('Style: ' + e.target.value, 'ready');
  });
  
  // Custom labels
  document.getElementById('useCustomLabels').addEventListener('change', async (e) => {
    const newSettings = await loadSettings();
    newSettings.useCustomLabels = e.target.checked;
    await saveSettings(newSettings);
  });
  
  // Image overlay
  document.getElementById('useImageOverlay').addEventListener('change', async (e) => {
    const newSettings = await loadSettings();
    newSettings.useImageOverlay = e.target.checked;
    await saveSettings(newSettings);
  });
  
  // Initial blur
  document.getElementById('initialBlurEnabled').addEventListener('change', async (e) => {
    const newSettings = await loadSettings();
    newSettings.initialBlurEnabled = e.target.checked;
    await saveSettings(newSettings);
  });
  
  // Label toggles
  document.querySelectorAll('[data-label]').forEach(checkbox => {
    checkbox.addEventListener('change', async (e) => {
      const labelName = e.target.dataset.label;
      const newSettings = await loadSettings();
      if (e.target.checked) {
        if (!newSettings.censorLabels.includes(labelName)) {
          newSettings.censorLabels.push(labelName);
        }
      } else {
        newSettings.censorLabels = newSettings.censorLabels.filter(l => l !== labelName);
      }
      await saveSettings(newSettings);
    });
  });
  
  // Quick actions
  document.getElementById('selectAll').addEventListener('click', async () => {
    const allLabels = LABELS.map(l => l.name);
    document.querySelectorAll('[data-label]').forEach(cb => cb.checked = true);
    const newSettings = await loadSettings();
    newSettings.censorLabels = allLabels;
    await saveSettings(newSettings);
    updateStatus('All selected', 'ready');
  });
  
  document.getElementById('selectExposed').addEventListener('click', async () => {
    const exposedLabels = LABELS.filter(l => l.exposed).map(l => l.name);
    document.querySelectorAll('[data-label]').forEach(cb => {
      cb.checked = exposedLabels.includes(cb.dataset.label);
    });
    const newSettings = await loadSettings();
    newSettings.censorLabels = exposedLabels;
    await saveSettings(newSettings);
    updateStatus('Exposed only', 'ready');
  });
  
  document.getElementById('selectNone').addEventListener('click', async () => {
    document.querySelectorAll('[data-label]').forEach(cb => cb.checked = false);
    const newSettings = await loadSettings();
    newSettings.censorLabels = [];
    await saveSettings(newSettings);
    updateStatus('All cleared', 'ready');
  });
  
  // Rescan
  document.getElementById('rescanBtn').addEventListener('click', async () => {
    updateStatus('Scanning...', 'loading');
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'RESCAN_PAGE' }, (response) => {
          if (chrome.runtime.lastError) {
            updateStatus('Refresh page first', '');
          } else if (response?.success) {
            updateStatus(`Found ${response.imageCount} items`, 'ready');
          }
        });
      }
    } catch (e) {
      updateStatus('Error', '');
    }
  });
  
  // Settings
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

function updateStatus(text, className = 'ready') {
  const status = document.getElementById('status');
  status.textContent = text;
  status.className = 'status ' + className;
}

document.addEventListener('DOMContentLoaded', init);
