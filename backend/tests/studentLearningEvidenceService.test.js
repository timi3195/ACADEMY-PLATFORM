const test = require("node:test");
const assert = require("node:assert/strict");

const STUDENT_A = "507f1f77bcf86cd799439011";
const STUDENT_B = "507f1f77bcf86cd799439012";
const COURSE_ID = "507f1f77bcf86cd799439021";
const MATERIAL_ROUTING = "507f1f77bcf86cd799439031";
const MATERIAL_GENERAL = "507f1f77bcf86cd799439032";
const MATERIAL_UNAVAILABLE = "507f1f77bcf86cd799439033";
const DEPARTMENT_ID = "507f1f77bcf86cd799439041";

const student = (id) => ({ _id: id, role: "student", department: DEPARTMENT_ID });
const course = {
  _id: COURSE_ID,
  title: "Networking",
  code: "NET101",
  department: DEPARTMENT_ID,
  topicsBreakdown: [{ name: "Routing" }, { name: "Subnetting" }]
};
const makeMaterial = (id, title, available = true, overrides = {}) => ({
  material: {
    _id: id,
    title,
    description: `${title} resource`,
    materialType: "Lecture Note",
    category: "Lecture Notes",
    tags: ["Subnetting"],
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-02T00:00:00Z"),
    ...overrides
  },
  available
});
const makeAnalytics = (overrides = {}) => ({
  courses: [{
    courseId: COURSE_ID,
    title: "Networking",
    code: "NET101",
    gradedAttempts: 4,
    topics: undefined,
    trend: { direction: "improving", comparedAttempts: 4, changePercentagePoints: 12 },
    questionTypeBreakdown: [
      { questionType: "objective", questionsGraded: 3, accuracy: 80 },
      { questionType: "fill_in_gap", questionsGraded: 2, accuracy: 60 },
      { questionType: "theory", questionsGraded: 0, accuracy: null }
    ]
  }],
  topics: [{
    courseId: COURSE_ID,
    topic: "Routing",
    classification: "Needs improvement",
    sufficiency: "sufficient",
    questionsAnswered: 4,
    questionsGraded: 4,
    correctAnswers: 1,
    accuracy: 25,
    trend: { direction: "improving", comparedAttempts: 4, changePercentagePoints: 10 }
  }],
  ...overrides
});

const withMocks = async (run, {
  analytics = makeAnalytics(),
  completed = false,
  accessibleCourseIds = [COURSE_ID]
} = {}) => {
  const User = require("../models/User");
  const Course = require("../models/course");
  const Progress = require("../models/CourseMaterialProgress");
  const membership = require("../services/courseMembershipService");
  const materials = require("../services/courseMaterialService");
  const practice = require("../services/practiceTestService");
  const studentAnalytics = require("../services/studentAnalyticsService");
  const originals = {
    userFindById: User.findById,
    courseFind: Course.find,
    progressFind: Progress.find,
    getAccessibleCourseIds: membership.getValidAccessibleCourseIds,
    listCourseMaterials: materials.listCourseMaterials,
    getCoverage: practice.getAccessibleCourseCoverage,
    getAnalytics: studentAnalytics.getStudentAnalytics
  };
  const progressQueries = [];
  const analyticsQueries = [];
  User.findById = (id) => ({
    select: async () => String(id) === STUDENT_A || String(id) === STUDENT_B
      ? student(String(id))
      : null
  });
  Course.find = () => ({
    select() { return this; },
    lean: async () => [course]
  });
  membership.getValidAccessibleCourseIds = async () => accessibleCourseIds;
  materials.listCourseMaterials = async () => [
    makeMaterial(MATERIAL_ROUTING, "Routing"),
    makeMaterial(MATERIAL_GENERAL, "Networking Handbook"),
    makeMaterial(MATERIAL_UNAVAILABLE, "Subnetting", false)
  ];
  Progress.find = (query) => {
    progressQueries.push(query);
    return {
      select() { return this; },
      lean: async () => completed
        ? [{
            student: query.student,
            course: query.course,
            material: MATERIAL_ROUTING,
            completed: true,
            completedAt: new Date("2025-02-01T00:00:00Z"),
            updatedAt: new Date("2025-02-01T00:00:00Z")
          }]
        : []
    };
  };
  practice.getAccessibleCourseCoverage = async (user, options) => {
    assert.equal(user.role, "student");
    assert.equal(options.includeEligibilityFingerprint, true);
    return [{
      courseId: COURSE_ID,
      eligibleQuestionCount: 20,
      questionTypeCounts: { objective: 10, fill_in_gap: 5, theory: 5 },
      topicQuestionCounts: { Routing: 8, Subnetting: 5 },
      availableTestLengths: [10, 20],
      practiceAttemptsEnabled: true,
      eligibilityFingerprint: "eligible-v1"
    }];
  };
  studentAnalytics.getStudentAnalytics = async (userId, _generatedAt, options) => {
    analyticsQueries.push({ userId: String(userId), options });
    return analytics;
  };

  try {
    const service = require("../services/studentLearningEvidenceService");
    await run({ service, progressQueries, analyticsQueries });
  } finally {
    User.findById = originals.userFindById;
    Course.find = originals.courseFind;
    Progress.find = originals.progressFind;
    membership.getValidAccessibleCourseIds = originals.getAccessibleCourseIds;
    materials.listCourseMaterials = originals.listCourseMaterials;
    practice.getAccessibleCourseCoverage = originals.getCoverage;
    studentAnalytics.getStudentAnalytics = originals.getAnalytics;
  }
};

test("evidence uses only verified analytics and student-scoped material progress", async () => {
  await withMocks(async ({ service, progressQueries, analyticsQueries }) => {
    const evidence = await service.buildStudentLearningEvidence(STUDENT_A);

    assert.equal(evidence.studentId, STUDENT_A);
    assert.deepEqual(analyticsQueries, [{
      userId: STUDENT_A,
      options: { accessibleCourseIds: [COURSE_ID] }
    }]);
    assert.equal(evidence.courses.length, 1);
    assert.equal(evidence.courses[0].cbt.verifiedAttemptCount, 4);
    assert.deepEqual(evidence.courses[0].cbt.topics.map(({ topic, classification }) => ({
      topic,
      classification
    })), [{ topic: "Routing", classification: "Needs improvement" }]);
    assert.deepEqual(evidence.courses[0].cbt.questionTypes.map(({ questionType, sufficiency }) => ({
      questionType,
      sufficiency
    })), [
      { questionType: "objective", sufficiency: "sufficient" },
      { questionType: "fill_in_gap", sufficiency: "insufficient" },
      { questionType: "theory", sufficiency: "insufficient" }
    ]);
    assert.deepEqual(progressQueries[0].student, STUDENT_A);
    assert.equal(progressQueries[0].course, COURSE_ID);
    assert.deepEqual(progressQueries[0].material.$in, [MATERIAL_ROUTING, MATERIAL_GENERAL]);
    assert.equal(evidence.courses[0].materials.length, 3);
    assert.equal(evidence.courses[0].materials.find((item) =>
      item.materialId === MATERIAL_ROUTING
    ).topicRelation, "exact_course_topic_title");
    assert.equal(evidence.courses[0].materials.find((item) =>
      item.materialId === MATERIAL_GENERAL
    ).topic, null);
    assert.equal(evidence.courses[0].materials.find((item) =>
      item.materialId === MATERIAL_UNAVAILABLE
    ).available, false);
  });
});

test("completed material is recorded as self-reported and is not repeatedly recommended", async () => {
  await withMocks(async ({ service }) => {
    const evidence = await service.buildStudentLearningEvidence(STUDENT_A);
    const material = evidence.courses[0].materials.find((item) =>
      item.materialId === MATERIAL_ROUTING
    );
    assert.equal(material.completionState, "completed");
    assert.equal(material.completedAt.toISOString(), "2025-02-01T00:00:00.000Z");
    const candidates = service.buildRecommendationCandidates(evidence);
    assert.equal(candidates.some((candidate) =>
      candidate.action.materialId === MATERIAL_ROUTING
    ), false);
  }, { completed: true });
});

test("insufficient topic evidence is not treated as weakness and general materials remain candidates", async () => {
  const insufficientAnalytics = makeAnalytics({
    courses: [{
      courseId: COURSE_ID,
      title: "Networking",
      code: "NET101",
      gradedAttempts: 1,
      trend: { direction: "insufficient_data", comparedAttempts: 1 },
      questionTypeBreakdown: [
        { questionType: "objective", questionsGraded: 1, accuracy: 0 }
      ]
    }],
    topics: [{
      courseId: COURSE_ID,
      topic: "Routing",
      classification: "Insufficient data",
      questionsAnswered: 1,
      questionsGraded: 1,
      accuracy: 0,
      trend: { direction: "insufficient_data", comparedAttempts: 1 }
    }]
  });
  await withMocks(async ({ service }) => {
    const evidence = await service.buildStudentLearningEvidence(STUDENT_A);
    assert.equal(evidence.courses[0].cbt.topics[0].sufficiency, "insufficient");
    assert.equal(evidence.courses[0].cbt.topics[0].classification, "Insufficient data");
    const candidates = service.buildRecommendationCandidates(evidence);
    assert.equal(candidates.some((candidate) =>
      candidate.evidence.category === "verified_topic_performance"
    ), false);
    assert.ok(candidates.some((candidate) =>
      candidate.evidence.category === "insufficient_topic_evidence" &&
      candidate.action.materialId === MATERIAL_ROUTING
    ));
  }, { analytics: insufficientAnalytics });
});

test("free-form tags and partial title matches do not create topic-material associations", () => {
  const service = require("../services/studentLearningEvidenceService");
  const topics = [{ name: "Subnetting" }];
  assert.equal(service.exactTopicTitle("Subnetting", topics), "Subnetting");
  assert.equal(service.exactTopicTitle("Subnetting Notes", topics), null);
  assert.equal(service.exactTopicTitle("Networking Handbook", topics), null);
});

test("practice candidates use only available supported test sizes and eligible questions", async () => {
  await withMocks(async ({ service }) => {
    const evidence = await service.buildStudentLearningEvidence(STUDENT_A);
    const candidates = service.buildRecommendationCandidates(evidence);
    const practiceCandidates = candidates.filter((candidate) => candidate.kind === "practice_test");
    assert.deepEqual(practiceCandidates.map((candidate) => candidate.action.questionCount), [10, 20]);
    assert.ok(practiceCandidates.every((candidate) =>
      candidate.evidence.eligibleQuestionCount >= candidate.action.questionCount
    ));

    const courseEvidence = evidence.courses[0];
    courseEvidence.practice.availableTestLengths = [5, 50];
    const invalidCandidates = service.buildRecommendationCandidates(evidence)
      .filter((candidate) => candidate.kind === "practice_test");
    assert.deepEqual(invalidCandidates, []);
  });
});

test("candidate references resolve only to listed accessible materials and practice courses", async () => {
  await withMocks(async ({ service }) => {
    const evidence = await service.buildStudentLearningEvidence(STUDENT_A);
    const candidates = service.buildRecommendationCandidates(evidence);
    const courseEvidence = evidence.courses[0];
    for (const candidate of candidates) {
      assert.equal(candidate.course.courseId, COURSE_ID);
      if (candidate.kind === "study_material") {
        const material = courseEvidence.materials.find((item) =>
          item.materialId === candidate.action.materialId
        );
        assert.ok(material);
        assert.equal(material.available, true);
        assert.equal(material.completionState, "incomplete");
      } else if (candidate.kind === "practice_test") {
        assert.ok(courseEvidence.practice.availableTestLengths.includes(candidate.action.questionCount));
      }
      assert.ok(candidate.candidateId);
      assert.ok(candidate.reason);
      assert.ok(candidate.evidence.category);
      assert.ok(["sufficient", "insufficient"].includes(candidate.evidence.sufficiency));
    }
  });
});

test("students without an accessible course receive no course candidates", async () => {
  await withMocks(async ({ service, analyticsQueries }) => {
    const evidence = await service.buildStudentLearningEvidence(STUDENT_A);
    assert.deepEqual(analyticsQueries[0].options.accessibleCourseIds, []);
    assert.deepEqual(evidence.courses, []);
    assert.deepEqual(service.buildRecommendationCandidates(evidence), []);
  }, { accessibleCourseIds: [] });
});

test("evidence fingerprints change when CBT, material progress, availability, or question coverage changes", async () => {
  await withMocks(async ({ service }) => {
    const base = await service.buildStudentLearningEvidence(STUDENT_A);
    const same = await service.buildStudentLearningEvidence(STUDENT_A);
    assert.equal(base.evidenceFingerprint, same.evidenceFingerprint);

    const changedCbt = structuredClone(base);
    changedCbt.courses[0].cbt.topics[0].accuracy = 50;
    assert.notEqual(service.buildEvidenceFingerprint(changedCbt), base.evidenceFingerprint);

    const changedAttempt = structuredClone(base);
    changedAttempt.courses[0].cbt.verifiedResults = [{
      attemptId: "attempt-2",
      scorePercentage: 50
    }];
    assert.notEqual(service.buildEvidenceFingerprint(changedAttempt), base.evidenceFingerprint);

    const changedProgress = structuredClone(base);
    changedProgress.courses[0].materials[0].completionState = "completed";
    assert.notEqual(service.buildEvidenceFingerprint(changedProgress), base.evidenceFingerprint);

    const changedAvailability = structuredClone(base);
    changedAvailability.courses[0].materials[0].available = false;
    assert.notEqual(service.buildEvidenceFingerprint(changedAvailability), base.evidenceFingerprint);

    const changedCoverage = structuredClone(base);
    changedCoverage.courses[0].practice.eligibilityFingerprint = "eligible-v2";
    assert.notEqual(service.buildEvidenceFingerprint(changedCoverage), base.evidenceFingerprint);

    const changedOwner = structuredClone(base);
    changedOwner.studentId = STUDENT_B;
    assert.notEqual(service.buildEvidenceFingerprint(changedOwner), base.evidenceFingerprint);
  });
});

test("student evidence and candidates are isolated by authenticated account", async () => {
  await withMocks(async ({ service, analyticsQueries, progressQueries }) => {
    const first = await service.getStudentLearningRecommendations(STUDENT_A);
    const second = await service.getStudentLearningRecommendations(STUDENT_B);
    assert.deepEqual(analyticsQueries.map((entry) => entry.userId), [STUDENT_A, STUDENT_B]);
    assert.deepEqual(progressQueries.map((query) => query.student), [STUDENT_A, STUDENT_B]);
    assert.equal(first.candidates[0].course.courseId, COURSE_ID);
    assert.equal(second.candidates[0].course.courseId, COURSE_ID);
    assert.equal(JSON.stringify(first).includes(STUDENT_A), false);
    assert.equal(JSON.stringify(first).includes("studentId"), false);
  });
});

test("administrators and missing users cannot load student recommendations", async () => {
  const User = require("../models/User");
  const originalFindById = User.findById;
  User.findById = (id) => ({
    select: async () => String(id) === STUDENT_A
      ? { _id: STUDENT_A, role: "admin" }
      : null
  });
  try {
    const service = require("../services/studentLearningEvidenceService");
    await assert.rejects(service.buildStudentLearningEvidence(STUDENT_A), { statusCode: 403 });
    await assert.rejects(service.buildStudentLearningEvidence(STUDENT_B), { statusCode: 404 });
  } finally {
    User.findById = originalFindById;
  }
});
