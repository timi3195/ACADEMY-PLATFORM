const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Question = require("../models/Question");
const QuizSession = require("../models/QuizSession");
const protect = require("../config/middleware/authMiddleware");
const requirePremium = require("../config/middleware/planMiddleware");
const questionAccess = require("../services/questionAccessService");
const shuffle = require("../utils/shuffle");
const quizSessionService = require("../services/quizSessionService");

const normalizeText = (value) => String(value == null ? "" : value).trim().toLowerCase();
const getAuthenticatedUserId = (req) => req.user.id;
const DEFAULT_QUESTION_COUNT = 10;
const MAX_QUESTION_COUNT = 50;

const safeAttemptQuestion = (question) => ({
  _id: question.questionId,
  question: question.question,
  topic: question.topic,
  presentedOptions: question.presentedOptions
});

const hasCorrectOption = (question) =>
  Array.isArray(question.options) &&
  question.options.every((option) => typeof option === "string" && option.trim().length > 0) &&
  question.options.length >= 2 &&
  typeof question.question === "string" &&
  question.question.trim().length > 0 &&
  question.options.filter((option) => normalizeText(option) === normalizeText(question.answer)).length === 1;

router.post("/start", protect, requirePremium, async (req, res) => {
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
    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > MAX_QUESTION_COUNT) {
      return res.status(400).json({
        success: false,
        message: `questionCount must be a positive integer no greater than ${MAX_QUESTION_COUNT}.`
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

    const matchQuery = {
      course: new mongoose.Types.ObjectId(courseId),
      department: access.course.department?._id || access.course.department,
      approvalStatus: "approved"
    };
    const sampledQuestions = await Question.aggregate([
      { $match: matchQuery },
      {
        $addFields: {
          _quizOriginalOptions: { $cond: [{ $isArray: "$options" }, "$options", []] },
          _quizOptions: {
            $filter: {
              input: { $cond: [{ $isArray: "$options" }, "$options", []] },
              as: "option",
              cond: {
                $and: [
                  { $eq: [{ $type: "$$option" }, "string"] },
                  {
                    $ne: [
                      {
                        $trim: {
                          input: {
                            $cond: [
                              { $eq: [{ $type: "$$option" }, "string"] },
                              "$$option",
                              ""
                            ]
                          }
                        }
                      },
                      ""
                    ]
                  }
                ]
              }
            }
          }
        }
      },
      {
        $addFields: {
          _quizAnswerMatches: {
            $filter: {
              input: "$_quizOptions",
              as: "option",
              cond: {
                $eq: [
                  { $toLower: { $trim: { input: "$$option" } } },
                  {
                    $toLower: {
                      $trim: {
                        input: {
                          $cond: [
                            { $eq: [{ $type: "$answer" }, "string"] },
                            "$answer",
                            ""
                          ]
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      },
      {
        $match: {
          $expr: {
            $and: [
              { $eq: [{ $size: "$_quizOriginalOptions" }, { $size: "$_quizOptions" }] },
              { $gte: [{ $size: "$_quizOptions" }, 2] },
              { $eq: [{ $size: "$_quizAnswerMatches" }, 1] },
              {
                $ne: [
                  {
                    $trim: {
                      input: {
                        $cond: [
                          { $eq: [{ $type: "$question" }, "string"] },
                          "$question",
                          ""
                        ]
                      }
                    }
                  },
                  ""
                ]
              }
            ]
          }
        }
      },
      { $sample: { size: questionCount } },
      { $project: { _quizOriginalOptions: 0, _quizOptions: 0, _quizAnswerMatches: 0 } }
    ]);

    if (sampledQuestions.length < questionCount || sampledQuestions.some((question) => !hasCorrectOption(question))) {
      return res.status(sampledQuestions.length === 0 ? 404 : 409).json({
        success: false,
        message: sampledQuestions.length === 0
          ? "No approved objective questions are available for this course yet."
          : `Only ${sampledQuestions.length} eligible questions are available; ${questionCount} were requested.`
      });
    }

    const examQuestions = sampledQuestions.map((question) => {
      const optionIds = questionAccess.stableOptionIds(question);
      const correctIndex = question.options.findIndex((option) =>
        normalizeText(option) === normalizeText(question.answer)
      );
      return {
        questionId: question._id,
        question: question.question,
        topic: question.topic,
        presentedOptions: shuffle(question.options.map((text, index) => ({
          optionId: optionIds[index],
          text
        }))),
        correctOptionId: optionIds[correctIndex]
      };
    });

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);
    const session = await QuizSession.create({
      user: actingUserId,
      course: access.course._id,
      questions: examQuestions,
      totalQuestions: examQuestions.length,
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
      courseId: session.course,
      totalQuestions: session.questions.length,
      status: session.status,
      startedAt,
      timeStarted: startedAt,
      expiresAt,
      durationMinutes,
      stateVersion: session.stateVersion,
      serverNow,
      questions: session.questions.map((question) => ({
        ...safeAttemptQuestion(question),
        selectedOptionId: null
      }))
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/health", (req, res) => res.json({
  success: true,
  service: "quiz",
  status: "ok",
  timestamp: new Date().toISOString()
}));

router.get("/active", protect, requirePremium, async (req, res) => {
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
    }
    return res.json({
      success: true,
      attempt: quizSessionService.toStudentAttempt(currentSession, new Date())
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:attemptId", protect, requirePremium, async (req, res) => {
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
    }
    return res.json({
      success: true,
      attempt: quizSessionService.toStudentAttempt(session, new Date())
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch("/:attemptId/answers", protect, requirePremium, async (req, res) => {
  try {
    const { attemptId } = req.params;
    const body = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(String(attemptId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid examination attempt ID." });
    }
    if (Object.keys(body).some((field) =>
      !["questionId", "selectedOptionId", "expectedVersion"].includes(field)
    )) {
      return res.status(400).json({
        success: false,
        message: "Answer updates may contain only questionId, selectedOptionId, and expectedVersion."
      });
    }
    if (!mongoose.Types.ObjectId.isValid(String(body.questionId || "")) ||
        !(body.selectedOptionId === null ||
          (typeof body.selectedOptionId === "string" &&
           body.selectedOptionId.trim().length > 0 &&
           body.selectedOptionId.length <= 256)) ||
        !Number.isSafeInteger(body.expectedVersion) ||
        body.expectedVersion < 0) {
      return res.status(400).json({
        success: false,
        message: "A valid questionId, option ID (or null), and expectedVersion are required."
      });
    }

    const result = await quizSessionService.saveAnswer({
      attemptId,
      userId: getAuthenticatedUserId(req),
      questionId: body.questionId,
      selectedOptionId: body.selectedOptionId,
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
    return res.json({
      success: true,
      answer: { questionId: body.questionId, selectedOptionId: question?.selectedOptionId || null },
      stateVersion: quizSessionService.getStateVersion(result.session),
      serverNow: new Date()
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

router.post("/submit", protect, requirePremium, async (req, res) => {
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
      if (new Set(attemptQuestionIds).size !== attemptQuestionIds.length) {
        return res.status(409).json({
          success: false,
          message: "Examination attempt contains duplicate questions."
        });
      }
      const answerIds = [];
      for (const item of body.answers) {
        if (!item || Object.keys(item).some((key) => !["questionId", "selectedOptionId"].includes(key)) ||
            !mongoose.Types.ObjectId.isValid(String(item.questionId || "")) ||
            !(item.selectedOptionId === null ||
              (typeof item.selectedOptionId === "string" &&
               item.selectedOptionId.trim() &&
               item.selectedOptionId.length <= 256))) {
          return res.status(400).json({ success: false, message: "Each answer must contain a questionId and selectedOptionId." });
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

      const answersById = new Map(body.answers.map((item) => [String(item.questionId), item.selectedOptionId]));
      for (const question of attemptQuestions) {
        const selectedOptionId = answersById.get(String(question.questionId));
        if (selectedOptionId !== null &&
            !(question.presentedOptions || []).some((option) => option.optionId === selectedOptionId)) {
          return res.status(400).json({ success: false, message: "Selected option does not belong to this examination question." });
        }
      }

      const saved = await quizSessionService.saveAnswers({
        attemptId: session._id,
        userId,
        answers: [...answersById].map(([questionId, selectedOptionId]) => ({
          questionId,
          selectedOptionId
        })),
        expectedVersion: quizSessionService.getStateVersion(session),
        now: new Date()
      });
      if (saved.kind === "expired" || saved.kind === "completed") {
        return res.json({
          success: true,
          session: quizSessionService.toStudentAttempt(saved.session, new Date()),
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
      if (saved.kind === "invalid_answers" || saved.kind === "unavailable") {
        return res.status(400).json({
          success: false,
          message: "Answers must match the questions and options in this attempt."
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
    return res.json({
      success: true,
      session: quizSessionService.toStudentAttempt(session, new Date()),
      alreadySubmitted: session.completionReason === "expired"
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
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
      .select("-questions.correctOptionId -questions.correctAnswer -questions.isCorrect")
      .populate("course")
      .sort({ createdAt: -1 });
    const results = records.filter((record) => !record.status || record.status === "completed");
    return res.json({ success: true, results });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
