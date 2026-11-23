const isDate = (value) =>
  value instanceof Date && Number.isFinite(value.getTime());

const isLegacyAttempt = (attempt) =>
  !(Number.isInteger(attempt?.attemptFormatVersion) && attempt.attemptFormatVersion >= 2);

const hasCompletionEvidence = (attempt) =>
  attempt?.status === "completed" ||
  (!attempt?.status && (isDate(attempt?.completedAt) || isDate(attempt?.timeEnded)));

const hasReliableObjectiveResult = (question) =>
  question &&
  (!question.questionType || question.questionType === "objective") &&
  question.questionId != null &&
  (typeof question.isCorrect === "boolean" ||
    (typeof question.selectedOptionId === "string" &&
      typeof question.correctOptionId === "string"));

const questionIsCorrect = (question) =>
  typeof question.isCorrect === "boolean"
    ? question.isCorrect
    : question.selectedOptionId === question.correctOptionId;

const roundMark = (value) => Math.round(value * 100) / 100;
const marksMatch = (left, right) =>
  Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 0.01;

const normalizeAdminAnswer = (value) =>
  value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");

const adminAnswersMatch = (left, right) =>
  normalizeAdminAnswer(left) === normalizeAdminAnswer(right);

const getVerifiedAdminFillResult = (question) => {
  const unavailable = null;
  const fill = question.markingSnapshot?.fillInGap;
  const blankCount = question.blankCount;
  if (question.markingSnapshot?.markingSource !== "admin_authored" ||
      !Number.isInteger(blankCount) ||
      blankCount < 1 ||
      !Number.isFinite(question.marks) ||
      question.marks <= 0 ||
      !fill ||
      !Array.isArray(fill.blanks) ||
      fill.blanks.length !== blankCount ||
      !marksMatch(fill.totalMarks, question.marks) ||
      !Array.isArray(question.selectedAnswers) ||
      question.selectedAnswers.length !== blankCount ||
      !Array.isArray(question.gradingResult?.blanks) ||
      question.gradingResult.blanks.length !== blankCount) return unavailable;

  const savedBlanks = new Map();
  let totalMarks = 0;
  for (const blank of fill.blanks) {
    if (!Number.isInteger(blank.blankNumber) ||
        blank.blankNumber < 1 ||
        blank.blankNumber > blankCount ||
        savedBlanks.has(blank.blankNumber) ||
        typeof blank.expectedAnswer !== "string" ||
        !Array.isArray(blank.acceptableAnswers) ||
        blank.acceptableAnswers.length === 0 ||
        blank.acceptableAnswers.some((answer) => typeof answer !== "string") ||
        !blank.acceptableAnswers.some((answer) =>
          adminAnswersMatch(answer, blank.expectedAnswer)) ||
        !Number.isFinite(blank.marks) ||
        blank.marks <= 0) return unavailable;
    savedBlanks.set(blank.blankNumber, blank);
    totalMarks += blank.marks;
  }
  if (savedBlanks.size !== blankCount || !marksMatch(totalMarks, question.marks)) {
    return unavailable;
  }

  const resultBlanks = new Map();
  for (const blank of question.gradingResult.blanks) {
    if (!Number.isInteger(blank.blankNumber) ||
        resultBlanks.has(blank.blankNumber)) return unavailable;
    resultBlanks.set(blank.blankNumber, blank);
  }
  if (resultBlanks.size !== blankCount) return unavailable;

  let score = 0;
  for (let blankNumber = 1; blankNumber <= blankCount; blankNumber += 1) {
    const snapshotBlank = savedBlanks.get(blankNumber);
    const resultBlank = resultBlanks.get(blankNumber);
    const savedAnswer = question.selectedAnswers[blankNumber - 1];
    if (!snapshotBlank ||
        !resultBlank ||
        typeof savedAnswer !== "string" ||
        resultBlank.status !== "graded" ||
        resultBlank.response !== savedAnswer ||
        !marksMatch(resultBlank.maxMarks, snapshotBlank.marks) ||
        !Array.isArray(resultBlank.criteria) ||
        resultBlank.criteria.length !== 0) return unavailable;

    const answerAccepted = snapshotBlank.acceptableAnswers.some((answer) =>
      adminAnswersMatch(answer, savedAnswer));
    const expectedMarks = answerAccepted ? snapshotBlank.marks : 0;
    if (!marksMatch(resultBlank.awardedMarks, expectedMarks)) return unavailable;
    score += expectedMarks;
  }

  return {
    score: roundMark(score),
    totalMarks: roundMark(totalMarks)
  };
};

const getVerifiedTypedResult = (attempt) => {
  const unavailable = { status: "unverified", score: null, totalMarks: null, percentage: null };
  if (!(attempt?.attemptFormatVersion >= 2) ||
      attempt.gradingStatus !== "graded" ||
      !Array.isArray(attempt.questions) ||
      attempt.questions.length === 0) return unavailable;

  let score = 0;
  let totalMarks = 0;
  for (const question of attempt.questions) {
    const type = question.questionType ?? "objective";
    const result = question.gradingResult;
    if (!question.questionId ||
        !["objective", "fill_in_gap", "theory"].includes(type) ||
        result?.status !== "graded" ||
        !Number.isFinite(question.marks) ||
        question.marks <= 0 ||
        !Number.isFinite(result.awardedMarks) ||
        !Number.isFinite(result.maxMarks) ||
        result.maxMarks !== question.marks ||
        result.awardedMarks < 0 ||
        result.awardedMarks > result.maxMarks) return unavailable;

    if (type === "objective") {
      if (typeof result.isCorrect !== "boolean" ||
          result.awardedMarks !== (result.isCorrect ? result.maxMarks : 0)) return unavailable;
    } else if (type === "fill_in_gap" &&
        question.markingSnapshot?.markingSource === "admin_authored") {
      const verifiedFill = getVerifiedAdminFillResult(question);
      if (!verifiedFill ||
          !marksMatch(result.awardedMarks, verifiedFill.score) ||
          !marksMatch(result.maxMarks, verifiedFill.totalMarks)) return unavailable;
    } else {
      const markRows = type === "fill_in_gap" ? result.blanks : result.criteria;
      if (!Array.isArray(markRows) || markRows.length === 0) return unavailable;
      let questionScore = 0;
      let questionMaxMarks = 0;
      for (const row of markRows) {
        if (type === "fill_in_gap" && row.status !== "graded") return unavailable;
        if (!Number.isFinite(row.awardedMarks) ||
            !Number.isFinite(row.maxMarks) ||
            row.maxMarks <= 0 ||
            row.awardedMarks < 0 ||
            row.awardedMarks > row.maxMarks) return unavailable;
        if (type === "fill_in_gap") {
          if (!Array.isArray(row.criteria) || row.criteria.length === 0) return unavailable;
          let blankScore = 0;
          let blankMaxMarks = 0;
          for (const criterion of row.criteria) {
            if (!Number.isFinite(criterion.awardedMarks) ||
                !Number.isFinite(criterion.maxMarks) ||
                criterion.maxMarks <= 0 ||
                criterion.awardedMarks < 0 ||
                criterion.awardedMarks > criterion.maxMarks) return unavailable;
            blankScore += criterion.awardedMarks;
            blankMaxMarks += criterion.maxMarks;
          }
          if (!marksMatch(blankScore, row.awardedMarks) ||
              !marksMatch(blankMaxMarks, row.maxMarks)) return unavailable;
        }
        questionScore += row.awardedMarks;
        questionMaxMarks += row.maxMarks;
      }
      if (!marksMatch(questionScore, result.awardedMarks) ||
          !marksMatch(questionMaxMarks, result.maxMarks)) return unavailable;
      if (type === "fill_in_gap" &&
          (!Number.isInteger(question.blankCount) || question.blankCount !== markRows.length)) {
        return unavailable;
      }
    }

    score += result.awardedMarks;
    totalMarks += result.maxMarks;
  }

  const normalizedScore = roundMark(score);
  const normalizedTotalMarks = roundMark(totalMarks);
  const percentage = totalMarks ? roundMark((normalizedScore / normalizedTotalMarks) * 100) : null;
  if (!Number.isFinite(attempt.score) ||
      !Number.isFinite(attempt.totalMarks) ||
      !Number.isFinite(attempt.percentage) ||
      !marksMatch(attempt.score, normalizedScore) ||
      !marksMatch(attempt.totalMarks, normalizedTotalMarks) ||
      !marksMatch(attempt.percentage, percentage)) return unavailable;

  return {
    status: "verified",
    score: normalizedScore,
    totalMarks: normalizedTotalMarks,
    percentage
  };
};

const getVerifiedLegacyResult = (attempt) => {
  if (!isLegacyAttempt(attempt) || !hasCompletionEvidence(attempt)) {
    return { status: "unverified", score: null, percentage: null };
  }

  const questions = Array.isArray(attempt.questions) ? attempt.questions : [];
  if (!questions.length || !questions.every(hasReliableObjectiveResult)) {
    return { status: "unverified", score: null, percentage: null };
  }

  const score = questions.filter(questionIsCorrect).length;
  const countMismatch = Number.isFinite(attempt.totalQuestions) &&
    attempt.totalQuestions > 0 &&
    attempt.totalQuestions !== questions.length;
  if (!Number.isSafeInteger(attempt.score) ||
      attempt.score !== score ||
      attempt.score < 0 ||
      attempt.score > questions.length ||
      countMismatch) {
    return { status: "unverified", score: null, percentage: null };
  }

  return {
    status: "verified",
    score,
    totalQuestions: questions.length,
    percentage: (score / questions.length) * 100
  };
};

const legacyVerificationExpressions = () => {
  const hasCorrectBoolean = (question) =>
    ({ $eq: [{ $type: `${question}.isCorrect` }, "bool"] });
  const hasOptionEvidence = (question) => ({
    $and: [
      { $eq: [{ $type: `${question}.selectedOptionId` }, "string"] },
      { $eq: [{ $type: `${question}.correctOptionId` }, "string"] }
    ]
  });
  const isObjective = (question) => ({
    $eq: [{ $ifNull: [`${question}.questionType`, "objective"] }, "objective"]
  });
  const hasResult = (question) => ({
    $and: [
      isObjective(question),
      { $ne: [`${question}.questionId`, null] },
      { $or: [hasCorrectBoolean(question), hasOptionEvidence(question)] }
    ]
  });
  const isCorrect = (question) => ({
    $cond: [
      hasCorrectBoolean(question),
      `${question}.isCorrect`,
      {
        $and: [
          hasOptionEvidence(question),
          { $eq: [`${question}.selectedOptionId`, `${question}.correctOptionId`] }
        ]
      }
    ]
  });

  return {
    questionCount: { $size: "$questions" },
    hasReliableQuestionResults: {
      $and: [
        { $gt: [{ $size: "$questions" }, 0] },
        {
          $allElementsTrue: [{
            $map: {
              input: "$questions",
              as: "legacyQuestion",
              in: hasResult("$$legacyQuestion")
            }
          }]
        }
      ]
    },
    verifiedScore: {
      $sum: {
        $map: {
          input: "$questions",
          as: "legacyQuestion",
          in: { $cond: [isCorrect("$$legacyQuestion"), 1, 0] }
        }
      }
    }
  };
};

module.exports = {
  getVerifiedLegacyResult,
  getVerifiedTypedResult,
  hasCompletionEvidence,
  isLegacyAttempt,
  legacyVerificationExpressions
};
