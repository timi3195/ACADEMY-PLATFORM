const MiB = 1024 * 1024;

const limits = Object.freeze({
  maxUploadBytes: 10 * MiB,
  maxPdfPages: 50,
  minPdfPageTextCharacters: 40,
  maxRenderedPagePixels: 2_000_000,
  maxRenderedPageDimension: 2_000,
  maxExtractedTextCharacters: 500_000,
  maxExtractedTextBytes: 2 * MiB,
  maxStoredSegments: 5_000,
  maxDiagnostics: 20,
  maxDocxExpandedBytes: 30 * MiB,
  maxDocxEntries: 1_000,
  maxDocxDocumentXmlBytes: 10 * MiB,
  maxDocxXmlPartBytes: 10 * MiB,
  maxDocxCompressionRatio: 100,
  maxDocxXmlDepth: 256,
  maxDocxXmlElements: 200_000,
  maxDocumentProcessingMs: 30 * 60 * 1000,
  workerConcurrency: 1,
  maxProcessingAttempts: 3,
  processingRetryBackoffMs: Object.freeze([30_000, 120_000]),
  processingLeaseMs: 60_000,
  processingHeartbeatMs: 20_000,
  processingPollMs: 5_000,
  maxChildMemoryMb: 256,
  maxChildOutputBytes: 4 * MiB
});

const isPdfPageCountWithinLimit = (pageCount) =>
  Number.isInteger(pageCount) && pageCount >= 1 && pageCount <= limits.maxPdfPages;

const isRenderedPageWithinLimits = (width, height) =>
  Number.isInteger(width) &&
  Number.isInteger(height) &&
  width > 0 &&
  height > 0 &&
  width <= limits.maxRenderedPageDimension &&
  height <= limits.maxRenderedPageDimension &&
  width * height <= limits.maxRenderedPagePixels;

const isDocumentProcessingTimeWithinLimit = (durationMs) =>
  Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= limits.maxDocumentProcessingMs;

const isExtractedSegmentsWithinLimits = (segments) => {
  if (!Array.isArray(segments) || segments.length > limits.maxStoredSegments) return false;

  let characterCount = 0;
  let byteCount = 0;
  for (const segment of segments) {
    if (!segment || typeof segment.text !== "string") return false;
    for (const _character of segment.text) {
      characterCount += 1;
      if (characterCount > limits.maxExtractedTextCharacters) return false;
    }
    byteCount += Buffer.byteLength(segment.text, "utf8");
    if (byteCount > limits.maxExtractedTextBytes) return false;
  }
  return true;
};

const isDiagnosticCountWithinLimit = (diagnostics) =>
  Array.isArray(diagnostics) && diagnostics.length <= limits.maxDiagnostics;

module.exports = Object.freeze({
  ...limits,
  isPdfPageCountWithinLimit,
  isRenderedPageWithinLimits,
  isDocumentProcessingTimeWithinLimit,
  isExtractedSegmentsWithinLimits,
  isDiagnosticCountWithinLimit
});
