// Pre-initialization for ONNX Runtime
// This must run BEFORE ort.min.js loads

// Store the base URL for later use
window.extensionBaseUrl = chrome.runtime.getURL('');
window.wasmBasePath = chrome.runtime.getURL('lib/');

console.log('[Offscreen Init] Extension base URL:', window.extensionBaseUrl);
console.log('[Offscreen Init] WASM base path:', window.wasmBasePath);

// Override WebAssembly.instantiateStreaming to handle extension URLs
// This is needed because ONNX Runtime uses streaming compilation which may fail with chrome-extension:// URLs
const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
WebAssembly.instantiateStreaming = async function(source, importObject) {
  try {
    // Try the original method first
    return await originalInstantiateStreaming(source, importObject);
  } catch (e) {
    console.log('[Offscreen Init] instantiateStreaming failed, falling back to arrayBuffer method:', e.message);
    // Fallback: fetch as arrayBuffer and use instantiate
    const response = await source;
    const buffer = await response.arrayBuffer();
    return WebAssembly.instantiate(buffer, importObject);
  }
};

// Override fetch to fix WASM file paths
const originalFetch = window.fetch;
window.fetch = function(url, options) {
  if (typeof url === 'string') {
    // Fix WASM file requests with relative paths
    if (url.endsWith('.wasm') && !url.startsWith('http') && !url.startsWith('chrome-extension://') && !url.startsWith('blob:')) {
      const fixedUrl = window.wasmBasePath + url.split('/').pop();
      console.log('[Offscreen Init] Fixing WASM URL:', url, '->', fixedUrl);
      return originalFetch(fixedUrl, options);
    }
  }
  return originalFetch(url, options);
};

console.log('[Offscreen Init] Pre-initialization complete');
