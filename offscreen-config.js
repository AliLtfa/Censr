// Configure ONNX Runtime after it loads
// This must run AFTER ort.min.js but BEFORE offscreen.js

if (typeof ort !== 'undefined') {
  // Set WASM configuration
  ort.env.wasm.wasmPaths = window.wasmBasePath;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  
  console.log('[Offscreen Config] ONNX Runtime configured');
  console.log('[Offscreen Config] WASM paths:', ort.env.wasm.wasmPaths);
  console.log('[Offscreen Config] Threads:', ort.env.wasm.numThreads);
  console.log('[Offscreen Config] SIMD:', ort.env.wasm.simd);
} else {
  console.error('[Offscreen Config] ONNX Runtime not loaded!');
}
