const path = require("path");
const sharp = require("sharp");

const readLimit = (name, fallback, min, max) => {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const invalidImage = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const MAX_IMAGE_COUNT = readLimit("QUESTION_EXTRACTION_MAX_IMAGES", 8, 1, 8);
const MAX_IMAGE_BYTES = readLimit("QUESTION_EXTRACTION_MAX_IMAGE_BYTES", 8 * 1024 * 1024, 1024, 25 * 1024 * 1024);
const MAX_BATCH_BYTES = readLimit("QUESTION_EXTRACTION_MAX_BATCH_BYTES", 32 * 1024 * 1024, MAX_IMAGE_BYTES, 64 * 1024 * 1024);
const MAX_IMAGE_PIXELS = readLimit("QUESTION_EXTRACTION_MAX_IMAGE_PIXELS", 15_000_000, 4096, 40_000_000);
const MAX_BATCH_PIXELS = readLimit("QUESTION_EXTRACTION_MAX_BATCH_PIXELS", 40_000_000, MAX_IMAGE_PIXELS, 100_000_000);

const mimeByExtension = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

const validateImage = async (file) => {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw invalidImage("Image content is missing.");
  }
  if (file.buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error(`Each image must be no larger than ${MAX_IMAGE_BYTES} bytes.`);
    error.statusCode = 413;
    throw error;
  }

  const name = String(file.originalname || "");
  const extension = path.extname(name).toLowerCase();
  const expectedMime = mimeByExtension[extension];
  if (!expectedMime || file.mimetype !== expectedMime ||
      name.length > 255 || name.includes("/") || name.includes("\\") ||
      /[\0-\x1f<>:"|?*]/.test(name) || name.includes("..") ||
      path.basename(name) !== name || path.win32.basename(name) !== name) {
    throw invalidImage("Only safely named JPG, JPEG, or PNG images with matching MIME types are accepted.");
  }

  let metadata;
  try {
    metadata = await sharp(file.buffer, {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS
    }).metadata();
    const detectedMime = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`;
    if (!["jpeg", "png"].includes(metadata.format) || expectedMime !== detectedMime) {
      throw invalidImage("Image signature does not match the file type.");
    }
    if (!metadata.width || !metadata.height || metadata.width < 64 || metadata.height < 64 ||
        metadata.width * metadata.height > MAX_IMAGE_PIXELS || (metadata.pages || 1) !== 1) {
      throw invalidImage("Image dimensions are outside the supported limits.");
    }

    await sharp(file.buffer, {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS
    }).rotate().resize({ width: 1, height: 1, fit: "inside" }).toBuffer();
  } catch (error) {
    throw invalidImage(error.message === "Image dimensions are outside the supported limits." ||
      error.message === "Image signature does not match the file type."
      ? error.message
      : "Image is corrupted or cannot be decoded.");
  }

  return {
    extension: extension.slice(1),
    mimeType: expectedMime,
    width: metadata.width,
    height: metadata.height,
    size: file.buffer.length
  };
};

const validateBatch = (files) => {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_IMAGE_COUNT) {
    throw invalidImage(`Upload between 1 and ${MAX_IMAGE_COUNT} images per batch.`);
  }
  const totalBytes = files.reduce((total, file) => total + (Number(file.size) || file.buffer?.length || 0), 0);
  if (totalBytes > MAX_BATCH_BYTES) {
    const error = new Error(`The total image batch must be no larger than ${MAX_BATCH_BYTES} bytes.`);
    error.statusCode = 413;
    throw error;
  }
};

const validateBatchPixels = (images) => {
  const totalPixels = images.reduce((total, image) => total + image.width * image.height, 0);
  if (totalPixels > MAX_BATCH_PIXELS) {
    const error = new Error(`The total decoded image size must not exceed ${MAX_BATCH_PIXELS} pixels.`);
    error.statusCode = 413;
    throw error;
  }
};

module.exports = {
  MAX_IMAGE_COUNT,
  MAX_IMAGE_BYTES,
  MAX_BATCH_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_BATCH_PIXELS,
  validateImage,
  validateBatch,
  validateBatchPixels
};
