const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const crypto = require("crypto");
const protect = require("../config/middleware/authMiddleware");
const adminOnly = require("../config/middleware/adminOnly");
const Question = require("../models/Question");
const QuizSession = require("../models/QuizSession");
const Course = require("../models/course");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const QuestionExtraction = require("../models/QuestionExtraction");
const questionAccess = require("../services/questionAccessService");
const questionMarkingService = require("../services/questionMarkingService");
const practiceTestService = require("../services/practiceTestService");
const { toStudentQuestion } = questionAccess;

const createOptionIds = (options) => options.map(() => crypto.randomUUID());

const getCourseId = (course) => course?._id || course;
const idOf = (value) => String(value?._id || value || "");
const inputError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const readText = (value, fallback, field) => {
  const resolved = value === undefined ? fallback : value;
  if (resolved == null) return "";
  if (typeof resolved !== "string") throw inputError(`${field} must be text.`);
  return resolved.trim();
};

const sendAccessError = (res, access) =>
  res.status(access.statusCode).json({ success: false, message: access.message });

const sendQuestionError = (res, error, fallback) => {
  const statusCode = error.statusCode ||
    (["ValidationError", "CastError"].includes(error.name) ? 400 : error.code === 11000 ? 409 : 500);
  if (statusCode >= 500) console.error("Question bank request failed:", error.message);
  return res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? fallback : error.message
  });
};

const getSourcePaperForCourse = async (sourcePaperId, course) => {
  if (!mongoose.Types.ObjectId.isValid(String(sourcePaperId || ""))) {
    throw inputError("Invalid source paper ID.");
  }
  const paper = await PastQuestionPaper.findById(sourcePaperId);
  if (!paper) throw inputError("Source past-question paper not found.", 404);
  if (idOf(paper.course) !== idOf(course._id) ||
      idOf(paper.department) !== idOf(course.department) ||
      paper.level !== course.level ||
      paper.semester !== course.semester) {
    throw inputError("The source paper must belong to the selected course, department, level, and semester.");
  }
  return paper;
};

const sourcePaperFields = (paper) => ({
  sourcePaper: paper._id,
  sourcePaperMetadata: {
    title: paper.title,
    examinationYear: String(paper.examinationYear),
    level: paper.level,
    semester: paper.semester
  },
  sourceExamYear: String(paper.examinationYear)
});

const resolveSource = async (payload, course, existing) => {
  const batchId = payload.batchId === undefined
    ? String(existing?.extractionBatchId || "")
    : String(payload.batchId || "").trim();
  const sourcePaperId = payload.sourcePaperId === undefined
    ? idOf(existing?.sourcePaper)
    : String(payload.sourcePaperId || "").trim();

  if (batchId) {
    if (batchId.length > 64) throw inputError("Invalid extraction batch ID.");
    const batch = await QuestionExtraction.findOne({ batchId });
    if (!batch) throw inputError("Extraction batch not found.", 404);
    if (idOf(batch.course) !== idOf(course._id) ||
        idOf(batch.department) !== idOf(course.department) ||
        batch.academicLevel !== course.level ||
        batch.semester !== course.semester) {
      throw inputError("The extraction batch must match the selected course, department, level, and semester.");
    }
    if (sourcePaperId && sourcePaperId !== idOf(batch.sourcePaper)) {
      throw inputError("The source paper must match the selected extraction batch.");
    }
    if (batch.sourcePaper) {
      const paper = await getSourcePaperForCourse(batch.sourcePaper, course);
      return {
        extractionBatchId: batch.batchId,
        ...sourcePaperFields(paper),
        sourceAcademicSession: String(batch.academicSession || "")
      };
    }
    return {
      extractionBatchId: batch.batchId,
      sourcePaper: batch.sourcePaper || null,
      sourcePaperMetadata: batch.sourcePaperMetadata || undefined,
      sourceExamYear: String(batch.sourceExamYear || ""),
      sourceAcademicSession: String(batch.academicSession || "")
    };
  }

  if (!sourcePaperId) {
    return {
      extractionBatchId: "",
      sourcePaper: null,
      sourcePaperMetadata: undefined,
      sourceExamYear: "",
      sourceAcademicSession: ""
    };
  }
  const paper = await getSourcePaperForCourse(sourcePaperId, course);
  return {
    extractionBatchId: "",
    ...sourcePaperFields(paper),
    sourceAcademicSession: ""
  };
};

const getPublishedMarkingFields = async (question, userId) => {
  if (question.approvalStatus !== "approved") return {};
  const marking = await questionMarkingService.generateForQuestion(question._id, userId);
  return {
    markingStatus: marking.status,
    markingVersion: marking.version?._id || null
  };
};

const hasStudentAttempt = async (question) =>
  Number(question.timesAnswered || 0) > 0 ||
  Boolean(await QuizSession.exists({ "questions.questionId": question._id }));

const buildQuestionInput = async (payload, userId, existing) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw inputError("Question data must be an object.");
  }

  const courseId = payload.course === undefined ? idOf(existing?.course) : String(payload.course);
  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    throw inputError("A valid course is required.");
  }
  const course = await Course.findById(courseId);
  if (!course) throw inputError("Course not found.", 404);
  if (!mongoose.Types.ObjectId.isValid(idOf(course.department))) {
    throw inputError("The selected course has no valid department.", 409);
  }

  const questionText = readText(payload.question, existing?.question, "Question");
  const topic = readText(payload.topic, existing?.topic, "Topic");
  const questionNumber = readText(payload.questionNumber, existing?.questionNumber, "Question number");
  if (!questionText || questionText.length > 5000) {
    throw inputError("Question text is required and must be 5,000 characters or fewer.");
  }
  if (!topic || topic.length > 160) throw inputError("A topic is required and must be 160 characters or fewer.");
  if (questionNumber.length > 32) throw inputError("Question number must be 32 characters or fewer.");

  const questionType = payload.questionType ?? existing?.questionType ??
    (Array.isArray(payload.subQuestions) && payload.subQuestions.length ? undefined : "objective");
  if (questionType !== undefined && !["objective", "fill_in_gap", "theory"].includes(questionType)) {
    throw inputError("Select a supported question type.");
  }

  const optionsInput = payload.options === undefined ? existing?.options : payload.options;
  if (optionsInput !== undefined && !Array.isArray(optionsInput)) {
    throw inputError("Answer options must be a list.");
  }
  if ((optionsInput || []).length > 8) {
    throw inputError("A multiple-choice question can have at most 8 answer options.");
  }
  const options = (optionsInput || []).map((option) => {
    if (typeof option !== "string") throw inputError("Answer options must be text.");
    return option.trim();
  }).filter(Boolean);
  if (options.length > 8) throw inputError("A multiple-choice question can have at most 8 answer options.");

  const answer = readText(payload.answer, existing?.answer, "Answer");
  const explanation = readText(payload.explanation, existing?.explanation, "Explanation");
  if (answer.length > 10000 || explanation.length > 10000) {
    throw inputError("Answer and explanation must each be 10,000 characters or fewer.");
  }

  const approvalStatus = payload.approvalStatus ?? existing?.approvalStatus ?? "approved";
  if (!["draft", "approved"].includes(approvalStatus)) {
    throw inputError("Question status must be draft or published.");
  }
  const questionOrigin = payload.questionOrigin ?? existing?.questionOrigin ?? "verified_past_paper";
  if (!["verified_past_paper", "original_practice"].includes(questionOrigin)) {
    throw inputError("Select a supported question origin.");
  }

  const year = readText(payload.year, existing?.year ?? String(new Date().getFullYear()), "Examination year");
  if (!/^\d{4}$/.test(year)) throw inputError("Examination year must be a four-digit year.");
  const session = readText(payload.session, existing?.session ?? "Rain", "Examination session");
  if (!["Rain", "Harmattan"].includes(session)) {
    throw inputError("Select a valid examination session.");
  }
  const marks = Number(payload.marks ?? existing?.marks ?? 2);
  if (!Number.isFinite(marks) || marks <= 0 || marks > 100) {
    throw inputError("Marks must be greater than 0 and no more than 100.");
  }
  const difficulty = readText(payload.difficulty, existing?.difficulty ?? "medium", "Difficulty");
  if (!["easy", "medium", "hard"].includes(difficulty)) {
    throw inputError("Select a valid difficulty.");
  }

  const subQuestions = payload.subQuestions === undefined
    ? existing?.subQuestions
    : payload.subQuestions;
  if (subQuestions !== undefined && !Array.isArray(subQuestions)) {
    throw inputError("Sub-questions must be a list.");
  }
  const hasSubQuestions = Array.isArray(subQuestions) && subQuestions.length > 0;
  if (hasSubQuestions && subQuestions.some((item) =>
    !item || typeof item !== "object" || typeof item.question !== "string" ||
    !item.question.trim() || !Array.isArray(item.options) ||
    item.options.length < 2 || typeof item.answer !== "string" || !item.answer.trim()
  )) {
    throw inputError("Each sub-question must include question text, at least 2 options, and an answer.");
  }

  let blankCount;
  if (questionType === "fill_in_gap") {
    const rawBlankCount = payload.blankCount ?? existing?.blankCount;
    blankCount = rawBlankCount === undefined || rawBlankCount === "" ? undefined : Number(rawBlankCount);
  }
  if (approvalStatus === "approved") {
    if (questionType === "objective" && !hasSubQuestions) {
      if (options.length < 2) throw inputError("Add at least 2 answer options before publishing.");
      if (!answer || !options.includes(answer)) {
        throw inputError("Choose a correct answer from the answer options before publishing.");
      }
    }
    if (questionType === "fill_in_gap") {
      if (!Number.isInteger(blankCount) || blankCount < 1 || blankCount > 20) {
        throw inputError("Fill-in-the-gap questions need between 1 and 20 blanks before publishing.");
      }
      if (!answer) throw inputError("Add a correct answer before publishing.");
    }
    if (questionType === "theory" && options.length > 0) {
      throw inputError("Theory questions cannot have multiple-choice options.");
    }
  } else if (questionType === "objective" && answer && options.length >= 2 && !options.includes(answer)) {
    throw inputError("The selected correct answer must match one of the answer options.");
  }

  const resolvedSource = await resolveSource(payload, course, existing);
  if (questionOrigin === "original_practice" &&
      (resolvedSource.sourcePaper ||
       resolvedSource.extractionBatchId ||
       resolvedSource.sourcePaperMetadata ||
       resolvedSource.sourceExamYear ||
       resolvedSource.sourceAcademicSession ||
       existing?.extractionDraftId ||
       existing?.extractionKey)) {
    throw inputError("Original practice questions cannot include past-paper provenance or extraction batches.");
  }
  if (questionOrigin === "verified_past_paper" &&
      approvalStatus === "approved" &&
      !resolvedSource.sourcePaper) {
    throw inputError("An uploaded source past-question paper is required before publishing this question.");
  }
  if (resolvedSource.sourceExamYear && year !== resolvedSource.sourceExamYear) {
    throw inputError("Examination year must match the selected source paper.");
  }
  const sourcePageInput = Object.hasOwn(payload, "sourcePage")
    ? payload.sourcePage
    : existing?.sourcePage;
  const sourcePage = sourcePageInput === undefined || sourcePageInput === null || sourcePageInput === ""
    ? null
    : Number(sourcePageInput);
  if (sourcePage !== null && (!Number.isInteger(sourcePage) || sourcePage < 1)) {
    throw inputError("Source page must be a positive whole number.");
  }
  const sourceExcerpt = readText(payload.sourceExcerpt, existing?.sourceExcerpt, "Source excerpt");
  if (sourceExcerpt.length > 5000) throw inputError("Source excerpt must be 5,000 characters or fewer.");
  if (questionOrigin === "original_practice" &&
      (sourcePage !== null || sourceExcerpt)) {
    throw inputError("Original practice questions cannot include source pages or excerpts.");
  }

  const previousOptions = existing?.options || [];
  const previousOptionIds = existing?.optionIds || [];
  const optionIds = options.map((option, index) =>
    previousOptions[index] === option && previousOptionIds[index]
      ? previousOptionIds[index]
      : crypto.randomUUID()
  );
  const next = {
    course: course._id,
    department: getCourseId(course.department),
    topic,
    questionNumber,
    question: questionText,
    questionType,
    options: questionType === "objective" || !questionType ? options : [],
    optionIds: questionType === "objective" || !questionType ? optionIds : [],
    answer,
    explanation,
    year,
    session,
    marks,
    difficulty,
    questionOrigin,
    approvalStatus,
    approvedBy: approvalStatus === "approved" ? userId : null,
    approvedAt: approvalStatus === "approved" ? (existing?.approvalStatus === "approved" && !payload.approvalStatus
      ? existing.approvedAt
      : new Date()) : null,
    ...resolvedSource,
    sourcePage: questionOrigin === "original_practice" ? null : sourcePage,
    sourceExcerpt: questionOrigin === "original_practice" ? "" : sourceExcerpt
  };
  if (questionType === "fill_in_gap") next.blankCount = blankCount;
  if (hasSubQuestions) next.subQuestions = subQuestions;
  else if (payload.subQuestions !== undefined) next.subQuestions = [];
  return next;
};

// Question-bank management listing. Legacy records remain visible to administrators.
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 5 }, (_, index) => String(currentYear - index));
    const filter = req.query.all === "true" ? {} : { year: { $in: years } };
    const questions = await Question.find(filter).populate("course");
    return res.json({ success: true, questions });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:questionId/marking-diagnostic", protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.questionId)) {
      return res.status(400).json({ success: false, message: "Invalid question ID." });
    }
    const diagnostic = await practiceTestService.getQuestionMarkingDiagnostic(req.params.questionId);
    if (!diagnostic) return res.status(404).json({ success: false, message: "Question not found." });
    return res.json({ success: true, diagnostic });
  } catch (error) {
    return sendQuestionError(res, error, "Unable to load the marking diagnostic.");
  }
});

// Manual administrator-authored questions can be saved as drafts or published.
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const questionInput = await buildQuestionInput(req.body, req.user.id);
    const createdQuestion = await Question.create(questionInput);
    const markingFields = await getPublishedMarkingFields(createdQuestion, req.user.id);
    return res.json({ success: true, question: createdQuestion, ...markingFields });
  } catch (error) {
    return sendQuestionError(res, error, "Unable to save the question.");
  }
});

// BULK QUESTION IMPORT / CBT SET UPLOAD
router.post("/bulk", protect, adminOnly, async (req, res) => {
  try {
    const { course, questions } = req.body || {};
    if (!course || !mongoose.Types.ObjectId.isValid(String(course)) ||
        !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ success: false, message: "A valid course and questions array are required." });
    }

    const courseDoc = await Course.findById(course);
    if (!courseDoc) return res.status(404).json({ success: false, message: "Course not found." });

    const payloads = questions.map((item) => {
      const options = Array.isArray(item.options)
        ? item.options.map((option) => String(option).trim()).filter(Boolean)
        : [];
      return {
        course: getCourseId(courseDoc),
        department: getCourseId(courseDoc.department),
        topic: item.topic || item.subject || "",
        question: item.question || item.prompt || "",
        options,
        optionIds: createOptionIds(options),
        answer: item.answer || item.correctAnswer || "",
        explanation: item.explanation || "",
        year: item.year || String(new Date().getFullYear()),
        session: item.session || "Rain",
        marks: item.marks != null ? Number(item.marks) : 2,
        difficulty: item.difficulty || "medium",
        approvalStatus: "approved",
        approvedBy: req.user.id,
        approvedAt: new Date()
      };
    }).filter((item) => item.question && item.options.length >= 2 && item.answer);
    payloads.forEach((item) => {
      item.answer = String(item.answer).trim();
    });

    if (payloads.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid questions found in the provided payload."
      });
    }

    const createdQuestions = await Question.insertMany(payloads);
    return res.json({
      success: true,
      count: createdQuestions.length,
      questions: createdQuestions
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:questionId", protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.questionId)) {
      return res.status(400).json({ success: false, message: "Invalid question ID." });
    }
    const question = await Question.findById(req.params.questionId).populate("course");
    if (!question) return res.status(404).json({ success: false, message: "Question not found." });
    return res.json({ success: true, question });
  } catch (error) {
    return sendQuestionError(res, error, "Unable to load the question.");
  }
});

router.put("/:questionId", protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.questionId)) {
      return res.status(400).json({ success: false, message: "Invalid question ID." });
    }
    const question = await Question.findById(req.params.questionId);
    if (!question) return res.status(404).json({ success: false, message: "Question not found." });
    if (await hasStudentAttempt(question)) {
      return res.status(409).json({
        success: false,
        message: "Questions included in student attempts cannot be edited."
      });
    }
    const questionInput = await buildQuestionInput(req.body, req.user.id, question);
    Object.assign(question, questionInput);
    await question.save();
    const markingFields = await getPublishedMarkingFields(question, req.user.id);
    return res.json({ success: true, question, ...markingFields });
  } catch (error) {
    return sendQuestionError(res, error, "Unable to update the question.");
  }
});

router.delete("/:questionId", protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.questionId)) {
      return res.status(400).json({ success: false, message: "Invalid question ID." });
    }
    const question = await Question.findById(req.params.questionId);
    if (!question) return res.status(404).json({ success: false, message: "Question not found." });
    if (await hasStudentAttempt(question)) {
      return res.status(409).json({
        success: false,
        message: "Questions included in student attempts cannot be deleted."
      });
    }
    if (question.approvalStatus !== "draft") {
      return res.status(409).json({
        success: false,
        message: "Only unused draft questions can be deleted."
      });
    }
    const deleted = await Question.findOneAndDelete({
      _id: req.params.questionId,
      approvalStatus: "draft"
    });
    if (!deleted) {
      const currentQuestion = await Question.findById(req.params.questionId);
      if (!currentQuestion) return res.status(404).json({ success: false, message: "Question not found." });
      return res.status(409).json({
        success: false,
        message: "Only unused draft questions can be deleted."
      });
    }
    return res.json({ success: true, message: "Question deleted." });
  } catch (error) {
    return sendQuestionError(res, error, "Unable to delete the question.");
  }
});

// Course question retrieval returns full records only to administrators and assigned approved lecturers.
router.get("/course/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(courseId))) {
      return res.status(400).json({ success: false, message: "Invalid course ID." });
    }

    const access = await questionAccess.getCourseAccess(req.user.id, courseId);
    if (!access.allowed) return sendAccessError(res, access);

    const query = { course: courseId };
    if (!access.manager) query.approvalStatus = "approved";
    if (typeof req.query.year === "string" && req.query.year.trim()) query.year = req.query.year.trim();

    const questions = await Question.find(query).populate("course");
    return res.json({
      success: true,
      questions: access.manager ? questions : questions.map(toStudentQuestion)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Legacy random practice retrieval remains available only to eligible authenticated students and managers.
router.get("/quiz/:courseId", protect, async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(courseId))) {
      return res.status(400).json({ success: false, message: "Invalid course ID." });
    }

    const access = await questionAccess.getCourseAccess(req.user.id, courseId);
    if (!access.allowed) return sendAccessError(res, access);

    const matchQuery = {
      course: new mongoose.Types.ObjectId(courseId),
      approvalStatus: "approved",
      $expr: { $gte: [{ $size: "$options" }, 2] }
    };
    const sampled = await Question.aggregate([
      { $match: matchQuery },
      { $sample: { size: 10 } }
    ]);
    const questions = sampled
      .filter((question) => Array.isArray(question.options) && question.options.length >= 2)
      .map(toStudentQuestion);

    if (questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No approved objective questions are available for this course yet."
      });
    }

    return res.json({ success: true, questions });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
