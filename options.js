  // Options page JavaScript for Censr v2.4

  const LABELS = [
    { name: "FEMALE_GENITALIA_COVERED", exposed: false },
    { name: "FACE_FEMALE", exposed: false },
    { name: "BUTTOCKS_EXPOSED", exposed: true },
    { name: "FEMALE_BREAST_EXPOSED", exposed: true },
    { name: "FEMALE_GENITALIA_EXPOSED", exposed: true },
    { name: "MALE_BREAST_EXPOSED", exposed: true },
    { name: "ANUS_EXPOSED", exposed: true },
    { name: "FEET_EXPOSED", exposed: true },
    { name: "BELLY_COVERED", exposed: false },
    { name: "FEET_COVERED", exposed: false },
    { name: "ARMPITS_COVERED", exposed: false },
    { name: "ARMPITS_EXPOSED", exposed: true },
    { name: "FACE_MALE", exposed: false },
    { name: "BELLY_EXPOSED", exposed: true },
    { name: "MALE_GENITALIA_EXPOSED", exposed: true },
    { name: "ANUS_COVERED", exposed: false },
    { name: "FEMALE_BREAST_COVERED", exposed: false },
    { name: "BUTTOCKS_COVERED", exposed: false }
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    censorLabels: [
      "FEMALE_GENITALIA_COVERED", "FEMALE_GENITALIA_EXPOSED",
      "FEMALE_BREAST_COVERED", "FEMALE_BREAST_EXPOSED",
      "BUTTOCKS_EXPOSED", "BUTTOCKS_COVERED",
      "ANUS_EXPOSED", "ANUS_COVERED",
      "MALE_GENITALIA_EXPOSED"
    ],
    confidence: 15,
    censorStyle: 'black',
    useCustomLabels: false,
    customLabels: {},
    useImageOverlay: false,
    overlayImages: [],
    useVideoOverlay: false,
    overlayVideos: [],
    hideLabels: true,
    boxSizeMultiplier: 1.0,
    frameInterval: 11,
    boxBorderColor: '#ff0000',
    boxBorderOpacity: 0,
    labelBgColor: '#000000',
    labelTextColor: '#ffffff',
    blurPower: 10,
    metronomeEnabled: false,
    metronomeBpm: 120,
    metronomeVolume: 50,
    uiTheme: 'black',
    initialBlurEnabled: false,
    wordOverlayEnabled: false,
    wordOverlayWords: 'CENSORED,DENIED,BLOCKED,NO',
    wordOverlayColors: '#ff0000,#9b00ff,#ff00aa,#ff4400'
  };

  let currentSettings = { ...DEFAULT_SETTINGS };

  // Audio context for metronome test
  let audioCtx = null;

  function playMetronomeSound(volume = 50) {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.value = volume / 100 * 0.5;
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
    
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.1);
  }


  function applyTheme(theme) {
    const t = theme || 'black';
    document.body.setAttribute('data-theme', t);
  }

  function updateWordPreview() {
    const preview = document.getElementById('wordPreview');
    if (!preview) return;
    const words = (currentSettings.wordOverlayWords || 'CENSORED').split(',').map(s => s.trim()).filter(s => s);
    const colors = (currentSettings.wordOverlayColors || '#ff0000').split(',').map(s => s.trim()).filter(s => s);
    const word = words[0] || 'CENSORED';
    const color = colors[0] || '#ff0000';
    preview.textContent = word;
    preview.style.color = color;
    preview.style.textShadow = `0 0 10px ${color}`;
  }

  function showStatus(message, isError = false) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = 'status show' + (isError ? ' error' : '');
    setTimeout(() => status.className = 'status', 3000);
  }

  async function loadSettings() {
    const result = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    currentSettings = { ...DEFAULT_SETTINGS, ...result };
    populateUI();
  }

  function populateUI() {
    // General
    document.getElementById('enabled').checked = currentSettings.enabled;
    document.getElementById('confidence').value = currentSettings.confidence;
    document.getElementById('confidenceValue').textContent = currentSettings.confidence + '%';
    document.getElementById('censorStyle').value = currentSettings.censorStyle;
    
    // Theme
    document.getElementById('uiTheme').value = currentSettings.uiTheme || 'pink';
    applyTheme(currentSettings.uiTheme);
    document.getElementById('uiTheme').addEventListener('change', (e) => {
      currentSettings.uiTheme = e.target.value;
      applyTheme(currentSettings.uiTheme);
    });

    // Display options
    document.getElementById('hideLabels').checked = currentSettings.hideLabels || false;
    document.getElementById('boxSizeMultiplier').value = currentSettings.boxSizeMultiplier || 1.0;
    document.getElementById('boxSizeValue').textContent = (currentSettings.boxSizeMultiplier || 1.0) + 'x';
    document.getElementById('blurPower').value = currentSettings.blurPower || 10;
    document.getElementById('blurPowerValue').textContent = currentSettings.blurPower || 10;
    
    // Colors
    document.getElementById('boxBorderColor').value = currentSettings.boxBorderColor || '#ff0000';
    document.getElementById('boxBorderHex').textContent = currentSettings.boxBorderColor || '#ff0000';
    const bbo = currentSettings.boxBorderOpacity ?? 0;
    document.getElementById('boxBorderOpacity').value = bbo;
    document.getElementById('boxBorderOpacityValue').textContent = Math.round(bbo * 100) + '%';
    document.getElementById('labelBgColor').value = currentSettings.labelBgColor || '#000000';
    document.getElementById('labelBgHex').textContent = currentSettings.labelBgColor || '#000000';
    document.getElementById('labelTextColor').value = currentSettings.labelTextColor || '#ffffff';
    document.getElementById('labelTextHex').textContent = currentSettings.labelTextColor || '#ffffff';
    
    // Video & GIF settings
    document.getElementById('frameInterval').value = currentSettings.frameInterval || 11;
    document.getElementById('frameIntervalValue').textContent = (currentSettings.frameInterval || 11) + 'ms';
    
    // Metronome
    document.getElementById('metronomeEnabled').checked = currentSettings.metronomeEnabled || false;
    document.getElementById('metronomeBpm').value = currentSettings.metronomeBpm || 120;
    document.getElementById('metronomeBpmValue').textContent = currentSettings.metronomeBpm || 120;
    document.getElementById('metronomeVolume').value = currentSettings.metronomeVolume !== undefined ? currentSettings.metronomeVolume : 50;
    document.getElementById('metronomeVolumeValue').textContent = (currentSettings.metronomeVolume !== undefined ? currentSettings.metronomeVolume : 50) + '%';
    
    // Custom labels toggle
    document.getElementById('useCustomLabels').checked = currentSettings.useCustomLabels || false;
    
    // Image overlay
    document.getElementById('useImageOverlay').checked = currentSettings.useImageOverlay || false;
    
    // Video overlay
    document.getElementById('useVideoOverlay').checked = currentSettings.useVideoOverlay || false;
    
    // Initial blur
    document.getElementById('initialBlurEnabled').checked = currentSettings.initialBlurEnabled === true;
    
    // Word overlay
    document.getElementById('wordOverlayEnabled').checked = currentSettings.wordOverlayEnabled || false;
    document.getElementById('wordOverlayWords').value = currentSettings.wordOverlayWords || 'CENSORED,DENIED,BLOCKED,NO';
    document.getElementById('wordOverlayColors').value = currentSettings.wordOverlayColors || '#ff0000,#9b00ff,#ff00aa,#ff4400';
    updateWordPreview();
    
    // Populate label grid
    populateLabelGrid();
    populateCustomLabelGrid();
    populateImageGrid();
    populateVideoGrid();
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

  function populateLabelGrid() {
    const grid = document.getElementById('labelGrid');
    grid.innerHTML = '';
    
    LABELS.forEach(label => {
      const div = document.createElement('div');
      div.className = `label-item ${label.exposed ? 'exposed' : 'covered'}`;
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `label_${label.name}`;
      checkbox.checked = currentSettings.censorLabels.includes(label.name);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (!currentSettings.censorLabels.includes(label.name)) {
            currentSettings.censorLabels.push(label.name);
          }
        } else {
          currentSettings.censorLabels = currentSettings.censorLabels.filter(l => l !== label.name);
        }
      });
      
      const icon = document.createElement('span');
      icon.className = 'label-icon';
      icon.textContent = getLabelIcon(label.name);

      const labelEl = document.createElement('span');
      labelEl.className = 'label-name';
      labelEl.textContent = label.name.replace(/_/g, ' ');
      
      div.appendChild(checkbox);
      div.appendChild(icon);
      div.appendChild(labelEl);
      grid.appendChild(div);
    });
  }

  function populateCustomLabelGrid() {
    const grid = document.getElementById('customLabelGrid');
    grid.innerHTML = '';
    
    LABELS.forEach(label => {
      const div = document.createElement('div');
      div.className = 'custom-label-item';
      
      const labelEl = document.createElement('label');
      labelEl.textContent = label.name.replace(/_/g, ' ');
      
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Custom text or emoji...';
      input.value = currentSettings.customLabels[label.name] || '';
      input.addEventListener('input', () => {
        currentSettings.customLabels[label.name] = input.value;
      });
      
      div.appendChild(labelEl);
      div.appendChild(input);
      grid.appendChild(div);
    });
  }

  function populateImageGrid() {
    const grid = document.getElementById('imageGrid');
    grid.innerHTML = '';
    
    (currentSettings.overlayImages || []).forEach((src, index) => {
      const div = document.createElement('div');
      div.className = 'image-item';
      
      const img = document.createElement('img');
      img.src = src;
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => {
        currentSettings.overlayImages.splice(index, 1);
        populateImageGrid();
      });
      
      div.appendChild(img);
      div.appendChild(deleteBtn);
      grid.appendChild(div);
    });
  }

  function populateVideoGrid() {
    const grid = document.getElementById('videoGrid');
    grid.innerHTML = '';
    
    (currentSettings.overlayVideos || []).forEach((src, index) => {
      const div = document.createElement('div');
      div.className = 'image-item';
      
      const video = document.createElement('video');
      video.src = src;
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => {
        currentSettings.overlayVideos.splice(index, 1);
        populateVideoGrid();
      });
      
      div.appendChild(video);
      div.appendChild(deleteBtn);
      grid.appendChild(div);
    });
  }

  function fileToDataUri(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function saveSettings() {
    await chrome.storage.local.set(currentSettings);
    
    // Notify all tabs
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_UPDATED',
          settings: currentSettings
        });
      } catch (e) {
        // Tab doesn't have content script
      }
    }
    
    showStatus('Settings saved!');
  }

  function exportSettings() {
    const blob = new Blob([JSON.stringify(currentSettings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'censr-settings.json';
    a.click();
    URL.revokeObjectURL(url);
    showStatus('Settings exported!');
  }

  function importSettings(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        currentSettings = { ...DEFAULT_SETTINGS, ...imported };
        populateUI();
        showStatus('Settings imported!');
      } catch (err) {
        showStatus('Invalid settings file!', true);
      }
    };
    reader.readAsText(file);
  }

  function resetSettings() {
    if (confirm('Reset all settings to defaults?')) {
      currentSettings = { ...DEFAULT_SETTINGS };
      populateUI();
      showStatus('Settings reset to defaults!');
    }
  }

  // Event listeners
  document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    
    // General settings
    document.getElementById('enabled').addEventListener('change', (e) => {
      currentSettings.enabled = e.target.checked;
    });
    
    document.getElementById('confidence').addEventListener('input', (e) => {
      document.getElementById('confidenceValue').textContent = e.target.value + '%';
    });
    
    document.getElementById('confidence').addEventListener('change', (e) => {
      currentSettings.confidence = parseInt(e.target.value);
    });
    
    document.getElementById('censorStyle').addEventListener('change', (e) => {
      currentSettings.censorStyle = e.target.value;
    });
    
    // Theme
    document.getElementById('uiTheme').value = currentSettings.uiTheme || 'pink';
    applyTheme(currentSettings.uiTheme);
    document.getElementById('uiTheme').addEventListener('change', (e) => {
      currentSettings.uiTheme = e.target.value;
      applyTheme(currentSettings.uiTheme);
    });

    // Display options
    document.getElementById('hideLabels').addEventListener('change', (e) => {
      currentSettings.hideLabels = e.target.checked;
    });
    
    document.getElementById('boxSizeMultiplier').addEventListener('input', (e) => {
      document.getElementById('boxSizeValue').textContent = e.target.value + 'x';
    });
    
    document.getElementById('boxSizeMultiplier').addEventListener('change', (e) => {
      currentSettings.boxSizeMultiplier = parseFloat(e.target.value);
    });
    
    document.getElementById('blurPower').addEventListener('input', (e) => {
      document.getElementById('blurPowerValue').textContent = e.target.value;
    });
    
    document.getElementById('blurPower').addEventListener('change', (e) => {
      currentSettings.blurPower = parseInt(e.target.value);
    });
    
    // Colors
    document.getElementById('boxBorderColor').addEventListener('input', (e) => {
      document.getElementById('boxBorderHex').textContent = e.target.value;
      currentSettings.boxBorderColor = e.target.value;
    });
    
    document.getElementById('boxBorderOpacity').addEventListener('input', (e) => {
      document.getElementById('boxBorderOpacityValue').textContent = Math.round(parseFloat(e.target.value) * 100) + '%';
    });
    
    document.getElementById('boxBorderOpacity').addEventListener('change', (e) => {
      currentSettings.boxBorderOpacity = parseFloat(e.target.value);
    });
    
    document.getElementById('labelBgColor').addEventListener('input', (e) => {
      document.getElementById('labelBgHex').textContent = e.target.value;
      currentSettings.labelBgColor = e.target.value;
    });
    
    document.getElementById('labelTextColor').addEventListener('input', (e) => {
      document.getElementById('labelTextHex').textContent = e.target.value;
      currentSettings.labelTextColor = e.target.value;
    });
    
    // Frame interval
    document.getElementById('frameInterval').addEventListener('input', (e) => {
      document.getElementById('frameIntervalValue').textContent = e.target.value + 'ms';
    });
    
    document.getElementById('frameInterval').addEventListener('change', (e) => {
      currentSettings.frameInterval = parseInt(e.target.value);
    });
    
    // Metronome
    document.getElementById('metronomeEnabled').addEventListener('change', (e) => {
      currentSettings.metronomeEnabled = e.target.checked;
    });
    
    document.getElementById('metronomeBpm').addEventListener('input', (e) => {
      document.getElementById('metronomeBpmValue').textContent = e.target.value;
    });
    
    document.getElementById('metronomeBpm').addEventListener('change', (e) => {
      currentSettings.metronomeBpm = parseInt(e.target.value);
    });
    
    document.getElementById('metronomeVolume').addEventListener('input', (e) => {
      document.getElementById('metronomeVolumeValue').textContent = e.target.value + '%';
    });
    
    document.getElementById('metronomeVolume').addEventListener('change', (e) => {
      currentSettings.metronomeVolume = parseInt(e.target.value);
    });
    
    document.getElementById('testMetronome').addEventListener('click', () => {
      playMetronomeSound(currentSettings.metronomeVolume);
    });
    
    // Custom labels toggle
    document.getElementById('useCustomLabels').addEventListener('change', (e) => {
      currentSettings.useCustomLabels = e.target.checked;
    });
    
    // Initial blur
    document.getElementById('initialBlurEnabled').addEventListener('change', (e) => {
      currentSettings.initialBlurEnabled = e.target.checked;
    });
    
    // Word overlay
    document.getElementById('wordOverlayEnabled').addEventListener('change', (e) => {
      currentSettings.wordOverlayEnabled = e.target.checked;
    });
    
    document.getElementById('wordOverlayWords').addEventListener('input', (e) => {
      currentSettings.wordOverlayWords = e.target.value;
      updateWordPreview();
    });
    
    document.getElementById('wordOverlayColors').addEventListener('input', (e) => {
      currentSettings.wordOverlayColors = e.target.value;
      updateWordPreview();
    });
    
    // Image overlay
    document.getElementById('useImageOverlay').addEventListener('change', (e) => {
      currentSettings.useImageOverlay = e.target.checked;
    });
    
    document.getElementById('imageInput').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      for (const file of files) {
        try {
          const dataUri = await fileToDataUri(file);
          if (!currentSettings.overlayImages) currentSettings.overlayImages = [];
          currentSettings.overlayImages.push(dataUri);
        } catch (err) {
          console.error('Failed to load image:', err);
        }
      }
      populateImageGrid();
      e.target.value = '';
    });
    
    // Video overlay
    document.getElementById('useVideoOverlay').addEventListener('change', (e) => {
      currentSettings.useVideoOverlay = e.target.checked;
    });
    
    document.getElementById('videoInput').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) {
          showStatus('Video too large! Keep under 10MB.', true);
          continue;
        }
        try {
          const dataUri = await fileToDataUri(file);
          if (!currentSettings.overlayVideos) currentSettings.overlayVideos = [];
          currentSettings.overlayVideos.push(dataUri);
        } catch (err) {
          console.error('Failed to load video:', err);
        }
      }
      populateVideoGrid();
      e.target.value = '';
    });
    
    // Actions
    document.getElementById('saveBtn').addEventListener('click', saveSettings);
    document.getElementById('exportBtn').addEventListener('click', exportSettings);
    document.getElementById('importBtn').addEventListener('click', () => {
      document.getElementById('importInput').click();
    });
    document.getElementById('importInput').addEventListener('change', (e) => {
      if (e.target.files[0]) {
        importSettings(e.target.files[0]);
        e.target.value = '';
      }
    });
    document.getElementById('resetBtn').addEventListener('click', resetSettings);
  });
