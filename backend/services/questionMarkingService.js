const crypto = require("crypto");
const Question = require("../models/Question");
const Course = require("../models/course");
const QuestionMarkingVersion = require("../models/QuestionMarkingVersion");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const gemini = require("../utils/gemini");
const { stableOptionIds } = require("./questionAccessService");

const PROMPT_VERSION = "question-marking-v1";
const SCHEMA_VERSION = "1";
const TYPES = new Set(["objective", "fill_in_gap", "theory"]);
const idOf = (value) => String(value?._id || value || "");
const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const boundedText = (value, maxLength) =>
  typeof value === "string" && value.trim() && value.trim().length <= maxLength
    ? value.trim()
    : null;
const validMarks = (value) => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 100;
const closeEnough = (left, right) => Math.abs(left - right) <= 0.01;

const parseModelJson = (message) => {
  const text = String(message || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("The generated marking record must be a JSON object.");
  return parsed;
};

const exactKeys = (value, required) =>
  isRecord(value) &&
  Object.keys(value).length === required.length &&
  required.every((key) => Object.hasOwn(value, key));

const validateObjective = (output, verifier, optionIds) => {
  const errors = [];
  if (!exactKeys(output, ["answerOptionId", "explanation", "uncertain", "uncertaintyReason"]) ||
      !optionIds.includes(output.answerOptionId) ||
      !boundedText(output.explanation, 2000) ||
      typeof output.uncertain !== "boolean" ||
      typeof output.uncertaintyReason !== "string" ||
      output.uncertaintyReason.length > 1000 ||
      (output.uncertain && !output.uncertaintyReason.trim())) {
    return { status: "invalid", errors: ["The generated objective marking record is malformed."] };
  }
  if (!exactKeys(verifier, ["selectedOptionId", "uncertain", "uncertaintyReason"]) ||
      !optionIds.includes(verifier.selectedOptionId) ||
      typeof verifier.uncertain !== "boolean" ||
      typeof verifier.uncertaintyReason !== "string" ||
      verifier.uncertaintyReason.length > 1000 ||
      (verifier.uncertain && !verifier.uncertaintyReason.trim())) {
    return { status: "invalid", errors: ["The independent objective verification is malformed."] };
  }
  const reasons = [];
  if (output.uncertain && output.uncertaintyReason) reasons.push(output.uncertaintyReason.trim());
  if (verifier.uncertain && verifier.uncertaintyReason) reasons.push(verifier.uncertaintyReason.trim());
  if (output.answerOptionId !== verifier.selectedOptionId) {
    reasons.push("Independent answer assessments selected different options.");
  }
  if (reasons.length) {
    return {
      status: "uncertain",
      reasons: [...new Set(reasons)],
      marking: {
        objective: {
          correctOptionId: output.answerOptionId,
          verificationOptionId: verifier.selectedOptionId,
          explanation: output.explanation.trim()
        }
      }
    };
  }
  return {
    status: "ready",
    reasons: [],
    marking: {
      objective: {
        correctOptionId: output.answerOptionId,
        verificationOptionId: verifier.selectedOptionId,
        explanation: output.explanation.trim()
      }
    }
  };
};

const validateFillInGap = (output, blankCount, totalMarks) => {
  if (!exactKeys(output, ["uncertain", "uncertaintyReason", "blanks", "explanation", "totalMarks"]) ||
      typeof output.uncertain !== "boolean" ||
      typeof output.uncertaintyReason !== "string" ||
      output.uncertaintyReason.length > 1000 ||
      (output.uncertain && !output.uncertaintyReason.trim()) ||
      !boundedText(output.explanation, 2000) ||
      !Number.isFinite(output.totalMarks) ||
      !closeEnough(output.totalMarks, totalMarks) ||
      !Array.isArray(output.blanks) ||
      output.blanks.length !== blankCount) {
    return { status: "invalid", errors: ["The generated fill-in-the-gap marking record is malformed."] };
  }

  const seen = new Set();
  let allocatedMarks = 0;
  const blanks = [];
  for (const blank of output.blanks) {
    if (!exactKeys(blank, ["blankNumber", "expectedAnswer", "acceptableAnswers", "gradingCriteria", "semanticGuidance"]) ||
        !Number.isInteger(blank.blankNumber) ||
        blank.blankNumber < 1 ||
        blank.blankNumber > blankCount ||
        seen.has(blank.blankNumber) ||
        !boundedText(blank.expectedAnswer, 500) ||
        !Array.isArray(blank.acceptableAnswers) ||
        blank.acceptableAnswers.length > 20 ||
        blank.acceptableAnswers.some((answer) => !boundedText(answer, 300)) ||
        !Array.isArray(blank.gradingCriteria) ||
        blank.gradingCriteria.length < 1 ||
        blank.gradingCriteria.length > 10 ||
        !boundedText(blank.semanticGuidance, 1000)) {
      return { status: "invalid", errors: ["A fill-in-the-gap answer or grading criterion is malformed."] };
    }
    let blankMarks = 0;
    const gradingCriteria = [];
    for (const criterion of blank.gradingCriteria) {
      if (!exactKeys(criterion, ["criterion", "marks"]) ||
          !boundedText(criterion.criterion, 500) ||
          !Number.isFinite(criterion.marks) ||
          criterion.marks < 0 ||
          criterion.marks > totalMarks) {
        return { status: "invalid", errors: ["A fill-in-the-gap mark allocation is invalid."] };
      }
      blankMarks += criterion.marks;
      gradingCriteria.push({ criterion: criterion.criterion.trim(), marks: criterion.marks });
    }
    if (blankMarks <= 0) {
      return { status: "invalid", errors: ["Each fill-in-the-gap blank must have positive marks."] };
    }
    seen.add(blank.blankNumber);
    allocatedMarks += blankMarks;
    blanks.push({
      blankNumber: blank.blankNumber,
      expectedAnswer: blank.expectedAnswer.trim(),
      acceptableAnswers: [...new Set([blank.expectedAnswer.trim(), ...blank.acceptableAnswers.map((answer) => answer.trim())])],
      gradingCriteria,
      semanticGuidance: blank.semanticGuidance.trim(),
      marks: blankMarks
    });
  }
  if (!closeEnough(allocatedMarks, totalMarks)) {
    return { status: "invalid", errors: ["Fill-in-the-gap criteria do not sum to the question's total marks."] };
  }
  return {
    status: output.uncertain ? "uncertain" : "ready",
    reasons: output.uncertain && output.uncertaintyReason.trim() ? [output.uncertaintyReason.trim()] : [],
    marking: {
      fillInGap: {
        blanks: blanks.sort((left, right) => left.blankNumber - right.blankNumber),
        explanation: output.explanation.trim(),
        totalMarks
      }
    }
  };
};

const validateTheory = (output, totalMarks) => {
  if (!exactKeys(output, ["uncertain", "uncertaintyReason", "referenceAnswer", "criteria", "explanation", "totalMarks"]) ||
      typeof output.uncertain !== "boolean" ||
      typeof output.uncertaintyReason !== "string" ||
      output.uncertaintyReason.length > 1000 ||
      (output.uncertain && !output.uncertaintyReason.trim()) ||
      !boundedText(output.referenceAnswer, 5000) ||
      !boundedText(output.explanation, 2000) ||
      !Number.isFinite(output.totalMarks) ||
      !closeEnough(output.totalMarks, totalMarks) ||
      !Array.isArray(output.criteria) ||
      output.criteria.length < 1 ||
      output.criteria.length > 20) {
    return { status: "invalid", errors: ["The generated theory marking record is malformed."] };
  }

  const ids = new Set();
  let allocatedMarks = 0;
  const criteria = [];
  for (const criterion of output.criteria) {
    if (!exactKeys(criterion, ["criterionId", "description", "marks", "acceptableAlternatives"]) ||
        !boundedText(criterion.criterionId, 40) ||
        ids.has(criterion.criterionId) ||
        !boundedText(criterion.description, 1000) ||
        !Number.isFinite(criterion.marks) ||
        criterion.marks <= 0 ||
        criterion.marks > totalMarks ||
        !Array.isArray(criterion.acceptableAlternatives) ||
        criterion.acceptableAlternatives.length > 20 ||
        criterion.acceptableAlternatives.some((answer) => !boundedText(answer, 500))) {
      return { status: "invalid", errors: ["A theory marking criterion is malformed."] };
    }
    ids.add(criterion.criterionId);
    allocatedMarks += criterion.marks;
    criteria.push({
      criterionId: criterion.criterionId.trim(),
      description: criterion.description.trim(),
      marks: criterion.marks,
      acceptableAlternatives: criterion.acceptableAlternatives.map((answer) => answer.trim())
    });
  }
  if (!closeEnough(allocatedMarks, totalMarks)) {
    return { status: "invalid", errors: ["Theory marking criteria do not sum to the question's total marks."] };
  }
  return {
    status: output.uncertain ? "uncertain" : "ready",
    reasons: output.uncertain && output.uncertaintyReason.trim() ? [output.uncertaintyReason.trim()] : [],
    marking: {
      theory: {
        referenceAnswer: output.referenceAnswer.trim(),
        criteria,
        explanation: output.explanation.trim(),
        totalMarks
      }
    }
  };
};

const buildQuestionInput = (question, sourcePaper) => {
  const questionOrigin = question.questionOrigin || "verified_past_paper";
  if (!["verified_past_paper", "original_practice"].includes(questionOrigin)) {
    return { error: "The question origin is missing or unsupported." };
  }
  const hasSourceProvenance = Boolean(
    question.sourcePaper ||
    question.sourcePaperMetadata ||
    question.sourceExamYear ||
    question.sourceAcademicSession ||
    (question.sourcePage !== undefined && question.sourcePage !== null && question.sourcePage !== "") ||
    question.sourceExcerpt ||
    question.extractionBatchId ||
    question.extractionDraftId ||
    question.extractionKey
  );
  if (questionOrigin === "original_practice" && (sourcePaper || hasSourceProvenance)) {
    return { error: "Original practice questions cannot include past-paper provenance." };
  }
  if (questionOrigin === "verified_past_paper" && !sourcePaper) {
    return { error: "A verified past-question paper is required for this question origin." };
  }
  const questionType = question.questionType ||
    (Array.isArray(question.options) && question.options.length >= 2 ? "objective" : "");
  if (!TYPES.has(questionType)) return { error: "The question type is missing or unsupported." };
  if (!validMarks(Number(question.marks))) return { error: "The question has invalid total marks." };

  const input = {
    questionType,
    questionText: String(question.question || "").trim(),
    topic: String(question.topic || "").trim(),
    marks: Number(question.marks),
    courseId: idOf(question.course),
    departmentId: idOf(question.department),
    questionYear: String(question.year || ""),
    questionSession: String(question.session || "Rain"),
    sourceExamYear: String(question.sourceExamYear || ""),
    sourceAcademicSession: String(question.sourceAcademicSession || ""),
    source: sourcePaper ? {
      paperId: idOf(sourcePaper),
      title: sourcePaper.title,
      examinationYear: String(sourcePaper.examinationYear),
      level: sourcePaper.level,
      semester: sourcePaper.semester,
      page: Number.isInteger(question.sourcePage) ? question.sourcePage : null,
      excerpt: String(question.sourceExcerpt || "").slice(0, 1000)
    } : null
  };
  if (!input.questionText || input.questionText.length > 5000) {
    return { error: "The approved question text is invalid." };
  }
  if (questionType === "objective") {
    const options = Array.isArray(question.options) ? question.options : [];
    const optionIds = stableOptionIds(question);
    if (options.length < 2 || options.length > 8 ||
        optionIds.length !== options.length ||
        new Set(optionIds).size !== optionIds.length ||
        options.some((option) => typeof option !== "string" || !option.trim() || option.length > 1000)) {
      return { error: "The objective question does not have valid unique options." };
    }
    input.options = options.map((text, index) => ({ optionId: optionIds[index], text: text.trim() }));
  } else if (questionType === "fill_in_gap") {
    if (!Number.isInteger(question.blankCount) || question.blankCount < 1 || question.blankCount > 20) {
      return { error: "The fill-in-the-gap question must specify between 1 and 20 blanks." };
    }
    input.blankCount = question.blankCount;
  }

  return { input };
};

const buildContentHash = (question, input) => digest(JSON.stringify({
  questionType: input.questionType,
  questionText: input.questionText,
  topic: input.topic,
  course: input.courseId,
  department: input.departmentId,
  questionYear: input.questionYear,
  questionSession: input.questionSession,
  sourceExamYear: input.sourceExamYear,
  sourceAcademicSession: input.sourceAcademicSession,
  options: input.options || [],
  blankCount: input.blankCount || null,
  marks: input.marks,
  source: input.source,
  questionNumber: String(question.questionNumber || "")
}));

const getQuestionSourceState = (question, course, sourcePaper, questionOrigin) => {
  if (!course ||
      idOf(course._id) !== idOf(question.course) ||
      idOf(course.department) !== idOf(question.department)) {
    return {
      status: "invalid",
      error: "The question does not have a valid course and department association."
    };
  }
  if (!["verified_past_paper", "original_practice"].includes(questionOrigin)) {
    return { status: "invalid", error: "The question origin is missing or unsupported." };
  }
  if (questionOrigin === "original_practice" &&
      (sourcePaper || question.sourcePaper || question.sourcePaperMetadata ||
       question.sourceExamYear || question.sourceAcademicSession ||
       (question.sourcePage !== undefined && question.sourcePage !== null && question.sourcePage !== "") ||
       question.sourceExcerpt || question.extractionBatchId ||
       question.extractionDraftId || question.extractionKey)) {
    return {
      status: "invalid",
      error: "Original practice questions cannot include past-paper provenance."
    };
  }
  if (questionOrigin === "verified_past_paper" && !question.sourcePaper) {
    return { status: "needs_source", error: "No uploaded source paper is linked to this question." };
  }
  if (questionOrigin === "verified_past_paper" && !sourcePaper) {
    return { status: "needs_source", error: "The linked source paper is unavailable." };
  }
  if (questionOrigin === "verified_past_paper" &&
      (idOf(sourcePaper.course) !== idOf(question.course) ||
       idOf(sourcePaper.department) !== idOf(question.department) ||
       sourcePaper.level !== course.level ||
       sourcePaper.semester !== course.semester ||
       String(question.year || "") !== String(sourcePaper.examinationYear) ||
       String(question.sourceExamYear || "") !== String(sourcePaper.examinationYear) ||
       !question.sourcePaperMetadata ||
       question.sourcePaperMetadata.title !== sourcePaper.title ||
       String(question.sourcePaperMetadata.examinationYear) !== String(sourcePaper.examinationYear) ||
       question.sourcePaperMetadata.level !== sourcePaper.level ||
       question.sourcePaperMetadata.semester !== sourcePaper.semester)) {
    return {
      status: "invalid",
      error: "The source paper does not match the approved question's course provenance."
    };
  }
  return { status: "", error: "" };
};

const isStoredMarkingUsable = (question, marking) => {
  const questionType = question.questionType ||
    (Array.isArray(question.options) && question.options.length >= 2 ? "objective" : "");

  if (questionType === "objective") {
    const objective = marking?.objective;
    if (!isRecord(objective)) return false;
    return validateObjective(
      {
        answerOptionId: objective.correctOptionId,
        explanation: objective.explanation,
        uncertain: false,
        uncertaintyReason: ""
      },
      {
        selectedOptionId: objective.verificationOptionId,
        uncertain: false,
        uncertaintyReason: ""
      },
      stableOptionIds(question)
    ).status === "ready";
  }

  if (questionType === "fill_in_gap") {
    const fillInGap = marking?.fillInGap;
    if (!isRecord(fillInGap) || !Array.isArray(fillInGap.blanks)) return false;
    const storedAnswersAreAccepted = fillInGap.blanks.every((blank) =>
      isRecord(blank) &&
      Array.isArray(blank.acceptableAnswers) &&
      blank.acceptableAnswers.some((answer) =>
        typeof answer === "string" &&
        answer.trim().toLowerCase() === String(blank.expectedAnswer || "").trim().toLowerCase())
    );
    if (!storedAnswersAreAccepted) return false;
    return validateFillInGap({
      uncertain: false,
      uncertaintyReason: "",
      blanks: fillInGap.blanks.map((blank) => isRecord(blank) ? {
        blankNumber: blank.blankNumber,
        expectedAnswer: blank.expectedAnswer,
        acceptableAnswers: blank.acceptableAnswers,
        gradingCriteria: blank.gradingCriteria,
        semanticGuidance: blank.semanticGuidance
      } : blank),
      explanation: fillInGap.explanation,
      totalMarks: fillInGap.totalMarks
    }, question.blankCount, Number(question.marks)).status === "ready";
  }

  if (questionType === "theory") {
    const theory = marking?.theory;
    if (!isRecord(theory)) return false;
    return validateTheory({
      uncertain: false,
      uncertaintyReason: "",
      referenceAnswer: theory.referenceAnswer,
      criteria: theory.criteria,
      explanation: theory.explanation,
      totalMarks: theory.totalMarks
    }, Number(question.marks)).status === "ready";
  }
  return false;
};

const markingVersionMetadataMatches = (existing, versionData) => {
  const sourceMetadataMatches = versionData.sourcePaperMetadata
    ? isRecord(existing.sourcePaperMetadata) &&
      existing.sourcePaperMetadata.title === versionData.sourcePaperMetadata.title &&
      String(existing.sourcePaperMetadata.examinationYear) ===
        String(versionData.sourcePaperMetadata.examinationYear) &&
      existing.sourcePaperMetadata.level === versionData.sourcePaperMetadata.level &&
      existing.sourcePaperMetadata.semester === versionData.sourcePaperMetadata.semester
    : !existing.sourcePaperMetadata;
  return idOf(existing.question) === idOf(versionData.question) &&
    idOf(existing.course) === idOf(versionData.course) &&
    idOf(existing.department) === idOf(versionData.department) &&
    existing.questionYear === versionData.questionYear &&
    existing.questionSession === versionData.questionSession &&
    existing.sourceExamYear === versionData.sourceExamYear &&
    existing.sourceAcademicSession === versionData.sourceAcademicSession &&
    existing.questionType === versionData.questionType &&
    existing.questionOrigin === versionData.questionOrigin &&
    existing.contentHash === versionData.contentHash &&
    existing.promptVersion === versionData.promptVersion &&
    existing.schemaVersion === versionData.schemaVersion &&
    existing.provider === versionData.provider &&
    existing.model === versionData.model &&
    idOf(existing.sourcePaper) === idOf(versionData.sourcePaper) &&
    sourceMetadataMatches &&
    (existing.sourcePage || null) === (versionData.sourcePage || null) &&
    (existing.sourceExcerpt || "") === versionData.sourceExcerpt;
};

const isQuestionSnapshotCurrent = async (question, contentHash) => {
  const currentQuestion = await Question.findOne({
    _id: question._id,
    course: question.course,
    department: question.department,
    approvalStatus: "approved"
  });
  if (!currentQuestion) return false;

  const currentCourse = await Course.findById(currentQuestion.course);
  const currentSourcePaper = currentQuestion.sourcePaper
    ? await PastQuestionPaper.findById(currentQuestion.sourcePaper)
    : null;
  const questionOrigin = currentQuestion.questionOrigin || "verified_past_paper";
  const sourceState = getQuestionSourceState(
    currentQuestion,
    currentCourse,
    currentSourcePaper,
    questionOrigin
  );
  if (sourceState.error) return false;

  const prepared = buildQuestionInput(currentQuestion, currentSourcePaper);
  return Boolean(prepared.input &&
    buildContentHash(currentQuestion, prepared.input) === contentHash);
};

const safeFailureCode = (error) => {
  if (error?.statusCode === 503) return "not_configured";
  if (error?.statusCode === 429) return "rate_limited";
  return "provider_error";
};

const persistInitialVersion = async (versionData, question) => {
  const existing = await QuestionMarkingVersion.findOne({ generationKey: versionData.generationKey });
  if (existing) {
    const readyVersionIsReusable = existing.status === "ready" &&
      markingVersionMetadataMatches(existing, versionData) &&
      isStoredMarkingUsable(question, existing.marking);
    const generationIsActive = existing.status === "generating" &&
      existing.generationStartedAt &&
      Date.now() - new Date(existing.generationStartedAt).getTime() < 10 * 60 * 1000;
    if (readyVersionIsReusable ||
        ["uncertain", "invalid", "needs_source"].includes(existing.status) ||
        generationIsActive) {
      return { record: existing, shouldGenerate: false };
    }
    Object.assign(existing, versionData);
    existing.status = "generating";
    existing.failureCode = "";
    existing.validationErrors = [];
    existing.generationStartedAt = new Date();
    await existing.save();
    return { record: existing, shouldGenerate: true };
  }

  const version = (await QuestionMarkingVersion.countDocuments({ question: versionData.question })) + 1;
  try {
    const record = await QuestionMarkingVersion.create({
      ...versionData,
      version,
      status: "generating",
      generationStartedAt: new Date()
    });
    return { record, shouldGenerate: true };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const record = await QuestionMarkingVersion.findOne({ generationKey: versionData.generationKey });
    if (!record) throw error;
    return { record, shouldGenerate: false };
  }
};

const generateForQuestion = async (questionId, userId, options = {}) => {
  const question = options.expectedCourseId
    ? await Question.findOne({ _id: questionId, course: options.expectedCourseId })
    : await Question.findById(questionId);
  if (!question && options.expectedCourseId) {
    return { status: "invalid", reason: "The question is no longer in the expected course." };
  }
  if (!question || question.approvalStatus !== "approved") {
    return { status: "invalid", reason: "Only an approved question can receive an AI marking record." };
  }

  const questionType = question.questionType ||
    (Array.isArray(question.options) && question.options.length >= 2 ? "objective" : "");
  const questionOrigin = question.questionOrigin || "verified_past_paper";
  const course = await Course.findById(question.course);
  const sourcePaper = question.sourcePaper
    ? await PastQuestionPaper.findById(question.sourcePaper)
    : null;
  const prepared = questionType && (
    questionOrigin === "original_practice" ||
    (questionOrigin === "verified_past_paper" && sourcePaper)
  )
    ? buildQuestionInput(question, sourcePaper)
    : { input: null };
  const contentHash = prepared.input
    ? buildContentHash(question, prepared.input)
    : digest(JSON.stringify({
      question: idOf(question._id),
      questionOrigin,
      questionType,
      text: String(question.question || ""),
      topic: String(question.topic || ""),
      course: idOf(question.course),
      department: idOf(question.department),
      year: String(question.year || ""),
      session: String(question.session || ""),
      sourceExamYear: String(question.sourceExamYear || ""),
      sourceAcademicSession: String(question.sourceAcademicSession || ""),
      options: Array.isArray(question.options) ? question.options : [],
      blankCount: question.blankCount || null,
      marks: Number(question.marks),
      sourcePaper: idOf(question.sourcePaper),
      sourcePage: question.sourcePage || null,
      sourceExcerpt: String(question.sourceExcerpt || "")
    }));
  const modelName = gemini.getUsageStats().model;
  const generationKey = digest(JSON.stringify([
    idOf(question._id),
    contentHash,
    PROMPT_VERSION,
    SCHEMA_VERSION,
    "gemini",
    modelName
  ]));

  const sourceState = getQuestionSourceState(question, course, sourcePaper, questionOrigin);

  const sourcePaperMetadata = sourcePaper
    ? {
      title: sourcePaper.title,
      examinationYear: String(sourcePaper.examinationYear),
      level: sourcePaper.level,
      semester: sourcePaper.semester
    }
    : undefined;
  const versionData = {
    question: question._id,
    generationKey,
    questionType: TYPES.has(questionType) ? questionType : "objective",
    contentHash,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    provider: "gemini",
    model: modelName,
    course: question.course,
    department: question.department,
    questionYear: String(question.year || ""),
    questionSession: question.session || "Rain",
    sourceExamYear: String(question.sourceExamYear || ""),
    sourceAcademicSession: String(question.sourceAcademicSession || ""),
    questionOrigin,
    sourcePaper: sourcePaper?._id || null,
    sourcePaperMetadata,
    sourcePage: Number.isInteger(question.sourcePage) ? question.sourcePage : null,
    sourceExcerpt: String(question.sourceExcerpt || "").slice(0, 1000)
  };
  const { record, shouldGenerate } = await persistInitialVersion(versionData, question);
  if (!shouldGenerate) return { status: record.status, version: record };

  if (sourceState.error) {
    record.status = sourceState.status;
    record.validationErrors = [sourceState.error];
    record.generatedAt = new Date();
    await record.save();
    return { status: record.status, version: record };
  }
  if (prepared.error) {
    record.status = "invalid";
    record.validationErrors = [prepared.error];
    record.generatedAt = new Date();
    await record.save();
    return { status: record.status, version: record };
  }

  try {
    const generated = await gemini.generateQuestionMarking(prepared.input, userId);
    if (!await isQuestionSnapshotCurrent(question, contentHash)) {
      record.status = "failed";
      record.failureCode = "";
      record.validationErrors = ["The question or course changed during marking generation."];
      record.generatedAt = new Date();
      await record.save();
      return { status: record.status, version: record };
    }
    const output = parseModelJson(generated.message);
    let result;
    if (questionType === "objective") {
      const verifier = parseModelJson(generated.verifierMessage);
      result = validateObjective(output, verifier, prepared.input.options.map((option) => option.optionId));
    } else if (questionType === "fill_in_gap") {
      result = validateFillInGap(output, prepared.input.blankCount, prepared.input.marks);
    } else {
      result = validateTheory(output, prepared.input.marks);
    }
    record.status = result.status;
    record.marking = result.marking;
    record.uncertaintyReasons = result.reasons || [];
    record.validationErrors = result.errors || [];
    record.generatedAt = new Date();
    await record.save();
    return { status: record.status, version: record };
  } catch (error) {
    record.status = error instanceof SyntaxError ? "invalid" : "failed";
    record.failureCode = error instanceof SyntaxError ? "" : safeFailureCode(error);
    record.validationErrors = error instanceof SyntaxError
      ? ["The AI response was not valid JSON."]
      : [];
    record.generatedAt = new Date();
    await record.save();
    return { status: record.status, version: record };
  }
};

module.exports = {
  generateForQuestion,
  parseModelJson,
  validateObjective,
  validateFillInGap,
  validateTheory,
  buildQuestionInput,
  buildContentHash
};
