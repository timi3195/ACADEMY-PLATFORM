const crypto = require("crypto");
const gemini = require("../utils/gemini");
const MAX_SOURCE_TEXT_LENGTH = 45000;
const MAX_CHUNK_SOURCE_LENGTH = 8000;
const MAX_DRAFT_COUNT = 100;

const normalizeForMatch = (value) => String(value || "")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim()
  .replace(/\s+/g, " ");

const extractJson = (value) => {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw createStructuringError("STRUCTURING_INVALID_JSON", "AI returned malformed question data.");
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw createStructuringError("STRUCTURING_INVALID_JSON", "AI returned malformed question data.");
  }
};

const asText = (value, maxLength) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const createStructuringError = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
};

const classifyStructuringError = (error) => {
  const code = String(error?.code || "");
  const status = Number(
    Object.prototype.hasOwnProperty.call(error || {}, "providerStatus")
      ? error.providerStatus
      : code.startsWith("AI_PROVIDER_")
        ? error?.statusCode || error?.status
        : null
  );
  const providerStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  let category = "provider_error";
  if (code === "AI_NOT_CONFIGURED") category = "configuration";
  else if (["AI_RATE_LIMITED", "AI_DAILY_LIMIT", "AI_MONTHLY_LIMIT"].includes(code) || providerStatus === 429) {
    category = "rate_limit";
  } else if (code === "AI_PROMPT_TOO_LONG") category = "prompt_limit";
  else if (code === "AI_RESPONSE_TRUNCATED") category = "response_truncated";
  else if (code === "STRUCTURING_INVALID_JSON") category = "invalid_response";
  else if (code === "STRUCTURING_INVALID_SCHEMA") category = "invalid_schema";
  else if (code === "STRUCTURING_SOURCE_TOO_LONG") category = "source_limit";
  else if (code === "STRUCTURING_DRAFT_LIMIT") category = "draft_limit";
  else if (providerStatus && providerStatus >= 500) category = "provider_unavailable";

  const messages = {
    configuration: "AI structuring is not configured on the server. Configure Gemini access, then retry.",
    rate_limit: "AI request limits are temporarily blocking structuring. Wait before retrying; completed sections are saved.",
    prompt_limit: "A source section exceeds the AI prompt limit. The OCR is preserved; split the source into smaller batches.",
    response_truncated: "The AI response was cut off. Completed sections are saved; retry the unfinished section.",
    invalid_response: "The AI returned malformed question data for this section. OCR is preserved; retry or review the source text.",
    invalid_schema: "The AI returned an unsupported question structure for this section. OCR is preserved; retry or review the source text.",
    source_limit: "OCR text exceeds the safe structuring limit. The saved text is intact; use smaller source batches.",
    draft_limit: "This section exceeds the supported draft limit. Completed sections are saved; split the source before retrying.",
    provider_unavailable: "The Gemini service could not complete this section. OCR and completed sections are preserved; retry later.",
    provider_error: "AI structuring failed for this section. OCR and completed sections are preserved; retry later."
  };
  const safeProviderCode = typeof error?.providerCode === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(error.providerCode)
    ? error.providerCode
    : "";
  const outputCharacterCount = Number(error?.outputCharacterCount);
  const outputTokenCount = Number(error?.tokens?.output);

  return {
    category,
    providerStatus,
    providerCode: safeProviderCode,
    finishReason: typeof error?.finishReason === "string"
      ? error.finishReason.slice(0, 40)
      : "",
    outputCharacterCount: Number.isSafeInteger(outputCharacterCount) && outputCharacterCount >= 0
      ? outputCharacterCount
      : null,
    outputTokenCount: Number.isSafeInteger(outputTokenCount) && outputTokenCount >= 0
      ? outputTokenCount
      : null,
    message: messages[category]
  };
};

const getChunkEnd = (text, start) => {
  const maximumEnd = Math.min(start + MAX_CHUNK_SOURCE_LENGTH, text.length);
  if (maximumEnd === text.length) return maximumEnd;
  const minimumEnd = start + Math.floor(MAX_CHUNK_SOURCE_LENGTH * 0.65);
  const candidates = [
    text.lastIndexOf("\n", maximumEnd),
    text.lastIndexOf(". ", maximumEnd),
    text.lastIndexOf("? ", maximumEnd),
    text.lastIndexOf("! ", maximumEnd),
    text.lastIndexOf(" ", maximumEnd)
  ].filter((index) => index >= minimumEnd);
  return candidates.length ? Math.max(...candidates) + 1 : maximumEnd;
};

const createStructuringChunks = (pages) => pages.flatMap((page) => {
  const text = String(page.text || "");
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = getChunkEnd(text, start);
    const chunkText = text.slice(start, end);
    const chunkIndex = chunks.length;
    const chunkKey = crypto.createHash("sha256")
      .update(`${String(page.imageId || "")}\0${String(page.pageNumber || "")}\0${chunkIndex}\0${chunkText}`)
      .digest("hex");
    chunks.push({
      chunkKey,
      page: { ...page, text: chunkText },
      sourceCharacterCount: chunkText.length
    });
    start = end;
  }
  return chunks;
});

const sourceOverlap = (value, source) => {
  const isMeaningful = (word) => word.length > 1 || /^\d+$/.test(word);
  const sourceWords = new Set(normalizeForMatch(source).split(" ").filter(isMeaningful));
  const words = normalizeForMatch(value).split(" ").filter(isMeaningful);
  if (!words.length) return 0;
  return words.filter((word) => sourceWords.has(word)).length / words.length;
};

const isSourceSupported = (value, source) => {
  const normalizedValue = normalizeForMatch(value);
  if (!normalizedValue) return false;
  const normalizedSource = normalizeForMatch(source);
  return normalizedSource.includes(normalizedValue) || sourceOverlap(value, source) >= 0.8;
};

const isVerbatimSourcePhrase = (value, source) => {
  const normalizedValue = normalizeForMatch(value);
  return Boolean(normalizedValue && normalizeForMatch(source).includes(normalizedValue));
};

const draftKey = (draft) => [
  String(draft.sourceImage || ""),
  String(draft.sourcePage || ""),
  normalizeForMatch(draft.questionNumber),
  normalizeForMatch(draft.questionText)
].join("\u001f");

const mergeUniqueDrafts = (existing, incoming) => {
  const merged = [];
  const seen = new Set();
  for (const draft of [...(existing || []), ...(incoming || [])]) {
    const key = draftKey(draft);
    if (!key.replace(/\u001f/g, "") || seen.has(key)) continue;
    seen.add(key);
    merged.push(draft);
  }
  return merged;
};

const countBlankMarkers = (value) => {
  const matches = String(value || "").match(/_{2,}|\[\[blank(?:\s*\d+)?\]\]/gi);
  return matches ? matches.length : 0;
};

const normalizeDraft = (candidate, pages) => {
  const warnings = Array.isArray(candidate.warnings)
    ? candidate.warnings.filter((warning) => typeof warning === "string").slice(0, 10).map((warning) => warning.slice(0, 240))
    : [];
  const questionText = asText(candidate.questionText, 5000);
  if (!questionText) return null;

  const sourceImageIndex = Number.isInteger(candidate.sourceImageIndex) &&
    candidate.sourceImageIndex >= 0 && candidate.sourceImageIndex < pages.length
    ? candidate.sourceImageIndex
    : null;
  const sourcePage = sourceImageIndex === null ? null : pages[sourceImageIndex];
  if (!sourcePage || sourceOverlap(questionText, sourcePage.text) < 0.5) return null;
  if (!isVerbatimSourcePhrase(questionText, sourcePage.text)) {
    warnings.push("Question wording differs from the OCR transcription; verify uncertain words against the original image.");
  }

  const allOptions = Array.isArray(candidate.options) ? candidate.options : [];
  if (allOptions.length > 8) warnings.push("More than eight options were returned; verify all options against the original image.");
  const sourceOptions = allOptions.filter((option) => {
    const text = typeof option === "string" ? option : option?.text;
    return isSourceSupported(text, sourcePage.text);
  });
  if (sourceOptions.length < allOptions.length) {
    warnings.push("One or more options were not supported by OCR text and were omitted.");
  }
  if (sourceOptions.some((option) => {
    const text = typeof option === "string" ? option : option?.text;
    return !isVerbatimSourcePhrase(text, sourcePage.text);
  })) {
    warnings.push("One or more option wordings differ from OCR; verify them against the original image.");
  }
  const rawOptions = sourceOptions.slice(0, 8);
  const structuredOptions = rawOptions.map((option, index) => {
    if (typeof option === "string") {
      return {
        optionId: crypto.randomUUID(),
        label: String.fromCharCode(65 + index),
        text: asText(option, 1000)
      };
    }
    return {
      optionId: crypto.randomUUID(),
      label: asText(option?.label, 20),
      text: asText(option?.text, 1000)
    };
  }).filter((option) => option.text);
  const requestedType = ["objective", "fill_in_gap", "theory", "unclassified"].includes(candidate.questionType)
    ? candidate.questionType
    : "";
  let questionType = requestedType || (structuredOptions.length >= 2 ? "objective" : "unclassified");
  let options = questionType === "objective" ? structuredOptions : [];
  if (questionType === "objective" && options.length < 2) {
    if (options.length === 0) {
      warnings.push("No objective choices were readable in the OCR; verify the question format and choices against the image.");
    } else {
      questionType = "unclassified";
      options = [];
      warnings.push("The objective question did not contain enough readable options to classify reliably.");
    }
  }
  if (requestedType && requestedType !== "objective" && structuredOptions.length) {
    warnings.push("Options were omitted because the question was classified as non-objective.");
  }
  let blankCount = null;
  if (questionType === "fill_in_gap") {
    const requestedBlankCount = Number(candidate.blankCount);
    blankCount = Number.isInteger(requestedBlankCount) && requestedBlankCount >= 1 && requestedBlankCount <= 20
      ? requestedBlankCount
      : countBlankMarkers(questionText);
    if (blankCount < 1 || blankCount > 20) {
      questionType = "unclassified";
      blankCount = null;
      warnings.push("The number of fill-in-the-gap blanks could not be established; select the type and blank count during review.");
    }
  }
  if (questionType === "unclassified" && requestedType !== "unclassified") {
    warnings.push("Question format could not be classified reliably; select it during review.");
  }

  const sourceText = sourcePage?.text || "";
  const rawAnswer = asText(candidate.possibleAnswer, 1000);
  const normalizedAnswer = normalizeForMatch(rawAnswer);
  const normalizedSource = normalizeForMatch(sourceText);
  const answerAppearsInSource = normalizedAnswer && normalizedSource.includes(normalizedAnswer);
  const answerMatchesOption = options.some((option) =>
    normalizeForMatch(option.label) === normalizedAnswer ||
    normalizeForMatch(option.text) === normalizedAnswer
  );
  const escapedAnswer = normalizedAnswer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const answerContext = normalizedAnswer && new RegExp(
    `\\b(?:answer|ans|answer key|correct answer|key)\\b.{0,40}\\b${escapedAnswer}\\b`
  ).test(normalizedSource);
  const possibleAnswer = rawAnswer && answerContext && answerAppearsInSource && answerMatchesOption
    ? rawAnswer
    : "";
  if (rawAnswer && !possibleAnswer) warnings.push("Possible answer was not confirmed in the OCR source and was omitted.");

  const rawExcerpt = asText(candidate.sourceExcerpt, 1000);
  const sourceExcerpt = rawExcerpt && sourceText.toLowerCase().includes(rawExcerpt.toLowerCase())
    ? rawExcerpt
    : "";
  if (rawExcerpt && !sourceExcerpt) warnings.push("AI source excerpt could not be verified against OCR text.");
  const rawExplanation = asText(candidate.explanation, 3000);
  const explanation = rawExplanation && isSourceSupported(rawExplanation, sourceText) ? rawExplanation : "";
  if (rawExplanation && !explanation) warnings.push("AI-generated explanation was not supported by OCR text and was omitted.");

  const confidence = Number(candidate.structuringConfidence);
  const structuringConfidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(1, confidence > 1 && confidence <= 100 ? confidence / 100 : confidence))
    : null;
  const requestedPage = Number(candidate.sourcePage);
  const sourcePageNumber = sourcePage
    ? requestedPage === sourcePage.pageNumber ? requestedPage : sourcePage.pageNumber
    : null;
  if (sourcePage && requestedPage && requestedPage !== sourcePage.pageNumber) {
    warnings.push("AI page reference did not match the selected source image and was corrected.");
  }

  return {
    questionNumber: asText(candidate.questionNumber, 40),
    questionText,
    questionType,
    blankCount,
    options,
    possibleAnswer,
    answerStatus: "unconfirmed",
    explanation,
    sourceImage: sourcePage?.imageId || null,
    sourcePage: sourcePageNumber,
    sourceExcerpt,
    ocrConfidence: sourcePage?.confidence ?? null,
    structuringConfidence,
    extractionWarnings: [...new Set(warnings)],
    reviewStatus: "pending"
  };
};

const toChunkFailure = (error, chunk, chunkIndex, chunkCount) => ({
  ...classifyStructuringError(error),
  chunkKey: chunk?.chunkKey || "",
  chunkIndex: Number.isInteger(chunkIndex) ? chunkIndex + 1 : null,
  chunkCount,
  sourceCharacterCount: chunk?.sourceCharacterCount || 0
});

const addResponseDiagnostics = (error, result) => {
  error.finishReason = typeof result.finishReason === "string" ? result.finishReason : "";
  error.outputCharacterCount = String(result.message || "").length;
  error.tokens = result.tokens;
  return error;
};

const structureQuestionDrafts = async ({
  pages,
  userId,
  completedChunkKeys = [],
  existingDrafts = [],
  onChunkSuccess = async () => {}
}) => {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw createStructuringError("STRUCTURING_NO_OCR", "No OCR text is available for structuring.");
  }
  const sourceLength = pages.reduce((total, page) => total + String(page.text || "").length, 0);
  if (sourceLength > MAX_SOURCE_TEXT_LENGTH) {
    throw createStructuringError(
      "STRUCTURING_SOURCE_TOO_LONG",
      "OCR text exceeds the safe structuring limit."
    );
  }

  const chunks = createStructuringChunks(pages);
  const completed = new Set((completedChunkKeys || []).map(String));
  const pendingChunks = chunks
    .map((chunk, index) => ({ ...chunk, index }))
    .filter((chunk) => !completed.has(chunk.chunkKey));
  const output = {
    drafts: [],
    completedChunkKeys: [],
    failures: [],
    warnings: [],
    chunkCount: chunks.length,
    provider: "gemini",
    model: ""
  };
  if (!pendingChunks.length) return output;

  let quotaReservation;
  try {
    quotaReservation = await gemini.reserveQuestionStructuringRequests(
      pendingChunks.map((chunk) => chunk.page),
      userId
    );
  } catch (error) {
    output.failures.push(toChunkFailure(error, null, null, chunks.length));
    return output;
  }

  let allDrafts = mergeUniqueDrafts([], existingDrafts);
  for (const chunk of pendingChunks) {
    let result;
    let chunkDrafts;
    let chunkWarnings;
    try {
      result = await gemini.structureQuestionDrafts([chunk.page], userId, quotaReservation);
      if (result.finishReason === "MAX_TOKENS") {
        throw createStructuringError("AI_RESPONSE_TRUNCATED", "Gemini truncated the response.", {
          finishReason: result.finishReason,
          outputCharacterCount: String(result.message || "").length,
          tokens: result.tokens
        });
      }

      let parsed;
      try {
        parsed = extractJson(result.message);
      } catch (error) {
        throw addResponseDiagnostics(error, result);
      }
      if (!parsed || !Array.isArray(parsed.questions)) {
        throw addResponseDiagnostics(
          createStructuringError("STRUCTURING_INVALID_SCHEMA", "AI returned an unsupported question structure."),
          result
        );
      }
      if (parsed.questions.length > MAX_DRAFT_COUNT) {
        throw addResponseDiagnostics(
          createStructuringError("STRUCTURING_DRAFT_LIMIT", "AI returned too many drafts in one section."),
          result
        );
      }

      const normalizedDrafts = parsed.questions
        .map((candidate) => candidate && typeof candidate === "object"
          ? normalizeDraft(candidate, [chunk.page])
          : null);
      const usableDrafts = normalizedDrafts.filter(Boolean);
      chunkDrafts = mergeUniqueDrafts([], usableDrafts);
      chunkWarnings = parsed.warnings && Array.isArray(parsed.warnings)
        ? parsed.warnings.filter((warning) => typeof warning === "string")
          .slice(0, 20)
          .map((warning) => warning.slice(0, 240))
        : [];
      const omittedDraftCount = parsed.questions.length - usableDrafts.length;
      if (omittedDraftCount) {
        chunkWarnings.push(
          `${omittedDraftCount} AI result(s) lacked reliable source text and were omitted. Review the saved OCR text and original images.`
        );
      }
      if (usableDrafts.length > chunkDrafts.length) {
        chunkWarnings.push("Duplicate question drafts in this section were ignored.");
      }
      if (parsed.questions.length > 0 && usableDrafts.length === 0) {
        chunkWarnings.push("No question text could be verified against the OCR source; review the saved OCR and image.");
      }
      const nextDrafts = mergeUniqueDrafts(allDrafts, chunkDrafts);
      if (nextDrafts.length > MAX_DRAFT_COUNT) {
        throw createStructuringError("STRUCTURING_DRAFT_LIMIT", "The batch exceeds the supported draft limit.");
      }
    } catch (error) {
      output.failures.push(toChunkFailure(error, chunk, chunk.index, chunks.length));
      continue;
    }

    await onChunkSuccess({
      chunkKey: chunk.chunkKey,
      chunkIndex: chunk.index + 1,
      chunkCount: chunks.length,
      drafts: chunkDrafts,
      warnings: chunkWarnings,
      provider: "gemini",
      model: result.model || gemini.getUsageStats().model || ""
    });
    allDrafts = mergeUniqueDrafts(allDrafts, chunkDrafts);
    output.drafts = mergeUniqueDrafts(output.drafts, chunkDrafts);
    output.completedChunkKeys.push(chunk.chunkKey);
    output.warnings.push(...chunkWarnings);
    output.model = result.model || output.model;
  }

  output.warnings = [...new Set(output.warnings)];
  return output;
};

module.exports = {
  MAX_SOURCE_TEXT_LENGTH,
  MAX_CHUNK_SOURCE_LENGTH,
  createStructuringChunks,
  mergeUniqueDrafts,
  classifyStructuringError,
  structureQuestionDrafts
};
