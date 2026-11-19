const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getVerifiedLegacyResult,
  getVerifiedTypedResult
} = require("../utils/legacyQuizResult");

const finishedAt = new Date("2025-02-01T12:00:00.000Z");

test("timestamped historical objective attempts without status remain verifiable", () => {
  const result = getVerifiedLegacyResult({
    completedAt: finishedAt,
    score: 1,
    totalQuestions: 2,
    questions: [
      { questionId: "q1", isCorrect: true },
      { questionId: "q2", isCorrect: false }
    ]
  });

  assert.deepEqual(result, {
    status: "verified",
    score: 1,
    totalQuestions: 2,
    percentage: 50
  });
});

test("zero-valued defaults are not treated as earned scores without question evidence", () => {
  const result = getVerifiedLegacyResult({
    status: "completed",
    score: 0,
    percentage: 0,
    totalQuestions: 2,
    questions: [
      { questionId: "q1" },
      { questionId: "q2" }
    ]
  });

  assert.deepEqual(result, {
    status: "unverified",
    score: null,
    percentage: null
  });
});

test("a zero score is preserved when saved objective correctness verifies it", () => {
  const result = getVerifiedLegacyResult({
    status: "completed",
    score: 0,
    totalQuestions: 2,
    questions: [
      { questionId: "q1", isCorrect: false },
      { questionId: "q2", isCorrect: false }
    ]
  });

  assert.deepEqual(result, {
    status: "verified",
    score: 0,
    totalQuestions: 2,
    percentage: 0
  });
});

test("legacy scores inconsistent with saved answers are unverified", () => {
  const result = getVerifiedLegacyResult({
    status: "completed",
    score: 2,
    totalQuestions: 2,
    questions: [
      { questionId: "q1", isCorrect: true },
      { questionId: "q2", isCorrect: false }
    ]
  });

  assert.equal(result.status, "unverified");
  assert.equal(result.score, null);
});

test("typed and non-objective attempts are not reclassified as historical objective results", () => {
  assert.equal(getVerifiedLegacyResult({
    attemptFormatVersion: 2,
    status: "completed",
    score: 2,
    questions: [{ questionId: "q1", isCorrect: true }]
  }).status, "unverified");
  assert.equal(getVerifiedLegacyResult({
    status: "completed",
    score: 1,
    questions: [{ questionId: "q1", questionType: "theory", isCorrect: true }]
  }).status, "unverified");
});

test("typed results are final only when question marks and persisted totals reconcile", () => {
  const attempt = {
    attemptFormatVersion: 2,
    gradingStatus: "graded",
    score: 6,
    totalMarks: 8,
    percentage: 75,
    questions: [
      {
        questionId: "objective",
        questionType: "objective",
        marks: 2,
        gradingResult: {
          status: "graded",
          awardedMarks: 2,
          maxMarks: 2,
          isCorrect: true
        }
      },
      {
        questionId: "fill",
        questionType: "fill_in_gap",
        blankCount: 1,
        marks: 2,
        gradingResult: {
          status: "graded",
          awardedMarks: 1,
          maxMarks: 2,
          blanks: [{
            status: "graded",
            awardedMarks: 1,
            maxMarks: 2,
            criteria: [{ awardedMarks: 1, maxMarks: 2 }]
          }]
        }
      },
      {
        questionId: "theory",
        questionType: "theory",
        marks: 4,
        gradingResult: {
          status: "graded",
          awardedMarks: 3,
          maxMarks: 4,
          criteria: [
            { awardedMarks: 2, maxMarks: 2 },
            { awardedMarks: 1, maxMarks: 2 }
          ]
        }
      }
    ]
  };

  assert.deepEqual(getVerifiedTypedResult(attempt), {
    status: "verified",
    score: 6,
    totalMarks: 8,
    percentage: 75
  });
  assert.equal(getVerifiedTypedResult({
    ...attempt,
    questions: attempt.questions.map((question) => question.questionType === "theory"
      ? {
        ...question,
        gradingResult: { ...question.gradingResult, awardedMarks: 5 }
      }
      : question)
  }).status, "unverified");
});
