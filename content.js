/* License watermark: CENSR_METHOD_WM_v1_7f3c2d9a (see NOTICE.txt) */
const __CENSR_WM = 'CENSR_METHOD_WM_v1_7f3c2d9a';
// Content Script for Censr Extension v3.0.1
// HYBRID architecture: CSS backdrop-filter for images/GIFs (CORS-proof), GPU canvas for videos

(function() {
  'use strict';

  if (window.__censrInitialized) return;
  window.__censrInitialized = true;

  const MODEL_INPUT_SIZE = 320;
  const DEFAULT_FRAME_INTERVAL = 11;
  const MIN_IMAGE_SIZE = 20;
  const MAX_OVERLAY_DIVS = 12;
  
  let settings = {
    enabled: true,
    censorLabels: [],
    confidence: 15,
    censorStyle: 'black',
    customLabels: {},
    overlayImages: [],
    overlayVideos: [],
    useCustomLabels: false,
    useImageOverlay: false,
    useVideoOverlay: false,
    hideLabels: true,
    boxSizeMultiplier: 1.0,
    frameInterval: DEFAULT_FRAME_INTERVAL,
    boxBorderColor: '#ff0000',
    boxBorderOpacity: 0,
    labelBgColor: '#000000',
    labelTextColor: '#ffffff',
    blurPower: 10,
    metronomeEnabled: false,
    metronomeBpm: 120,
    metronomeVolume: 50,
    initialBlurEnabled: false,
    wordOverlayEnabled: false,
    wordOverlayWords: 'CENSORED,DENIED,BLOCKED,NO',
    wordOverlayColors: '#ff0000,#9b00ff,#ff00aa,#ff4400'
  };

  // State Maps
  let processedImagesMap = new WeakMap();
  let processedVideosMap = new WeakMap();
  let processedCanvasesMap = new WeakMap();
  let processedGifsMap = new WeakMap();
  
  const imageQueue = [];
  let loadedOverlayImages = [];
  let loadedOverlayVideos = [];
  const overlayImageCache = new Map();
  const overlayVideoCache = new Map();
  
  let audioCtx = null;
  let lastMetronomeTime = 0;

  // --- Styles ---
  const style = document.createElement('style');
  style.textContent = `
    .censr-canvas { position: absolute !important; top: 0 !important; left: 0 !important; pointer-events: none !important; z-index: 9999 !important; }
    .censr-pending { filter: blur(15px) !important; transition: filter 0.15s ease !important; }
    .censr-pending-none { filter: none !important; }
    .censr-processed { filter: none !important; }
    .censr-video-canvas { position: absolute !important; top: 0 !important; left: 0 !important; pointer-events: none !important; z-index: 9999 !important; }
    .censr-canvas-overlay { position: absolute !important; top: 0 !important; left: 0 !important; pointer-events: none !important; z-index: 9999 !important; }
    .censr-css-overlay { position: absolute !important; pointer-events: none !important; z-index: 9999 !important; overflow: hidden !important; }
    .censr-box { position: absolute !important; pointer-events: none !important; box-sizing: border-box !important; }
  `;
  const target = document.head || document.documentElement;
  if (target) {
    target.appendChild(style);
  } else {
    window.addEventListener('DOMContentLoaded', () => { document.head.appendChild(style); });
  }

  // --- Metronome ---
  function playMetronomeSound() {
    if (!settings.metronomeEnabled) return;
    const now = Date.now();
    const interval = 60000 / (settings.metronomeBpm || 120);
    if (now - lastMetronomeTime < interval) return;
    lastMetronomeTime = now;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 800;
      gain.gain.value = (settings.metronomeVolume || 50) / 100 * 0.3;
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {}
  }

  // --- Settings & Assets ---
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
        if (chrome.runtime.lastError) { resolve(settings); return; }
        if (response) {
          settings = { ...settings, ...response };
          if (settings.overlayImages?.length > 0) preloadOverlayImages();
          if (settings.overlayVideos?.length > 0) preloadOverlayVideos();
        }
        resolve(settings);
      });
    });
  }

  async function preloadOverlayImages() {
    loadedOverlayImages = [];
    for (const src of settings.overlayImages) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = src; });
        loadedOverlayImages.push(img);
      } catch (e) {}
    }
  }

  async function preloadOverlayVideos() {
    loadedOverlayVideos = [];
    for (const src of settings.overlayVideos) {
      try {
        const video = document.createElement('video');
        video.muted = true; video.loop = true; video.playsInline = true; video.src = src;
        await new Promise((r, e) => { video.onloadeddata = r; video.onerror = e; });
        loadedOverlayVideos.push(video);
      } catch (e) {}
    }
  }

  function getOverlayImage(key) {
    if (!loadedOverlayImages.length) return null;
    if (overlayImageCache.has(key)) return overlayImageCache.get(key);
    const img = loadedOverlayImages[Math.floor(Math.random() * loadedOverlayImages.length)];
    overlayImageCache.set(key, img);
    return img;
  }

  function getOverlayVideo(key) {
    if (!loadedOverlayVideos.length) return null;
    if (overlayVideoCache.has(key)) return overlayVideoCache.get(key);
    const vid = loadedOverlayVideos[Math.floor(Math.random() * loadedOverlayVideos.length)];
    overlayVideoCache.set(key, vid);
    return vid;
  }

  function getDisplayLabel(labelName) {
    if (settings.useCustomLabels && settings.customLabels?.[labelName]) {
      const options = settings.customLabels[labelName].split(',').map(s => s.trim()).filter(s => s);
      if (options.length > 0) return options[Math.floor(Math.random() * options.length)];
    }
    return labelName.replace(/_/g, ' ');
  }

  function isGifUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes('.gif') || lower.includes('image/gif');
  }

  function hexToRgba(hex, a = 1) {
    try {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    } catch (e) { return `rgba(255,0,0,${a})`; }
  }

  // --- CORS-resilient Image Loading ---
  // Domain-level CORS cache: once we know a domain is tainted, skip the canvas test
  const corsTaintedDomains = new Set();
  
  function getDomain(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  }

  function preprocessSource(source, sourceWidth, sourceHeight) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const maxSize = Math.max(sourceWidth, sourceHeight);
    const scale = MODEL_INPUT_SIZE / maxSize;
    canvas.width = MODEL_INPUT_SIZE;
    canvas.height = MODEL_INPUT_SIZE;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    ctx.drawImage(source, 0, 0, Math.round(sourceWidth * scale), Math.round(sourceHeight * scale));
    const imageData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    return { imageData: { data: Array.from(imageData.data), width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE } };
  }

  async function detect(source, sourceWidth, sourceHeight) {
    const url = source.currentSrc || source.src || '';
    const domain = getDomain(url);
    
    // For IMG elements: check if we need the URL fast-path
    if (source.tagName === 'IMG' && url && !url.startsWith('data:')) {
      const isKnownTainted = domain && corsTaintedDomains.has(domain);
      
      if (isKnownTainted) {
        // FAST PATH: Send URL directly to offscreen — no canvas, no fetch, one hop
        return detectViaUrl(url, sourceWidth, sourceHeight);
      }
      
      // Test if canvas is tainted
      try {
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(source, 0, 0, 1, 1);
        ctx.getImageData(0, 0, 1, 1);
        // Not tainted — use normal local preprocessing path
      } catch (e) {
        // Tainted — cache this domain and use URL fast-path
        if (domain) corsTaintedDomains.add(domain);
        return detectViaUrl(url, sourceWidth, sourceHeight);
      }
    }

    // LOCAL PATH: preprocess locally and send pixel data (same-origin images, videos)
    try {
      const { imageData } = preprocessSource(source, sourceWidth, sourceHeight);
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'DETECT_IMAGE', imageData, imgWidth: sourceWidth, imgHeight: sourceHeight, confidence: settings.confidence
        }, (response) => {
          if (chrome.runtime.lastError) { resolve([]); return; }
          if (response?.success) resolve(response.boxes);
          else resolve([]);
        });
      });
    } catch(e) {
      // If local preprocess fails (e.g. video CORS), try URL path
      if (url && !url.startsWith('data:') && !url.startsWith('blob:')) {
        return detectViaUrl(url, sourceWidth, sourceHeight);
      }
      return [];
    }
  }

  // URL fast-path: offscreen fetches, preprocesses, and infers — one round trip
  function detectViaUrl(url, imgWidth, imgHeight) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 8000); // Don't hang forever
      chrome.runtime.sendMessage({
        type: 'DETECT_URL', url, imgWidth, imgHeight, confidence: settings.confidence
      }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) { resolve([]); return; }
        if (response?.success) resolve(response.boxes);
        else resolve([]);
      });
    });
  }

  // =====================================================================
  // CSS OVERLAY ENGINE - No canvas, CORS-proof, GPU-accelerated
  // Used for static images and GIFs
  // =====================================================================

  // Calculate rendered image rect accounting for object-fit (contain/cover/fill)
  function getObjectFitRect(element, naturalWidth, naturalHeight) {
    const dw = element.clientWidth || element.offsetWidth;
    const dh = element.clientHeight || element.offsetHeight;
    if (!dw || !dh || !naturalWidth || !naturalHeight) return { rx: 0, ry: 0, rw: dw || 0, rh: dh || 0 };
    
    const objectFit = getComputedStyle(element).objectFit || 'fill';
    const imgAspect = naturalWidth / naturalHeight;
    const containerAspect = dw / dh;
    
    if (objectFit === 'contain' || objectFit === 'scale-down') {
      let rw, rh;
      if (imgAspect > containerAspect) {
        rw = dw; rh = Math.round(dw / imgAspect);
      } else {
        rh = dh; rw = Math.round(dh * imgAspect);
      }
      return { rx: Math.round((dw - rw) / 2), ry: Math.round((dh - rh) / 2), rw, rh };
    } else if (objectFit === 'cover') {
      let rw, rh;
      if (imgAspect > containerAspect) {
        rh = dh; rw = Math.round(dh * imgAspect);
      } else {
        rw = dw; rh = Math.round(dw / imgAspect);
      }
      return { rx: Math.round((dw - rw) / 2), ry: Math.round((dh - rh) / 2), rw, rh };
    }
    
    // 'fill' or default — stretches to fill container
    return { rx: 0, ry: 0, rw: dw, rh: dh };
  }

  function computeBoxLayouts(boxes, displayWidth, displayHeight, naturalWidth, naturalHeight, offsetX = 0, offsetY = 0, renderWidth = null, renderHeight = null) {
    const rw = renderWidth || displayWidth;
    const rh = renderHeight || displayHeight;
    const scaleX = rw / naturalWidth;
    const scaleY = rh / naturalHeight;
    const sizeMultiplier = settings.boxSizeMultiplier || 1.0;
    const relevantBoxes = boxes.filter(box => settings.censorLabels.includes(box.labelName));
    
    return relevantBoxes.map(box => {
      const [bx, by, bw, bh] = box.bounding;
      const ew = bw * sizeMultiplier, eh = bh * sizeMultiplier;
      const ex = bx - (ew - bw) / 2, ey = by - (eh - bh) / 2;
      const x = Math.max(0, Math.round(ex * scaleX) + offsetX);
      const y = Math.max(0, Math.round(ey * scaleY) + offsetY);
      const w = Math.min(Math.round(ew * scaleX), displayWidth - x);
      const h = Math.min(Math.round(eh * scaleY), displayHeight - y);
      return { x, y, w, h, labelName: box.labelName, probability: box.probability,
               // Store natural-space coords for canvas pixelation
               nx: Math.max(0, ex), ny: Math.max(0, ey), nw: ew, nh: eh };
    });
  }

  function buildCSSBoxStyle(layout) {
    const { x, y, w, h } = layout;
    let s = `position:absolute !important;left:${x}px !important;top:${y}px !important;width:${w}px !important;height:${h}px !important;box-sizing:border-box !important;pointer-events:none !important;`;
    
    const hasCustomOverlay = (settings.useVideoOverlay && loadedOverlayVideos.length > 0) || (settings.useImageOverlay && loadedOverlayImages.length > 0);
    
    if (hasCustomOverlay) {
      s += 'overflow:hidden !important;';
    } else if (settings.wordOverlayEnabled) {
      const power = Math.max(8, settings.blurPower || 10);
      s += `backdrop-filter:blur(${power}px) !important;-webkit-backdrop-filter:blur(${power}px) !important;background:rgba(0,0,0,0.45) !important;`;
    } else {
      const style = settings.censorStyle || 'black';
      switch (style) {
        case 'black':
          s += 'background:#000000 !important;'; break;
        case 'white':
          s += 'background:#ffffff !important;'; break;
        case 'pixel':
          s += 'overflow:hidden !important;'; break;
        case 'heavy-blur':
          s += 'backdrop-filter:blur(40px) saturate(0.5) !important;-webkit-backdrop-filter:blur(40px) saturate(0.5) !important;'; break;
        case 'noise':
          s += 'overflow:hidden !important;'; break;
        case 'bars':
          s += `backdrop-filter:blur(8px) !important;-webkit-backdrop-filter:blur(8px) !important;background:repeating-linear-gradient(0deg, #000 0px, #000 4px, transparent 4px, transparent 8px) !important;`; break;
        case 'sticker':
          s += 'overflow:hidden !important;background:#111 !important;'; break;
        case 'hearts':
          s += 'overflow:hidden !important;background:#ff69b4 !important;'; break;
        case 'redact':
          s += 'background:#111 !important;overflow:hidden !important;'; break;
        case 'glitch':
          s += `backdrop-filter:blur(3px) hue-rotate(90deg) contrast(2) !important;-webkit-backdrop-filter:blur(3px) hue-rotate(90deg) contrast(2) !important;`; break;
        case 'gradient':
          s += 'background:linear-gradient(135deg, #ff0000, #ff8800, #ffff00, #00ff00, #0088ff, #8800ff, #ff0088) !important;opacity:0.85 !important;'; break;
        case 'spiral':
          s += 'overflow:hidden !important;background:#000 !important;'; break;
        case 'diamond':
          s += `backdrop-filter:blur(20px) !important;-webkit-backdrop-filter:blur(20px) !important;background:repeating-conic-gradient(#000 0% 25%, transparent 0% 50%) 50%/20px 20px !important;`; break;
        case 'invert':
          s += 'backdrop-filter:invert(1) blur(2px) !important;-webkit-backdrop-filter:invert(1) blur(2px) !important;'; break;
        default: // blur
          const power = settings.blurPower || 10;
          s += `backdrop-filter:blur(${power}px) !important;-webkit-backdrop-filter:blur(${power}px) !important;`;
      }
    }
    
    if (!settings.wordOverlayEnabled || hasCustomOverlay) {
      const bOpacity = settings.boxBorderOpacity ?? 0;
      if (bOpacity > 0) {
        s += `border:2px solid ${hexToRgba(settings.boxBorderColor || '#ff0000', bOpacity)} !important;`;
      }
    }
    
    return s;
  }

  function populateBoxDiv(div, layout, index, sourceElement) {
    const hasCustomOverlay = (settings.useVideoOverlay && loadedOverlayVideos.length > 0) || (settings.useImageOverlay && loadedOverlayImages.length > 0);
    
    div.style.cssText = buildCSSBoxStyle(layout) + 'display:block !important;';
    div.innerHTML = '';
    
    const style = settings.censorStyle || 'black';
    
    // Pixel mosaic mode
    if (style === 'pixel' && !hasCustomOverlay && !settings.wordOverlayEnabled && sourceElement) {
      renderPixelMosaic(div, layout, sourceElement);
    }
    // Noise: random colored static blocks
    else if (style === 'noise' && !hasCustomOverlay && !settings.wordOverlayEnabled) {
      renderNoiseMosaic(div, layout);
    }
    // Sticker: emoji grid
    else if (style === 'sticker' && !hasCustomOverlay && !settings.wordOverlayEnabled) {
      const emojis = ['🚫','⛔','❌','🔞','🙈','🙊','🙉','⚠️','🔒','💀'];
      const fontSize = Math.max(12, Math.min(layout.w, layout.h) / 4);
      div.style.display = 'flex'; div.style.flexWrap = 'wrap'; div.style.alignItems = 'center';
      div.style.justifyContent = 'center'; div.style.gap = '2px'; div.style.fontSize = fontSize + 'px';
      div.style.lineHeight = '1'; div.style.padding = '4px';
      const count = Math.max(1, Math.floor((layout.w * layout.h) / (fontSize * fontSize * 1.5)));
      for (let i = 0; i < count; i++) div.insertAdjacentText('beforeend', emojis[i % emojis.length]);
    }
    // Hearts: hearts pattern
    else if (style === 'hearts' && !hasCustomOverlay && !settings.wordOverlayEnabled) {
      const fontSize = Math.max(10, Math.min(layout.w, layout.h) / 3);
      div.style.display = 'flex'; div.style.flexWrap = 'wrap'; div.style.alignItems = 'center';
      div.style.justifyContent = 'center'; div.style.fontSize = fontSize + 'px';
      div.style.lineHeight = '1'; div.style.padding = '2px';
      const hearts = ['💕','💗','💖','💝','❤️','💜','🩷','🤍'];
      const count = Math.max(1, Math.floor((layout.w * layout.h) / (fontSize * fontSize * 1.2)));
      for (let i = 0; i < count; i++) div.insertAdjacentText('beforeend', hearts[i % hearts.length]);
    }
    // Redact: [REDACTED] text on black
    else if (style === 'redact' && !hasCustomOverlay && !settings.wordOverlayEnabled) {
      const fontSize = Math.max(8, Math.min(layout.w * 0.35, layout.h * 0.4, 24));
      div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.justifyContent = 'center';
      div.style.fontFamily = "'Courier New', monospace"; div.style.fontWeight = 'bold';
      div.style.fontSize = fontSize + 'px'; div.style.color = '#cc0000';
      div.style.letterSpacing = '3px'; div.style.textTransform = 'uppercase';
      div.textContent = '[REDACTED]';
    }
    // Spiral: hypnotic spiral pattern
    else if (style === 'spiral' && !hasCustomOverlay && !settings.wordOverlayEnabled) {
      const size = Math.max(layout.w, layout.h);
      div.style.background = `conic-gradient(from 0deg, #000 0deg, #fff 30deg, #000 60deg, #fff 90deg, #000 120deg, #fff 150deg, #000 180deg, #fff 210deg, #000 240deg, #fff 270deg, #000 300deg, #fff 330deg, #000 360deg)`;
      div.style.backgroundSize = size + 'px ' + size + 'px';
      div.style.opacity = '0.9';
    }
    // Image overlay
    else if (settings.useImageOverlay && loadedOverlayImages.length > 0) {
      const key = `css_${layout.labelName}_${layout.x}_${layout.y}`;
      const overlayImg = getOverlayImage(key);
      if (overlayImg) {
        div.style.backgroundImage = `url(${overlayImg.src})`;
        div.style.backgroundSize = 'cover';
        div.style.backgroundPosition = 'center';
      }
    }
    // Word overlay
    else if (settings.wordOverlayEnabled && !hasCustomOverlay) {
      const words = (settings.wordOverlayWords || 'CENSORED').split(',').map(s => s.trim()).filter(s => s);
      const colors = (settings.wordOverlayColors || '#ff0000').split(',').map(s => s.trim()).filter(s => s);
      const now = Date.now();
      const word = words[Math.floor(now / 800) % words.length] || 'CENSORED';
      const color = colors[Math.floor(now / 600) % colors.length] || '#ff0000';
      const fontSize = Math.max(10, Math.min(layout.w * 0.85, layout.h * 0.6, 120));
      div.style.display = 'flex'; div.style.alignItems = 'center'; div.style.justifyContent = 'center';
      div.style.color = color; div.style.fontSize = fontSize + 'px';
      div.style.fontFamily = "Impact, 'Arial Black', sans-serif"; div.style.fontWeight = '900';
      div.style.textShadow = `0 0 8px ${color}, 0 0 16px ${color}`;
      div.style.webkitTextStroke = '1px rgba(0,0,0,0.7)'; div.style.letterSpacing = '2px';
      div.textContent = word;
    }
    
    if (!settings.hideLabels && !settings.wordOverlayEnabled) {
      const label = getDisplayLabel(layout.labelName);
      const labelDiv = document.createElement('div');
      const fontSize = Math.max(10, Math.min(14, layout.w / 6));
      labelDiv.style.cssText = `position:absolute !important;bottom:2px !important;left:2px !important;background:${hexToRgba(settings.labelBgColor || '#000000', 0.8)} !important;color:${settings.labelTextColor || '#ffffff'} !important;font-size:${fontSize}px !important;font-weight:bold !important;padding:1px 3px !important;font-family:Arial,sans-serif !important;`;
      labelDiv.textContent = label;
      div.appendChild(labelDiv);
    }
  }

  // Noise mosaic: random colored TV static blocks
  function renderNoiseMosaic(div, layout) {
    const { w, h } = layout;
    if (w <= 0 || h <= 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.style.cssText = 'width:100% !important;height:100% !important;display:block !important;';
    const ctx = canvas.getContext('2d');
    const blockSize = Math.max(4, Math.min(w, h) / 16);
    for (let py = 0; py < h; py += blockSize) {
      for (let px = 0; px < w; px += blockSize) {
        const v = Math.floor(Math.random() * 256);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(px, py, blockSize, blockSize);
      }
    }
    div.appendChild(canvas);
  }

  // Animated pixel mosaic renderer — draws colored blocks from source image data
  function renderPixelMosaic(div, layout, sourceElement) {
    const { w, h, nx, ny, nw, nh } = layout;
    if (w <= 0 || h <= 0) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.style.cssText = 'width:100% !important;height:100% !important;display:block !important;';
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixelSize = Math.max(8, Math.min(w, h) / 8);
    const drawSrc = sourceElement.__censrDrawSource || sourceElement;
    
    try {
      // Draw the source region onto a temp canvas to read pixels
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w; tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      tempCtx.drawImage(drawSrc, nx || 0, ny || 0, nw || w, nh || h, 0, 0, w, h);
      const imageData = tempCtx.getImageData(0, 0, w, h);
      
      // Draw pixelated blocks
      for (let py = 0; py < h; py += pixelSize) {
        for (let px = 0; px < w; px += pixelSize) {
          const sampleX = Math.min(px + Math.floor(pixelSize / 2), w - 1);
          const sampleY = Math.min(py + Math.floor(pixelSize / 2), h - 1);
          const idx = (sampleY * w + sampleX) * 4;
          ctx.fillStyle = `rgb(${imageData.data[idx]}, ${imageData.data[idx + 1]}, ${imageData.data[idx + 2]})`;
          ctx.fillRect(px, py, pixelSize, pixelSize);
        }
      }
    } catch (e) {
      // CORS fallback: generate random-ish colored blocks as visual noise
      const colors = ['#ff0044', '#cc0033', '#aa0022', '#ff2255', '#ee1144', '#dd0066', '#ff3366', '#cc2244', '#bb1133', '#990022', '#ff4477', '#dd3355'];
      for (let py = 0; py < h; py += pixelSize) {
        for (let px = 0; px < w; px += pixelSize) {
          ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
          ctx.fillRect(px, py, pixelSize, pixelSize);
        }
      }
    }
    
    div.appendChild(canvas);
  }

  function createCSSOverlay(layouts, displayWidth, displayHeight, sourceElement) {
    const container = document.createElement('div');
    container.className = 'censr-css-overlay';
    container.style.cssText = `position:absolute !important;pointer-events:none !important;z-index:9999 !important;overflow:hidden !important;width:${displayWidth}px !important;height:${displayHeight}px !important;`;
    
    if (layouts.length > 0) playMetronomeSound();
    
    layouts.forEach((layout, i) => {
      const div = document.createElement('div');
      div.className = 'censr-box';
      populateBoxDiv(div, layout, i, sourceElement);
      container.appendChild(div);
    });
    
    return container;
  }


  // =====================================================================
  // IMAGE PROCESSING - Legacy canvas overlay (restored for X/Reddit speed)
  // =====================================================================

  function drawLegacyBlurred(ctx, source, x, y, w, h, bx, by, bw, bh) {
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w; tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      const blurFactor = settings.blurPower || 10;
      const smallW = Math.max(4, Math.floor(w / blurFactor));
      const smallH = Math.max(4, Math.floor(h / blurFactor));
      tempCtx.drawImage(source, bx, by, bw, bh, 0, 0, smallW, smallH);
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'low';
      tempCtx.drawImage(tempCanvas, 0, 0, smallW, smallH, 0, 0, w, h);
      ctx.drawImage(tempCanvas, 0, 0, w, h, x, y, w, h);
      ctx.fillStyle = 'rgba(128, 128, 128, 0.3)';
      ctx.fillRect(x, y, w, h);
    } catch (e) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y, w, h);
    }
  }

  function drawLegacyPixelated(ctx, source, x, y, w, h, bx, by, bw, bh) {
    const pixelSize = Math.max(8, Math.min(w, h) / 8);
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w; tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      tempCtx.drawImage(source, bx, by, bw, bh, 0, 0, w, h);
      const imageData = tempCtx.getImageData(0, 0, w, h);
      for (let py = 0; py < h; py += pixelSize) {
        for (let px = 0; px < w; px += pixelSize) {
          const sampleX = Math.min(px + Math.floor(pixelSize / 2), w - 1);
          const sampleY = Math.min(py + Math.floor(pixelSize / 2), h - 1);
          const idx = (sampleY * w + sampleX) * 4;
          ctx.fillStyle = `rgb(${imageData.data[idx]}, ${imageData.data[idx + 1]}, ${imageData.data[idx + 2]})`;
          ctx.fillRect(x + px, y + py, pixelSize, pixelSize);
        }
      }
    } catch (e) {
      const colors = ['#ff0044', '#cc0033', '#aa0022', '#ff2255', '#ee1144', '#dd0066',
                       '#ff3366', '#cc2244', '#bb1133', '#990022', '#ff4477', '#dd3355'];
      for (let py = 0; py < h; py += pixelSize) {
        for (let px = 0; px < w; px += pixelSize) {
          ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
          ctx.fillRect(x + px, y + py, pixelSize, pixelSize);
        }
      }
    }
  }

  // =====================================================================
  // UNIFIED CANVAS STYLE RENDERER — handles all 15 styles for images + videos
  // =====================================================================
  function drawStyleCanvas(ctx, source, x, y, w, h, bx, by, bw, bh) {
    const style = settings.censorStyle || 'black';
    switch (style) {
      case 'black':
        ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, h); break;
      case 'white':
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w, h); break;
      case 'pixel':
        drawCanvasPixelated(ctx, source, x, y, w, h, bx, by, bw, bh); break;
      case 'heavy-blur':
        drawCanvasBlur(ctx, source, x, y, w, h, bx, by, bw, bh, 40); break;
      case 'noise':
        drawCanvasNoise(ctx, x, y, w, h); break;
      case 'bars':
        drawCanvasBlur(ctx, source, x, y, w, h, bx, by, bw, bh, 8);
        drawCanvasBars(ctx, x, y, w, h); break;
      case 'sticker':
        ctx.fillStyle = '#111'; ctx.fillRect(x, y, w, h);
        drawCanvasSticker(ctx, x, y, w, h); break;
      case 'hearts':
        ctx.fillStyle = '#ff69b4'; ctx.fillRect(x, y, w, h);
        drawCanvasHearts(ctx, x, y, w, h); break;
      case 'redact':
        ctx.fillStyle = '#111'; ctx.fillRect(x, y, w, h);
        drawCanvasRedact(ctx, x, y, w, h); break;
      case 'glitch':
        drawCanvasGlitch(ctx, source, x, y, w, h, bx, by, bw, bh); break;
      case 'gradient':
        drawCanvasGradient(ctx, x, y, w, h); break;
      case 'spiral':
        drawCanvasSpiral(ctx, x, y, w, h); break;
      case 'diamond':
        drawCanvasBlur(ctx, source, x, y, w, h, bx, by, bw, bh, 20);
        drawCanvasDiamond(ctx, x, y, w, h); break;
      case 'invert':
        drawCanvasInvert(ctx, source, x, y, w, h, bx, by, bw, bh); break;
      default: // blur
        drawCanvasBlur(ctx, source, x, y, w, h, bx, by, bw, bh, settings.blurPower || 10);
    }
  }

  function drawCanvasBlur(ctx, source, x, y, w, h, bx, by, bw, bh, power) {
    try {
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.filter = `blur(${power}px)`;
      const s = source.__censrDrawSource || source;
      ctx.drawImage(s, bx, by, bw, bh, x - power, y - power, w + power * 2, h + power * 2);
      ctx.restore();
    } catch (e) {
      try { ctx.restore(); } catch(e2) {}
      // Fallback: downscale approach
      try {
        const tc = document.createElement('canvas'); tc.width = w; tc.height = h;
        const tctx = tc.getContext('2d'); const sw = Math.max(4, Math.floor(w / power));
        const sh = Math.max(4, Math.floor(h / power));
        tctx.drawImage(source.__censrDrawSource || source, bx, by, bw, bh, 0, 0, sw, sh);
        tctx.imageSmoothingEnabled = true;
        tctx.drawImage(tc, 0, 0, sw, sh, 0, 0, w, h);
        ctx.drawImage(tc, 0, 0, w, h, x, y, w, h);
      } catch(e3) { ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); }
    }
  }

  function drawCanvasPixelated(ctx, source, x, y, w, h, bx, by, bw, bh) {
    const pixelSize = Math.max(8, Math.min(w, h) / 8);
    try {
      const tc = document.createElement('canvas'); tc.width = w; tc.height = h;
      const tctx = tc.getContext('2d', { willReadFrequently: true });
      tctx.drawImage(source.__censrDrawSource || source, bx, by, bw, bh, 0, 0, w, h);
      const id = tctx.getImageData(0, 0, w, h);
      for (let py = 0; py < h; py += pixelSize) {
        for (let px = 0; px < w; px += pixelSize) {
          const sx = Math.min(px + (pixelSize >> 1), w - 1);
          const sy = Math.min(py + (pixelSize >> 1), h - 1);
          const i = (sy * w + sx) * 4;
          ctx.fillStyle = `rgb(${id.data[i]},${id.data[i+1]},${id.data[i+2]})`;
          ctx.fillRect(x + px, y + py, pixelSize, pixelSize);
        }
      }
    } catch (e) {
      const cols = ['#ff0044','#cc0033','#aa0022','#ff2255','#ee1144','#dd0066','#ff3366','#0044ff','#2233cc','#00cc44','#22aa33'];
      for (let py = 0; py < h; py += pixelSize) {
        for (let px = 0; px < w; px += pixelSize) {
          ctx.fillStyle = cols[Math.floor(Math.random() * cols.length)];
          ctx.fillRect(x + px, y + py, pixelSize, pixelSize);
        }
      }
    }
  }

  function drawCanvasNoise(ctx, x, y, w, h) {
    const bs = Math.max(3, Math.min(w, h) / 20);
    for (let py = 0; py < h; py += bs) {
      for (let px = 0; px < w; px += bs) {
        const v = Math.floor(Math.random() * 256);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x + px, y + py, bs, bs);
      }
    }
  }

  function drawCanvasBars(ctx, x, y, w, h) {
    for (let by = 0; by < h; by += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(x, y + by, w, 4);
    }
  }

  function drawCanvasSticker(ctx, x, y, w, h) {
    const emojis = ['🚫','⛔','❌','🔞','🙈','🔒','💀','⚠️'];
    const fs = Math.max(12, Math.min(w, h) / 3.5);
    ctx.font = `${fs}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cols = Math.max(1, Math.floor(w / (fs * 1.1)));
    const rows = Math.max(1, Math.floor(h / (fs * 1.1)));
    let ei = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillText(emojis[ei % emojis.length], x + (c + 0.5) * (w / cols), y + (r + 0.5) * (h / rows));
        ei++;
      }
    }
    ctx.textAlign = 'start';
  }

  function drawCanvasHearts(ctx, x, y, w, h) {
    const hearts = ['💕','💗','💖','💝','❤️','💜','🩷'];
    const fs = Math.max(10, Math.min(w, h) / 3);
    ctx.font = `${fs}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cols = Math.max(1, Math.floor(w / (fs * 1.1)));
    const rows = Math.max(1, Math.floor(h / (fs * 1.1)));
    let hi = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillText(hearts[hi % hearts.length], x + (c + 0.5) * (w / cols), y + (r + 0.5) * (h / rows));
        hi++;
      }
    }
    ctx.textAlign = 'start';
  }

  function drawCanvasRedact(ctx, x, y, w, h) {
    const fs = Math.max(8, Math.min(w * 0.3, h * 0.35, 22));
    ctx.font = `bold ${fs}px 'Courier New', monospace`;
    ctx.fillStyle = '#cc0000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.letterSpacing = '2px';
    ctx.fillText('[REDACTED]', x + w / 2, y + h / 2);
    ctx.textAlign = 'start';
  }

  function drawCanvasGlitch(ctx, source, x, y, w, h, bx, by, bw, bh) {
    try {
      const s = source.__censrDrawSource || source;
      // Draw base with hue shift
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.filter = 'blur(2px) hue-rotate(90deg) contrast(2)';
      ctx.drawImage(s, bx, by, bw, bh, x, y, w, h);
      ctx.restore();
      // Red channel shift
      ctx.save(); ctx.globalAlpha = 0.4; ctx.globalCompositeOperation = 'screen';
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.filter = 'hue-rotate(180deg) saturate(3)';
      ctx.drawImage(s, bx, by, bw, bh, x + 4, y - 2, w, h);
      ctx.restore();
      // Scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      for (let sy = 0; sy < h; sy += 3) ctx.fillRect(x, y + sy, w, 1);
    } catch(e) {
      try { ctx.restore(); } catch(e2) {}
      ctx.fillStyle = '#220033'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#ff0066'; ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center'; ctx.fillText('GLITCH', x + w/2, y + h/2);
      ctx.textAlign = 'start';
    }
  }

  function drawCanvasGradient(ctx, x, y, w, h) {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#ff0000'); grad.addColorStop(0.17, '#ff8800');
    grad.addColorStop(0.33, '#ffff00'); grad.addColorStop(0.5, '#00ff00');
    grad.addColorStop(0.67, '#0088ff'); grad.addColorStop(0.83, '#8800ff');
    grad.addColorStop(1, '#ff0088');
    ctx.fillStyle = grad; ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
  }

  function drawCanvasSpiral(ctx, x, y, w, h) {
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
    const cx = x + w / 2, cy = y + h / 2;
    const maxR = Math.max(w, h) * 0.7;
    const arms = 8;
    for (let a = 0; a < arms; a++) {
      ctx.beginPath();
      for (let r = 0; r < maxR; r += 2) {
        const angle = (a * Math.PI * 2 / arms) + (r / maxR) * Math.PI * 6;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        if (r === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = a % 2 === 0 ? '#fff' : '#888';
      ctx.lineWidth = 3; ctx.stroke();
    }
  }

  function drawCanvasDiamond(ctx, x, y, w, h) {
    const size = 16;
    for (let dy = 0; dy < h; dy += size) {
      for (let dx = 0; dx < w; dx += size) {
        const odd = ((Math.floor(dx / size) + Math.floor(dy / size)) % 2) === 0;
        ctx.fillStyle = odd ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.3)';
        ctx.fillRect(x + dx, y + dy, size, size);
      }
    }
  }

  function drawCanvasInvert(ctx, source, x, y, w, h, bx, by, bw, bh) {
    try {
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.filter = 'invert(1) blur(2px)';
      ctx.drawImage(source.__censrDrawSource || source, bx, by, bw, bh, x, y, w, h);
      ctx.restore();
    } catch(e) {
      try { ctx.restore(); } catch(e2) {}
      ctx.fillStyle = '#220044'; ctx.fillRect(x, y, w, h);
    }
  }

  function drawLegacyWordOverlay(ctx, source, x, y, w, h, bx, by, bw, bh) {
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w; tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      const blurFactor = Math.max(8, settings.blurPower || 10);
      const smallW = Math.max(4, Math.floor(w / blurFactor));
      const smallH = Math.max(4, Math.floor(h / blurFactor));
      tempCtx.drawImage(source, bx, by, bw, bh, 0, 0, smallW, smallH);
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'low';
      tempCtx.drawImage(tempCanvas, 0, 0, smallW, smallH, 0, 0, w, h);
      ctx.drawImage(tempCanvas, 0, 0, w, h, x, y, w, h);
    } catch (e) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y, w, h);
    }

    const now = Date.now();
    const glitchIntensity = Math.max(2, Math.min(w * 0.08, 12));
    const sliceCount = Math.max(3, Math.floor(h / 12));
    const sliceH = Math.ceil(h / sliceCount);
    for (let i = 0; i < sliceCount; i++) {
      const sy = y + i * sliceH;
      const sh = Math.min(sliceH, y + h - sy);
      if (sh <= 0) continue;
      const seed = Math.sin(now * 0.003 + i * 7.3) * glitchIntensity;
      const offset = Math.round(seed);
      if (Math.abs(offset) > 1) {
        try {
          const sliceData = ctx.getImageData(x, sy, w, sh);
          ctx.putImageData(sliceData, x + offset, sy);
        } catch (e) {}
      }
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x, y, w, h);

    if (h > 30) {
      for (let sy = 0; sy < h; sy += 3) {
        ctx.fillStyle = `rgba(255, 0, 100, ${0.03 + Math.sin(now * 0.005 + sy) * 0.02})`;
        ctx.fillRect(x, y + sy, w, 1);
      }
    }

    const words = (settings.wordOverlayWords || 'CENSORED').split(',').map(s => s.trim()).filter(s => s);
    const colors = (settings.wordOverlayColors || '#ff0000').split(',').map(s => s.trim()).filter(s => s);
    const word = words[Math.floor(now / 800) % words.length] || 'CENSORED';
    const color = colors[Math.floor(now / 600) % colors.length] || '#ff0000';

    let fontSize = Math.min(w * 0.85, h * 0.7);
    ctx.font = `900 ${fontSize}px Impact, Arial Black, sans-serif`;
    while (ctx.measureText(word).width > w * 0.9 && fontSize > 8) {
      fontSize -= 2;
      ctx.font = `900 ${fontSize}px Impact, Arial Black, sans-serif`;
    }

    const textX = x + w / 2;
    const textY = y + h / 2 + fontSize * 0.35;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = Math.max(2, fontSize / 12);
    ctx.strokeText(word, textX, textY);
    ctx.fillStyle = color;
    ctx.fillText(word, textX, textY);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.textAlign = 'start';
  }

  function drawLegacyCensoredRegions(ctx, source, boxes, displayWidth, displayHeight, naturalWidth, naturalHeight, labelCache = {}, isAnimated = false, sourceId = '') {
    const scaleX = displayWidth / naturalWidth;
    const scaleY = displayHeight / naturalHeight;
    const sizeMultiplier = settings.boxSizeMultiplier || 1.0;
    const relevantBoxes = boxes.filter(box => settings.censorLabels.includes(box.labelName));

    if (relevantBoxes.length > 0) playMetronomeSound();

    relevantBoxes.forEach(box => {
      const [bx, by, bw, bh] = box.bounding;
      const expandedW = bw * sizeMultiplier;
      const expandedH = bh * sizeMultiplier;
      const expandedX = bx - (expandedW - bw) / 2;
      const expandedY = by - (expandedH - bh) / 2;
      const x = Math.round(expandedX * scaleX);
      const y = Math.round(expandedY * scaleY);
      const w = Math.round(expandedW * scaleX);
      const h = Math.round(expandedH * scaleY);
      const clampedX = Math.max(0, x);
      const clampedY = Math.max(0, y);
      const clampedW = Math.min(w, displayWidth - clampedX);
      const clampedH = Math.min(h, displayHeight - clampedY);

      const key = `${sourceId}_${box.labelName}_${Math.round(bx)}_${Math.round(by)}`;

      if (settings.useVideoOverlay && loadedOverlayVideos.length > 0) {
        const vid = getOverlayVideo(key);
        if (vid) {
          try { ctx.drawImage(vid, clampedX, clampedY, clampedW, clampedH); vid.play().catch(() => {}); }
          catch (e) { ctx.fillStyle = '#000'; ctx.fillRect(clampedX, clampedY, clampedW, clampedH); }
        }
      } else if (settings.useImageOverlay && loadedOverlayImages.length > 0) {
        const overlayImg = isAnimated ? getOverlayImage(key + '_' + Date.now()) : (labelCache[`img_${key}`] || (labelCache[`img_${key}`] = getOverlayImage(key)));
        if (overlayImg) ctx.drawImage(overlayImg, clampedX, clampedY, clampedW, clampedH);
      } else if (settings.wordOverlayEnabled) {
        drawLegacyWordOverlay(ctx, source, clampedX, clampedY, clampedW, clampedH, Math.max(0, expandedX), Math.max(0, expandedY), expandedW, expandedH);
      } else {
        drawStyleCanvas(ctx, source, clampedX, clampedY, clampedW, clampedH, Math.max(0, expandedX), Math.max(0, expandedY), expandedW, expandedH);
      }

      const isWordOverlayActive = settings.wordOverlayEnabled && !(settings.useVideoOverlay && loadedOverlayVideos.length > 0) && !(settings.useImageOverlay && loadedOverlayImages.length > 0);
      if (!isWordOverlayActive) {
        const bOpacity = settings.boxBorderOpacity ?? 0;
        if (bOpacity > 0) {
          ctx.strokeStyle = hexToRgba(settings.boxBorderColor || '#ff0000', bOpacity);
          ctx.lineWidth = 2;
          ctx.strokeRect(clampedX, clampedY, clampedW, clampedH);
        }
      }

      if (!settings.hideLabels && !isWordOverlayActive) {
        const label = labelCache[`label_${box.labelName}`] || (labelCache[`label_${box.labelName}`] = getDisplayLabel(box.labelName));
        const fontSize = Math.max(10, Math.min(14, clampedW / 6));
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.fillStyle = hexToRgba(settings.labelBgColor || '#000000', 0.8);
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(clampedX + 1, clampedY + clampedH - fontSize - 5, textWidth + 4, fontSize + 4);
        ctx.fillStyle = settings.labelTextColor || '#ffffff';
        ctx.fillText(label, clampedX + 3, clampedY + clampedH - 5);
      }
    });

    return relevantBoxes.length;
  }

  function applyCensorshipToImage(img, boxes) {
    if (!img.isConnected) return;

    // Clean up previous overlay and observer
    if (img.__censrCanvas && img.__censrCanvas.parentNode) {
      img.__censrCanvas.remove();
    }
    img.__censrCanvas = null;
    if (img.__censrResizeObs) { img.__censrResizeObs.disconnect(); img.__censrResizeObs = null; }

    const relevantBoxes = boxes.filter(box => settings.censorLabels.includes(box.labelName));
    if (relevantBoxes.length === 0) {
      img.classList.remove('censr-pending', 'censr-pending-none');
      img.classList.add('censr-processed');
      return;
    }

    const parent = img.parentElement;
    if (!parent) return;

    const parentPos = getComputedStyle(parent).position;
    if (parentPos === 'static' || parentPos === '') {
      parent.dataset.censrOrigPos = parentPos;
      parent.style.position = 'relative';
    }

    function renderOverlay() {
      const displayWidth = img.clientWidth || img.offsetWidth;
      const displayHeight = img.clientHeight || img.offsetHeight;
      if (displayWidth === 0 || displayHeight === 0) return;

      if (img.__censrCanvas && img.__censrCanvas.parentNode) img.__censrCanvas.remove();

      const canvas = document.createElement('canvas');
      canvas.className = 'censr-canvas';
      canvas.width = displayWidth;
      canvas.height = displayHeight;

      const imgRect = img.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const left = imgRect.left - parentRect.left;
      const top = imgRect.top - parentRect.top;
      canvas.style.cssText = `position:absolute !important;left:${left}px !important;top:${top}px !important;width:${displayWidth}px !important;height:${displayHeight}px !important;pointer-events:none !important;z-index:9999 !important;`;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      drawLegacyCensoredRegions(ctx, img, boxes, displayWidth, displayHeight, img.naturalWidth, img.naturalHeight, {}, false, img.src || 'img');

      parent.appendChild(canvas);
      img.__censrCanvas = canvas;
    }

    renderOverlay();

    // Watch for zoom/scroll/resize changes
    const resizeObs = new ResizeObserver(() => {
      if (!img.isConnected) { resizeObs.disconnect(); return; }
      renderOverlay();
    });
    resizeObs.observe(img);
    img.__censrResizeObs = resizeObs;

    img.classList.remove('censr-pending', 'censr-pending-none');
    img.classList.add('censr-processed');
  }

  async function processImage(img) {
    if (!settings.enabled || !img.isConnected) return;
    const src = img.src || img.currentSrc;
    if (isGifUrl(src)) { setupGifProcessing(img); return; }

    const cached = processedImagesMap.get(img);
    if (cached && cached.settingsHash === JSON.stringify(settings.censorLabels)) {
      applyCensorshipToImage(img, cached.boxes);
      return;
    }
    if (!src || src.startsWith('data:image/svg')) {
      img.classList.remove('censr-pending', 'censr-pending-none');
      return;
    }

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width < MIN_IMAGE_SIZE || height < MIN_IMAGE_SIZE) {
      img.classList.remove('censr-pending', 'censr-pending-none');
      if (!img.naturalWidth) {
        img.addEventListener('load', () => queueImage(img), { once: true });
      }
      return;
    }

    try {
      if (!img.complete) await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; setTimeout(resolve, 3000); });
      const boxes = await detect(img, img.naturalWidth, img.naturalHeight);
      processedImagesMap.set(img, { boxes, settingsHash: JSON.stringify(settings.censorLabels) });
      applyCensorshipToImage(img, boxes);
    } catch (error) {
      img.classList.remove('censr-pending', 'censr-pending-none');
    }
  }

  const CONCURRENT_LIMIT = 4;
  let activeProcessing = 0;

  async function processQueue() {
    while (imageQueue.length > 0 && activeProcessing < CONCURRENT_LIMIT) {
      const img = imageQueue.shift();
      if (!img || !img.isConnected) continue;
      activeProcessing++;
      processImage(img).finally(() => {
        activeProcessing--;
        processQueue();
      });
    }
  }

  function queueImage(img) {
    if (!imageQueue.includes(img) && !processedImagesMap.has(img) && !processedGifsMap.has(img)) {
      img.classList.add(settings.initialBlurEnabled ? 'censr-pending' : 'censr-pending-none');
      imageQueue.push(img);
      processQueue();
    }
  }
  // =====================================================================
  // GIF PROCESSING - CSS overlays updated per-frame (no canvas, no CORS)
  // =====================================================================

  function setupGifProcessing(img) {
    if (processedGifsMap.has(img)) return;
    
    const parent = img.parentElement;
    if (!parent) return;
    
    const parentPos = getComputedStyle(parent).position;
    if (parentPos === 'static' || parentPos === '') {
      parent.dataset.censrOrigPos = parentPos;
      parent.style.position = 'relative';
    }
    
    const container = document.createElement('div');
    container.className = 'censr-css-overlay';
    container.style.cssText = 'position:absolute !important;pointer-events:none !important;z-index:9999 !important;overflow:hidden !important;';
    
    const boxDivs = [];
    for (let i = 0; i < MAX_OVERLAY_DIVS; i++) {
      const div = document.createElement('div');
      div.className = 'censr-box';
      div.style.display = 'none';
      container.appendChild(div);
      boxDivs.push(div);
    }
    
    parent.appendChild(container);
    
    const gifState = {
      container, boxDivs, lastBoxes: [],
      intervalId: null, isProcessing: false,
      resizeObserver: null, parent,
      id: 'gif_' + Math.random().toString(36).substr(2, 9)
    };
    processedGifsMap.set(img, gifState);
    
    function updateOverlayPositions() {
      if (!img.isConnected) return;
      const dw = img.clientWidth || img.offsetWidth;
      const dh = img.clientHeight || img.offsetHeight;
      if (!dw || !dh) return;
      const imgRect = img.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      container.style.left = (imgRect.left - parentRect.left) + 'px';
      container.style.top = (imgRect.top - parentRect.top) + 'px';
      container.style.width = dw + 'px';
      container.style.height = dh + 'px';
    }
    gifState.updateOverlayPositions = updateOverlayPositions;
    
    const resizeObserver = new ResizeObserver(() => {
      updateOverlayPositions();
      if (gifState.lastBoxes.length > 0) {
        const dw = img.clientWidth || img.offsetWidth;
        const dh = img.clientHeight || img.offsetHeight;
        const nw = img.naturalWidth, nh = img.naturalHeight;
        if (dw && dh && nw && nh) {
          const ofr = getObjectFitRect(img, nw, nh);
          const layouts = computeBoxLayouts(gifState.lastBoxes, dw, dh, nw, nh, ofr.rx, ofr.ry, ofr.rw, ofr.rh);
          applyLayoutsToDivs(gifState, layouts, img);
        }
      }
    });
    resizeObserver.observe(img);
    gifState.resizeObserver = resizeObserver;
    
    img.classList.remove('censr-pending', 'censr-pending-none');
    img.classList.add('censr-processed');
    
    updateOverlayPositions();
    gifState.intervalId = setInterval(() => processGifFrame(img), settings.frameInterval || DEFAULT_FRAME_INTERVAL);
    processGifFrame(img);
  }

  function applyLayoutsToDivs(gifState, layouts, sourceElement) {
    const { boxDivs } = gifState;
    if (layouts.length > 0) playMetronomeSound();
    
    for (let i = 0; i < boxDivs.length; i++) {
      if (i < layouts.length) {
        populateBoxDiv(boxDivs[i], layouts[i], i, sourceElement);
      } else {
        boxDivs[i].style.display = 'none';
        boxDivs[i].innerHTML = '';
      }
    }
  }

  async function processGifFrame(img) {
    if (!settings.enabled) return;
    const state = processedGifsMap.get(img);
    if (!state || state.isProcessing) return;
    if (!img.isConnected) { stopGifProcessing(img); return; }
    
    const dw = img.clientWidth || img.offsetWidth;
    const dh = img.clientHeight || img.offsetHeight;
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!dw || !dh || !nw || !nh) return;
    
    state.updateOverlayPositions();
    state.isProcessing = true;
    
    try {
      const boxes = await detect(img, nw, nh);
      state.lastBoxes = boxes;
      const ofr = getObjectFitRect(img, nw, nh);
      const layouts = computeBoxLayouts(boxes, dw, dh, nw, nh, ofr.rx, ofr.ry, ofr.rw, ofr.rh);
      applyLayoutsToDivs(state, layouts, img);
    } catch (error) {
    } finally {
      state.isProcessing = false;
    }
  }

  function stopGifProcessing(img) {
    const state = processedGifsMap.get(img);
    if (!state) return;
    if (state.intervalId) { clearInterval(state.intervalId); state.intervalId = null; }
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (state.container?.parentNode) state.container.remove();
    if (state.parent?.dataset.censrOrigPos !== undefined) {
      state.parent.style.position = state.parent.dataset.censrOrigPos || '';
      delete state.parent.dataset.censrOrigPos;
    }
    processedGifsMap.delete(img);
  }

  function restartGifProcessing(img) {
    const state = processedGifsMap.get(img);
    if (!state) return;
    if (state.intervalId) clearInterval(state.intervalId);
    state.intervalId = setInterval(() => processGifFrame(img), settings.frameInterval || DEFAULT_FRAME_INTERVAL);
  }

  // =====================================================================
  // VIDEO PROCESSING - Canvas with GPU-accelerated ctx.filter blur
  // =====================================================================

  function drawCensoredRegions(ctx, source, boxes, displayWidth, displayHeight, naturalWidth, naturalHeight, labelCache = {}, isAnimated = false, sourceId = '', offsetX = 0, offsetY = 0) {
    const scaleX = displayWidth / naturalWidth;
    const scaleY = displayHeight / naturalHeight;
    const sizeMultiplier = settings.boxSizeMultiplier || 1.0;
    const relevantBoxes = boxes.filter(box => settings.censorLabels.includes(box.labelName));

    if (relevantBoxes.length > 0) playMetronomeSound();

    relevantBoxes.forEach(box => {
      const [bx, by, bw, bh] = box.bounding;
      const expandedW = bw * sizeMultiplier, expandedH = bh * sizeMultiplier;
      const expandedX = bx - (expandedW - bw) / 2, expandedY = by - (expandedH - bh) / 2;
      const x = Math.round(expandedX * scaleX) + offsetX, y = Math.round(expandedY * scaleY) + offsetY;
      const w = Math.round(expandedW * scaleX), h = Math.round(expandedH * scaleY);
      const clampedX = Math.max(0, x), clampedY = Math.max(0, y);
      const clampedW = Math.min(w, displayWidth - clampedX), clampedH = Math.min(h, displayHeight - clampedY);
      
      const key = `${sourceId}_${box.labelName}_${Math.round(bx)}_${Math.round(by)}`;
      
      if (settings.useVideoOverlay && loadedOverlayVideos.length > 0) {
        const vid = getOverlayVideo(key);
        if (vid) {
          try { ctx.drawImage(vid, clampedX, clampedY, clampedW, clampedH); vid.play().catch(() => {}); }
          catch (e) { ctx.fillStyle = '#000'; ctx.fillRect(clampedX, clampedY, clampedW, clampedH); }
        }
      } else if (settings.useImageOverlay && loadedOverlayImages.length > 0) {
        const overlayImg = isAnimated ? getOverlayImage(key + '_' + Date.now()) : (labelCache[`img_${key}`] || (labelCache[`img_${key}`] = getOverlayImage(key)));
        if (overlayImg) ctx.drawImage(overlayImg, clampedX, clampedY, clampedW, clampedH);
      } else if (settings.wordOverlayEnabled) {
        drawWordOverlay(ctx, source, clampedX, clampedY, clampedW, clampedH, Math.max(0, expandedX), Math.max(0, expandedY), expandedW, expandedH);
      } else {
        drawStyleCanvas(ctx, source, clampedX, clampedY, clampedW, clampedH, Math.max(0, expandedX), Math.max(0, expandedY), expandedW, expandedH);
      }
      
      const isWordOverlayActive = settings.wordOverlayEnabled && !(settings.useVideoOverlay && loadedOverlayVideos.length > 0) && !(settings.useImageOverlay && loadedOverlayImages.length > 0);
      
      if (!isWordOverlayActive) {
        const bOpacity = settings.boxBorderOpacity ?? 0;
        if (bOpacity > 0) {
          ctx.strokeStyle = hexToRgba(settings.boxBorderColor || '#ff0000', bOpacity);
          ctx.lineWidth = 2;
          ctx.strokeRect(clampedX, clampedY, clampedW, clampedH);
        }
      }
      
      if (!settings.hideLabels && !isWordOverlayActive) {
        const label = labelCache[`label_${box.labelName}`] || (labelCache[`label_${box.labelName}`] = getDisplayLabel(box.labelName));
        const fontSize = Math.max(10, Math.min(14, clampedW / 6));
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.fillStyle = hexToRgba(settings.labelBgColor || '#000000', 0.8);
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(clampedX + 1, clampedY + clampedH - fontSize - 5, textWidth + 4, fontSize + 4);
        ctx.fillStyle = settings.labelTextColor || '#ffffff';
        ctx.fillText(label, clampedX + 3, clampedY + clampedH - 5);
      }
    });
    return relevantBoxes.length;
  }

  // GPU blur via ctx.filter (orders of magnitude faster than manual downscale)
  function drawBlurred(ctx, source, x, y, w, h, bx, by, bw, bh) {
    try {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      const blurPx = settings.blurPower || 10;
      ctx.filter = `blur(${blurPx}px)`;
      const drawSrc = source.__censrDrawSource || source;
      ctx.drawImage(drawSrc, bx, by, bw, bh, x - blurPx, y - blurPx, w + blurPx * 2, h + blurPx * 2);
      ctx.restore();
      ctx.fillStyle = 'rgba(128, 128, 128, 0.15)';
      ctx.fillRect(x, y, w, h);
    } catch (e) {
      try { ctx.restore(); } catch (e2) {}
      ctx.fillStyle = 'rgba(30, 30, 30, 0.92)';
      ctx.fillRect(x, y, w, h);
    }
  }

  // Real pixelate mosaic for videos — samples actual pixel colors into blocks
  function drawPixelated(ctx, source, x, y, w, h, bx, by, bw, bh) {
    const pixelSize = Math.max(8, Math.min(w, h) / 8);
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w; tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      const drawSrc = source.__censrDrawSource || source;
      tempCtx.drawImage(drawSrc, bx, by, bw, bh, 0, 0, w, h);
      const imageData = tempCtx.getImageData(0, 0, w, h);
      for (let py = 0; py < h; py += pixelSize) {
        for (let px = 0; px < w; px += pixelSize) {
          const sampleX = Math.min(px + Math.floor(pixelSize / 2), w - 1);
          const sampleY = Math.min(py + Math.floor(pixelSize / 2), h - 1);
          const idx = (sampleY * w + sampleX) * 4;
          ctx.fillStyle = `rgb(${imageData.data[idx]}, ${imageData.data[idx + 1]}, ${imageData.data[idx + 2]})`;
          ctx.fillRect(x + px, y + py, pixelSize, pixelSize);
        }
      }
    } catch (e) {
      // CORS fallback: random colored blocks
      const colors = ['#ff0044', '#cc0033', '#aa0022', '#ff2255', '#ee1144', '#dd0066',
                       '#ff3366', '#cc2244', '#bb1133', '#990022', '#ff4477', '#dd3355',
                       '#0044ff', '#2233cc', '#3355ee', '#00cc44', '#22aa33', '#44dd55'];
      for (let py = 0; py < h; py += pixelSize) {
        for (let px = 0; px < w; px += pixelSize) {
          ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
          ctx.fillRect(x + px, y + py, pixelSize, pixelSize);
        }
      }
    }
  }

  function drawWordOverlay(ctx, source, x, y, w, h, bx, by, bw, bh) {
    try {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      const blurPx = Math.max(8, settings.blurPower || 10);
      ctx.filter = `blur(${blurPx}px)`;
      const drawSrc = source.__censrDrawSource || source;
      ctx.drawImage(drawSrc, bx, by, bw, bh, x - blurPx, y - blurPx, w + blurPx * 2, h + blurPx * 2);
      ctx.restore();
    } catch (e) {
      try { ctx.restore(); } catch (e2) {}
      ctx.fillStyle = 'rgba(30, 30, 30, 0.92)';
      ctx.fillRect(x, y, w, h);
    }
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x, y, w, h);
    
    const now = Date.now();
    const words = (settings.wordOverlayWords || 'CENSORED').split(',').map(s => s.trim()).filter(s => s);
    const colors = (settings.wordOverlayColors || '#ff0000').split(',').map(s => s.trim()).filter(s => s);
    const word = words[Math.floor(now / 800) % words.length] || 'CENSORED';
    const color = colors[Math.floor(now / 600) % colors.length] || '#ff0000';
    
    let fontSize = Math.min(w * 0.85, h * 0.7);
    ctx.font = `900 ${fontSize}px Impact, Arial Black, sans-serif`;
    while (ctx.measureText(word).width > w * 0.9 && fontSize > 8) {
      fontSize -= 2;
      ctx.font = `900 ${fontSize}px Impact, Arial Black, sans-serif`;
    }
    
    const textX = x + w / 2, textY = y + h / 2 + fontSize * 0.35;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = Math.max(2, fontSize / 12);
    ctx.strokeText(word, textX, textY);
    ctx.fillStyle = color;
    ctx.fillText(word, textX, textY);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.textAlign = 'start';
  }

  // --- Video Setup with Smart Framework Detection ---
  function findVideoWrapper(video) {
    const frameworkClasses = [
      'video-js', 'plyr', 'jwplayer', 'mejs__container', 'flowplayer', 'fp-player',
      'html5-video-container', 'ytp-player', 'shaka-video-container',
      'kt-player', 'kt_player', 'player-wrap', 'player-holder',
      'dplayer', 'art-video-player', 'ckin__player',
      'fluid_video_wrapper', 'vp-player',
    ];
    const frameworkIdPrefixes = ['kt_player', 'player', 'video-player', 'main_video'];
    
    // First pass: look for known framework containers (prioritize over position check)
    let el = video.parentElement;
    let firstPositioned = null;
    for (let i = 0; i < 8 && el; i++) {
      // Check class list for known frameworks
      for (const cls of frameworkClasses) {
        if (el.classList.contains(cls)) return el;
      }
      // Check for Video.js vjs- prefixed classes
      for (const cls of el.classList) {
        if (cls.startsWith('vjs-') && cls !== 'vjs-tech') return el;
      }
      // Check ID-based matches
      const elId = (el.id || '').toLowerCase();
      for (const prefix of frameworkIdPrefixes) {
        if (elId.includes(prefix)) return el;
      }
      // Check data attributes
      if (el.dataset?.flowplayerInstanceId || el.dataset?.player || el.dataset?.playerId) return el;
      // Track first positioned ancestor as fallback
      if (!firstPositioned) {
        const pos = getComputedStyle(el).position;
        if (pos === 'relative' || pos === 'absolute' || pos === 'fixed') {
          firstPositioned = el;
        }
      }
      el = el.parentElement;
    }
    // Fallback: use first positioned ancestor, or immediate parent
    return firstPositioned || video.parentElement;
  }

  function setupVideoProcessing(video) {
    if (processedVideosMap.has(video)) return;
    const videoState = { canvas: null, ctx: null, lastBoxes: [], intervalId: null, isProcessing: false, wrapper: null, labelCache: {}, resizeObserver: null };
    processedVideosMap.set(video, videoState);

    const wrapper = findVideoWrapper(video);
    if (!wrapper) return;
    
    const wrapperPos = getComputedStyle(wrapper).position;
    if (wrapperPos === 'static' || wrapperPos === '') {
      wrapper.dataset.censrOrigPos = wrapperPos;
      wrapper.style.position = 'relative';
    }
    videoState.wrapper = wrapper;

    const canvas = document.createElement('canvas');
    canvas.className = 'censr-video-canvas';
    canvas.style.pointerEvents = 'none';
    wrapper.appendChild(canvas);
    videoState.canvas = canvas;
    videoState.ctx = canvas.getContext('2d', { willReadFrequently: true });
    videoState.id = 'video_' + Math.random().toString(36).substr(2, 9);

    const resizeObserver = new ResizeObserver(() => {
      if (!video.isConnected) return;
      const rect = video.getBoundingClientRect();
      const dw = Math.round(rect.width) || video.clientWidth;
      const dh = Math.round(rect.height) || video.clientHeight;
      if (dw && dh && (canvas.width !== dw || canvas.height !== dh)) {
        canvas.width = dw; canvas.height = dh;
        canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
        const wr = wrapper.getBoundingClientRect();
        canvas.style.left = (rect.left - wr.left) + 'px';
        canvas.style.top = (rect.top - wr.top) + 'px';
        if (videoState.lastBoxes.length > 0 && video.videoWidth && video.videoHeight) {
          const vA = video.videoWidth / video.videoHeight, cA = dw / dh;
          let rW = dw, rH = dh, rX = 0, rY = 0;
          if (Math.abs(vA - cA) > 0.01) {
            if (vA > cA) { rW = dw; rH = Math.round(dw / vA); rY = Math.round((dh - rH) / 2); }
            else { rH = dh; rW = Math.round(dh * vA); rX = Math.round((dw - rW) / 2); }
          }
          videoState.ctx.clearRect(0, 0, dw, dh);
          drawCensoredRegions(videoState.ctx, video, videoState.lastBoxes, rW, rH, video.videoWidth, video.videoHeight, videoState.labelCache, true, videoState.id, rX, rY);
        }
      }
    });
    resizeObserver.observe(video);
    videoState.resizeObserver = resizeObserver;

    const start = () => startVideoProcessing(video);
    const stop = () => { const s = processedVideosMap.get(video); if (s?.intervalId) { clearInterval(s.intervalId); s.intervalId = null; } };
    video.addEventListener('play', start);
    video.addEventListener('playing', start);
    video.addEventListener('pause', stop);
    video.addEventListener('ended', stop);
    // timeupdate fires continuously during playback — catches already-playing videos
    // that we missed the play/playing events for (common with Video.js, KVS, etc.)
    video.addEventListener('timeupdate', function onTimeUpdate() {
      if (!video.paused && !video.ended && video.readyState >= 2) {
        startVideoProcessing(video);
        video.removeEventListener('timeupdate', onTimeUpdate); // Only need to catch it once
      }
    });
    // Also catch readyState transitions
    video.addEventListener('canplay', start, { once: true });
    video.addEventListener('loadeddata', start, { once: true });
    // Immediate check
    if (!video.paused && video.readyState >= 2) startVideoProcessing(video);
    // Delayed check — Video.js often isn't ready until a tick later
    setTimeout(() => {
      if (!video.paused && video.readyState >= 2) startVideoProcessing(video);
    }, 500);
  }

  function startVideoProcessing(video) {
    const state = processedVideosMap.get(video);
    if (!state || state.intervalId) return; // Already running
    if (video.paused || video.ended) return; // Not playing
    state.intervalId = setInterval(() => processVideoFrame(video), settings.frameInterval || DEFAULT_FRAME_INTERVAL);
    processVideoFrame(video);
  }

  function restartVideoProcessing(video) {
    const state = processedVideosMap.get(video);
    if (!state || video.paused || video.ended) return;
    if (state.intervalId) clearInterval(state.intervalId);
    state.intervalId = setInterval(() => processVideoFrame(video), settings.frameInterval || DEFAULT_FRAME_INTERVAL);
  }

  async function processVideoFrame(video) {
    if (!settings.enabled) return;
    const state = processedVideosMap.get(video);
    if (!state || state.isProcessing || video.paused || video.ended) return;
    // readyState >= 1 (HAVE_METADATA) is enough — we just need dimensions.
    // Video.js with MSE can drop readyState during buffering, but frames are still drawable.
    if (video.readyState < 1) return;

    const vw = video.videoWidth, vh = video.videoHeight;
    const rect = video.getBoundingClientRect();
    const dw = Math.round(rect.width) || video.clientWidth, dh = Math.round(rect.height) || video.clientHeight;
    if (!vw || !vh || !dw || !dh) return;

    if (state.canvas.width !== dw || state.canvas.height !== dh) {
      state.canvas.width = dw; state.canvas.height = dh;
      state.canvas.style.width = dw + 'px'; state.canvas.style.height = dh + 'px';
    }
    const wr = state.wrapper.getBoundingClientRect();
    state.canvas.style.left = (rect.left - wr.left) + 'px';
    state.canvas.style.top = (rect.top - wr.top) + 'px';

    state.isProcessing = true;
    try {
      const boxes = await detect(video, vw, vh);
      state.lastBoxes = boxes;
      state.ctx.clearRect(0, 0, dw, dh);
      const vAspect = vw / vh, cAspect = dw / dh;
      let rW = dw, rH = dh, rX = 0, rY = 0;
      if (Math.abs(vAspect - cAspect) > 0.01) {
        if (vAspect > cAspect) { rW = dw; rH = Math.round(dw / vAspect); rY = Math.round((dh - rH) / 2); }
        else { rH = dh; rW = Math.round(dh * vAspect); rX = Math.round((dw - rW) / 2); }
      }
      drawCensoredRegions(state.ctx, video, boxes, rW, rH, vw, vh, state.labelCache, true, state.id, rX, rY);
    } catch (error) {} finally { state.isProcessing = false; }
  }

  // --- Canvas Video Processing ---
  function isLikelyVideoCanvas(canvas) {
    const w = canvas.width || canvas.offsetWidth, h = canvas.height || canvas.offsetHeight;
    if (w < 200 || h < 100) return false;
    const ratio = w / h;
    return ratio >= 1 && ratio <= 3 && canvas.getBoundingClientRect().width > 0;
  }

  function setupCanvasProcessing(canvas) {
    if (processedCanvasesMap.has(canvas) || !isLikelyVideoCanvas(canvas)) return;
    if (!canvas.parentNode) return;
    const canvasState = { overlay: null, ctx: null, lastBoxes: [], intervalId: null, isProcessing: false, lastPixelSample: null, unchangedCount: 0, labelCache: {} };
    processedCanvasesMap.set(canvas, canvasState);

    const overlay = document.createElement('canvas'); overlay.className = 'censr-canvas-overlay';
    canvas.parentNode.insertBefore(overlay, canvas.nextSibling);
    
    const updateOverlayPosition = () => {
      if (!canvas.parentNode || !canvas.isConnected) return;
      const rect = canvas.getBoundingClientRect();
      const parentRect = canvas.parentNode.getBoundingClientRect();
      overlay.style.cssText = `position:absolute;left:${rect.left - parentRect.left}px;top:${rect.top - parentRect.top}px;width:${rect.width}px;height:${rect.height}px`;
      overlay.width = Math.round(rect.width); overlay.height = Math.round(rect.height);
    };
    
    const parent = canvas.parentNode;
    if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    
    canvasState.overlay = overlay; canvasState.ctx = overlay.getContext('2d', { willReadFrequently: true });
    canvasState.updateOverlayPosition = updateOverlayPosition;
    canvasState.id = 'canvas_' + Math.random().toString(36).substr(2, 9);
    canvasState.intervalId = setInterval(() => { updateOverlayPosition(); processCanvasFrame(canvas); }, settings.frameInterval || DEFAULT_FRAME_INTERVAL);
    updateOverlayPosition(); processCanvasFrame(canvas);
  }

  function sampleCanvasPixels(canvas) {
    try {
      // WebGL canvases can't use getContext('2d') - skip them
      if (canvas.__censrSkip) return null;
      let ctx;
      try { 
        ctx = canvas.getContext('2d', { willReadFrequently: true }); 
      } catch (e) { 
        canvas.__censrSkip = true;
        return null; 
      }
      if (!ctx) {
        // getContext('2d') returns null if canvas already has a webgl context
        canvas.__censrSkip = true;
        return null;
      }
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return null;
      const data = ctx.getImageData(Math.floor(w/2), Math.floor(h/2), 1, 1).data;
      return `${data[0]},${data[1]},${data[2]}`;
    } catch (e) {
      // Cross-origin tainted canvas - mark to skip future attempts
      canvas.__censrSkip = true;
      return null;
    }
  }

  async function processCanvasFrame(canvas) {
    if (!settings.enabled) return;
    const state = processedCanvasesMap.get(canvas);
    if (!state || state.isProcessing) return;
    if (!canvas.isConnected) { stopCanvasProcessing(canvas); return; }
    const canvasWidth = canvas.width, canvasHeight = canvas.height;
    if (!canvasWidth || !canvasHeight) return;
    const pixelSample = sampleCanvasPixels(canvas);
    if (pixelSample === null) { stopCanvasProcessing(canvas); return; }
    if (pixelSample === state.lastPixelSample) { state.unchangedCount++; if (state.unchangedCount > 30) { stopCanvasProcessing(canvas); return; } return; }
    state.lastPixelSample = pixelSample; state.unchangedCount = 0;
    const displayWidth = state.overlay.width, displayHeight = state.overlay.height;
    state.isProcessing = true;
    try {
      const boxes = await detect(canvas, canvasWidth, canvasHeight);
      state.lastBoxes = boxes;
      state.ctx.clearRect(0, 0, displayWidth, displayHeight);
      drawCensoredRegions(state.ctx, canvas, boxes, displayWidth, displayHeight, canvasWidth, canvasHeight, state.labelCache, true, state.id);
    } catch (error) {} finally { state.isProcessing = false; }
  }

  function stopCanvasProcessing(canvas) {
    const state = processedCanvasesMap.get(canvas);
    if (!state) return;
    if (state.intervalId) { clearInterval(state.intervalId); state.intervalId = null; }
    if (state.overlay?.parentNode) state.overlay.remove();
    processedCanvasesMap.delete(canvas);
  }

  function restartCanvasProcessing(canvas) {
    const state = processedCanvasesMap.get(canvas);
    if (!state) return;
    if (state.intervalId) clearInterval(state.intervalId);
    state.intervalId = setInterval(() => { if (state.updateOverlayPosition) state.updateOverlayPosition(); processCanvasFrame(canvas); }, settings.frameInterval || DEFAULT_FRAME_INTERVAL);
  }

  // --- Main Scanning ---
  function findAllVideos() {
    const videos = new Set();
    document.querySelectorAll('video').forEach(v => videos.add(v));
    document.querySelectorAll('iframe').forEach(iframe => { try { const doc = iframe.contentDocument || iframe.contentWindow?.document; if (doc) doc.querySelectorAll('video').forEach(v => videos.add(v)); } catch (e) {} });
    document.querySelectorAll('*').forEach(el => { if (el.shadowRoot) el.shadowRoot.querySelectorAll('video').forEach(v => videos.add(v)); });
    return Array.from(videos);
  }

  function scanPage() {
    if (!settings.enabled) return 0;
    let count = 0;
    
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { queueImage(entry.target); io.unobserve(entry.target); }
      });
    });
    
    const images = document.querySelectorAll('img');
    images.forEach(img => { 
      if (img.complete && img.naturalWidth > 0) queueImage(img); 
      else { io.observe(img); img.addEventListener('load', () => queueImage(img), { once: true }); }
    });
    count += images.length;
    
    // Sort videos by viewport position (top-first) for scrolling sites
    const videos = findAllVideos();
    videos.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    
    // Use IntersectionObserver for videos too — only set up when visible
    const vio = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const video = entry.target;
          vio.unobserve(video);
          if (video.readyState >= 2) setupVideoProcessing(video);
          else {
            video.addEventListener('loadeddata', () => setupVideoProcessing(video), { once: true });
            video.addEventListener('canplay', () => setupVideoProcessing(video), { once: true });
          }
        }
      });
    }, { rootMargin: '200px' }); // Pre-load slightly before visible
    
    videos.forEach(video => {
      // If already in viewport, set up immediately
      const rect = video.getBoundingClientRect();
      if (rect.top < window.innerHeight + 200 && rect.bottom > -200) {
        if (video.readyState >= 2) setupVideoProcessing(video); 
        else {
          video.addEventListener('loadeddata', () => setupVideoProcessing(video), { once: true });
          video.addEventListener('canplay', () => setupVideoProcessing(video), { once: true });
        }
      } else {
        // Defer off-screen videos
        vio.observe(video);
      }
    });
    count += videos.length;
    
    const canvases = document.querySelectorAll('canvas');
    canvases.forEach(canvas => { setTimeout(() => { if (isLikelyVideoCanvas(canvas) && !processedCanvasesMap.has(canvas)) setupCanvasProcessing(canvas); }, 2000); });
    count += canvases.length;
    return count;
  }

  function fullCleanup() {
    document.querySelectorAll('video').forEach(video => {
      const state = processedVideosMap.get(video);
      if (state) { if (state.intervalId) clearInterval(state.intervalId); if (state.resizeObserver) state.resizeObserver.disconnect(); }
    });
    document.querySelectorAll('img').forEach(img => {
      const state = processedGifsMap.get(img);
      if (state) { if (state.intervalId) clearInterval(state.intervalId); if (state.resizeObserver) state.resizeObserver.disconnect(); }
      if (img.__censrOverlay && img.__censrOverlay.parentNode) img.__censrOverlay.remove();
      if (img.__censrCanvas && img.__censrCanvas.parentNode) img.__censrCanvas.remove();
      if (img.__censrResizeObs) { img.__censrResizeObs.disconnect(); img.__censrResizeObs = null; }
      img.__censrOverlay = null;
      img.__censrCanvas = null;
      img.__censrDrawSource = null;
      if (img.dataset.censrCssBlur) { img.style.filter = ''; delete img.dataset.censrCssBlur; }
    });
    document.querySelectorAll('canvas').forEach(canvas => { const state = processedCanvasesMap.get(canvas); if (state?.intervalId) clearInterval(state.intervalId); });
    processedImagesMap = new WeakMap(); processedVideosMap = new WeakMap(); processedCanvasesMap = new WeakMap(); processedGifsMap = new WeakMap();
    document.querySelectorAll('.censr-canvas, .censr-video-canvas, .censr-canvas-overlay, .censr-css-overlay, .censr-gif-canvas').forEach(el => el.remove());
    document.querySelectorAll('[data-censr-orig-pos]').forEach(el => {
      el.style.position = el.dataset.censrOrigPos || '';
      delete el.dataset.censrOrigPos;
    });
    document.querySelectorAll('.censr-wrapper, .censr-gif-wrapper').forEach(wrapper => {
      while (wrapper.firstChild) wrapper.parentNode.insertBefore(wrapper.firstChild, wrapper);
      wrapper.remove();
    });
    document.querySelectorAll('.censr-pending, .censr-pending-none, .censr-processed').forEach(el => {
      el.classList.remove('censr-pending', 'censr-pending-none', 'censr-processed');
    });
    imageQueue.length = 0; activeProcessing = 0;
    overlayImageCache.clear(); overlayVideoCache.clear();
  }

  function fullRescan() { fullCleanup(); return scanPage(); }

  function applySettingsChanges() {
    document.querySelectorAll('video').forEach(video => { if (processedVideosMap.has(video)) restartVideoProcessing(video); });
    document.querySelectorAll('img').forEach(img => { if (processedGifsMap.has(img)) restartGifProcessing(img); });
    document.querySelectorAll('canvas').forEach(canvas => { if (processedCanvasesMap.has(canvas)) restartCanvasProcessing(canvas); });
    document.querySelectorAll('img').forEach(img => {
      const cached = processedImagesMap.get(img);
      if (cached && img.isConnected) {
        cached.settingsHash = '';
        applyCensorshipToImage(img, cached.boxes);
      }
    });
  }

  function queueImageSafe(img) {
    if (img.complete && img.naturalWidth > 0) {
      queueImage(img);
    } else {
      // Image not loaded yet — wait for it (Twitter/X adds imgs before src resolves)
      img.addEventListener('load', () => queueImage(img), { once: true });
      // Also queue immediately in case it loads before the event fires
      queueImage(img);
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (!settings.enabled) return;
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.nodeName === 'IMG') queueImageSafe(node);
        else if (node.nodeName === 'VIDEO') { if (node.readyState >= 2) setupVideoProcessing(node); else node.addEventListener('loadeddata', () => setupVideoProcessing(node), { once: true }); }
        else if (node.nodeName === 'CANVAS') { setTimeout(() => { if (isLikelyVideoCanvas(node)) setupCanvasProcessing(node); }, 2000); }
        else if (node.querySelectorAll) {
          node.querySelectorAll('img').forEach(img => queueImageSafe(img));
          node.querySelectorAll('video').forEach(video => { if (video.readyState >= 2) setupVideoProcessing(video); else video.addEventListener('loadeddata', () => setupVideoProcessing(video), { once: true }); });
          node.querySelectorAll('canvas').forEach(canvas => { setTimeout(() => { if (isLikelyVideoCanvas(canvas)) setupCanvasProcessing(canvas); }, 2000); });
        }
      });
      if (mutation.type === 'attributes' && (mutation.attributeName === 'src' || mutation.attributeName === 'srcset') && mutation.target.nodeName === 'IMG') {
        processedImagesMap.delete(mutation.target);
        queueImage(mutation.target);
      }
    });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'RESCAN_PAGE') { loadSettings().then(() => { const count = fullRescan(); sendResponse({ success: true, imageCount: count }); }); return true; }
    if (message.type === 'SETTINGS_UPDATED') {
      const oldOverlays = JSON.stringify(settings.overlayImages);
      const oldVideos = JSON.stringify(settings.overlayVideos);
      settings = { ...settings, ...message.settings };
      if (JSON.stringify(settings.overlayImages) !== oldOverlays) { preloadOverlayImages(); overlayImageCache.clear(); }
      if (JSON.stringify(settings.overlayVideos) !== oldVideos) { preloadOverlayVideos(); overlayVideoCache.clear(); }
      applySettingsChanges();
      sendResponse({ success: true });
    }
    if (message.type === 'PAGE_LOADED') { loadSettings().then(() => scanPage()); }
  });

  async function init() {
    await loadSettings();
    if (!settings.enabled) return;
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
    chrome.runtime.sendMessage({ type: 'PRELOAD_MODEL' });
    setTimeout(() => scanPage(), 500);
    window.addEventListener('load', () => { setTimeout(() => scanPage(), 1500); });
    // Late-loading players (kt_player, KVS, etc.) inject videos after page load scripts run
    setTimeout(() => scanPage(), 4000);
    setTimeout(() => scanPage(), 8000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
