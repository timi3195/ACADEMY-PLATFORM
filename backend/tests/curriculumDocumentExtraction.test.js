const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const mongoose = require("mongoose");
const extractionLimits = require("../config/curriculumExtractionLimits");
const extractionService = require("../services/curriculumDocumentExtractionService");
const { createDocx, createPdf } = require("./helpers/curriculumDocumentFixtures");

const IMPORT_ID = "507f1f77bcf86cd799439019";
const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const createStoredDocument = (bytes, mimeType) => {
  const extension = mimeType === PDF_MIME ? ".pdf" : ".docx";
  return {
    provider: "local-disk",
    storageFilename: `curriculum-imports/${IMPORT_ID}/source${extension}`,
    storageKey: "",
    status: "stored",
    originalFilename: `source${extension}`,
    mimeType,
    size: bytes.length,
    contentHash: crypto.createHash("sha256").update(bytes).digest("hex")
  };
};

const extract = async (bytes, mimeType, options = {}) => {
  const document = createStoredDocument(bytes, mimeType);
  let storageReads = 0;
  const storage = options.storage || {
    async getPrivateCurriculumDocumentStream({ document: storedDocument, importId }) {
      storageReads += 1;
      assert.equal(importId, IMPORT_ID);
      assert.equal(storedDocument.storageFilename, document.storageFilename);
      return Readable.from([bytes]);
    }
  };
  const result = await extractionService.extractCurriculumDocument({
    importId: IMPORT_ID,
    document,
    storage
  });
  return { result, storageReads };
};

const buildDocxXml = (body) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
  `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
  `<w:body>${body}</w:body></w:document>`;

test("PDF extraction preserves page numbers, item order, and text positions", async () => {
  const bytes = createPdf({
    pages: [
      { items: ["First page item with enough content.", "Second page item"] },
      { items: ["Text from page two with enough characters to avoid OCR."] }
    ]
  });
  const { result, storageReads } = await extract(bytes, PDF_MIME);
  assert.equal(result.status, "succeeded");
  assert.equal(result.extractionMethod, "pdf_text");
  assert.deepEqual(result.segments.map(({ text, page }) => ({ text, page })), [
    { text: "First page item with enough content.\n", page: 1 },
    { text: "Second page item", page: 1 },
    { text: "Text from page two with enough characters to avoid OCR.", page: 2 }
  ]);
  assert.match(result.segments[0].locator, /^item:1;x:72;y:720;w:/);
  assert.match(result.segments[1].locator, /^item:2;x:72;y:702;w:/);
  assert.deepEqual(result.ocrCandidatePages, []);
  assert.equal(storageReads, 1);
});

test("empty and sparse PDF pages are reported as OCR candidates without invoking OCR", async () => {
  const bytes = createPdf({
    pages: [
      { items: ["This page contains enough text to exceed the sparse-page threshold."] },
      { items: [] },
      { items: ["tiny"] }
    ]
  });
  const { result } = await extract(bytes, PDF_MIME);
  assert.equal(result.status, "partially_succeeded");
  assert.deepEqual(result.ocrCandidatePages, [2, 3]);
  assert.deepEqual(result.segments.map(({ page }) => page), [1, 3]);
});

test("PDF extraction enforces the 50-page maximum", async () => {
  const allowed = await extract(createPdf({
    pages: Array.from({ length: extractionLimits.maxPdfPages }, () => ({ items: [] }))
  }), PDF_MIME);
  assert.equal(allowed.result.status, "partially_succeeded");
  assert.equal(allowed.result.ocrCandidatePages.length, extractionLimits.maxPdfPages);

  const rejected = await extract(createPdf({
    pages: Array.from({ length: extractionLimits.maxPdfPages + 1 }, () => ({ items: [] }))
  }), PDF_MIME);
  assert.equal(rejected.result.status, "failed");
  assert.deepEqual(rejected.result.segments, []);
  assert.equal(rejected.result.diagnostics[0].code, "TEXT_EXTRACTION_FAILED");
});

test("PDF extraction rejects malformed, encrypted, and active-content documents", async () => {
  for (const bytes of [
    Buffer.from("%PDF-1.7\nmalformed"),
    createPdf({ encrypted: true, userPassword: "protected" }),
    createPdf({
      catalogExtra: "/OpenAction << /S /JavaScript /JS (app.alert) >>"
    }),
    createPdf({
      catalogExtra: "/Names << /EmbeddedFiles << /Names [(note.txt) " +
        "<< /Type /Filespec /F (note.txt) /EF << /F 5 0 R >> >>] >> >>"
    })
  ]) {
    const { result } = await extract(bytes, PDF_MIME);
    assert.equal(result.status, "failed");
    assert.deepEqual(result.segments, []);
    assert.equal(result.diagnostics[0].code, "TEXT_EXTRACTION_FAILED");
  }
});

test("DOCX extraction enforces the extracted-text character ceiling", async () => {
  const largeText = Buffer.from(crypto.randomBytes(
    extractionLimits.maxExtractedTextCharacters + 1
  ).map((byte) => 97 + (byte % 26)));
  const xml = Buffer.concat([
    Buffer.from("<w:document xmlns:w=\"urn:word\"><w:body><w:p><w:r><w:t>"),
    largeText,
    Buffer.from("</w:t></w:r></w:p></w:body></w:document>")
  ]);
  const { result } = await extract(createDocx({ document: xml }), DOCX_MIME);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.segments, []);
  assert.equal(result.diagnostics[0].code, "TEXT_EXTRACTION_FAILED");
});

test("DOCX extraction returns paragraphs and table cells in reading order with structural locators", async () => {
  const xml = buildDocxXml(
    "<w:p><w:r><w:t>Before table</w:t></w:r></w:p>" +
    "<w:tbl><w:tr>" +
    "<w:tc><w:p><w:r><w:t>First cell</w:t></w:r></w:p></w:tc>" +
    "<w:tc><w:p><w:hyperlink w:anchor=\"private-target\">" +
    "<w:r><w:t>Visible link label</w:t></w:r></w:hyperlink></w:p></w:tc>" +
    "</w:tr><w:tr><w:tc><w:p><w:r><w:t>Second row</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
    "<w:p><w:r><w:t>After table</w:t></w:r></w:p>" +
    "<w:p><w:drawing><wp:docPr name=\"private attribute\" descr=\"private alt text\"/></w:drawing></w:p>"
  );
  const { result } = await extract(createDocx({ document: xml }), DOCX_MIME);
  assert.equal(result.status, "succeeded");
  assert.equal(result.extractionMethod, "docx_text");
  assert.deepEqual(result.segments.map(({ text, locator }) => ({ text, locator })), [
    { text: "Before table", locator: "paragraph:1" },
    { text: "First cell", locator: "paragraph:2;table:1,row:1,cell:1" },
    { text: "Visible link label", locator: "paragraph:3;table:1,row:1,cell:2" },
    { text: "Second row", locator: "paragraph:4;table:1,row:2,cell:1" },
    { text: "After table", locator: "paragraph:5" }
  ]);
  assert.ok(result.segments.every((segment) => segment.page === null));
  assert.ok(result.segments.every((segment) => segment.extractionMethod === "docx_text"));
  const returnedText = result.segments.map(({ text }) => text).join("\n");
  assert.doesNotMatch(returnedText, /private-target|private attribute|private alt text|<[^>]+>/);
  assert.deepEqual(result.ocrCandidatePages, []);
});

test("DOCX extraction rejects documents that fail the security preflight", async () => {
  const unsafeDocuments = [
    createDocx({
      entries: [{
        name: "word/_rels/document.xml.rels",
        content: '<Relationships><Relationship Id="rId2" Type="https://example.invalid/link" ' +
          'Target="https://example.invalid/resource" TargetMode="External"/></Relationships>'
      }]
    }),
    createDocx({ document: "<w:document><w:body>" }),
    createDocx({
      entries: [{ name: "custom/attachment.bin", content: "embedded data" }]
    }),
    Buffer.from("not a ZIP archive")
  ];
  for (const bytes of unsafeDocuments) {
    const { result } = await extract(bytes, DOCX_MIME);
    assert.equal(result.status, "failed");
    assert.deepEqual(result.segments, []);
    assert.equal(result.diagnostics[0].code, "TEXT_EXTRACTION_FAILED");
  }
});

test("DOCX extraction enforces the extracted segment ceiling", async () => {
  const paragraphs = Array.from(
    { length: extractionLimits.maxStoredSegments + 1 },
    (_unused, index) => `<w:p><w:r><w:t>item ${index}</w:t></w:r></w:p>`
  ).join("");
  const bytes = createDocx({ document: buildDocxXml(paragraphs) });
  const { result } = await extract(bytes, DOCX_MIME);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.segments, []);
  assert.equal(result.diagnostics[0].code, "TEXT_EXTRACTION_FAILED");
});

test("extraction uses no database, AI, OCR, Course creation, or network integrations", async () => {
  const originalFetch = global.fetch;
  const originalConnect = mongoose.connect;
  let fetchCalls = 0;
  let databaseConnections = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Network access is not allowed in this test.");
  };
  mongoose.connect = async () => {
    databaseConnections += 1;
    throw new Error("Database access is not allowed in this test.");
  };
  try {
    const pdf = await extract(createPdf({ pages: [{ items: [] }] }), PDF_MIME);
    assert.equal(pdf.result.status, "partially_succeeded");
    assert.deepEqual(pdf.result.ocrCandidatePages, [1]);

    const unsupported = await extractionService.extractCurriculumDocument({
      importId: IMPORT_ID,
      document: { mimeType: "text/plain" },
      storage: {
        async getPrivateCurriculumDocumentStream() {
          throw new Error("Unsupported types must not be read.");
        }
      }
    });
    assert.equal(unsupported.status, "failed");
    assert.equal(unsupported.diagnostics[0].code, "FILE_TYPE_UNSUPPORTED");
    assert.equal(fetchCalls, 0);
    assert.equal(databaseConnections, 0);

    const prohibitedModules = Object.keys(require.cache).filter((filename) =>
      /[\\/]utils[\\/]gemini\.js$/i.test(filename) ||
      /tesseract|[\\/]services[\\/].*ocr/i.test(filename) ||
      /[\\/]models[\\/]course\.js$/i.test(filename));
    assert.deepEqual(prohibitedModules, []);
  } finally {
    global.fetch = originalFetch;
    mongoose.connect = originalConnect;
  }
});
