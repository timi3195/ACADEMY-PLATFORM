const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const QuizSession = require("../models/QuizSession");
const User = require("../models/User");
const protect = require("../config/middleware/authMiddleware");
const questionAccess = require("../services/questionAccessService");
const practiceTestService = require("../services/practiceTestService");
const shuffle = require("../utils/shuffle");
const quizSessionService = require("../services/quizSessionService");
const quizGradingService = require("../services/quizGradingService");
const {
  getVerifiedLegacyResult,
  getVerifiedTypedResult,
  hasCompletionEvidence,
  isLegacyAttempt
} = require("../utils/legacyQuizResult");

const getAuthenticatedUserId = (req) => req.user.id;
const DEFAULT_QUESTION_COUNT = 10;

const questionTypeOf = (question) => question.questionType || "objective";
const cloneMarkingSnapshot = (marking) => JSON.parse(JSON.stringify(marking));
const gradeCompletedAttempt = async (session, userId) => {
  if (!session ||
      !(session.attemptFormatVersion >= 2) ||
      (session.status !== "completed" && !session.timeEnded)) return session;
  const result = await quizGradingService.gradeAttempt({ attemptId: session._id, userId });
  return result.session || session;
};

router.get("/coverage", protect, async (req, res) => {
  try {
    const user = await User.findById(getAuthenticatedUserId(req));
    if (!user) {
      return res.status(401).json({ success: false, message: "Authenticated user not found." });
    }

    const courses = await practiceTestService.getAccessibleCourseCoverage(user);
    return res.json({
      success: true,
      supportedQuestionCounts: practiceTestService.PRACTICE_TEST_LENGTHS,
      courses
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to load CBT course coverage."
    });
  }
});

router.post("/start", protect, async (req, res) => {
  try {
    const body = req.body || {};
    const allowedFields = ["courseId", "questionCount"];
    if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
      return res.status(400).json({
        success: false,
        message: "Start request may contain only courseId and questionCount."
      });
    }

    const { courseId } = body;
    const durationMinutes = quizSessionService.getConfiguredDurationMinutes();
    const questionCount = body.questionCount === undefined
      ? DEFAULT_QUESTION_COUNT
      : body.questionCount;
    if (!practiceTestService.PRACTICE_TEST_LENGTHS.includes(questionCount)) {
      return res.status(400).json({
        success: false,
        message: `questionCount must be one of ${practiceTestService.PRACTICE_TEST_LENGTHS.join(", ")}.`
      });
    }

    if (!mongoose.Types.ObjectId.isValid(String(courseId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid course ID." });
    }

    const actingUserId = getAuthenticatedUserId(req);
    const access = await questionAccess.getCourseAccess(actingUserId, courseId);
    if (!access.allowed) {
      return res.status(access.statusCode).json({ success: false, message: access.message });
    }

    const activeQuery = {
      user: actingUserId,
      course: access.course._id,
      $or: [
        { status: "in_progress" },
        { status: { $exists: false }, timeEnded: { $exists: false } }
      ]
    };
    const activeAttempt = await QuizSession.findOne(activeQuery).sort({ createdAt: -1 });
    if (activeAttempt && !quizSessionService.isExpired(activeAttempt, new Date())) {
      return res.status(409).json({
        success: false,
        code: "ACTIVE_ATTEMPT_EXISTS",
        message: "An active attempt already exists for this course.",
        attempt: quizSessionService.toStudentAttempt(activeAttempt, new Date())
      });
    }
    if (activeAttempt) {
      await quizSessionService.finalizeAttempt(activeAttempt._id, {
        userId: actingUserId,
        reason: "expired"
      });
    }

    const selection = await practiceTestService.assemblePracticeTest(access.course, questionCount);
    if (!selection.ok) {
      const availableTestLengths = practiceTestService.PRACTICE_TEST_LENGTHS.filter((length) =>
        selection.eligibleQuestionCount >= length
      );
      return res.status(selection.eligibleQuestionCount === 0 ? 404 : 409).json({
        success: false,
        eligibleQuestionCount: selection.eligibleQuestionCount,
        availableTestLengths,
        message: selection.eligibleQuestionCount === 0
          ? "No approved, source-verified questions with usable AI marking are available for this course yet."
          : `Only ${selection.eligibleQuestionCount} eligible questions are available; ${questionCount} were requested.`
      });
    }

    const examQuestions = selection.entries.map(({ question, paper, markingVersion }, index) => {
      const questionType = questionTypeOf(question);
      const optionIds = questionType === "objective"
        ? questionAccess.stableOptionIds(question)
        : [];
      const presentedOptions = questionType === "objective"
        ? shuffle(question.options.map((text, optionIndex) => ({
          optionId: optionIds[optionIndex],
          text
        })))
        : [];
      return {
        questionId: question._id,
        question: question.question,
        questionType,
        questionOrder: index + 1,
        blankCount: questionType === "fill_in_gap" ? question.blankCount : undefined,
        marks: Number(question.marks),
        topic: question.topic,
        presentedOptions,
        sourceSnapshot: {
          paperId: paper._id,
          title: paper.title,
          examinationYear: String(paper.examinationYear),
          level: paper.level,
          semester: paper.semester,
          page: Number.isInteger(question.sourcePage) ? question.sourcePage : undefined,
          excerpt: String(question.sourceExcerpt || "").slice(0, 1000)
        },
        markingVersionId: markingVersion._id,
        markingSnapshot: cloneMarkingSnapshot(markingVersion.marking),
        selectedAnswers: questionType === "fill_in_gap" ? Array(question.blankCount).fill("") : undefined,
        theoryResponse: questionType === "theory" ? "" : undefined
      };
    });

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
    const session = await QuizSession.create({
      user: actingUserId,
      course: access.course._id,
      questions: examQuestions,
      totalQuestions: examQuestions.length,
      score: null,
      percentage: null,
      attemptFormatVersion: 2,
      activeAttempt: true,
      gradingStatus: "pending",
      status: "in_progress",
      timeStarted: startedAt,
      startedAt,
      expiresAt,
      durationMinutes,
      stateVersion: 0
    });
    const serverNow = new Date();

    return res.status(201).json({
      success: true,
      attemptId: session._id,
      ...quizSessionService.toStudentAttempt(session, serverNow)
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "ACTIVE_ATTEMPT_EXISTS",
        message: "An active attempt already exists for this course."
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/health", (req, res) => res.json({
  success: true,
  service: "quiz",
  status: "ok",
  timestamp: new Date().toISOString()
}));

router.get("/active", protect, async (req, res) => {
  try {
    if (Object.keys(req.query || {}).some((key) => key !== "courseId")) {
      return res.status(400).json({ success: false, message: "Only courseId may be specified." });
    }
    const userId = getAuthenticatedUserId(req);
    const query = {
      user: userId,
      $or: [
        { status: "in_progress" },
        { status: { $exists: false }, timeEnded: { $exists: false } }
      ]
    };
    if (req.query.courseId) {
      if (!mongoose.Types.ObjectId.isValid(String(req.query.courseId))) {
        return res.status(400).json({ success: false, message: "Invalid course ID." });
      }
      query.course = req.query.courseId;
    }

    let session = await QuizSession.findOne(query).sort({ createdAt: -1 });
    if (!session) {
      const latestQuery = { user: userId };
      if (req.query.courseId) latestQuery.course = req.query.courseId;
      session = await QuizSession.findOne(latestQuery).sort({ createdAt: -1 });
    }
    if (!session) return res.status(404).json({ success: false, message: "No examination attempt was found." });

    let currentSession = session;
    const serverNow = new Date();
    if (session.status !== "completed" && quizSessionService.isExpired(session, serverNow)) {
      currentSession = await quizSessionService.finalizeAttempt(session._id, {
        userId: getAuthenticatedUserId(req),
        reason: "expired"
      });
      currentSession = await gradeCompletedAttempt(currentSession, userId);
    }
    return res.json({
      success: true,
      attempt: quizSessionService.toStudentAttempt(currentSession, new Date())
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:attemptId", protect, async (req, res) => {
  try {
    const { attemptId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(attemptId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid examination attempt ID." });
    }

    const userId = getAuthenticatedUserId(req);
    let session = await QuizSession.findOne({ _id: attemptId, user: userId });
    if (!session) return res.status(404).json({ success: false, message: "Examination attempt not found." });

    const serverNow = new Date();
    if (session.status !== "completed" && quizSessionService.isExpired(session, serverNow)) {
      session = await quizSessionService.finalizeAttempt(attemptId, { userId, reason: "expired" });
      session = await gradeCompletedAttempt(session, userId);
    }
    return res.json({
      success: true,
      attempt: quizSessionService.toStudentAttempt(session, new Date())
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch("/:attemptId/answers", protect, async (req, res) => {
  try {
    const { attemptId } = req.params;
    const body = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(String(attemptId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid examination attempt ID." });
    }
    if (Object.keys(body).some((field) =>
      ![
        "questionId",
        "selectedOptionId",
        "selectedAnswers",
        "theoryResponse",
        "expectedVersion"
      ].includes(field)
    )) {
      return res.status(400).json({
        success: false,
        message: "Answer updates may contain only a questionId, one typed answer, and expectedVersion."
      });
    }
    const answerFields = ["selectedOptionId", "selectedAnswers", "theoryResponse"]
      .filter((field) => Object.hasOwn(body, field));
    if (!mongoose.Types.ObjectId.isValid(String(body.questionId || "")) ||
        answerFields.length !== 1 ||
        !Number.isSafeInteger(body.expectedVersion) ||
        body.expectedVersion < 0) {
      return res.status(400).json({
        success: false,
        message: "A valid questionId, one typed answer, and expectedVersion are required."
      });
    }

    const result = await quizSessionService.saveTypedAnswer({
      attemptId,
      userId: getAuthenticatedUserId(req),
      questionId: body.questionId,
      answer: { [answerFields[0]]: body[answerFields[0]] },
      expectedVersion: body.expectedVersion,
      now: new Date()
    });
    if (result.kind === "not_found") {
      return res.status(404).json({ success: false, message: "Examination attempt not found." });
    }
    if (result.kind === "invalid_question") {
      return res.status(400).json({ success: false, message: "Question is not part of this attempt." });
    }
    if (result.kind === "invalid_option") {
      return res.status(400).json({ success: false, message: "Option is not part of this question." });
    }
    if (result.kind === "invalid_answer") {
      return res.status(400).json({
        success: false,
        message: "The answer does not match the type and limits of this question."
      });
    }
    if (result.kind === "completed") {
      return res.status(409).json({ success: false, code: "ATTEMPT_COMPLETED", message: "This attempt is already complete." });
    }
    if (result.kind === "unavailable") {
      return res.status(409).json({ success: false, message: "This attempt cannot accept answer changes." });
    }
    if (result.kind === "expired") {
      return res.status(409).json({
        success: false,
        code: "ATTEMPT_EXPIRED",
        message: "The examination has expired.",
        attempt: quizSessionService.toStudentAttempt(result.session, new Date())
      });
    }
    if (result.kind === "conflict") {
      return res.status(409).json({
        success: false,
        code: "ANSWER_VERSION_CONFLICT",
        message: "The attempt changed. Reloading its latest saved answers is required."
      });
    }

    const question = result.session.questions.find(
      (item) => String(item.questionId) === String(body.questionId)
    );
    const answer = { questionId: body.questionId };
    if (question?.questionType === "fill_in_gap") {
      answer.selectedAnswers = Array.isArray(question.selectedAnswers) ? question.selectedAnswers : [];
    } else if (question?.questionType === "theory") {
      answer.theoryResponse = question.theoryResponse || "";
    } else {
      answer.selectedOptionId = question?.selectedOptionId || null;
    }
    return res.json({
      success: true,
      answer,
      stateVersion: quizSessionService.getStateVersion(result.session),
      serverNow: new Date()
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: "Unable to save the answer right now. Reopen the attempt to verify saved answers and retry."
    });
  }
});

router.post("/submit", protect, async (req, res) => {
  try {
    const body = req.body || {};
    if (Object.keys(body).some((field) => !["attemptId", "answers"].includes(field))) {
      return res.status(400).json({
        success: false,
        message: "Submission may contain only attemptId and optional answers."
      });
    }
    if (!mongoose.Types.ObjectId.isValid(String(body.attemptId || "")) ||
        (body.answers !== undefined && !Array.isArray(body.answers))) {
      return res.status(400).json({
        success: false,
        message: "A valid attemptId and optional answers array are required."
      });
    }

    const userId = getAuthenticatedUserId(req);
    let session = await QuizSession.findOne({ _id: body.attemptId, user: userId });
    if (!session) return res.status(404).json({ success: false, message: "Examination attempt not found." });
    if (session.status === "completed" || session.timeEnded) {
      return res.json({
        success: true,
        session: quizSessionService.toStudentAttempt(session, new Date()),
        alreadySubmitted: true
      });
    }

    const now = new Date();
    if (quizSessionService.isExpired(session, now)) {
      session = await quizSessionService.finalizeAttempt(body.attemptId, {
        userId,
        reason: "expired"
      });
      session = await gradeCompletedAttempt(session, userId);
      return res.json({
        success: true,
        session: quizSessionService.toStudentAttempt(session, new Date()),
        alreadySubmitted: true,
        expired: true
      });
    }

    if (body.answers !== undefined) {
      const attemptQuestions = session.questions || [];
      const attemptQuestionIds = attemptQuestions.map((item) => String(item.questionId));
      const questionsById = new Map(attemptQuestions.map((item) => [
        String(item.questionId),
        item
      ]));
      if (new Set(attemptQuestionIds).size !== attemptQuestionIds.length) {
        return res.status(409).json({
          success: false,
          message: "Examination attempt contains duplicate questions."
        });
      }
      const answerIds = [];
      for (const item of body.answers) {
        if (!item ||
            Object.keys(item).some((key) =>
              !["questionId", "selectedOptionId", "selectedAnswers", "theoryResponse"].includes(key)
            ) ||
            !mongoose.Types.ObjectId.isValid(String(item.questionId || ""))) {
          return res.status(400).json({
            success: false,
            message: "Each answer must contain a questionId and one answer matching its question type."
          });
        }
        const answerFields = ["selectedOptionId", "selectedAnswers", "theoryResponse"]
          .filter((field) => Object.hasOwn(item, field));
        if (answerFields.length !== 1) {
          return res.status(400).json({
            success: false,
            message: "Each answer must contain exactly one type-specific response."
          });
        }
        answerIds.push(String(item.questionId));
      }
      if (new Set(answerIds).size !== answerIds.length) {
        return res.status(400).json({ success: false, message: "Duplicate question answers are not allowed." });
      }
      if (answerIds.length !== attemptQuestionIds.length ||
          attemptQuestionIds.some((questionId) => !answerIds.includes(questionId))) {
        return res.status(400).json({ success: false, message: "Answers must match the questions in this attempt." });
      }

      const normalizedAnswers = [];
      for (const item of body.answers) {
        const question = questionsById.get(String(item.questionId));
        const answerFields = ["selectedOptionId", "selectedAnswers", "theoryResponse"]
          .filter((field) => Object.hasOwn(item, field));
        const answer = { [answerFields[0]]: item[answerFields[0]] };
        const validatedAnswer = quizSessionService.validateTypedAnswer(question, answer);
        if (!validatedAnswer) {
          const invalidOption = (question.questionType || "objective") === "objective" &&
            answer.selectedOptionId !== null &&
            (question.presentedOptions || []).every((option) =>
              option.optionId !== answer.selectedOptionId);
          return res.status(400).json({
            success: false,
            message: invalidOption
              ? "Selected option does not belong to this examination question."
              : "The answer does not match the type and limits of this question."
          });
        }
        normalizedAnswers.push({
          questionId: item.questionId,
          ...validatedAnswer
        });
      }

      const saved = await quizSessionService.saveAnswers({
        attemptId: session._id,
        userId,
        answers: normalizedAnswers,
        expectedVersion: quizSessionService.getStateVersion(session),
        now: new Date()
      });
      if (saved.kind === "expired" || saved.kind === "completed") {
        const savedSession = await gradeCompletedAttempt(saved.session, userId);
        return res.json({
          success: true,
          session: quizSessionService.toStudentAttempt(savedSession, new Date()),
          alreadySubmitted: true,
          expired: saved.kind === "expired"
        });
      }
      if (saved.kind === "conflict") {
        return res.status(409).json({
          success: false,
          code: "ANSWER_VERSION_CONFLICT",
          message: "The attempt changed while submitting. Review the latest saved answers and retry.",
          attempt: quizSessionService.toStudentAttempt(saved.session, new Date())
        });
      }
      if (saved.kind === "invalid_option") {
        return res.status(400).json({
          success: false,
          message: "Selected option does not belong to this examination question."
        });
      }
      if (saved.kind === "invalid_answers" || saved.kind === "invalid_option" ||
          saved.kind === "unavailable") {
        return res.status(400).json({
          success: false,
          message: "Answers must match the types and limits of the questions in this attempt."
        });
      }
      if (saved.kind === "not_found") {
        return res.status(404).json({ success: false, message: "Examination attempt not found." });
      }
      if (saved.kind !== "saved") {
        return res.status(409).json({
          success: false,
          message: "The attempt changed while submitting. Review the saved answers and retry."
        });
      }
    }

    session = await quizSessionService.finalizeAttempt(body.attemptId, { userId, reason: "manual" });
    if (!session) return res.status(404).json({ success: false, message: "Examination attempt not found." });
    session = await gradeCompletedAttempt(session, userId);
    return res.json({
      success: true,
      session: quizSessionService.toStudentAttempt(session, new Date()),
      alreadySubmitted: session.completionReason === "expired"
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: "Unable to complete submission right now. Reopen the attempt to check saved answers and retry."
    });
  }
});

router.post("/:attemptId/grade", protect, async (req, res) => {
  try {
    const { attemptId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(attemptId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid examination attempt ID." });
    }
    if (Object.keys(req.body || {}).length > 0) {
      return res.status(400).json({ success: false, message: "Grading requests do not accept client data." });
    }

    const userId = getAuthenticatedUserId(req);
    const result = await quizGradingService.gradeAttempt({ attemptId, userId });
    if (result.kind === "not_found") {
      return res.status(404).json({ success: false, message: "Examination attempt not found." });
    }
    if (result.kind === "not_submitted" || result.kind === "legacy") {
      return res.status(409).json({
        success: false,
        message: "This submitted attempt is not eligible for Stage 3D grading."
      });
    }
    const responseStatus = result.kind === "already_grading" ? 202 : 200;
    return res.status(responseStatus).json({
      success: true,
      session: quizSessionService.toStudentAttempt(result.session, new Date()),
      gradingState: result.kind
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Unable to process grading. Your submitted answers remain saved."
    });
  }
});

router.get("/results/:userId", protect, async (req, res) => {
  try {
    const requestedUserId = req.params.userId;
    const actingUserId = getAuthenticatedUserId(req);
    if (!mongoose.Types.ObjectId.isValid(String(requestedUserId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }
    if (req.user.role !== "admin" && String(actingUserId) !== String(requestedUserId)) {
      return res.status(403).json({ success: false, message: "You are not allowed to view this quiz history." });
    }

    const records = await QuizSession.find({ user: requestedUserId })
      .select("-questions.markingSnapshot -questions.markingVersionId -gradingToken -gradingStartedAt -gradingAttemptCount -gradingErrorCode")
      .populate("course")
      .sort({ createdAt: -1 });
    const results = records
      .filter((record) =>
        record.status === "completed" ||
        (!record.status && hasCompletionEvidence(record))
      )
      .map((record) => {
        const result = typeof record.toObject === "function" ? record.toObject() : { ...record };
        result.status = result.status || "completed";
        if (isLegacyAttempt(result)) {
          const historicalResult = getVerifiedLegacyResult(result);
          result.historicalScoreStatus = historicalResult.status;
          result.score = historicalResult.status === "verified" ? historicalResult.score : null;
          result.percentage = historicalResult.status === "verified"
            ? historicalResult.percentage
            : null;
          if (historicalResult.status === "verified") {
            result.totalQuestions = historicalResult.totalQuestions;
          }
        } else if (result.gradingStatus === "graded") {
          const typedResult = getVerifiedTypedResult(result);
          if (typedResult.status === "verified") {
            result.score = typedResult.score;
            result.totalMarks = typedResult.totalMarks;
            result.percentage = typedResult.percentage;
          } else {
            result.gradingStatus = "unverified";
            result.score = null;
            result.totalMarks = null;
            result.percentage = null;
          }
        } else {
          result.score = null;
          result.percentage = null;
        }
        result.questions = (result.questions || []).map((question) => {
          const safeQuestion = { ...question };
          delete safeQuestion.correctOptionId;
          delete safeQuestion.correctAnswer;
          delete safeQuestion.isCorrect;
          delete safeQuestion.markingSnapshot;
          delete safeQuestion.markingVersionId;
          if (result.gradingStatus === "unverified") delete safeQuestion.gradingResult;
          return safeQuestion;
        });
        return result;
      });
    return res.json({ success: true, results });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
