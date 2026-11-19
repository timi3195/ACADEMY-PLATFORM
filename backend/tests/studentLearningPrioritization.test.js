const test = require("node:test");
const assert = require("node:assert/strict");

const STUDENT_A = "507f1f77bcf86cd799439011";
const STUDENT_B = "507f1f77bcf86cd799439012";
const COURSE_ID = "507f1f77bcf86cd799439021";
const MATERIAL_ID = "507f1f77bcf86cd799439031";
const service = require("../services/studentLearningEvidenceService");
const gemini = require("../utils/gemini");

const makeCandidates = () => [
  {
    candidateId: `material:${COURSE_ID}:${MATERIAL_ID}:revisit`,
    kind: "study_material",
    course: { courseId: COURSE_ID, title: "Networking", code: "NET101" },
    action: {
      type: "revisit_material",
      materialId: MATERIAL_ID,
      title: "Routing",
      materialType: "Lecture Note"
    },
    reason: "Verified results show Routing needs improvement.",
    evidence: {
      category: "verified_topic_performance",
      sufficiency: "sufficient",
      topic: "Routing",
      classification: "Needs improvement",
      questionsAnswered: 4,
      accuracy: 25
    }
  },
  {
    candidateId: `practice:${COURSE_ID}:10`,
    kind: "practice_test",
    course: { courseId: COURSE_ID, title: "Networking", code: "NET101" },
    action: { type: "start_practice_test", questionCount: 10 },
    reason: "An eligible course-wide practice test is available.",
    evidence: {
      category: "practice_coverage",
      sufficiency: "sufficient",
      eligibleQuestionCount: 20
    }
  }
];

const responseFor = (candidates) => ({
  message: JSON.stringify({
    recommendations: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      actionType: candidate.action?.type || candidate.actionType,
      explanationCode: candidate.evidence.category === "practice_coverage"
        ? "available_practice"
        : "topic_performance"
    }))
  })
});

const withMocks = async ({
  studentId = STUDENT_A,
  fingerprint = "evidence-1",
  candidates = makeCandidates(),
  prioritize = async (input) => responseFor(input)
}, run) => {
  const originalPrioritize = gemini.prioritizeStudentLearningCandidates;
  let currentStudentId = studentId;
  let currentFingerprint = fingerprint;
  service.clearRecommendationCache();
  gemini.prioritizeStudentLearningCandidates = prioritize;
  const getResult = (requestedId = currentStudentId) => {
    assert.equal(String(requestedId), currentStudentId);
    const evidence = {
      studentId: currentStudentId,
      evidenceFingerprint: currentFingerprint,
      generatedAt: new Date("2026-01-01T00:00:00Z"),
      courses: []
    };
    return service.prioritizeRecommendationCandidates(requestedId, evidence, candidates);
  };
  try {
    await run({
      service,
      gemini,
      candidates,
      getResult,
      setFingerprint: (value) => { currentFingerprint = value; },
      setStudentId: (value) => { currentStudentId = value; }
    });
  } finally {
    gemini.prioritizeStudentLearningCandidates = originalPrioritize;
    service.clearRecommendationCache();
  }
};

test("Gemini receives only bounded candidate and evidence fields", async () => {
  const candidates = makeCandidates();
  candidates[0].action.url = "https://private.example/resource";
  candidates[0].evidence.rawStudentAnswers = ["private answer"];
  candidates[0].evidence.markingKey = "private key";
  candidates[0].privateSnapshot = { studentId: STUDENT_A };
  let received;

  await withMocks({ candidates, prioritize: async (input, userId) => {
    received = { input, userId };
    return responseFor(input);
  } }, async ({ getResult }) => {
    const result = await getResult(STUDENT_A);
    assert.equal(result.prioritizationStatus, "ai_prioritized");
  });

  assert.equal(received.userId, STUDENT_A);
  assert.equal(received.input.length, 2);
  const serialized = JSON.stringify(received.input);
  for (const forbidden of [
    STUDENT_A,
    "evidence-1",
    "rawStudentAnswers",
    "private answer",
    "markingKey",
    "private key",
    "privateSnapshot",
    "https://private.example/resource"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(received.input[0].actionType, "revisit_material");
  assert.equal(received.input[0].evidence.accuracy, 25);
});

test("valid supplied IDs are prioritized while backend resources and reasons remain authoritative", async () => {
  const candidates = makeCandidates();
  await withMocks({ candidates, prioritize: async (input) => ({
    message: JSON.stringify({
      recommendations: [
        {
          candidateId: input[1].candidateId,
          actionType: input[1].actionType,
          explanationCode: "available_practice"
        },
        {
          candidateId: input[0].candidateId,
          actionType: input[0].actionType,
          explanationCode: "topic_performance"
        }
      ]
    })
  }) }, async ({ getResult }) => {
    const result = await getResult(STUDENT_A);
    assert.equal(result.prioritizationStatus, "ai_prioritized");
    assert.deepEqual(result.candidates.map((candidate) => candidate.candidateId), [
      candidates[1].candidateId,
      candidates[0].candidateId
    ]);
    assert.equal(result.candidates[0].action.questionCount, 10);
    assert.equal(result.candidates[1].action.materialId, MATERIAL_ID);
    assert.equal(result.candidates[1].reason, candidates[0].reason);
    assert.equal(result.candidates[1].action.title, "Routing");
    assert.equal(result.candidates[0].prioritizationExplanation,
      "Prioritized because an eligible practice test is available.");
  });
});

test("unknown IDs, duplicates, invalid actions, extra resource claims, and malformed or incomplete output fall back", async () => {
  const candidates = makeCandidates();
  const malformedOutputs = [
    "{not json",
    JSON.stringify({ recommendations: [] }),
    JSON.stringify({ recommendations: [
      { candidateId: "fabricated:resource", actionType: "start_practice_test", explanationCode: "available_practice" },
      { candidateId: candidates[0].candidateId, actionType: "revisit_material", explanationCode: "topic_performance" }
    ] }),
    JSON.stringify({ recommendations: [
      { candidateId: candidates[0].candidateId, actionType: "revisit_material", explanationCode: "topic_performance" },
      { candidateId: candidates[0].candidateId, actionType: "revisit_material", explanationCode: "topic_performance" }
    ] }),
    JSON.stringify({ recommendations: [
      { candidateId: candidates[0].candidateId, actionType: "start_practice_test", explanationCode: "topic_performance" },
      { candidateId: candidates[1].candidateId, actionType: "start_practice_test", explanationCode: "available_practice" }
    ] }),
    JSON.stringify({ recommendations: [
      { candidateId: candidates[0].candidateId, actionType: "revisit_material", explanationCode: "topic_performance", url: "https://invented.example" },
      { candidateId: candidates[1].candidateId, actionType: "start_practice_test", explanationCode: "available_practice" }
    ] }),
    JSON.stringify({ recommendations: [
      { candidateId: candidates[0].candidateId, actionType: "revisit_material", explanationCode: "topic_performance", score: 100 },
      { candidateId: candidates[1].candidateId, actionType: "start_practice_test", explanationCode: "available_practice" }
    ] })
  ];

  for (let index = 0; index < malformedOutputs.length; index += 1) {
    await withMocks({
      fingerprint: `invalid-output-${index}`,
      candidates,
      prioritize: async () => ({ message: malformedOutputs[index] })
    }, async ({ getResult }) => {
      const result = await getResult(STUDENT_A);
      assert.equal(result.prioritizationStatus, "deterministic_fallback");
      assert.deepEqual(result.candidates, candidates);
    });
  }
});

test("provider failures, rate limits, and timeouts return deterministic candidates", async () => {
  const failures = [
    new Error("provider unavailable"),
    Object.assign(new Error("rate limited"), { statusCode: 429 })
  ];
  for (let index = 0; index < failures.length; index += 1) {
    await withMocks({
      fingerprint: `provider-failure-${index}`,
      prioritize: async () => { throw failures[index]; }
    }, async ({ candidates: originalCandidates, getResult }) => {
      const result = await getResult(STUDENT_A);
      assert.equal(result.prioritizationStatus, "deterministic_fallback");
      assert.deepEqual(result.candidates, originalCandidates);
    });
  }

  let failedCallCount = 0;
  await withMocks({
    fingerprint: "uncached-provider-failure",
    prioritize: async () => {
      failedCallCount += 1;
      throw new Error("provider unavailable");
    }
  }, async ({ getResult }) => {
    await getResult(STUDENT_A);
    await getResult(STUDENT_A);
    assert.equal(failedCallCount, 2);
  });

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback) => originalSetTimeout(callback, 0);
  try {
    await withMocks({
      fingerprint: "provider-timeout",
      prioritize: () => new Promise(() => {})
    }, async ({ candidates: originalCandidates, getResult }) => {
      const result = await getResult(STUDENT_A);
      assert.equal(result.prioritizationStatus, "deterministic_fallback");
      assert.deepEqual(result.candidates, originalCandidates);
    });
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("cached prioritization requires unchanged student-specific evidence", async () => {
  const candidates = makeCandidates();
  let callCount = 0;
  const prioritize = async (input) => {
    callCount += 1;
    return responseFor(input);
  };

  await withMocks({ fingerprint: "unchanged", candidates, prioritize }, async ({
    getResult,
    setFingerprint,
    setStudentId
  }) => {
    const first = await getResult(STUDENT_A);
    const cached = await getResult(STUDENT_A);
    assert.equal(first.prioritizationStatus, "ai_prioritized");
    assert.equal(cached.prioritizationStatus, "ai_prioritized");
    assert.equal(callCount, 1);
    assert.equal(JSON.stringify(cached.candidates).includes(STUDENT_A), false);
    assert.equal(JSON.stringify(cached.candidates).includes("unchanged"), false);
    setFingerprint("changed");
    const changed = await getResult(STUDENT_A);
    assert.equal(changed.prioritizationStatus, "ai_prioritized");
    assert.equal(callCount, 2);
    setFingerprint("unchanged");
    setStudentId(STUDENT_B);
    const otherStudent = await getResult(STUDENT_B);
    assert.equal(otherStudent.prioritizationStatus, "ai_prioritized");
    assert.equal(callCount, 3);
  });
});
