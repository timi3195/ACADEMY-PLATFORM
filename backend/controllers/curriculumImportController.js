const fs = require("node:fs/promises");
const curriculumImportService = require("../services/curriculumImportService");
const storageService = require("../services/storageService");

const sendError = (res, error) => {
  if (error?.name === "ValidationError") {
    return res.status(400).json({ success: false, message: "Curriculum entry validation failed." });
  }
  const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500
    ? error.statusCode
    : 500;
  const message = status < 500
    ? error.message
    : "Unable to process the curriculum request.";
  return res.status(status).json({ success: false, message });
};

const removeTempDirectory = async (req) => {
  if (!req.curriculumTempDirectory) return;
  const directory = req.curriculumTempDirectory;
  req.curriculumTempDirectory = null;
  await fs.rm(directory, { recursive: true, force: true });
};

exports.list = async (req, res) => {
  try {
    const result = await curriculumImportService.listCurriculumImports({ query: req.query });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
};

exports.get = async (req, res) => {
  try {
    const curriculumImport = await curriculumImportService.getCurriculumImport({
      importId: req.params.id
    });
    if (!curriculumImport) {
      return res.status(404).json({ success: false, message: "Curriculum import not found." });
    }
    return res.json({ success: true, curriculumImport });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.create = async (req, res) => {
  let status = 201;
  let body;
  try {
    if (!req.file) {
      status = 400;
      body = { success: false, message: "A curriculum document is required." };
    } else {
      const result = await curriculumImportService.createCurriculumImportFromFile({
        schoolId: req.body.schoolId,
        departmentId: req.body.departmentId,
        programmeHeading: req.body.programmeHeading,
        uploadedBy: req.user.id,
        file: req.file
      });
      if (result.status === "duplicate_retry") {
        status = 200;
        body = {
          success: true,
          duplicate: true,
          retried: true,
          curriculumImportId: String(result.existingImportId),
          version: result.version
        };
      } else if (result.status === "version_conflict") {
        status = 409;
        body = {
          success: false,
          retryable: true,
          message: result.message
        };
      } else {
        body = {
          success: true,
          curriculumImport: curriculumImportService.serializeCurriculumImport(result.import)
        };
      }
    }
  } catch (error) {
    const validationError = error?.name === "ValidationError";
    const statusCode = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : validationError
        ? 400
        : 500;
    status = statusCode;
    body = {
      success: false,
      message: validationError
        ? "Curriculum entry validation failed."
        : statusCode < 500
          ? error.message
          : "Unable to process the curriculum request."
    };
  }
  try {
    await removeTempDirectory(req);
  } catch {
    status = 500;
    body = { success: false, message: "Private upload cleanup failed." };
  }
  return res.status(status).json(body);
};

exports.getDocument = async (req, res) => {
  try {
    const result = await curriculumImportService.getCurriculumDocumentStream({
      importId: req.params.id
    });
    if (!result) {
      return res.status(404).json({ success: false, message: "Curriculum document not found." });
    }
    const filename = storageService.safeFilename(result.originalFilename);
    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Length", result.size);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    result.stream.once("error", () => {
      if (res.headersSent) return res.destroy();
      return res.status(404).json({ success: false, message: "Curriculum document not found." });
    });
    return result.stream.pipe(res);
  } catch (error) {
    return sendError(res, error);
  }
};

exports.extract = async (req, res) => {
  try {
    const result = await curriculumImportService.requestCurriculumExtraction({
      importId: req.params.id
    });
    if (!result) {
      return res.status(404).json({ success: false, message: "Curriculum import not found." });
    }
    return res.status(202).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getEntryEvidence = async (req, res) => {
  try {
    const result = await curriculumImportService.getCurriculumEntryEvidence({
      importId: req.params.id,
      entryId: req.params.entryId
    });
    if (!result) {
      return res.status(404).json({ success: false, message: "Curriculum entry evidence not found." });
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.updateEntry = async (req, res) => {
  try {
    const { note = "", ...updates } = req.body || {};
    const curriculumImport = await curriculumImportService.updateCurriculumEntry({
      importId: req.params.id,
      entryId: req.params.entryId,
      updates,
      reviewerId: req.user.id,
      note
    });
    if (!curriculumImport) {
      return res.status(404).json({ success: false, message: "Curriculum import or draft entry not found." });
    }
    return res.json({ success: true, curriculumImport });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.reviewEntry = async (req, res) => {
  try {
    const curriculumImport = await curriculumImportService.reviewCurriculumEntry({
      importId: req.params.id,
      entryId: req.params.entryId,
      action: req.body?.action,
      reviewerId: req.user.id,
      note: req.body?.note
    });
    if (!curriculumImport) {
      return res.status(404).json({ success: false, message: "Curriculum import or draft entry not found." });
    }
    return res.json({ success: true, curriculumImport });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.removeTempDirectory = removeTempDirectory;
