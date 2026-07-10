/* License watermark: CENSR_METHOD_WM_v1_7f3c2d9a (see NOTICE.txt) */
const __CENSR_WM = 'CENSR_METHOD_WM_v1_7f3c2d9a';
// Offscreen document for ONNX inference
// This runs in extension context, bypassing page CSP

const LABELS = [
  "FEMALE_GENITALIA_COVERED", "FACE_FEMALE", "BUTTOCKS_EXPOSED",
  "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_BREAST_EXPOSED",
  "ANUS_EXPOSED", "FEET_EXPOSED", "BELLY_COVERED", "FEET_COVERED",
  "ARMPITS_COVERED", "ARMPITS_EXPOSED", "FACE_MALE", "BELLY_EXPOSED",
  "MALE_GENITALIA_EXPOSED", "ANUS_COVERED", "FEMALE_BREAST_COVERED",
  "BUTTOCKS_COVERED"
];

const MODEL_INPUT_SIZE = 320;
let onnxSession = null;
let modelLoadPromise = null;

console.log('[Offscreen] Main script loaded, WASM paths:', ort.env.wasm.wasmPaths);

// Load the model
async function loadModel() {
  if (onnxSession) return onnxSession;
  if (modelLoadPromise) return modelLoadPromise;

  modelLoadPromise = (async () => {
    try {
      console.log('[Offscreen] Loading NudeNet model...');
      const modelUrl = chrome.runtime.getURL('model/320n.onnx');
      
      const response = await fetch(modelUrl);
      if (!response.ok) throw new Error('Failed to fetch model: ' + response.status);
      const modelBuffer = await response.arrayBuffer();
      console.log('[Offscreen] Model fetched, size:', modelBuffer.byteLength);
      
      onnxSession = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      
      // Warmup
      console.log('[Offscreen] Warming up model...');
      const warmupTensor = new ort.Tensor('float32', 
        new Float32Array(1 * 3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE), 
        [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]
      );
      await onnxSession.run({ images: warmupTensor });
      
      console.log('[Offscreen] Model ready!');
      return onnxSession;
    } catch (error) {
      console.error('[Offscreen] Failed to load model:', error);
      modelLoadPromise = null;
      throw error;
    }
  })();

  return modelLoadPromise;
}

// Process model output with CORRECT coordinate transformation
function processOutput(output, imgWidth, imgHeight, scoreThreshold) {
  const boxes = [];
  const data = output.data;
  const [batchSize, channels, numAnchors] = output.dims;
  const numClasses = channels - 4;

  // CORRECT: Calculate single scale factor
  // Model outputs coords in 0-320 range, need to scale back to original image
  const maxSize = Math.max(imgWidth, imgHeight);
  const scaleFactor = maxSize / MODEL_INPUT_SIZE;

  for (let i = 0; i < numAnchors; i++) {
    let maxScore = -Infinity;
    let label = -1;

    for (let c = 0; c < numClasses; c++) {
      const score = data[(c + 4) * numAnchors + i];
      if (score > maxScore) {
        maxScore = score;
        label = c;
      }
    }

    if (maxScore > scoreThreshold && label >= 0 && label < LABELS.length) {
      // Raw model output (in 0-320 coordinate space)
      const x = data[0 * numAnchors + i];
      const y = data[1 * numAnchors + i];
      const w = data[2 * numAnchors + i];
      const h = data[3 * numAnchors + i];

      // Convert from model space (320x320) to original image space
      // x, y are center coordinates, w, h are dimensions
      let bX = (x - 0.5 * w) * scaleFactor;
      let bY = (y - 0.5 * h) * scaleFactor;
      let bW = w * scaleFactor;
      let bH = h * scaleFactor;

      // Clamp to image bounds
      bX = Math.max(0, bX);
      bY = Math.max(0, bY);
      bW = Math.min(bW, imgWidth - bX);
      bH = Math.min(bH, imgHeight - bY);

      if (bW > 5 && bH > 5) {
        boxes.push({
          label: label,
          labelName: LABELS[label],
          probability: maxScore,
          bounding: [bX, bY, bW, bH]
        });
      }
    }
  }

  return nms(boxes, 0.45);
}

// Non-Maximum Suppression
function nms(boxes, iouThresh) {
  if (boxes.length === 0) return [];
  
  boxes.sort((a, b) => b.probability - a.probability);
  const selected = [];
  const active = new Array(boxes.length).fill(true);

  for (let i = 0; i < boxes.length; i++) {
    if (!active[i]) continue;
    selected.push(boxes[i]);
    const [ax, ay, aw, ah] = boxes[i].bounding;

    for (let j = i + 1; j < boxes.length; j++) {
      if (!active[j]) continue;
      const [bx, by, bw, bh] = boxes[j].bounding;
      
      const x1 = Math.max(ax, bx);
      const y1 = Math.max(ay, by);
      const x2 = Math.min(ax + aw, bx + bw);
      const y2 = Math.min(ay + ah, by + bh);
      
      const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const union = aw * ah + bw * bh - intersection;
      const iou = union > 0 ? intersection / union : 0;

      if (iou > iouThresh) {
        active[j] = false;
      }
    }
  }
  return selected;
}

// Run inference on image data
async function detectImage(imageData, imgWidth, imgHeight, confidence) {
  await loadModel();
  
  const { data } = imageData;
  const scoreThreshold = confidence / 100;
  
  // Convert to CHW format, normalized [0,1]
  const float32Data = new Float32Array(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  const pixelCount = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  
  for (let i = 0; i < pixelCount; i++) {
    const pi = i * 4;
    float32Data[i] = data[pi] / 255.0;                    // R
    float32Data[pixelCount + i] = data[pi + 1] / 255.0;   // G  
    float32Data[2 * pixelCount + i] = data[pi + 2] / 255.0; // B
  }
  
  const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  const results = await onnxSession.run({ images: inputTensor });
  const output = results.output0;
  
  return processOutput(output, imgWidth, imgHeight, scoreThreshold);
}

// FAST PATH: Fetch image by URL, preprocess, and infer — all in one hop
async function detectFromUrl(url, imgWidth, imgHeight, confidence) {
  await loadModel();
  
  const scoreThreshold = confidence / 100;
  
  // Fetch image
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error('Fetch failed: ' + response.status);
  const blob = await response.blob();
  
  // Validate it's actually an image
  if (!blob.type.startsWith('image/') && blob.size < 100) {
    throw new Error('Not an image: ' + blob.type);
  }
  
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    throw new Error('Invalid image data');
  }
  
  const naturalW = imgWidth || bitmap.width;
  const naturalH = imgHeight || bitmap.height;
  if (naturalW < 10 || naturalH < 10) { bitmap.close(); return []; }
  
  const maxSize = Math.max(naturalW, naturalH);
  const scale = MODEL_INPUT_SIZE / maxSize;
  
  // Use OffscreenCanvas if available, otherwise fallback to regular canvas
  let imageData;
  try {
    const canvas = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    ctx.drawImage(bitmap, 0, 0, Math.round(naturalW * scale), Math.round(naturalH * scale));
    imageData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  } catch (e) {
    // Fallback: use document canvas if OffscreenCanvas fails
    const canvas = document.createElement('canvas');
    canvas.width = MODEL_INPUT_SIZE; canvas.height = MODEL_INPUT_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
    ctx.drawImage(bitmap, 0, 0, Math.round(naturalW * scale), Math.round(naturalH * scale));
    imageData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  }
  bitmap.close();
  
  // Convert to CHW float32
  const float32Data = new Float32Array(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
  const pixelCount = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const data = imageData.data;
  
  for (let i = 0; i < pixelCount; i++) {
    const pi = i * 4;
    float32Data[i] = data[pi] / 255.0;
    float32Data[pixelCount + i] = data[pi + 1] / 255.0;
    float32Data[2 * pixelCount + i] = data[pi + 2] / 255.0;
  }
  
  const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  const results = await onnxSession.run({ images: inputTensor });
  const output = results.output0;
  
  return processOutput(output, naturalW, naturalH, scoreThreshold);
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DETECT_IMAGE') {
    const { imageData, imgWidth, imgHeight, confidence } = message;
    
    detectImage(imageData, imgWidth, imgHeight, confidence)
      .then(boxes => {
        sendResponse({ success: true, boxes });
      })
      .catch(error => {
        console.error('[Offscreen] Detection error:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  }
  
  if (message.type === 'DETECT_URL') {
    const { url, imgWidth, imgHeight, confidence } = message;
    
    detectFromUrl(url, imgWidth, imgHeight, confidence)
      .then(boxes => {
        sendResponse({ success: true, boxes });
      })
      .catch(error => {
        console.error('[Offscreen] URL detection error:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  }
  
  if (message.type === 'PRELOAD_MODEL') {
    loadModel()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// Preload model on startup
loadModel().catch(err => console.error('[Offscreen] Preload failed:', err));

console.log('[Offscreen] NSFW Censor offscreen document ready');
