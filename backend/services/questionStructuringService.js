const crypto = require("crypto");
const gemini = require("../utils/gemini");
const MAX_SOURCE_TEXT_LENGTH = 45000;

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
  if (start < 0 || end <= start) throw new Error("AI returned an invalid question structure.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("AI returned an invalid question structure.");
  }
};

const asText = (value, maxLength) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

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

  const allOptions = Array.isArray(candidate.options) ? candidate.options : [];
  if (allOptions.length > 8) warnings.push("More than eight options were returned; verify all options against the original image.");
  const sourceOptions = allOptions.filter((option) => {
    const text = typeof option === "string" ? option : option?.text;
    return isSourceSupported(text, sourcePage.text);
  });
  if (sourceOptions.length < allOptions.length) {
    warnings.push("One or more options were not supported by OCR text and were omitted.");
  }
  const rawOptions = sourceOptions.slice(0, 8);
  const options = rawOptions.map((option, index) => {
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

const structureQuestionDrafts = async ({ pages, userId }) => {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("No OCR text is available for structuring.");
  }
  const sourceLength = pages.reduce((total, page) => total + String(page.text || "").length, 0);
  if (sourceLength > MAX_SOURCE_TEXT_LENGTH) {
    throw new Error("OCR text exceeds the structuring limit. The saved text is intact; retry with smaller image batches.");
  }

  const result = await gemini.structureQuestionDrafts(pages, userId);
  const parsed = extractJson(result.message);
  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new Error("AI returned an invalid question structure.");
  }

  if (parsed.questions.length > 100) {
    throw new Error("AI returned more than the supported draft limit; OCR text is preserved for a narrower retry.");
  }
  const drafts = parsed.questions
    .map((candidate) => normalizeDraft(candidate || {}, pages))
    .filter(Boolean);
  const warnings = parsed.warnings && Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((warning) => typeof warning === "string").slice(0, 20).map((warning) => warning.slice(0, 240))
    : [];
  const omittedDraftCount = parsed.questions.length - drafts.length;
  if (omittedDraftCount) {
    warnings.push(`${omittedDraftCount} draft(s) lacked reliable source text and were omitted. Review the saved OCR text and original images.`);
  }

  return {
    drafts,
    provider: "gemini",
    model: result.model || gemini.getUsageStats().model,
    warnings
  };
};

module.exports = { structureQuestionDrafts };
