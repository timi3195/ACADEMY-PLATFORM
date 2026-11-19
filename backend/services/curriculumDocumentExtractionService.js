const crypto = require("node:crypto");
const sax = require("sax");
const CurriculumImport = require("../models/CurriculumImport");
const documentValidation = require("./curriculumDocumentValidation");
const storageService = require("./storageService");
const extractionLimits = require("../config/curriculumExtractionLimits");

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DIAGNOSTIC_MESSAGES = {
  FILE_TYPE_UNSUPPORTED: "The uploaded document type is not supported.",
  TEXT_EXTRACTION_FAILED: "Text could not be extracted from the document."
};

const countCharacters = (text) => {
  let count = 0;
  for (const _character of text) count += 1;
  return count;
};

const createResult = ({
  status,
  extractionMethod,
  segments = [],
  ocrCandidatePages = [],
  diagnosticCode = null
}) => ({
  status,
  extractionMethod,
  segments,
  ocrCandidatePages,
  diagnostics: diagnosticCode
    ? [{
        stage: "extraction",
        code: diagnosticCode,
        message: DIAGNOSTIC_MESSAGES[diagnosticCode]
      }]
    : []
});

const extractionFailure = (extractionMethod, diagnosticCode = "TEXT_EXTRACTION_FAILED") =>
  createResult({
    status: "failed",
    extractionMethod,
    diagnosticCode
  });

const appendSegment = (state, { text, page = null, locator, extractionMethod }) => {
  const characterCount = countCharacters(text);
  const byteCount = Buffer.byteLength(text, "utf8");
  if (!text ||
      typeof locator !== "string" ||
      locator.length > 200 ||
      state.segments.length >= extractionLimits.maxStoredSegments ||
      state.characterCount + characterCount > extractionLimits.maxExtractedTextCharacters ||
      state.byteCount + byteCount > extractionLimits.maxExtractedTextBytes) {
    const error = new Error("Extracted curriculum text exceeds its configured limits.");
    error.code = "EXTRACTION_LIMIT_EXCEEDED";
    throw error;
  }
  state.segments.push({ text, page, locator, extractionMethod });
  state.characterCount += characterCount;
  state.byteCount += byteCount;
};

const readPrivateDocument = async ({ document, importId, storage }) => {
  const storedDocument = typeof document?.toObject === "function"
    ? document.toObject()
    : document;
  if (!storedDocument ||
      storedDocument.status !== "stored" ||
      !Number.isSafeInteger(storedDocument.size) ||
      storedDocument.size < 5 ||
      storedDocument.size > extractionLimits.maxUploadBytes ||
      !/^[a-f0-9]{64}$/.test(storedDocument.contentHash || "") ||
      !CurriculumImport.isSafeStorageReference({
        ...storedDocument,
        expectedImportId: importId
      })) {
    throw new Error("Stored curriculum document metadata is invalid.");
  }
  const stream = await storage.getPrivateCurriculumDocumentStream({
    document: storedDocument,
    importId
  });
  const chunks = [];
  const hash = crypto.createHash("sha256");
  let actualSize = 0;
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
      throw new Error("Private curriculum stream returned invalid data.");
    }
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    actualSize += bytes.length;
    if (actualSize > extractionLimits.maxUploadBytes ||
        actualSize > storedDocument.size) {
      throw new Error("Private curriculum document size is invalid.");
    }
    chunks.push(bytes);
    hash.update(bytes);
  }
  if (actualSize !== storedDocument.size ||
      hash.digest("hex") !== storedDocument.contentHash) {
    throw new Error("Private curriculum document integrity validation failed.");
  }
  return { bytes: Buffer.concat(chunks, actualSize), mimeType: storedDocument.mimeType };
};

const formatPosition = (value) => {
  if (!Number.isFinite(value)) return "?";
  const rounded = Number(value.toFixed(2));
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const createPdfItemLocator = (item, itemNumber) => {
  const transform = Array.isArray(item.transform) || item.transform instanceof Float32Array
    ? item.transform
    : [];
  const direction = ["ltr", "rtl", "ttb"].includes(item.dir) ? item.dir : "?";
  return [
    `item:${itemNumber}`,
    `x:${formatPosition(transform[4])}`,
    `y:${formatPosition(transform[5])}`,
    `w:${formatPosition(item.width)}`,
    `h:${formatPosition(item.height)}`,
    `dir:${direction}`
  ].join(";");
};

const extractPdf = async (bytes) => documentValidation.withValidatedPdfDocument(bytes, async (document) => {
  if (!extractionLimits.isPdfPageCountWithinLimit(document.numPages)) {
    throw new Error("PDF page count exceeds its configured limit.");
  }
  const state = { segments: [], characterCount: 0, byteCount: 0 };
  const ocrCandidatePages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    let pageCharacterCount = 0;
    try {
      const textContent = await page.getTextContent({ includeMarkedContent: false });
      for (let itemIndex = 0; itemIndex < textContent.items.length; itemIndex += 1) {
        const item = textContent.items[itemIndex];
        if (typeof item.str !== "string" || !item.str) continue;
        const cleanText = item.str.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
        if (!cleanText) continue;
        for (const character of cleanText) {
          if (!/\s/u.test(character)) pageCharacterCount += 1;
        }
        appendSegment(state, {
          text: `${cleanText}${item.hasEOL ? "\n" : ""}`,
          page: pageNumber,
          locator: createPdfItemLocator(item, itemIndex + 1),
          extractionMethod: "pdf_text"
        });
      }
    } finally {
      page.cleanup();
    }
    if (pageCharacterCount < extractionLimits.minPdfPageTextCharacters) {
      ocrCandidatePages.push(pageNumber);
    }
  }

  if (!extractionLimits.isExtractedSegmentsWithinLimits(state.segments)) {
    throw new Error("Extracted curriculum text exceeds its configured limits.");
  }
  return createResult({
    status: ocrCandidatePages.length ? "partially_succeeded" : "succeeded",
    extractionMethod: "pdf_text",
    segments: state.segments,
    ocrCandidatePages
  });
});

const localName = (qualifiedName) =>
  qualifiedName.slice(qualifiedName.lastIndexOf(":") + 1).toLowerCase();

const extractDocxXml = (xml) => {
  const state = { segments: [], characterCount: 0, byteCount: 0 };
  const tableStack = [];
  const parser = sax.parser(true, { strictEntities: true, position: false });
  let depth = 0;
  let paragraphNumber = 0;
  let tableNumber = 0;
  let paragraph = null;
  let textElementDepth = 0;
  let skippedDepth = 0;
  let parseError = null;

  parser.onerror = (error) => {
    parseError = error;
  };
  parser.ondoctype = () => {
    throw new Error("DOCX document declarations are not allowed.");
  };
  parser.onopentag = (node) => {
    depth += 1;
    const name = localName(node.name);
    if (skippedDepth) {
      skippedDepth += 1;
      return;
    }
    if (["del", "movefrom"].includes(name)) {
      skippedDepth = 1;
      return;
    }
    if (name === "tbl") {
      tableStack.push({ number: ++tableNumber, row: 0, cell: 0 });
    } else if (name === "tr" && tableStack.length) {
      tableStack[tableStack.length - 1].row += 1;
      tableStack[tableStack.length - 1].cell = 0;
    } else if (name === "tc" && tableStack.length) {
      tableStack[tableStack.length - 1].cell += 1;
    } else if (name === "p") {
      if (paragraph) throw new Error("DOCX paragraphs are nested.");
      paragraph = {
        number: ++paragraphNumber,
        chunks: [],
        tablePath: tableStack.map(({ number, row, cell }) =>
          `table:${number},row:${row},cell:${cell}`)
      };
    } else if (name === "t" && paragraph) {
      textElementDepth = depth;
    } else if (paragraph && name === "tab") {
      paragraph.chunks.push("\t");
    } else if (paragraph && ["br", "cr"].includes(name)) {
      paragraph.chunks.push("\n");
    } else if (paragraph && name === "nobreakhyphen") {
      paragraph.chunks.push("-");
    }
  };
  parser.ontext = (text) => {
    if (paragraph && textElementDepth && !skippedDepth) paragraph.chunks.push(text);
  };
  parser.onclosetag = (qualifiedName) => {
    const name = localName(qualifiedName);
    if (skippedDepth) {
      skippedDepth -= 1;
      depth -= 1;
      return;
    }
    if (name === "t" && textElementDepth === depth) textElementDepth = 0;
    if (name === "p" && paragraph) {
      const text = paragraph.chunks.join("")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t\u00a0]+/g, " ")
        .trim();
      if (text) {
        const locator = [
          `paragraph:${paragraph.number}`,
          ...paragraph.tablePath
        ].join(";");
        appendSegment(state, {
          text,
          page: null,
          locator,
          extractionMethod: "docx_text"
        });
      }
      paragraph = null;
    }
    if (name === "tbl") tableStack.pop();
    depth -= 1;
  };

  parser.write(xml).close();
  if (parseError) throw parseError;
  if (depth !== 0 || paragraph || tableStack.length) {
    throw new Error("DOCX document structure is incomplete.");
  }
  if (!extractionLimits.isExtractedSegmentsWithinLimits(state.segments)) {
    throw new Error("Extracted curriculum text exceeds its configured limits.");
  }
  return state.segments;
};

const extractCurriculumDocument = async ({
  importId,
  document,
  storage = storageService
} = {}) => {
  const extractionMethod = document?.mimeType === PDF_MIME
    ? "pdf_text"
    : document?.mimeType === DOCX_MIME
      ? "docx_text"
      : null;
  if (!extractionMethod) {
    return extractionFailure(null, "FILE_TYPE_UNSUPPORTED");
  }

  try {
    const { bytes, mimeType } = await readPrivateDocument({ document, importId, storage });
    if (mimeType !== document.mimeType) throw new Error("Stored document type is invalid.");
    if (mimeType === PDF_MIME) return await extractPdf(bytes);
    const xml = await documentValidation.readValidatedDocxDocumentXml(bytes);
    const segments = extractDocxXml(xml.toString("utf8"));
    if (!segments.length) return extractionFailure("docx_text");
    return createResult({
      status: "succeeded",
      extractionMethod: "docx_text",
      segments
    });
  } catch {
    return extractionFailure(extractionMethod);
  }
};

module.exports = {
  extractCurriculumDocument,
  readPrivateDocument
};
