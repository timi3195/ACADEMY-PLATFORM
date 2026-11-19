const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const service = require("../services/curriculumImportService");
const extractionLimits = require("../config/curriculumExtractionLimits");
const {
  createDocx,
  createDocxEntries,
  createModeratelyCompressiblePayload,
  createPdf,
  createZip
} = require("./helpers/curriculumDocumentFixtures");

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const withUpload = async (t, { filename, mimeType, bytes }, callback) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "curriculum-preflight-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, filename);
  await fs.writeFile(filePath, bytes);
  return callback({
    path: filePath,
    originalname: filename,
    mimetype: mimeType,
    size: bytes.length
  });
};

const assertUploadRejected = async (t, file) =>
  withUpload(t, file, (upload) =>
    assert.rejects(service.validateCurriculumUpload(upload), { code: "INVALID_UPLOAD" }));

test("preflight accepts generated valid PDF and DOCX documents", async (t) => {
  const pdf = await withUpload(t, {
    filename: "curriculum.pdf",
    mimeType: PDF_MIME,
    bytes: createPdf()
  }, (upload) => service.validateCurriculumUpload(upload));
  assert.equal(pdf.mimeType, PDF_MIME);

  const docx = await withUpload(t, {
    filename: "curriculum.docx",
    mimeType: DOCX_MIME,
    bytes: createDocx()
  }, (upload) => service.validateCurriculumUpload(upload));
  assert.equal(docx.mimeType, DOCX_MIME);
});

test("PDF preflight rejects invalid signatures, malformed files, and encrypted files", async (t) => {
  await assertUploadRejected(t, {
    filename: "bad-signature.pdf",
    mimeType: PDF_MIME,
    bytes: Buffer.from("NOT-PDF")
  });
  await assertUploadRejected(t, {
    filename: "malformed.pdf",
    mimeType: PDF_MIME,
    bytes: Buffer.from("%PDF-1.7\nnot a valid PDF structure")
  });
  await assertUploadRejected(t, {
    filename: "password.pdf",
    mimeType: PDF_MIME,
    bytes: createPdf({ encrypted: true, userPassword: "protected" })
  });
  await assertUploadRejected(t, {
    filename: "empty-password-encrypted.pdf",
    mimeType: PDF_MIME,
    bytes: createPdf({ encrypted: true })
  });
});

test("PDF preflight rejects catalog actions without fetching external resources", async (t) => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Network access is not allowed in this test.");
  };
  try {
    await assertUploadRejected(t, {
      filename: "active-action.pdf",
      mimeType: PDF_MIME,
      bytes: createPdf({
        catalogExtra: "/OpenAction << /S /JavaScript /JS (app.alert) >>"
      })
    });
    await withUpload(t, {
      filename: "offline.pdf",
      mimeType: PDF_MIME,
      bytes: createPdf()
    }, (upload) => service.validateCurriculumUpload(upload));
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("PDF preflight rejects catalog JavaScript and embedded attachments", async (t) => {
  await assertUploadRejected(t, {
    filename: "javascript.pdf",
    mimeType: PDF_MIME,
    bytes: createPdf({
      catalogExtra: "/Names << /JavaScript << /Names [(script) " +
        "<< /S /JavaScript /JS (app.alert) >>] >> >>"
    })
  });
  await assertUploadRejected(t, {
    filename: "attachment.pdf",
    mimeType: PDF_MIME,
    bytes: createPdf({
      catalogExtra: "/Names << /EmbeddedFiles << /Names [(note.txt) " +
        "<< /Type /Filespec /F (note.txt) /EF << /F 4 0 R >> >>] >> >>"
    })
  });
});

test("DOCX preflight rejects malformed and encrypted ZIP archives", async (t) => {
  await assertUploadRejected(t, {
    filename: "malformed.docx",
    mimeType: DOCX_MIME,
    bytes: Buffer.from("PK\u0003\u0004broken archive")
  });
  await assertUploadRejected(t, {
    filename: "encrypted.docx",
    mimeType: DOCX_MIME,
    bytes: createDocx({
      entries: [{ name: "word/private.bin", content: "private", flags: 0x801 }]
    })
  });
});

test("DOCX preflight enforces actual expanded bytes, entry count, XML size, and ratios", async (t) => {
  const baseEntries = createDocxEntries();
  const baseSize = baseEntries.reduce((total, entry) =>
    total + Buffer.byteLength(entry.content), 0);
  const declaredPayloadSize = extractionLimits.maxDocxExpandedBytes - baseSize;
  const actualPayload = createModeratelyCompressiblePayload(declaredPayloadSize + 1);
  const compressedPayloadSize = zlib.deflateRawSync(actualPayload).length;
  assert.ok(declaredPayloadSize / compressedPayloadSize <= extractionLimits.maxDocxCompressionRatio);

  const expandedAttack = createZip([
    ...baseEntries,
    {
      name: "custom/expanded.bin",
      content: actualPayload,
      declaredUncompressedSize: declaredPayloadSize
    }
  ]);
  assert.ok(expandedAttack.length <= extractionLimits.maxUploadBytes);
  await assertUploadRejected(t, {
    filename: "expanded.docx",
    mimeType: DOCX_MIME,
    bytes: expandedAttack
  });

  const excessiveEntries = createDocx({
    entries: Array.from(
      { length: extractionLimits.maxDocxEntries - 2 },
      (_unused, index) => ({ name: `custom/entry-${index}.xml`, content: "<item/>" })
    )
  });
  await assertUploadRejected(t, {
    filename: "many-entries.docx",
    mimeType: DOCX_MIME,
    bytes: excessiveEntries
  });

  const oversizedDocumentXml = createDocx({
    document: Buffer.concat([
      Buffer.from("<w:document>"),
      Buffer.from(crypto.randomBytes(extractionLimits.maxDocxDocumentXmlBytes + 1)
        .map((byte) => 97 + (byte % 26))),
      Buffer.from("</w:document>")
    ])
  });
  assert.ok(oversizedDocumentXml.length < extractionLimits.maxUploadBytes);
  await assertUploadRejected(t, {
    filename: "large-document-xml.docx",
    mimeType: DOCX_MIME,
    bytes: oversizedDocumentXml
  });

  const oversizedCompressedDocx = Buffer.alloc(extractionLimits.maxUploadBytes + 1);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(oversizedCompressedDocx);
  await assertUploadRejected(t, {
    filename: "oversized.docx",
    mimeType: DOCX_MIME,
    bytes: oversizedCompressedDocx
  });

  const ratioAttack = createDocx({
    entries: [{
      name: "custom/ratio.bin",
      content: Buffer.alloc(1024 * 1024, 0x41)
    }]
  });
  await assertUploadRejected(t, {
    filename: "ratio.docx",
    mimeType: DOCX_MIME,
    bytes: ratioAttack
  });
});

test("DOCX preflight rejects traversal, duplicate, and inconsistent entries", async (t) => {
  const traversal = createDocx({
    entries: [{ name: "../outside.bin", content: "outside" }]
  });
  await assertUploadRejected(t, {
    filename: "traversal.docx",
    mimeType: DOCX_MIME,
    bytes: traversal
  });

  const duplicate = createDocx({
    entries: [{ name: "word/document.xml", content: "<w:document/>" }]
  });
  await assertUploadRejected(t, {
    filename: "duplicate.docx",
    mimeType: DOCX_MIME,
    bytes: duplicate
  });

  const inconsistent = createZip(createDocxEntries().map((entry) =>
    entry.name === "word/document.xml"
      ? { ...entry, declaredUncompressedSize: 1 }
      : entry
  ));
  await assertUploadRejected(t, {
    filename: "inconsistent.docx",
    mimeType: DOCX_MIME,
    bytes: inconsistent
  });
});

test("DOCX preflight rejects external relationships and active or embedded content", async (t) => {
  const unsafeDocuments = [
    ["external-relationship.docx", createDocx({
      entries: [{
        name: "word/_rels/document.xml.rels",
        content: '<Relationships><Relationship Id="rId2" Type="https://example.invalid/link" ' +
          'Target="https://example.invalid/resource" TargetMode="External"/></Relationships>'
      }]
    })],
    ["vba.docx", createDocx({
      entries: [{ name: "word/vbaProject.bin", content: "macro" }]
    })],
    ["macro-content-type.docx", createDocx({
      contentTypes: '<Types><Override PartName="/word/document.xml" ' +
        'ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'
    })],
    ["ole.docx", createDocx({
      entries: [{ name: "word/embeddings/oleObject1.bin", content: "ole" }]
    })],
    ["embedded-package.docx", createDocx({
      entries: [{
        name: "word/_rels/document.xml.rels",
        content: '<Relationships><Relationship Id="rId2" ' +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" ' +
          'Target="embeddings/object.bin"/></Relationships>'
      }]
    })],
    ["alt-chunk.docx", createDocx({
      document: '<w:document xmlns:w="urn:word"><w:body><w:altChunk/></w:body></w:document>'
    })],
    ["image.docx", createDocx({
      entries: [{ name: "word/media/image1.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }]
    })],
    ["unreferenced-image.docx", createDocx({
      entries: [{ name: "word/custom/image.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }]
    })],
    ["unreferenced-attachment.docx", createDocx({
      entries: [{ name: "custom/attachment.dat", content: "embedded data" }]
    })],
    ["image-content-type.docx", createDocx({
      contentTypes: '<Types><Default Extension="png" ContentType="image/png"/></Types>'
    })],
    ["doctype.docx", createDocx({
      document: '<!DOCTYPE w:document [<!ENTITY x "x">]><w:document>&x;</w:document>'
    })]
  ];

  for (const [filename, bytes] of unsafeDocuments) {
    await assertUploadRejected(t, { filename, mimeType: DOCX_MIME, bytes });
  }
});
