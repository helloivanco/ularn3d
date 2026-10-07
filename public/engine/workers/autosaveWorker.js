"use strict";
importScripts("../lib/lz-string.min.js");
onmessage = ({ data }) => {
  const { sequence, epoch, key, legacy, value } = data;
  try {
    const started = performance.now();
    const compressed = LZString.compressToUTF16(value);
    postMessage({ sequence, epoch, key, legacy, compressed, compressionMs: performance.now() - started });
  } catch (error) {
    postMessage({ sequence, epoch, key, error: String(error.message || error) });
  }
};
