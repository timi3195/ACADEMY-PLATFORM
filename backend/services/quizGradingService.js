const crypto = require("crypto");
const QuizSession = require("../models/QuizSession");
const gemini = require("../utils/gemini");

const GRADING_TIMEOUT_MS = 45_000;
const GRADING_LEASE_MS = 60_000;
const MARK_TOLERANCE = 0.000001;
const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) =>
  isRecord(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const text = (value, maxLength) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
const numericMark = (value) => Number.isFinite(value) && value >= 0;
const roundMark = (value) => Math.round(value * 100) / 100;
const sameTotal = (left, right) => Math.abs(left - right) <= MARK_TOLERANCE;

const normalizeAnswer = (value) =>
  String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");

const parseAiResponse = (value) => {
  const parsed = JSON.parse(String(value || ""));
  if (!isRecord(parsed)) throw new Error("invalid_output");
  return parsed;
};

const validateAiGradingOutput = (items, output) => {
  if (!exactKeys(output, ["results"]) || !Array.isArray(output.results) ||
      output.results.length !== items.length) {
    throw new Error("invalid_output");
  }

  const requested = new Map(items.map((item) => [item.resultKey, item]));
  const validated = new Map();
  for (const result of output.results) {
    if (!isRecord(result)) throw new Error("invalid_output");
    const resultKey = result.blankNumber === undefined
      ? `theory:${result.questionId}`
      : `fill:${result.questionId}:${result.blankNumber}`;
    const expected = requested.get(resultKey);
    if (!expected || validated.has(resultKey)) throw new Error("invalid_output");
    const requiredKeys = expected.blankNumber === undefined
      ? ["questionId", "uncertain", "uncertaintyReason", "criteria", "totalAwardedMarks", "explanation"]
      : ["questionId", "blankNumber", "uncertain", "uncertaintyReason", "criteria", "totalAwardedMarks", "explanation"];
    if (!exactKeys(result, requiredKeys) ||
        result.questionId !== expected.questionId ||
        (expected.blankNumber !== undefined && result.blankNumber !== expected.blankNumber) ||
        typeof result.uncertain !== "boolean" ||
        typeof result.uncertaintyReason !== "string" ||
        result.uncertaintyReason.length > 1000 ||
        !text(result.explanation, 2000) ||
        !Array.isArray(result.criteria)) {
      throw new Error("invalid_output");
    }

    if (result.uncertain) {
      if (!result.uncertaintyReason.trim() ||
          result.criteria.length !== 0 ||
          result.totalAwardedMarks !== null) {
        throw new Error("invalid_output");
      }
      validated.set(resultKey, {
        uncertain: true,
        uncertaintyReason: result.uncertaintyReason.trim(),
        explanation: result.explanation.trim(),
        criteria: [],
        totalAwardedMarks: null
      });
      continue;
    }

    if (result.uncertaintyReason.trim().length > 0 ||
        !numericMark(result.totalAwardedMarks) ||
        result.totalAwardedMarks > expected.maxMarks ||
        result.criteria.length !== expected.criteria.length) {
      throw new Error("invalid_output");
    }
    const expectedCriteria = new Map(expected.criteria.map((criterion) => [
      criterion.criterionId,
      criterion
    ]));
    const returnedIds = new Set();
    let total = 0;
    const criteria = result.criteria.map((criterion) => {
      if (!exactKeys(criterion, ["criterionId", "awardedMarks", "feedback", "missingPoint"]) ||
          !expectedCriteria.has(criterion.criterionId) ||
          returnedIds.has(criterion.criterionId) ||
          !numericMark(criterion.awardedMarks) ||
          typeof criterion.missingPoint !== "string" ||
          criterion.missingPoint.length > 1000 ||
          !text(criterion.feedback, 1000)) {
        throw new Error("invalid_output");
      }
      const expectedCriterion = expectedCriteria.get(criterion.criterionId);
      if (criterion.awardedMarks > expectedCriterion.maxMarks ||
          (criterion.awardedMarks < expectedCriterion.maxMarks && !criterion.missingPoint.trim()) ||
          (criterion.awardedMarks === expectedCriterion.maxMarks && criterion.missingPoint.trim())) {
        throw new Error("invalid_output");
      }
      returnedIds.add(criterion.criterionId);
      total += criterion.awardedMarks;
      return {
        criterionId: criterion.criterionId,
        awardedMarks: roundMark(criterion.awardedMarks),
        maxMarks: expectedCriterion.maxMarks,
        feedback: criterion.feedback.trim(),
        missingPoint: criterion.missingPoint.trim()
      };
    });
    if (returnedIds.size !== expectedCriteria.size ||
        !sameTotal(total, result.totalAwardedMarks) ||
        !sameTotal(total, roundMark(total))) {
      throw new Error("invalid_output");
    }
    validated.set(resultKey, {
      uncertain: false,
      uncertaintyReason: "",
      explanation: result.explanation.trim(),
      criteria,
      totalAwardedMarks: roundMark(total)
    });
  }

  if (validated.size !== requested.size) throw new Error("invalid_output");
  return validated;
};

const validQuestionMarks = (question) =>
  Number.isFinite(question?.marks) && question.marks > 0 && question.marks <= 100;

const reviewResult = (question, reason) => ({
  status: "needs_review",
  questionType: question.questionType || "objective",
  awardedMarks: null,
  maxMarks: validQuestionMarks(question) ? question.marks : 0,
  provisional: false,
  uncertaintyReason: reason,
  explanation: "No mark was assigned because this saved marking record could not be validated."
});

const getObjectiveResult = (question) => {
  const marking = question.markingSnapshot?.objective;
  const expectedOption = (question.presentedOptions || []).find(
    (option) => option.optionId === marking?.correctOptionId
  );
  if (!validQuestionMarks(question) ||
      !marking ||
      !expectedOption ||
      marking.verificationOptionId !== marking.correctOptionId ||
      !text(marking.explanation, 2000)) {
    return reviewResult(question, "The saved objective marking record is incomplete or inconsistent.");
  }
  const correct = question.selectedOptionId === marking.correctOptionId;
  return {
    status: "graded",
    questionType: "objective",
    isCorrect: correct,
    awardedMarks: correct ? question.marks : 0,
    maxMarks: question.marks,
    provisional: false,
    correctOptionId: marking.correctOptionId,
    correctAnswer: expectedOption.text,
    explanation: marking.explanation.trim(),
    lostMarks: correct ? "" : `The correct answer is ${expectedOption.text}.`
  };
};

const getFillMarking = (question) => {
  const fill = question.markingSnapshot?.fillInGap;
  const blanks = fill?.blanks;
  if (!validQuestionMarks(question) ||
      !fill ||
      !Array.isArray(blanks) ||
      blanks.length !== question.blankCount ||
      !Array.isArray(question.selectedAnswers) ||
      question.selectedAnswers.length !== question.blankCount ||
      !sameTotal(Number(fill.totalMarks), question.marks)) return null;

  const seen = new Set();
  let total = 0;
  const normalized = [];
  for (const blank of blanks) {
    if (!Number.isInteger(blank.blankNumber) ||
        blank.blankNumber < 1 ||
        blank.blankNumber > question.blankCount ||
        seen.has(blank.blankNumber) ||
        !text(blank.expectedAnswer, 500) ||
        !Array.isArray(blank.acceptableAnswers) ||
        blank.acceptableAnswers.length === 0 ||
        blank.acceptableAnswers.some((answer) => !text(answer, 500)) ||
        !Array.isArray(blank.gradingCriteria) ||
        !text(blank.semanticGuidance, 1000)) return null;
    let blankMarks = 0;
    const criteria = blank.gradingCriteria.map((criterion, index) => {
      if (!text(criterion.criterion, 500) ||
          !Number.isFinite(criterion.marks) ||
          criterion.marks < 0 ||
          criterion.marks > question.marks) return null;
      blankMarks += criterion.marks;
      return {
        criterionId: `blank-${blank.blankNumber}-criterion-${index + 1}`,
        description: criterion.criterion.trim(),
        maxMarks: criterion.marks
      };
    });
    if (criteria.some((criterion) => !criterion) ||
        !sameTotal(blankMarks, Number(blank.marks)) ||
        blankMarks <= 0) return null;
    seen.add(blank.blankNumber);
    total += blankMarks;
    normalized.push({
      blankNumber: blank.blankNumber,
      expectedAnswers: [...new Set([blank.expectedAnswer, ...blank.acceptableAnswers].map((answer) => answer.trim()))],
      semanticGuidance: blank.semanticGuidance.trim(),
      criteria,
      maxMarks: roundMark(blankMarks)
    });
  }
  if (seen.size !== question.blankCount || !sameTotal(total, question.marks)) return null;
  return {
    blanks: normalized.sort((left, right) => left.blankNumber - right.blankNumber),
    explanation: text(fill.explanation, 2000) || ""
  };
};

const getTheoryMarking = (question) => {
  const theory = question.markingSnapshot?.theory;
  if (!validQuestionMarks(question) ||
      !theory ||
      !text(theory.referenceAnswer, 5000) ||
      !text(theory.explanation, 2000) ||
      !Array.isArray(theory.criteria) ||
      theory.criteria.length === 0 ||
      theory.criteria.length > 20 ||
      !sameTotal(Number(theory.totalMarks), question.marks)) return null;
  const seen = new Set();
  let total = 0;
  const criteria = [];
  for (const criterion of theory.criteria) {
    if (!text(criterion.criterionId, 40) ||
        seen.has(criterion.criterionId) ||
        !text(criterion.description, 1000) ||
        !Number.isFinite(criterion.marks) ||
        criterion.marks <= 0 ||
        criterion.marks > question.marks ||
        !Array.isArray(criterion.acceptableAlternatives) ||
        criterion.acceptableAlternatives.some((answer) => !text(answer, 500))) return null;
    seen.add(criterion.criterionId);
    total += criterion.marks;
    criteria.push({
      criterionId: criterion.criterionId,
      description: criterion.description.trim(),
      maxMarks: criterion.marks,
      acceptableAlternatives: criterion.acceptableAlternatives.map((answer) => answer.trim())
    });
  }
  if (!sameTotal(total, question.marks)) return null;
  return {
    referenceAnswer: theory.referenceAnswer.trim(),
    explanation: theory.explanation.trim(),
    criteria
  };
};

const makeFillCriterionResult = (criterion, awardedMarks, feedback, missingPoint) => ({
  criterionId: criterion.criterionId,
  description: criterion.description,
  awardedMarks: roundMark(awardedMarks),
  maxMarks: criterion.maxMarks,
  feedback,
  missingPoint
});

const gradeFillBlankExactly = (blank, response) => {
  const accepted = new Set(blank.expectedAnswers.map(normalizeAnswer));
  const normalizedResponse = normalizeAnswer(response);
  if (!normalizedResponse) {
    return {
      status: "graded",
      provisional: false,
      blankNumber: blank.blankNumber,
      awardedMarks: 0,
      maxMarks: blank.maxMarks,
      response,
      expectedAnswers: blank.expectedAnswers,
      criteria: blank.criteria.map((criterion) =>
        makeFillCriterionResult(criterion, 0, "No answer was submitted for this blank.", criterion.description)),
      explanation: "This blank was not answered.",
      lostMarks: "No answer was submitted."
    };
  }
  if (!accepted.has(normalizedResponse)) return null;
  return {
    status: "graded",
    provisional: false,
    blankNumber: blank.blankNumber,
    awardedMarks: blank.maxMarks,
    maxMarks: blank.maxMarks,
    response,
    expectedAnswers: blank.expectedAnswers,
    criteria: blank.criteria.map((criterion) =>
      makeFillCriterionResult(criterion, criterion.maxMarks, "The response matches an accepted answer.", "")),
    explanation: "The response matches an accepted answer.",
    lostMarks: ""
  };
};

const buildGradingPlan = (session) => {
  const results = [];
  const aiItems = [];
  const aiItemContexts = new Map();
  for (const [index, question] of (session.questions || []).entries()) {
    const type = question.questionType || "objective";
    if (type === "objective") {
      results[index] = getObjectiveResult(question);
      continue;
    }
    if (type === "fill_in_gap") {
      const fill = getFillMarking(question);
      if (!fill) {
        results[index] = reviewResult(question, "The saved fill-in marking record is incomplete or inconsistent.");
        continue;
      }
      const blanks = [];
      for (const blank of fill.blanks) {
        const response = question.selectedAnswers[blank.blankNumber - 1] || "";
        const exactResult = gradeFillBlankExactly(blank, response);
        if (exactResult) {
          blanks.push(exactResult);
          continue;
        }
        const resultKey = `fill:${question.questionId}:${blank.blankNumber}`;
        aiItemContexts.set(resultKey, { questionIndex: index, question, blank, response });
        aiItems.push({
          resultKey,
          questionId: String(question.questionId),
          questionType: "fill_in_gap",
          question: question.question,
          studentAnswer: response,
          blankNumber: blank.blankNumber,
          expectedAnswers: blank.expectedAnswers,
          semanticGuidance: blank.semanticGuidance,
          criteria: blank.criteria
        });
        blanks.push(null);
      }
      results[index] = {
        status: "graded",
        questionType: type,
        awardedMarks: null,
        maxMarks: question.marks,
        provisional: false,
        explanation: fill.explanation,
        blanks
      };
      continue;
    }
    if (type === "theory") {
      const theory = getTheoryMarking(question);
      if (!theory || typeof question.theoryResponse !== "string") {
        results[index] = reviewResult(question, "The saved theory marking record is incomplete or inconsistent.");
        continue;
      }
      if (!question.theoryResponse.trim()) {
        results[index] = {
          status: "graded",
          questionType: type,
          awardedMarks: 0,
          maxMarks: question.marks,
          provisional: false,
          explanation: "No written response was submitted.",
          referenceAnswer: theory.referenceAnswer,
          criteria: theory.criteria.map((criterion) => ({
            criterionId: criterion.criterionId,
            description: criterion.description,
            awardedMarks: 0,
            maxMarks: criterion.maxMarks,
            feedback: "No response was provided for this criterion.",
            missingPoint: criterion.description
          })),
          lostMarks: "No written response was submitted."
        };
        continue;
      }
      const resultKey = `theory:${question.questionId}`;
      aiItemContexts.set(resultKey, { questionIndex: index, question, theory });
      aiItems.push({
        resultKey,
        questionId: String(question.questionId),
        questionType: "theory",
        question: question.question,
        studentAnswer: question.theoryResponse,
        referenceAnswer: theory.referenceAnswer,
        criteria: theory.criteria
      });
      results[index] = {
        status: "pending",
        questionType: type,
        awardedMarks: null,
        maxMarks: question.marks,
        provisional: false,
        explanation: "",
        referenceAnswer: theory.referenceAnswer,
        criteria: theory.criteria.map((criterion) => ({
          criterionId: criterion.criterionId,
          description: criterion.description,
          awardedMarks: null,
          maxMarks: criterion.maxMarks,
          feedback: "",
          missingPoint: ""
        }))
      };
      continue;
    }
    results[index] = reviewResult(question, "The saved question type is not supported for grading.");
  }
  return { results, aiItems, aiItemContexts };
};

const applyAiResults = (plan, aiResults) => {
  for (const item of plan.aiItems) {
    const key = item.resultKey;
    const assessment = aiResults.get(key);
    const context = plan.aiItemContexts.get(key);
    if (!assessment || !context) throw new Error("invalid_output");
    const { questionIndex, question } = context;
    if (item.questionType === "fill_in_gap") {
      const questionResult = plan.results[questionIndex];
      const blank = context.blank;
      if (assessment.uncertain) {
        questionResult.blanks[blank.blankNumber - 1] = {
          status: "needs_review",
          provisional: true,
          blankNumber: blank.blankNumber,
          awardedMarks: null,
          maxMarks: blank.maxMarks,
          response: context.response,
          expectedAnswers: blank.expectedAnswers,
          criteria: [],
          explanation: assessment.explanation,
          uncertaintyReason: assessment.uncertaintyReason,
          lostMarks: ""
        };
        questionResult.status = "needs_review";
      } else {
        questionResult.blanks[blank.blankNumber - 1] = {
          status: "graded",
          provisional: false,
          blankNumber: blank.blankNumber,
          awardedMarks: assessment.totalAwardedMarks,
          maxMarks: blank.maxMarks,
          response: context.response,
          expectedAnswers: blank.expectedAnswers,
          criteria: assessment.criteria.map((criterion) => {
            const expected = blank.criteria.find((item) => item.criterionId === criterion.criterionId);
            return {
              ...makeFillCriterionResult(
                expected,
                criterion.awardedMarks,
                criterion.feedback,
                criterion.missingPoint
              )
            };
          }),
          explanation: assessment.explanation,
          lostMarks: assessment.totalAwardedMarks < blank.maxMarks
            ? assessment.criteria.filter((criterion) => criterion.missingPoint).map((criterion) => criterion.missingPoint).join(" ")
            : ""
        };
      }
      questionResult.provisional = questionResult.provisional || assessment.uncertain;
      continue;
    }

    if (assessment.uncertain) {
      plan.results[questionIndex] = {
        status: "needs_review",
        questionType: "theory",
        awardedMarks: null,
        maxMarks: question.marks,
        provisional: true,
        uncertaintyReason: assessment.uncertaintyReason,
        explanation: assessment.explanation,
        referenceAnswer: context.theory.referenceAnswer,
        criteria: []
      };
    } else {
      plan.results[questionIndex] = {
        status: "graded",
        questionType: "theory",
        awardedMarks: assessment.totalAwardedMarks,
        maxMarks: question.marks,
        provisional: false,
        explanation: assessment.explanation,
        referenceAnswer: context.theory.referenceAnswer,
        criteria: assessment.criteria.map((criterion) => {
          const expected = context.theory.criteria.find((item) => item.criterionId === criterion.criterionId);
          return {
            criterionId: criterion.criterionId,
            description: expected.description,
            awardedMarks: criterion.awardedMarks,
            maxMarks: expected.maxMarks,
            feedback: criterion.feedback,
            missingPoint: criterion.missingPoint
          };
        }),
        lostMarks: assessment.criteria.filter((criterion) => criterion.missingPoint)
          .map((criterion) => criterion.missingPoint).join(" ")
      };
    }
  }

  for (let index = 0; index < plan.results.length; index += 1) {
    const result = plan.results[index];
    if (result.questionType !== "fill_in_gap" || !Array.isArray(result.blanks)) continue;
    const review = result.blanks.some((blank) => blank?.status === "needs_review");
    result.status = review ? "needs_review" : "graded";
    result.awardedMarks = review
      ? null
      : roundMark(result.blanks.reduce((total, blank) => total + blank.awardedMarks, 0));
    result.provisional = result.blanks.some((blank) => blank?.status === "needs_review");
    result.lostMarks = result.blanks.filter((blank) => blank?.lostMarks)
      .map((blank) => `Blank ${blank.blankNumber}: ${blank.lostMarks}`).join(" ");
  }
};

const calculateTotals = (results) => {
  let totalMarks = 0;
  let provisionalScore = 0;
  let provisionalMaxMarks = 0;
  let needsReview = false;
  for (const result of results) {
    totalMarks += result.maxMarks;
    if (result.status === "graded") {
      provisionalScore += result.awardedMarks;
      provisionalMaxMarks += result.maxMarks;
    } else if (result.status === "needs_review") {
      needsReview = true;
      if (Array.isArray(result.blanks)) {
        for (const blank of result.blanks) {
          if (blank.status === "graded") {
            provisionalScore += blank.awardedMarks;
            provisionalMaxMarks += blank.maxMarks;
          }
        }
        if (provisionalScore > provisionalMaxMarks + MARK_TOLERANCE) {
          throw new Error("invalid_output");
        }
      }
    } else {
      throw new Error("invalid_output");
    }
  }
  return {
    totalMarks: roundMark(totalMarks),
    provisionalScore: roundMark(provisionalScore),
    provisionalMaxMarks: roundMark(provisionalMaxMarks),
    provisionalPercentage: provisionalMaxMarks
      ? roundMark((provisionalScore / provisionalMaxMarks) * 100)
      : null,
    needsReview
  };
};

const withTimeout = (promise, timeoutMs) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    const error = new Error("grading_timeout");
    error.code = "grading_timeout";
    reject(error);
  }, timeoutMs);
  promise.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    }
  );
});

const mapFailureCode = (error) => {
  if (error?.code === "grading_timeout") return "grading_timeout";
  if (error?.message === "invalid_output") return "invalid_output";
  if (error?.statusCode === 429) return "quota_exceeded";
  if (error?.statusCode === 503) return "not_configured";
  if (error?.statusCode === 400) return "request_too_large";
  return "provider_error";
};

const fetchAttempt = (attemptId, userId) =>
  QuizSession.findOne({ _id: attemptId, user: userId });

const gradeAttempt = async ({
  attemptId,
  userId,
  now = () => new Date(),
  timeoutMs = GRADING_TIMEOUT_MS
}) => {
  let session = await fetchAttempt(attemptId, userId);
  if (!session) return { kind: "not_found" };
  if (session.status !== "completed" && !session.timeEnded) return { kind: "not_submitted", session };
  if (!(session.attemptFormatVersion >= 2)) return { kind: "legacy", session };
  if (session.gradingStatus === "graded" || session.gradingStatus === "needs_review") {
    return { kind: "already_graded", session };
  }
  if (session.gradingStatus === "grading" &&
      session.gradingStartedAt instanceof Date &&
      session.gradingStartedAt.getTime() > now().getTime() - GRADING_LEASE_MS) {
    return { kind: "already_grading", session };
  }

  const token = crypto.randomUUID();
  const startedAt = now();
  const staleBefore = new Date(startedAt.getTime() - GRADING_LEASE_MS);
  const claimed = await QuizSession.findOneAndUpdate(
    {
      $and: [
        { _id: attemptId, user: userId, status: "completed", attemptFormatVersion: { $gte: 2 } },
        {
          $or: [
            { gradingStatus: { $in: ["pending", "failed"] } },
            { gradingStatus: { $exists: false } },
            { gradingStatus: "grading", gradingStartedAt: { $lte: staleBefore } },
            { gradingStatus: "grading", gradingStartedAt: { $exists: false } }
          ]
        }
      ]
    },
    {
      $set: { gradingStatus: "grading", gradingToken: token, gradingStartedAt: startedAt },
      $unset: { gradingErrorCode: "" },
      $inc: { gradingAttemptCount: 1 }
    },
    { new: true }
  );
  if (!claimed) {
    session = await fetchAttempt(attemptId, userId);
    if (!session) return { kind: "not_found" };
    return {
      kind: session.gradingStatus === "graded" || session.gradingStatus === "needs_review"
        ? "already_graded"
        : session.gradingStatus === "grading" ? "already_grading" : "not_ready",
      session
    };
  }

  try {
    const plan = buildGradingPlan(claimed);
    let aiResults = new Map();
    if (plan.aiItems.length) {
      const generated = await withTimeout(
        gemini.gradeCbtResponses(plan.aiItems.map(({ resultKey, ...item }) => item), userId),
        timeoutMs
      );
      aiResults = validateAiGradingOutput(plan.aiItems, parseAiResponse(generated.message));
    }
    applyAiResults(plan, aiResults);
    const totals = calculateTotals(plan.results);
    const hasReview = totals.needsReview;
    for (const result of plan.results) {
      if (result.status === "graded") result.provisional = false;
      for (const blank of result.blanks || []) {
        if (blank.status === "graded") blank.provisional = false;
      }
    }
    const resultFields = {};
    for (const [index, result] of plan.results.entries()) {
      resultFields[`questions.${index}.gradingResult`] = result;
    }
    const finalFields = {
      ...resultFields,
      gradingStatus: hasReview ? "needs_review" : "graded",
      totalMarks: totals.totalMarks,
      score: hasReview ? null : totals.provisionalScore,
      percentage: hasReview || !totals.totalMarks
        ? null
        : roundMark((totals.provisionalScore / totals.totalMarks) * 100),
      provisionalScore: hasReview ? totals.provisionalScore : null,
      provisionalMaxMarks: hasReview ? totals.provisionalMaxMarks : null,
      provisionalPercentage: hasReview ? totals.provisionalPercentage : null,
      gradingErrorCode: ""
    };
    const graded = await QuizSession.findOneAndUpdate(
      { _id: attemptId, user: userId, gradingStatus: "grading", gradingToken: token },
      {
        $set: finalFields,
        $unset: { gradingToken: "", gradingStartedAt: "" }
      },
      { new: true }
    );
    if (graded) return { kind: hasReview ? "needs_review" : "graded", session: graded };
    session = await fetchAttempt(attemptId, userId);
    return { kind: "superseded", session };
  } catch (error) {
    const failureCode = mapFailureCode(error);
    const failed = await QuizSession.findOneAndUpdate(
      { _id: attemptId, user: userId, gradingStatus: "grading", gradingToken: token },
      {
        $set: { gradingStatus: "failed", gradingErrorCode: failureCode },
        $unset: { gradingToken: "", gradingStartedAt: "" }
      },
      { new: true }
    );
    if (failed) return { kind: "failed", session: failed };
    session = await fetchAttempt(attemptId, userId);
    return { kind: "superseded", session };
  }
};

module.exports = {
  GRADING_TIMEOUT_MS,
  GRADING_LEASE_MS,
  normalizeAnswer,
  validateAiGradingOutput,
  buildGradingPlan,
  applyAiResults,
  calculateTotals,
  gradeAttempt
};
