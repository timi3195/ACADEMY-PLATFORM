const QuizSession = require("../models/QuizSession");

const DEFAULT_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 180;
const EXPIRY_BATCH_SIZE = 100;
const EXPIRY_POLL_INTERVAL_MS = 30_000;
const FINALIZATION_RETRIES = 5;

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
  const startedAt = getStartTime(session);
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : NaN;
  let elapsedMs = Number.isFinite(startedAtMs) ? now.getTime() - startedAtMs : 0;
  if (completionReason === "expired" &&
      Number.isFinite(startedAtMs) &&
      session.expiresAt instanceof Date) {
    elapsedMs = Math.min(elapsedMs, session.expiresAt.getTime() - startedAtMs);
  }
  const duration = Math.max(0, Math.floor(elapsedMs / 1000));

  return {
    questions,
    score,
    totalQuestions,
    percentage: totalQuestions ? (score / totalQuestions) * 100 : 0,
    timeEnded: now,
    completedAt: now,
    duration,
    status: "completed",
    completionReason
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
  const questions = (session.questions || []).map((question) => ({
    _id: question.questionId,
    question: question.question,
    topic: question.topic,
    presentedOptions: (question.presentedOptions || []).map((option) => ({
      optionId: option.optionId,
      text: option.text
    })),
    selectedOptionId: question.selectedOptionId || null
  }));
  const startedAt = getStartTime(session);
  const response = {
    _id: session._id,
    courseId: session.course,
    status: session.status || (session.timeEnded ? "completed" : "in_progress"),
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
    response.score = session.score || 0;
    response.percentage = session.percentage || 0;
    response.timeEnded = session.timeEnded || session.completedAt || null;
    response.completedAt = session.completedAt || session.timeEnded || null;
    response.completionReason = session.completionReason || "manual";
  }
  return response;
};

const saveAnswer = async ({
  attemptId,
  userId,
  questionId,
  selectedOptionId,
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
  if (selectedOptionId !== null &&
      !(question.presentedOptions || []).some((option) => option.optionId === selectedOptionId)) {
    return { kind: "invalid_option", session };
  }

  const writeNow = clock();
  if (isExpired(session, writeNow)) {
    const completed = await finalizeAttempt(attemptId, { userId, reason: "expired", now: () => writeNow });
    return { kind: "expired", session: completed || session };
  }
  const questionIdValue = question.questionId;
  const answerUpdate = selectedOptionId === null
    ? { $unset: { "questions.$[question].selectedOptionId": "" } }
    : { $set: { "questions.$[question].selectedOptionId": selectedOptionId } };
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
    {
      ...answerUpdate,
      $set: { ...(answerUpdate.$set || {}), lastAnswerUpdatedAt: writeNow },
      $inc: { stateVersion: 1 }
    },
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
    answerByQuestionId.set(questionId, answer.selectedOptionId);
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
    const selectedOptionId = answerByQuestionId.get(String(question.questionId));
    if (selectedOptionId !== null &&
        !(question.presentedOptions || []).some((option) => option.optionId === selectedOptionId)) {
      return { kind: "invalid_option", session };
    }
    const path = `questions.${index}.selectedOptionId`;
    if (selectedOptionId === null) unsetFields[path] = "";
    else setFields[path] = selectedOptionId;
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
  }).sort({ expiresAt: 1 }).limit(limit).select("_id").lean();

  let finalized = 0;
  for (const session of expiredSessions) {
    const completed = await finalizeAttempt(session._id, {
      reason: "expired",
      now: () => now
    });
    if (completed?.status === "completed") finalized += 1;
  }
  return { inspected: expiredSessions.length, finalized };
};

let expiryWorker;
const startExpiryWorker = () => {
  if (expiryWorker) return expiryWorker;
  const process = () => {
    processExpiredAttempts().catch((error) => {
      console.error("Quiz expiry processing failed:", error);
    });
  };
  process();
  expiryWorker = setInterval(process, EXPIRY_POLL_INTERVAL_MS);
  expiryWorker.unref?.();
  return expiryWorker;
};

module.exports = {
  DEFAULT_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  getConfiguredDurationMinutes,
  getStateVersion,
  isExpired,
  finalizeAttempt,
  saveAnswer,
  saveAnswers,
  toStudentAttempt,
  processExpiredAttempts,
  startExpiryWorker
};
