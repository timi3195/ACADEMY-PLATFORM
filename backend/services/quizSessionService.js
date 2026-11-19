const QuizSession = require("../models/QuizSession");
const { logger } = require("../utils/logger");
const { classifyMongoConnectionError } = require("../utils/mongoConnection");
const {
  getVerifiedLegacyResult,
  getVerifiedTypedResult,
  hasCompletionEvidence,
  isLegacyAttempt
} = require("../utils/legacyQuizResult");

const DEFAULT_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 180;
const EXPIRY_BATCH_SIZE = 100;
const EXPIRY_POLL_INTERVAL_MS = 30_000;
const FINALIZATION_RETRIES = 5;
const MAX_BACKGROUND_GRADING_CONCURRENCY = 3;
const backgroundGradingQueue = [];
const queuedGradingAttemptIds = new Set();
let activeBackgroundGradings = 0;

const getConfiguredDurationMinutes = (configuredValue = process.env.QUIZ_DURATION_MINUTES) => {
  if (configuredValue === undefined || configuredValue === "") return DEFAULT_DURATION_MINUTES;
  if (typeof configuredValue !== "string" || !/^\d+$/.test(configuredValue)) {
    throw new Error("QUIZ_DURATION_MINUTES must be a whole number between 1 and 180.");
  }

  const durationMinutes = Number(configuredValue);
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > MAX_DURATION_MINUTES) {
    throw new Error("QUIZ_DURATION_MINUTES must be a whole number between 1 and 180.");
  }
  return durationMinutes;
};

const getStateVersion = (session) =>
  Number.isSafeInteger(session?.stateVersion) && session.stateVersion >= 0
    ? session.stateVersion
    : 0;

const isInProgress = (session) =>
  session?.status === "in_progress" || (!session?.status && !session?.timeEnded);

const getStartTime = (session) => session?.startedAt || session?.timeStarted || null;
const getQuestionType = (question) => question?.questionType || "objective";

const isExpired = (session, now) =>
  session?.expiresAt instanceof Date &&
  Number.isFinite(session.expiresAt.getTime()) &&
  session.expiresAt.getTime() <= now.getTime();

const getActiveStatusFilter = () => ({
  $or: [
    { status: "in_progress" },
    { status: { $exists: false }, timeEnded: { $exists: false } }
  ]
});

const getVersionFilter = (stateVersion) => ({
  $or: [
    { stateVersion },
    ...(stateVersion === 0 ? [{ stateVersion: { $exists: false } }] : [])
  ]
});

const getUnexpiredFilter = (now) => ({
  $or: [
    { expiresAt: { $gt: now } },
    { expiresAt: { $exists: false } },
    { expiresAt: null }
  ]
});

const createAtomicAttemptFilter = (session, now, { expired = false } = {}) => ({
  $and: [
    { _id: session._id },
    getActiveStatusFilter(),
    getVersionFilter(getStateVersion(session)),
    expired ? { expiresAt: { $lte: now } } : getUnexpiredFilter(now)
  ]
});

const calculateResult = (session, now, completionReason) => {
  const startedAt = getStartTime(session);
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : NaN;
  let elapsedMs = Number.isFinite(startedAtMs) ? now.getTime() - startedAtMs : 0;
  if (completionReason === "expired" &&
      Number.isFinite(startedAtMs) &&
      session.expiresAt instanceof Date) {
    elapsedMs = Math.min(elapsedMs, session.expiresAt.getTime() - startedAtMs);
  }
  const duration = Math.max(0, Math.floor(elapsedMs / 1000));

  if (session.attemptFormatVersion >= 2) {
    return {
      totalQuestions: (session.questions || []).length,
      timeEnded: now,
      completedAt: now,
      duration,
      status: "completed",
      completionReason,
      activeAttempt: false,
      gradingStatus: session.gradingStatus || "pending"
    };
  }

  let score = 0;
  const questions = (session.questions || []).map((question) => {
    const selectedOptionId = (question.presentedOptions || [])
      .some((option) => option.optionId === question.selectedOptionId)
      ? question.selectedOptionId
      : undefined;
    const isCorrect = Boolean(
      selectedOptionId &&
      question.correctOptionId &&
      selectedOptionId === question.correctOptionId
    );
    if (isCorrect) score += 1;

    const plainQuestion = typeof question.toObject === "function" ? question.toObject() : question;
    return {
      ...plainQuestion,
      selectedOptionId,
      isCorrect
    };
  });

  const totalQuestions = questions.length;
  return {
    questions,
    score,
    totalQuestions,
    percentage: totalQuestions ? (score / totalQuestions) * 100 : 0,
    timeEnded: now,
    completedAt: now,
    duration,
    status: "completed",
    completionReason,
    activeAttempt: false
  };
};

const finalizeAttempt = async (attemptId, { userId, reason = "manual", now = () => new Date() } = {}) => {
  for (let retry = 0; retry < FINALIZATION_RETRIES; retry += 1) {
    const filter = { _id: attemptId };
    if (userId) filter.user = userId;
    const session = await QuizSession.findOne(filter);
    if (!session) return null;
    if (session.status === "completed" || session.timeEnded) return session;
    if (!isInProgress(session)) return session;

    const finalizedAt = now();
    const completionReason = isExpired(session, finalizedAt) ? "expired" : reason;
    if (completionReason === "expired" && !isExpired(session, finalizedAt)) return session;

    const result = calculateResult(session, finalizedAt, completionReason);
    const completed = await QuizSession.findOneAndUpdate(
      createAtomicAttemptFilter(session, finalizedAt, { expired: completionReason === "expired" }),
      {
        $set: result,
        $inc: { stateVersion: 1 }
      },
      { new: true }
    );
    if (completed) return completed;
  }

  const filter = { _id: attemptId };
  if (userId) filter.user = userId;
  const latest = await QuizSession.findOne(filter);
  if (latest?.status === "completed" || latest?.timeEnded) return latest;
  const error = new Error("The examination attempt changed while it was being finalized. Please retry.");
  error.code = "ATTEMPT_FINALIZATION_CONFLICT";
  throw error;
};

const toStudentAttempt = (session, serverNow = new Date()) => {
  const completed = session.status === "completed" || hasCompletionEvidence(session);
  const legacy = isLegacyAttempt(session);
  const historicalResult = legacy && completed ? getVerifiedLegacyResult(session) : null;
  const typedResult = !legacy && completed ? getVerifiedTypedResult(session) : null;
  const gradingStatus = legacy
    ? completed && historicalResult?.status === "verified" ? "graded" : "unscored"
    : session.gradingStatus === "graded" && typedResult?.status !== "verified"
      ? "unverified"
      : session.gradingStatus || "pending";
  const includeFeedback = completed && ["graded", "needs_review"].includes(gradingStatus);
  const questions = (session.questions || []).map((question) => ({
    _id: question.questionId,
    question: question.question,
    topic: question.topic,
    questionType: getQuestionType(question),
    questionOrder: question.questionOrder,
    marks: question.marks,
    blankCount: question.blankCount,
    presentedOptions: (question.presentedOptions || []).map((option) => ({
      optionId: option.optionId,
      text: option.text
    })),
    selectedOptionId: question.selectedOptionId || null,
    selectedAnswers: Array.isArray(question.selectedAnswers) ? [...question.selectedAnswers] : [],
    theoryResponse: question.theoryResponse || "",
    ...(includeFeedback && question.gradingResult
      ? { gradingResult: question.gradingResult }
      : {})
  }));
  const startedAt = getStartTime(session);
  const response = {
    _id: session._id,
    courseId: session.course,
    status: session.status || (completed ? "completed" : "in_progress"),
    startedAt,
    timeStarted: startedAt,
    expiresAt: session.expiresAt || null,
    durationMinutes: session.durationMinutes || null,
    lastAnswerUpdatedAt: session.lastAnswerUpdatedAt || null,
    stateVersion: getStateVersion(session),
    totalQuestions: session.totalQuestions || questions.length,
    questions,
    serverNow
  };

  if (response.status === "completed") {
    response.timeEnded = session.timeEnded || session.completedAt || null;
    response.completedAt = session.completedAt || session.timeEnded || null;
    response.completionReason = session.completionReason || "manual";
    if (legacy) {
      response.historicalScoreStatus = historicalResult.status;
      response.gradingStatus = gradingStatus;
      if (historicalResult.status === "verified") {
        response.score = historicalResult.score;
        response.percentage = historicalResult.percentage;
      }
    } else {
      response.gradingStatus = gradingStatus;
    }
    if (!legacy &&
        response.gradingStatus === "graded" &&
        typedResult?.status === "verified") {
      response.score = typedResult.score;
      response.percentage = typedResult.percentage;
      response.totalMarks = typedResult.totalMarks;
    } else if (response.gradingStatus === "needs_review") {
      response.totalMarks = session.totalMarks;
      response.provisionalScore = session.provisionalScore;
      response.provisionalMaxMarks = session.provisionalMaxMarks;
      response.provisionalPercentage = session.provisionalPercentage;
    }
  }
  return response;
};

const validateTypedAnswer = (question, answer) => {
  if (!question || !answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const questionType = getQuestionType(question);
  const keys = Object.keys(answer).sort();
  if (questionType === "objective") {
    if (keys.join(",") !== "selectedOptionId") return null;
    const selectedOptionId = answer.selectedOptionId;
    if (selectedOptionId !== null &&
        (typeof selectedOptionId !== "string" ||
         !selectedOptionId.trim() ||
         selectedOptionId.length > 256 ||
         !(question.presentedOptions || []).some((option) => option.optionId === selectedOptionId))) {
      return null;
    }
    return { selectedOptionId };
  }
  if (questionType === "fill_in_gap") {
    if (keys.join(",") !== "selectedAnswers" ||
        !Array.isArray(answer.selectedAnswers) ||
        answer.selectedAnswers.length !== question.blankCount ||
        answer.selectedAnswers.some((value) =>
          typeof value !== "string" || value.length > 1000) ||
        answer.selectedAnswers.join("").length > 5000) return null;
    return { selectedAnswers: [...answer.selectedAnswers] };
  }
  if (questionType === "theory") {
    if (keys.join(",") !== "theoryResponse" ||
        typeof answer.theoryResponse !== "string" ||
        answer.theoryResponse.length > 20000) return null;
    return { theoryResponse: answer.theoryResponse };
  }
  return null;
};

const saveTypedAnswer = async ({
  attemptId,
  userId,
  questionId,
  answer,
  expectedVersion,
  now = new Date(),
  clock = () => new Date()
}) => {
  const session = await QuizSession.findOne({ _id: attemptId, user: userId });
  if (!session) return { kind: "not_found" };
  if (session.status === "completed" || session.timeEnded) return { kind: "completed", session };
  if (!isInProgress(session)) return { kind: "unavailable", session };
  if (isExpired(session, now)) {
    const completed = await finalizeAttempt(attemptId, { userId, reason: "expired", now: () => now });
    return { kind: "expired", session: completed || session };
  }

  const stateVersion = getStateVersion(session);
  if (expectedVersion !== stateVersion) return { kind: "conflict", session };

  const question = (session.questions || []).find(
    (item) => String(item.questionId) === String(questionId)
  );
  if (!question) return { kind: "invalid_question", session };
  const validatedAnswer = validateTypedAnswer(question, answer);
  if (!validatedAnswer) {
    const invalidOption = getQuestionType(question) === "objective" &&
      answer && Object.hasOwn(answer, "selectedOptionId") &&
      answer.selectedOptionId !== null &&
      !(question.presentedOptions || []).some((option) => option.optionId === answer.selectedOptionId);
    return { kind: invalidOption ? "invalid_option" : "invalid_answer", session };
  }

  const writeNow = clock();
  if (isExpired(session, writeNow)) {
    const completed = await finalizeAttempt(attemptId, { userId, reason: "expired", now: () => writeNow });
    return { kind: "expired", session: completed || session };
  }
  const questionIdValue = question.questionId;
  const setFields = { lastAnswerUpdatedAt: writeNow };
  const unsetFields = {};
  for (const [field, value] of Object.entries(validatedAnswer)) {
    const path = `questions.$[question].${field}`;
    if (field === "selectedOptionId" && value === null) unsetFields[path] = "";
    else setFields[path] = value;
  }
  const update = { $set: setFields, $inc: { stateVersion: 1 } };
  if (Object.keys(unsetFields).length) update.$unset = unsetFields;
  const updated = await QuizSession.findOneAndUpdate(
    {
      $and: [
        { _id: session._id, user: userId },
        getActiveStatusFilter(),
        getVersionFilter(stateVersion),
        getUnexpiredFilter(writeNow),
        { questions: { $elemMatch: { questionId: questionIdValue } } }
      ]
    },
    update,
    {
      new: true,
      arrayFilters: [{ "question.questionId": questionIdValue }]
    }
  );
  if (updated) return { kind: "saved", session: updated };

  const latest = await QuizSession.findOne({ _id: attemptId, user: userId });
  if (!latest) return { kind: "not_found" };
  if (latest.status === "completed" || latest.timeEnded) return { kind: "completed", session: latest };
  if (isExpired(latest, writeNow)) {
    const completed = await finalizeAttempt(attemptId, { userId, reason: "expired", now: () => writeNow });
    return { kind: "expired", session: completed || latest };
  }
  return { kind: "conflict", session: latest };
};

const saveAnswer = (params) => saveTypedAnswer({
  ...params,
  answer: { selectedOptionId: params.selectedOptionId }
});

const saveAnswers = async ({
  attemptId,
  userId,
  answers,
  expectedVersion,
  now = new Date(),
  clock = () => new Date()
}) => {
  const session = await QuizSession.findOne({ _id: attemptId, user: userId });
  if (!session) return { kind: "not_found" };
  if (session.status === "completed" || session.timeEnded) return { kind: "completed", session };
  if (!isInProgress(session)) return { kind: "unavailable", session };
  if (isExpired(session, now)) {
    const completed = await finalizeAttempt(attemptId, { userId, reason: "expired", now: () => now });
    return { kind: "expired", session: completed || session };
  }

  const stateVersion = getStateVersion(session);
  if (expectedVersion !== stateVersion) return { kind: "conflict", session };
  const questions = session.questions || [];
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    return { kind: "invalid_answers", session };
  }
  const answerByQuestionId = new Map();
  for (const answer of answers) {
    const questionId = String(answer?.questionId || "");
    if (answerByQuestionId.has(questionId)) return { kind: "invalid_answers", session };
    answerByQuestionId.set(questionId, answer);
  }
  if (answerByQuestionId.size !== questions.length ||
      questions.some((question) => !answerByQuestionId.has(String(question.questionId)))) {
    return { kind: "invalid_answers", session };
  }

  const writeNow = clock();
  if (isExpired(session, writeNow)) {
    const completed = await finalizeAttempt(attemptId, { userId, reason: "expired", now: () => writeNow });
    return { kind: "expired", session: completed || session };
  }
  const setFields = { lastAnswerUpdatedAt: writeNow };
  const unsetFields = {};
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const answerRecord = answerByQuestionId.get(String(question.questionId));
    const typedAnswer = Object.fromEntries(Object.entries(answerRecord)
      .filter(([key]) => key !== "questionId"));
    const validatedAnswer = validateTypedAnswer(question, typedAnswer);
    if (!validatedAnswer) {
      const invalidOption = getQuestionType(question) === "objective" &&
        typedAnswer.selectedOptionId !== null &&
        (question.presentedOptions || []).every((option) => option.optionId !== typedAnswer.selectedOptionId);
      return { kind: invalidOption ? "invalid_option" : "invalid_answers", session };
    }
    for (const [field, value] of Object.entries(validatedAnswer)) {
      const path = `questions.${index}.${field}`;
      if (field === "selectedOptionId" && value === null) unsetFields[path] = "";
      else setFields[path] = value;
    }
  }

  const update = {
    $set: setFields,
    $inc: { stateVersion: 1 }
  };
  if (Object.keys(unsetFields).length) update.$unset = unsetFields;
  const updated = await QuizSession.findOneAndUpdate(
    {
      $and: [
        { _id: session._id, user: userId },
        getActiveStatusFilter(),
        getVersionFilter(stateVersion),
        getUnexpiredFilter(writeNow)
      ]
    },
    update,
    { new: true }
  );
  if (updated) return { kind: "saved", session: updated };

  const latest = await QuizSession.findOne({ _id: attemptId, user: userId });
  if (!latest) return { kind: "not_found" };
  if (latest.status === "completed" || latest.timeEnded) return { kind: "completed", session: latest };
  if (isExpired(latest, writeNow)) {
    const completed = await finalizeAttempt(attemptId, { userId, reason: "expired", now: () => writeNow });
    return { kind: "expired", session: completed || latest };
  }
  return { kind: "conflict", session: latest };
};

const processExpiredAttempts = async ({ now = new Date(), limit = EXPIRY_BATCH_SIZE } = {}) => {
  const expiredSessions = await QuizSession.find({
    status: "in_progress",
    expiresAt: { $lte: now }
  }).sort({ expiresAt: 1 }).limit(limit).select("_id user attemptFormatVersion").lean();

  let finalized = 0;
  for (const session of expiredSessions) {
    const completed = await finalizeAttempt(session._id, {
      reason: "expired",
      now: () => now
    });
    if (completed?.status === "completed") {
      finalized += 1;
      queueAttemptGrading(completed);
    }
  }
  const staleBefore = new Date(now.getTime() - 60_000);
  const pendingSessions = await QuizSession.find({
    status: "completed",
    attemptFormatVersion: { $gte: 2 },
    $or: [
      { gradingStatus: "pending" },
      { gradingStatus: { $exists: false } },
      { gradingStatus: "grading", gradingStartedAt: { $lte: staleBefore } }
    ]
  }).sort({ completedAt: 1 }).limit(limit).select("_id user attemptFormatVersion").lean();
  for (const session of pendingSessions) queueAttemptGrading(session);
  return { inspected: expiredSessions.length, finalized };
};

const queueAttemptGrading = (session) => {
  if (!session?.user || !(session.attemptFormatVersion >= 2)) return;
  const attemptKey = String(session._id);
  if (queuedGradingAttemptIds.has(attemptKey)) return;
  queuedGradingAttemptIds.add(attemptKey);
  backgroundGradingQueue.push(session);
  const processQueue = () => {
    while (activeBackgroundGradings < MAX_BACKGROUND_GRADING_CONCURRENCY &&
        backgroundGradingQueue.length > 0) {
      const next = backgroundGradingQueue.shift();
      activeBackgroundGradings += 1;
      require("./quizGradingService")
        .gradeAttempt({ attemptId: next._id, userId: next.user })
        .catch(() => {
          logger.error("quiz_grading_queue_failed", {
            category: "grading_persistence_error"
          });
        })
        .finally(() => {
          activeBackgroundGradings -= 1;
          queuedGradingAttemptIds.delete(String(next._id));
          processQueue();
        });
    }
  };
  setImmediate(processQueue);
};

let expiryWorker;
const startExpiryWorker = () => {
  if (expiryWorker) return expiryWorker;
  const process = () => {
    processExpiredAttempts().catch((error) => {
      logger.error("quiz_expiry_processing_failed", {
        category: classifyMongoConnectionError(error)
      });
    });
  };
  process();
  expiryWorker = setInterval(process, EXPIRY_POLL_INTERVAL_MS);
  expiryWorker.unref?.();
  return expiryWorker;
};

const stopExpiryWorker = () => {
  if (!expiryWorker) return false;
  clearInterval(expiryWorker);
  expiryWorker = undefined;
  return true;
};

module.exports = {
  DEFAULT_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  getConfiguredDurationMinutes,
  getStateVersion,
  isExpired,
  finalizeAttempt,
  saveAnswer,
  saveTypedAnswer,
  saveAnswers,
  validateTypedAnswer,
  toStudentAttempt,
  processExpiredAttempts,
  startExpiryWorker,
  stopExpiryWorker
};
