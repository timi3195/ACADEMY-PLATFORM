const fs = require("node:fs/promises");
const { StringDecoder } = require("node:string_decoder");
const yauzl = require("yauzl");
const sax = require("sax");
const extractionLimits = require("../config/curriculumExtractionLimits");

const MiB = 1024 * 1024;
const MAX_COMPRESSED_DOCX_BYTES = extractionLimits.maxUploadBytes;
const MAX_DOCX_AUXILIARY_XML_BYTES = extractionLimits.maxDocxXmlPartBytes;
const UNSAFE_CONTENT_TYPE = /macroenabled|vbaproject|oleobject|activex|image\//i;
const UNSAFE_RELATIONSHIP = /oleobject|embeddedobject|\/package|\/image/i;
const UNSAFE_PART = /(?:^|\/)(?:media|embeddings|activex)(?:\/|$)|(?:^|\/)(?:vbaproject(?:\.bin)?|oleobject[^/]*)$/i;

const createCrcTable = () => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
};

const CRC_TABLE = createCrcTable();

const updateCrc32 = (crc, bytes) => {
  let value = crc;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
};

const normalizeEntryName = (name) => {
  if (typeof name !== "string" ||
      name.length === 0 ||
      name.length > 512 ||
      name.includes("\u0000") ||
      /[\u0001-\u001f\u007f]/.test(name) ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /^[a-z]:/i.test(name)) {
    throw new Error("Invalid archive entry name.");
  }
  const segments = name.split("/");
  if (name.endsWith("/")) segments.pop();
  if (segments.length === 0 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid archive entry path.");
  }
  return name.normalize("NFC").toLocaleLowerCase("en-US");
};

const inspectEntryFeatures = (entryName, entry, seenNames) => {
  const normalizedName = normalizeEntryName(entryName);
  if (seenNames.has(normalizedName)) throw new Error("Duplicate archive entry.");
  seenNames.add(normalizedName);

  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw new Error("Encrypted or unsupported archive entry.");
  }
  const unixMode = entry.externalFileAttributes >>> 16;
  if ((entry.versionMadeBy >>> 8) === 3 && (unixMode & 0xf000) === 0xa000) {
    throw new Error("Symbolic links are not allowed in DOCX archives.");
  }
  if (UNSAFE_PART.test(entryName)) {
    throw new Error("Embedded or active content is not allowed in DOCX archives.");
  }
  if (!entryName.endsWith("/") && !/\.(?:xml|rels)$/i.test(entryName)) {
    throw new Error("Binary or embedded content is not allowed in DOCX archives.");
  }
  if (entryName.toLowerCase() === "word/document.xml" &&
      entry.uncompressedSize > extractionLimits.maxDocxDocumentXmlBytes) {
    throw new Error("DOCX document XML exceeds its size limit.");
  }
  if (entryName.toLowerCase().endsWith(".xml") &&
      entry.uncompressedSize > MAX_DOCX_AUXILIARY_XML_BYTES) {
    throw new Error("DOCX XML part exceeds its size limit.");
  }
  if (entry.uncompressedSize > extractionLimits.maxDocxExpandedBytes) {
    throw new Error("DOCX entry exceeds the expanded-size limit.");
  }
  if (entry.uncompressedSize > 0 &&
      (entry.compressedSize === 0 ||
       entry.uncompressedSize / entry.compressedSize > extractionLimits.maxDocxCompressionRatio)) {
    throw new Error("DOCX entry exceeds the compression-ratio limit.");
  }
  return normalizedName;
};

const getAttributeMap = (attributes) =>
  Object.fromEntries(Object.entries(attributes).map(([name, value]) => [name.toLowerCase(), value]));

const createXmlInspector = (entryName) => {
  const lowerName = entryName.toLowerCase();
  const isContentTypes = lowerName === "[content_types].xml";
  const isRelationships = lowerName.endsWith(".rels");
  const isMainDocument = lowerName === "word/document.xml";
  const requiredRoot = isContentTypes
    ? "types"
    : isRelationships
      ? "relationships"
      : isMainDocument
        ? "document"
        : null;
  const decoder = new StringDecoder("utf8");
  const parser = sax.parser(true, { strictEntities: true, position: false });
  let parseError = null;
  let rootName = "";
  let depth = 0;
  let elementCount = 0;
  let hasOfficeDocumentRelationship = false;

  parser.onerror = (error) => {
    parseError = error;
  };
  parser.ondoctype = () => {
    throw new Error("DOCX XML declarations are not allowed.");
  };
  parser.onopentag = (node) => {
    depth += 1;
    elementCount += 1;
    if (depth > extractionLimits.maxDocxXmlDepth ||
        elementCount > extractionLimits.maxDocxXmlElements) {
      throw new Error("DOCX XML structure exceeds its limit.");
    }
    const localName = node.name.slice(node.name.lastIndexOf(":") + 1).toLowerCase();
    if (depth === 1) rootName = localName;
    if (localName === "altchunk") throw new Error("DOCX altChunk content is not supported.");

    const attributes = getAttributeMap(node.attributes);
    if (isRelationships && localName === "relationship") {
      const target = attributes.target || "";
      const relationshipType = attributes.type || "";
      if (attributes.targetmode?.toLowerCase() === "external" ||
          /^[a-z][a-z0-9+.-]*:/i.test(target) ||
          UNSAFE_RELATIONSHIP.test(relationshipType) ||
          /(?:^|\/)(?:media|embeddings|vbaproject|oleobject)(?:\/|$)/i.test(target)) {
        throw new Error("External or embedded DOCX relationships are not supported.");
      }
      if (lowerName === "_rels/.rels" &&
          /\/officedocument$/i.test(relationshipType) &&
          /^(?:\.\/)?word\/document\.xml$/i.test(target)) {
        hasOfficeDocumentRelationship = true;
      }
    }
    if (isContentTypes &&
        ["default", "override"].includes(localName) &&
        UNSAFE_CONTENT_TYPE.test(attributes.contenttype || "")) {
      throw new Error("Active or embedded DOCX content is not supported.");
    }
  };
  parser.onclosetag = () => {
    depth -= 1;
  };

  return {
    write(chunk) {
      parser.write(decoder.write(chunk));
      if (parseError) throw parseError;
    },
    finish() {
      parser.write(decoder.end()).close();
      if (parseError) throw parseError;
      if (depth !== 0 || (requiredRoot && rootName !== requiredRoot)) {
        throw new Error("DOCX XML structure is invalid.");
      }
      return { hasOfficeDocumentRelationship };
    }
  };
};

const validateDocxArchive = async (source, fileSize, { captureDocumentXml = false } = {}) => {
  const actualFileSize = Buffer.isBuffer(source) ? source.length : fileSize;
  if (!Number.isSafeInteger(actualFileSize) ||
      actualFileSize < 5 ||
      actualFileSize > MAX_COMPRESSED_DOCX_BYTES) {
    throw new Error("DOCX compressed size exceeds its limit.");
  }
  if (Buffer.isBuffer(source)) {
    if (!source.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new Error("DOCX ZIP signature is invalid.");
    }
  } else {
    const zipSignature = await fs.open(source, "r");
    try {
      const signature = Buffer.alloc(4);
      const { bytesRead } = await zipSignature.read(signature, 0, signature.length, 0);
      if (bytesRead !== 4 || !signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
        throw new Error("DOCX ZIP signature is invalid.");
      }
    } finally {
      await zipSignature.close();
    }
  }

  const zipOptions = {
    autoClose: false,
    decodeStrings: true,
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: false
  };
  const zipfile = Buffer.isBuffer(source)
    ? await yauzl.fromBufferPromise(source, zipOptions)
    : await yauzl.openPromise(source, zipOptions);
  try {
    if (zipfile.entryCount === 0 || zipfile.entryCount > extractionLimits.maxDocxEntries) {
      throw new Error("DOCX archive entry count exceeds its limit.");
    }

    const entries = new Set();
    const xmlInspectors = new Map();
    const documentXmlChunks = captureDocumentXml ? [] : null;
    let declaredExpandedBytes = 0;
    let actualExpandedBytes = 0;
    let actualEntryCount = 0;

    for await (const entry of zipfile.eachEntry()) {
      actualEntryCount += 1;
      if (actualEntryCount > extractionLimits.maxDocxEntries) {
        throw new Error("DOCX archive entry count exceeds its limit.");
      }
      const normalizedName = inspectEntryFeatures(entry.fileName, entry, entries);
      declaredExpandedBytes += entry.uncompressedSize;
      if (declaredExpandedBytes > extractionLimits.maxDocxExpandedBytes) {
        throw new Error("DOCX expanded size exceeds its limit.");
      }

      const lowerName = entry.fileName.toLowerCase();
      const isXml = lowerName.endsWith(".xml") || lowerName.endsWith(".rels");
      const xmlInspector = isXml ? createXmlInspector(entry.fileName) : null;
      const readStream = await zipfile.openReadStreamPromise(entry);
      let actualEntryBytes = 0;
      let crc = 0xffffffff;
      for await (const chunk of readStream) {
        actualEntryBytes += chunk.length;
        actualExpandedBytes += chunk.length;
        if (actualExpandedBytes > extractionLimits.maxDocxExpandedBytes ||
            actualEntryBytes > extractionLimits.maxDocxExpandedBytes ||
            (lowerName === "word/document.xml" &&
             actualEntryBytes > extractionLimits.maxDocxDocumentXmlBytes) ||
            (isXml && actualEntryBytes > MAX_DOCX_AUXILIARY_XML_BYTES)) {
          throw new Error("DOCX actual expanded size exceeds its limit.");
        }
        crc = updateCrc32(crc, chunk);
        xmlInspector?.write(chunk);
        if (documentXmlChunks && lowerName === "word/document.xml") {
          documentXmlChunks.push(Buffer.from(chunk));
        }
      }
      if (actualEntryBytes !== entry.uncompressedSize ||
          ((crc ^ 0xffffffff) >>> 0) !== entry.crc32 ||
          (actualEntryBytes > 0 &&
           (entry.compressedSize === 0 ||
            actualEntryBytes / entry.compressedSize > extractionLimits.maxDocxCompressionRatio))) {
        throw new Error("DOCX entry metadata does not match its content.");
      }
      if (xmlInspector) {
        const inspection = xmlInspector.finish();
        if (lowerName === "_rels/.rels" && !inspection.hasOfficeDocumentRelationship) {
          throw new Error("DOCX package does not reference its main document.");
        }
        xmlInspectors.set(normalizedName, true);
      }
    }

    for (const requiredName of ["[content_types].xml", "_rels/.rels", "word/document.xml"]) {
      if (!entries.has(requiredName)) throw new Error("DOCX is missing a required package part.");
    }
    if (actualEntryCount !== zipfile.entryCount ||
        !xmlInspectors.has("[content_types].xml") ||
        !xmlInspectors.has("_rels/.rels") ||
        !xmlInspectors.has("word/document.xml")) {
      throw new Error("DOCX archive is incomplete.");
    }
    return documentXmlChunks ? Buffer.concat(documentXmlChunks) : undefined;
  } finally {
    zipfile.close();
  }
};

const withValidatedPdfDocument = async (data, callback = async () => undefined) => {
  const file = Buffer.isBuffer(data)
    ? data
    : data instanceof Uint8Array
      ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
      : null;
  if (!file || file.length < 5 || file.length > extractionLimits.maxUploadBytes ||
      !file.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("PDF signature or size is invalid.");
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(file),
    disableAutoFetch: true,
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    enableXfa: false,
    isEvalSupported: false,
    stopAtErrors: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false
  });
  try {
    const document = await loadingTask.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new Error("PDF page tree is invalid.");
    }
    if (document.isPureXfa ||
        await document.getPermissions() !== null ||
        (await document.getJSActions())?.size ||
        await document.getOpenAction() ||
        (await document.getAttachments())?.size) {
      throw new Error("PDF contains encrypted or unsupported active content.");
    }
    return await callback(document);
  } finally {
    await loadingTask.destroy();
  }
};

const validatePdfDocument = async (filePath) =>
  withValidatedPdfDocument(await fs.readFile(filePath));

const readValidatedDocxDocumentXml = async (data) => {
  if (!Buffer.isBuffer(data)) throw new Error("DOCX data must be a byte buffer.");
  return validateDocxArchive(data, data.length, { captureDocumentXml: true });
};

const validateCurriculumDocument = async ({ filePath, mimeType, fileSize }) => {
  if (!filePath || !Number.isSafeInteger(fileSize) ||
      fileSize < 5 || fileSize > extractionLimits.maxUploadBytes) {
    throw new Error("Curriculum document size is invalid.");
  }
  if (mimeType === "application/pdf") {
    await validatePdfDocument(filePath);
    return;
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    await validateDocxArchive(filePath, fileSize);
    return;
  }
  throw new Error("Curriculum document type is unsupported.");
};

module.exports = {
  validateCurriculumDocument,
  validateDocxArchive,
  validatePdfDocument,
  withValidatedPdfDocument,
  readValidatedDocxDocumentXml
};
