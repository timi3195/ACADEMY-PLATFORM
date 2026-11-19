const path = require("node:path");
const { createCanvas } = require("@napi-rs/canvas");
const { createWorker } = require("tesseract.js");
const tesseractRoot = path.dirname(require.resolve("tesseract.js"));
const tesseractCoreRoot = path.dirname(require.resolve("tesseract.js-core"));
const { verifyLocalOcrModel } = require("./curriculumOcrModelVerification");
const extractionLimits = require("../config/curriculumExtractionLimits");
const documentValidation = require("./curriculumDocumentValidation");

const OCR_FAILURE_DIAGNOSTIC = {
  stage: "extraction",
  code: "OCR_FAILED",
  message: "Text could not be read from the scanned document."
};
const OCR_MODEL_UNAVAILABLE_DIAGNOSTIC = {
  stage: "extraction",
  code: "OCR_MODEL_UNAVAILABLE",
  message: "The verified local English OCR model is unavailable. Verify the pinned model installation."
};
const RENDER_BOUNDS_DIAGNOSTIC = {
  stage: "extraction",
  code: "PDF_RENDER_BOUNDS",
  message: "PDF page rendered within configured OCR limits."
};

const addOcrSegment = (segments, pageNumber, text, confidence) => {
  const cleanText = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!cleanText) return false;
  const candidate = {
    text: cleanText,
    page: pageNumber,
    locator: `page:${pageNumber};ocr`,
    extractionMethod: "ocr",
    confidence: Number.isFinite(confidence)
      ? Math.min(1, Math.max(0, confidence / 100))
      : null
  };
  if (!extractionLimits.isExtractedSegmentsWithinLimits([...segments, candidate])) return false;
  segments.push(candidate);
  return true;
};

const createTesseractOptions = (dataDirectory) => ({
  corePath: tesseractCoreRoot,
  langPath: dataDirectory,
  cachePath: dataDirectory,
  cacheMethod: "none",
  gzip: false,
  workerPath: path.join(tesseractRoot, "worker-script", "node", "index.js"),
  logger: () => {},
  errorHandler: () => {}
});

const createBoundedOcrViewport = (page) => {
  const baseViewport = page.getViewport({ scale: 1 });
  const baseWidth = baseViewport.width;
  const baseHeight = baseViewport.height;
  if (!Number.isFinite(baseWidth) ||
      !Number.isFinite(baseHeight) ||
      baseWidth <= 0 ||
      baseHeight <= 0) {
    throw new Error("PDF page dimensions are invalid.");
  }
  if (baseWidth < 72 / 150 || baseHeight < 72 / 150) {
    throw new Error("PDF page dimensions are below the minimum renderable size.");
  }
  let scale = Math.min(
    150 / 72,
    extractionLimits.maxRenderedPageDimension / baseWidth,
    extractionLimits.maxRenderedPageDimension / baseHeight,
    Math.sqrt(extractionLimits.maxRenderedPagePixels / (baseWidth * baseHeight))
  );
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("PDF page dimensions exceed rendering limits.");
  }
  let viewport = page.getViewport({ scale });
  let width = Math.ceil(viewport.width);
  let height = Math.ceil(viewport.height);
  const isWithinDpiLimit = () =>
    width * 72 / baseWidth <= 150 &&
    height * 72 / baseHeight <= 150;
  while (!extractionLimits.isRenderedPageWithinLimits(width, height) || !isWithinDpiLimit()) {
    scale *= 0.999;
    viewport = page.getViewport({ scale });
    width = Math.ceil(viewport.width);
    height = Math.ceil(viewport.height);
  }
  const effectiveDpi = Math.max(
    width * 72 / baseWidth,
    height * 72 / baseHeight
  );
  return { viewport, width, height, effectiveDpi };
};

const extractPdfOcr = async ({
  bytes,
  extraction,
  dataDirectory,
  canvasModule = { createCanvas },
  tesseractModule = { createWorker },
  verifyModel = verifyLocalOcrModel
}) => {
  const candidatePages = [...new Set(extraction.ocrCandidatePages)];
  if (!candidatePages.length || extraction.status === "failed") return extraction;

  const verifiedModel = await verifyModel({ dataDirectory });
  if (!verifiedModel.available ||
      path.resolve(verifiedModel.dataDirectory || "") !== path.resolve(dataDirectory)) {
    const diagnostics = [...extraction.diagnostics];
    if (diagnostics.length < extractionLimits.maxDiagnostics) {
      diagnostics.push(OCR_MODEL_UNAVAILABLE_DIAGNOSTIC);
    }
    return {
      ...extraction,
      status: "partially_succeeded",
      segments: [...extraction.segments],
      ocrCandidatePages: candidatePages,
      diagnostics
    };
  }

  const segments = [...extraction.segments];
  const diagnostics = [...extraction.diagnostics];
  const remainingPages = [];
  let ocrWorker;
  let hadFailure = false;
  try {
    ocrWorker = await tesseractModule.createWorker(
      "eng",
      1,
      createTesseractOptions(dataDirectory)
    );
    await documentValidation.withValidatedPdfDocument(bytes, async (document) => {
      for (const pageNumber of candidatePages) {
        let canvas;
        const page = await document.getPage(pageNumber);
        try {
          const { viewport, width, height, effectiveDpi } = createBoundedOcrViewport(page);
          canvas = canvasModule.createCanvas(width, height);
          const context = canvas.getContext("2d");
          await page.render({
            canvas,
            canvasContext: context,
            viewport,
            annotationMode: 0
          }).promise;
          if (diagnostics.length < extractionLimits.maxDiagnostics) {
            diagnostics.push({
              ...RENDER_BOUNDS_DIAGNOSTIC,
              page: pageNumber,
              width,
              height,
              effectiveDpi
            });
          }
          const image = canvas.toBuffer("image/png");
          const { data } = await ocrWorker.recognize(image);
          if (!addOcrSegment(segments, pageNumber, data?.text || "", data?.confidence)) {
            hadFailure = true;
            remainingPages.push(pageNumber);
          }
        } catch {
          hadFailure = true;
          remainingPages.push(pageNumber);
        } finally {
          page.cleanup();
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      }
    });
  } catch {
    hadFailure = true;
    for (const pageNumber of candidatePages) {
      if (!remainingPages.includes(pageNumber)) remainingPages.push(pageNumber);
    }
  } finally {
    if (ocrWorker) await ocrWorker.terminate();
  }

  if (hadFailure && diagnostics.length < extractionLimits.maxDiagnostics) {
    diagnostics.push(OCR_FAILURE_DIAGNOSTIC);
  }
  return {
    ...extraction,
    status: remainingPages.length ? "partially_succeeded" : "succeeded",
    extractionMethod: "pdf_text_ocr",
    segments,
    ocrCandidatePages: remainingPages,
    diagnostics
  };
};

module.exports = {
  createBoundedOcrViewport,
  createTesseractOptions,
  extractPdfOcr
};
