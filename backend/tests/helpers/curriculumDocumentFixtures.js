const crypto = require("node:crypto");
const zlib = require("node:zlib");

const PDF_PASSWORD_PADDING = Buffer.from(
  "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
  "hex"
);

const crc32 = (data) => {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
};

const padPdfPassword = (password) => {
  const bytes = Buffer.from(password);
  return Buffer.concat([bytes, PDF_PASSWORD_PADDING]).subarray(0, 32);
};

const rc4 = (key, data) => {
  const state = Array.from({ length: 256 }, (_unused, index) => index);
  let j = 0;
  for (let index = 0; index < state.length; index += 1) {
    j = (j + state[index] + key[index % key.length]) & 0xff;
    [state[index], state[j]] = [state[j], state[index]];
  }
  const output = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let index = 0; index < data.length; index += 1) {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    output[index] = data[index] ^ state[(state[i] + state[j]) & 0xff];
  }
  return output;
};

const createPdfEncryption = ({ userPassword = "", ownerPassword = "owner", documentId }) => {
  const ownerKey = crypto.createHash("md5").update(padPdfPassword(ownerPassword)).digest().subarray(0, 5);
  const ownerEntry = rc4(ownerKey, padPdfPassword(userPassword));
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const fileKey = crypto.createHash("md5")
    .update(Buffer.concat([padPdfPassword(userPassword), ownerEntry, permissions, documentId]))
    .digest()
    .subarray(0, 5);
  const userEntry = Buffer.concat([rc4(fileKey, PDF_PASSWORD_PADDING), Buffer.alloc(16)]);
  return {
    ownerEntry: ownerEntry.toString("hex"),
    userEntry: userEntry.toString("hex"),
    permissions: -4
  };
};

const createPdf = ({
  catalogExtra = "",
  encrypted = false,
  userPassword = "",
  pages = [{ items: [] }]
} = {}) => {
  const documentId = crypto.createHash("md5").update("curriculum-pdf-fixture").digest();
  const pageDefinitions = pages.map((page) =>
    typeof page === "string" ? { items: [page] } : page || { items: [] });
  const pageObjectNumbers = pageDefinitions.map((_page, index) => 4 + index * 2);
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${catalogExtra} >>`,
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] ` +
      `/Count ${pageDefinitions.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  pageDefinitions.forEach((page, index) => {
    const pageObjectNumber = pageObjectNumbers[index];
    const contentObjectNumber = pageObjectNumber + 1;
    const textItems = Array.isArray(page.items) ? page.items : [];
    const content = textItems.map((text, itemIndex) => {
      const escaped = String(text).replace(/([\\()])/g, "\\$1");
      return `BT /F1 12 Tf 72 ${720 - itemIndex * 18} Td (${escaped}) Tj ET`;
    }).join("\n");
    const contentBytes = Buffer.from(content);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`
    );
  });
  if (encrypted) {
    const encryption = createPdfEncryption({ userPassword, documentId });
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${encryption.ownerEntry}> ` +
      `/U <${encryption.userEntry}> /P ${encryption.permissions} >>`
    );
  }

  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  const id = documentId.toString("hex");
  const encryptionReference = encrypted ? `/Encrypt ${objects.length} 0 R ` : "";
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encryptionReference}/ID [<${id}><${id}>] >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
};

const makeZipEntry = ({
  name,
  content = Buffer.alloc(0),
  compressionMethod = 8,
  flags = 0x800,
  externalFileAttributes = 0,
  declaredUncompressedSize,
  declaredCrc32
}) => {
  const nameBytes = Buffer.from(name);
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const compressed = compressionMethod === 8 ? zlib.deflateRawSync(data) : data;
  const crc = crc32(data);
  const centralUncompressedSize = declaredUncompressedSize ?? data.length;
  const centralCrc = declaredCrc32 ?? crc;

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(flags, 6);
  localHeader.writeUInt16LE(compressionMethod, 8);
  localHeader.writeUInt32LE(centralCrc, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(nameBytes.length, 26);
  const localParts = [localHeader, nameBytes, compressed];

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE((3 << 8) | 20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(flags, 8);
  centralHeader.writeUInt16LE(compressionMethod, 10);
  centralHeader.writeUInt32LE(centralCrc, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(centralUncompressedSize, 24);
  centralHeader.writeUInt16LE(nameBytes.length, 28);
  centralHeader.writeUInt32LE(externalFileAttributes, 38);
  return {
    localParts,
    centralParts: [centralHeader, nameBytes],
    localSize: localHeader.length + nameBytes.length + compressed.length
  };
};

const createZip = (entries) => {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const options of entries) {
    const entry = makeZipEntry(options);
    entry.centralParts[0].writeUInt32LE(localOffset, 42);
    localParts.push(...entry.localParts);
    centralParts.push(...entry.centralParts);
    localOffset += entry.localSize;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
};

const createDocxEntries = (overrides = {}) => ([
  {
    name: "[Content_Types].xml",
    content: overrides.contentTypes ||
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="' +
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>"
  },
  {
    name: "_rels/.rels",
    content: overrides.rootRelationships ||
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="word/document.xml"/></Relationships>'
  },
  {
    name: "word/document.xml",
    content: overrides.document ||
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body><w:p><w:r><w:t>Curriculum fixture</w:t></w:r></w:p></w:body></w:document>"
  },
  ...(overrides.entries || [])
]);

const createDocx = (overrides = {}) => createZip(createDocxEntries(overrides));

const createModeratelyCompressiblePayload = (size) => {
  const payload = Buffer.alloc(size, 0x41);
  const noise = crypto.randomBytes(Math.ceil(size / 16));
  for (let offset = 0; offset < payload.length; offset += 16) {
    payload[offset] = noise[Math.floor(offset / 16)];
  }
  return payload;
};

module.exports = {
  createDocx,
  createDocxEntries,
  createModeratelyCompressiblePayload,
  createPdf,
  createZip
};
