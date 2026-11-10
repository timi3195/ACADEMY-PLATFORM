const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSystemInstruction } = require("../utils/gemini");

test("Gemini prompt includes verified course aggregates and guards insufficient evidence", () => {
  const cbtPerformance = {
    hasCompletedAttempts: true,
    scope: "selected_course",
    completedAttempts: 4,
    averageScorePercentage: 72.5,
    accuracy: 70,
    questionsAnswered: 20,
    strongTopics: [{ topic: "Variables", questionsAnswered: 5, accuracy: 90 }],
    weakTopics: [{ topic: "Loops", questionsAnswered: 5, accuracy: 40 }],
    topicsWithInsufficientEvidence: [{ topic: "Functions", questionsAnswered: 2 }],
    overallTrend: {
      scope: "all_courses",
      direction: "improving",
      comparedAttempts: 4,
      changePercentagePoints: 12.5
    }
  };
  const prompt = buildSystemInstruction({ courseName: "Programming", cbtPerformance });

  assert.match(prompt, /"averageScorePercentage":72\.5/);
  assert.match(prompt, /"topic":"Loops"/);
  assert.match(prompt, /"direction":"improving"/);
  assert.match(prompt, /do not describe them as weak/i);
  assert.match(prompt, /suggest practical revision activities/i);
  assert.doesNotMatch(prompt, /correctAnswer|correctOptionId|selectedAnswer/);
});

test("Gemini prompt permits ordinary study questions without claiming performance analysis", () => {
  const prompt = buildSystemInstruction({
    courseName: "Programming",
    cbtPerformance: {
      hasCompletedAttempts: false,
      scope: "selected_course",
      completedAttempts: 0
    }
  });

  assert.match(prompt, /No completed CBT attempts are available for this selected course/);
  assert.match(prompt, /may still answer ordinary academic questions/i);
  assert.match(prompt, /do not claim to have analyzed the student's results/i);
});
