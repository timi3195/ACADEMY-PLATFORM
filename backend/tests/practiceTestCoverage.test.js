const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "phase-2-practice-coverage-test-secret";
const { generateAccessToken } = require("../utils/token");
const Question = require("../models/Question");
const QuestionMarkingVersion = require("../models/QuestionMarkingVersion");
const Course = require("../models/course");
const User = require("../models/User");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const courseMembership = require("../services/courseMembershipService");
const questionMarkingService = require("../services/questionMarkingService");
const practiceTestService = require("../services/practiceTestService");
const quizRouter = require("../routes/quizSession");

const STUDENT = "507f1f77bcf86cd799439011";
const ADMIN = "507f1f77bcf86cd799439013";
const COURSE_A = "507f1f77bcf86cd799439021";
const COURSE_B = "507f1f77bcf86cd799439022";
const DEPARTMENT_A = "507f1f77bcf86cd799439031";
const DEPARTMENT_B = "507f1f77bcf86cd799439032";
const PAPER_A = "507f1f77bcf86cd799439041";
const PAPER_B = "507f1f77bcf86cd799439042";
const QUESTION_BASE = 100;

const courseA = {
  _id: COURSE_A,
  title: "Cloud Computing",
  code: "NCC221",
  department: DEPARTMENT_A,
  level: "HND2",
  semester: "First"
};
const courseB = {
  _id: COURSE_B,
  title: "Accounting",
  code: "NAC101",
  department: DEPARTMENT_B,
  level: "HND2",
  semester: "First"
};
const student = {
  _id: STUDENT,
  id: STUDENT,
  role: "student",
  department: DEPARTMENT_A,
  coursesEnrolled: []
};
const sourcePaper = {
  _id: PAPER_A,
  title: "Cloud Computing 2024",
  course: COURSE_A,
  department: DEPARTMENT_A,
  examinationYear: "2024",
  level: "HND2",
  semester: "First",
  fileUrl: "private-paper-url",
  storageKey: "private-storage-key"
};
const secondSourcePaper = {
  ...sourcePaper,
  _id: PAPER_B,
  title: "Cloud Computing 2025",
  examinationYear: "2025",
  semester: "First",
  fileUrl: "other-private-paper-url",
  storageKey: "other-private-storage-key"
};
const metadataFor = (paper) => ({
  title: paper.title,
  examinationYear: paper.examinationYear,
  level: paper.level,
  semester: paper.semester
});

const makeQuestion = (index, overrides = {}) => ({
  _id: `507f1f77bcf86cd79943${String(QUESTION_BASE + index).padStart(4, "0")}`,
  course: COURSE_A,
  department: DEPARTMENT_A,
  topic: index % 2 ? "Networks" : "Cloud basics",
  question: `Question ${index}`,
  questionType: "objective",
  marks: 2,
  options: ["Correct", "Incorrect"],
  optionIds: [`correct-${index}`, `incorrect-${index}`],
  answer: "Correct",
  year: "2024",
  session: index % 2 ? "Rain" : "Harmattan",
  approvalStatus: "approved",
  approvedBy: ADMIN,
  approvedAt: new Date("2026-01-01T00:00:00.000Z"),
  sourcePaper: PAPER_A,
  sourcePaperMetadata: metadataFor(sourcePaper),
  sourceExamYear: "2024",
  sourceAcademicSession: "2023/2024",
  sourcePage: index,
  sourceExcerpt: `Question ${index} source excerpt`,
  questionNumber: String(index),
  ...overrides
});

const makeMarkingVersion = (question, paper, overrides = {}) => {
  const prepared = questionMarkingService.buildQuestionInput(question, paper);
  if (!prepared.input) return null;
  const questionType = prepared.input.questionType;
  const marking = questionType === "objective"
    ? {
      objective: {
        correctOptionId: question.optionIds[0],
        verificationOptionId: question.optionIds[0],
        explanation: "The first option is confirmed."
      }
    }
    : questionType === "fill_in_gap"
      ? {
        fillInGap: {
          blanks: [{
            blankNumber: 1,
            expectedAnswer: "network",
            acceptableAnswers: ["network", "a network"],
            gradingCriteria: [{ criterion: "Identifies a network", marks: Number(question.marks) }],
            semanticGuidance: "Accept equivalent descriptions."
          }],
          explanation: "The response identifies the concept.",
          totalMarks: Number(question.marks)
        }
      }
      : {
        theory: {
          referenceAnswer: "A detailed reference response.",
          criteria: [{
            criterionId: "point-1",
            description: "Explains the key concept.",
            marks: Number(question.marks),
            acceptableAlternatives: ["Equivalent explanation"]
          }],
          explanation: "Marks are allocated by the approved criteria.",
          totalMarks: Number(question.marks)
        }
      };
  return {
    _id: `${question._id.slice(0, 20)}${String(9000 + Number(question._id.slice(-4))).padStart(4, "0")}`,
    question: question._id,
    course: question.course,
    department: question.department,
    questionYear: String(question.year || ""),
    questionSession: question.session || "Rain",
    sourceExamYear: String(question.sourceExamYear || ""),
    sourceAcademicSession: String(question.sourceAcademicSession || ""),
    questionOrigin: question.questionOrigin || "verified_past_paper",
    version: 1,
    questionType,
    contentHash: questionMarkingService.buildContentHash(question, prepared.input),
    status: "ready",
    marking,
    sourcePaper: paper?._id || null,
    sourcePaperMetadata: paper ? metadataFor(paper) : undefined,
    sourcePage: question.sourcePage ?? null,
    sourceExcerpt: String(question.sourceExcerpt || "").slice(0, 1000),
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides
  };
};

const makeAdminMarkingVersion = (question, paper) => {
  const prepared = questionMarkingService.buildQuestionInput(question, paper);
  if (!prepared.input) return null;
  const administratorMarking = questionMarkingService.buildAdminMarking(question);
  if (administratorMarking.error) return null;
  const aiVersion = makeMarkingVersion(question, paper);
  if (!aiVersion) return null;
  return {
    ...aiVersion,
    contentHash: questionMarkingService.buildAdminContentHash(
      question,
      prepared.input,
      administratorMarking.marking
    ),
    marking: administratorMarking.marking,
    markingSource: "admin_authored",
    provider: "administrator"
  };
};

const makeOriginalQuestion = (index, overrides = {}) => makeQuestion(index, {
  questionOrigin: "original_practice",
  sourcePaper: null,
  sourcePaperMetadata: undefined,
  sourceExamYear: "",
  sourceAcademicSession: "",
  sourcePage: null,
  sourceExcerpt: "",
  extractionKey: undefined,
  extractionBatchId: "",
  extractionDraftId: "",
  ...overrides
});

const defaultMarkingVersions = (questions, papers) => questions
  .map((question) => {
    const paper = papers.find((item) => String(item._id) === String(question.sourcePaper));
    return question.questionOrigin === "original_practice"
      ? makeMarkingVersion(question, null)
      : paper && makeMarkingVersion(question, paper);
  })
  .filter(Boolean);

const buildApp = (userId = STUDENT) => {
  const app = express();
  app.use(express.json());
  if (userId) {
    const token = generateAccessToken(userId, { role: "student" });
    app.use((req, res, next) => {
      req.headers.authorization = `Bearer ${token}`;
      next();
    });
  }
  app.use("/api/quiz", quizRouter);
  return app;
};

const withMocks = async (run, {
  questions = [],
  markingVersions = null,
  courses = [courseA],
  papers = [sourcePaper],
  user = student,
  accessibleCourseIds = [COURSE_A]
} = {}) => {
  const originals = {
    questionFind: Question.find,
    markingVersionFind: QuestionMarkingVersion.find,
    courseFind: Course.find,
    courseFindById: Course.findById,
    userFindById: User.findById,
    paperFind: PastQuestionPaper.find,
    accessibleCourseIds: courseMembership.getValidAccessibleCourseIds
  };
  const state = {
    questionFilter: null,
    markingFilter: null,
    courseFilter: null,
    paperFilter: null,
    questionFindCount: 0,
    markingFindCount: 0,
    paperFindCount: 0,
    userLookups: 0
  };

  Question.find = async (filter) => {
    state.questionFilter = filter;
    state.questionFindCount += 1;
    const courseMatches = (question) => Array.isArray(filter.$or)
      ? filter.$or.some((pair) =>
        String(pair.course) === String(question.course) &&
        String(pair.department) === String(question.department))
      : String(question.course) === String(filter.course) &&
        String(question.department) === String(filter.department);
    return questions.filter((question) =>
      courseMatches(question) &&
      question.approvalStatus === filter.approvalStatus &&
      question.approvedBy &&
      question.approvedAt instanceof Date
    );
  };
  QuestionMarkingVersion.find = async (filter) => {
    state.markingFilter = filter;
    state.markingFindCount += 1;
    const questionIds = filter.question?.$in || [];
    const hashes = filter.contentHash?.$in || [];
    const versions = markingVersions || defaultMarkingVersions(questions, papers);
    return versions.filter((version) =>
      questionIds.some((id) => String(id) === String(version.question)) &&
      hashes.includes(version.contentHash)
    );
  };
  Course.find = async (filter) => {
    state.courseFilter = filter;
    const allowedIds = filter?._id?.$in;
    return courses.filter((course) =>
      !allowedIds || allowedIds.some((id) => String(id) === String(course._id))
    );
  };
  Course.findById = async (id) =>
    courses.find((course) => String(course._id) === String(id)) || null;
  PastQuestionPaper.find = async (filter) => {
    state.paperFilter = filter;
    state.paperFindCount += 1;
    const allowedIds = filter._id?.$in || [];
    return papers.filter((paper) =>
      allowedIds.some((id) => String(id) === String(paper._id))
    );
  };
  User.findById = async () => {
    state.userLookups += 1;
    return user;
  };
  courseMembership.getValidAccessibleCourseIds = async () => accessibleCourseIds;

  try {
    await run(state);
  } finally {
    Question.find = originals.questionFind;
    QuestionMarkingVersion.find = originals.markingVersionFind;
    Course.find = originals.courseFind;
    Course.findById = originals.courseFindById;
    User.findById = originals.userFindById;
    PastQuestionPaper.find = originals.paperFind;
    courseMembership.getValidAccessibleCourseIds = originals.accessibleCourseIds;
  }
};

test("the course pool requires reviewer approval, matching course, valid format, source, and current marking", async () => {
  const eligible = makeQuestion(1);
  const legacyWithoutSource = makeQuestion(2, {
    sourcePaper: undefined,
    sourcePaperMetadata: undefined
  });
  const candidates = [
    eligible,
    legacyWithoutSource,
    makeQuestion(3, { approvalStatus: "draft" }),
    makeQuestion(4, { approvedBy: null }),
    makeQuestion(5, { approvedAt: null }),
    makeQuestion(6, { options: ["", "Incorrect"] }),
    makeQuestion(7, { options: ["Same", "Same"], optionIds: ["same-a", "same-b"] }),
    makeQuestion(8, { course: COURSE_B }),
    makeQuestion(9, { department: DEPARTMENT_B }),
    makeQuestion(10, { questionType: "unknown" })
  ];

  await withMocks(async (state) => {
    const pool = await practiceTestService.getEligibleQuestionsForCourse(courseA);
    assert.deepEqual(pool.map((question) => question._id), [eligible._id]);
    assert.equal(practiceTestService.isEligibleQuestion(candidates[7], courseA), false);
    assert.equal(String(state.questionFilter.course), COURSE_A);
    assert.equal(String(state.questionFilter.department), DEPARTMENT_A);
    assert.equal(state.questionFilter.approvalStatus, "approved");
    assert.equal(Object.prototype.hasOwnProperty.call(pool[0], "answer"), false);
  }, { questions: candidates });
});

test("approved original practice requires explicit origin, source-free provenance, and ready marking", async () => {
  const readyOriginal = makeOriginalQuestion(1);
  const unapprovedOriginal = makeOriginalQuestion(2, {
    approvalStatus: "draft",
    approvedBy: null,
    approvedAt: null
  });
  const unmarkedOriginal = makeOriginalQuestion(3);
  const sourceLessVerified = makeQuestion(4, {
    sourcePaper: null,
    sourcePaperMetadata: undefined,
    sourceExamYear: "",
    sourceAcademicSession: "",
    sourcePage: null,
    sourceExcerpt: ""
  });
  const readyVersion = makeMarkingVersion(readyOriginal, null);

  await withMocks(async () => {
    const pool = await practiceTestService.getEligibleQuestionsForCourse(courseA);
    assert.deepEqual(pool.map((question) => question._id), [readyOriginal._id]);
    assert.equal(
      practiceTestService.isEligibleQuestion(unapprovedOriginal, courseA, null, readyVersion),
      false
    );
    assert.equal(
      practiceTestService.isEligibleQuestion(unmarkedOriginal, courseA, null, null),
      false
    );
  }, {
    questions: [readyOriginal, unapprovedOriginal, unmarkedOriginal, sourceLessVerified],
    markingVersions: [readyVersion]
  });
});

test("original and verified questions combine for CBT thresholds and report origin-specific formats", async () => {
  const verified = Array.from({ length: 5 }, (_, index) =>
    makeQuestion(index + 1, { year: sourcePaper.examinationYear })
  );
  const original = Array.from({ length: 5 }, (_, index) =>
    makeOriginalQuestion(index + 6, {
      questionType: index === 4 ? "theory" : "objective",
      options: index === 4 ? [] : ["Correct", "Incorrect"],
      optionIds: index === 4 ? [] : [`correct-${index + 6}`, `incorrect-${index + 6}`]
    })
  );
  const markingVersions = [
    ...verified.map((question) => makeMarkingVersion(question, sourcePaper)),
    ...original.map((question) => makeMarkingVersion(question, null))
  ];

  await withMocks(async () => {
    const coverage = await practiceTestService.buildCourseCoverage(courseA);
    const assembled = await practiceTestService.assemblePracticeTest(courseA, 10);
    assert.equal(coverage.eligibleQuestionCount, 10);
    assert.equal(coverage.verifiedSourceQuestionCount, 5);
    assert.equal(coverage.originalPracticeQuestionCount, 5);
    assert.deepEqual(coverage.questionOriginCounts, {
      verified_past_paper: 5,
      original_practice: 5
    });
    assert.deepEqual(coverage.verifiedSourceQuestionTypeCounts, {
      objective: 5,
      fill_in_gap: 0,
      theory: 0
    });
    assert.deepEqual(coverage.originalPracticeQuestionTypeCounts, {
      objective: 4,
      fill_in_gap: 0,
      theory: 1
    });
    assert.deepEqual(coverage.availableTestLengths, [10]);
    assert.equal(assembled.ok, true);
    assert.equal(assembled.questions.length, 10);
  }, { questions: [...verified, ...original], markingVersions });
});

test("coverage counts each eligible format and distinct verified source papers", async () => {
  const questions = Array.from({ length: 25 }, (_, index) => {
    const paper = index < 15 ? sourcePaper : secondSourcePaper;
    const type = index < 10 ? "objective" : index < 20 ? "fill_in_gap" : "theory";
    const typeFields = type === "objective"
      ? {}
      : type === "fill_in_gap"
        ? { questionType: type, options: [], optionIds: [], blankCount: 1 }
        : { questionType: type, options: [], optionIds: [] };
    return makeQuestion(index + 1, {
      ...typeFields,
      year: paper.examinationYear,
      sourcePaper: paper._id,
      sourcePaperMetadata: metadataFor(paper),
      sourceExamYear: paper.examinationYear
    });
  });
  const papers = [sourcePaper, secondSourcePaper];

  await withMocks(async (state) => {
    const coverage = await practiceTestService.buildCourseCoverage(courseA);
    assert.equal(coverage.courseName, "Cloud Computing");
    assert.equal(coverage.courseCode, "NCC221");
    assert.equal(coverage.eligibleQuestionCount, 25);
    assert.equal(coverage.objectiveQuestionCount, 10);
    assert.equal(coverage.fillInGapQuestionCount, 10);
    assert.equal(coverage.theoryQuestionCount, 5);
    assert.deepEqual(coverage.questionTypeCounts, { objective: 10, fill_in_gap: 10, theory: 5 });
    assert.equal(Object.prototype.hasOwnProperty.call(coverage, "topicQuestionCounts"), false);
    assert.equal(coverage.distinctSourcePaperCount, 2);
    assert.equal(coverage.verifiedSourceQuestionCount, 25);
    assert.deepEqual(coverage.availableTestLengths, [10, 20]);
    assert.equal(coverage.enoughForPracticeTest, true);
    assert.equal(coverage.practiceAttemptsEnabled, true);
    assert.equal(coverage.availabilityMessage, null);
    assert.deepEqual(coverage.academicYears, ["2025", "2024"]);
    assert.deepEqual(coverage.academicSessions, ["2023/2024"]);
    assert.deepEqual(coverage.examSessions, ["Harmattan", "Rain"]);
    assert.deepEqual(coverage.pastPaperSemesters, ["First"]);
    assert.deepEqual(coverage.topicCategories, ["Cloud basics", "Networks"]);
    assert.equal(state.paperFilter._id.$in.length, 2);
  }, { questions, papers });
});

test("recommendation coverage includes eligible topic counts and a question eligibility fingerprint", async () => {
  const questions = Array.from({ length: 10 }, (_, index) =>
    makeQuestion(index + 1, { topic: index < 6 ? "Networks" : "Cloud basics" })
  );
  await withMocks(async () => {
    const coverage = await practiceTestService.buildCourseCoverage(courseA, undefined, {
      includeEligibilityFingerprint: true,
      includeTopicQuestionCounts: true
    });
    assert.deepEqual(coverage.topicQuestionCounts, { "Cloud basics": 4, Networks: 6 });
    assert.match(coverage.eligibilityFingerprint, /^[a-f0-9]{64}$/);
  }, { questions });
});

test("coverage reports exact eligible counts when fewer than ten questions qualify", async () => {
  await withMocks(async () => {
    const coverage = await practiceTestService.buildCourseCoverage(courseA);
    assert.equal(coverage.eligibleQuestionCount, 9);
    assert.equal(coverage.enoughForPracticeTest, false);
    assert.deepEqual(coverage.availableTestLengths, []);
    assert.match(coverage.insufficientQuestionsMessage, /Only 9 eligible approved questions/);
  }, { questions: Array.from({ length: 9 }, (_, index) => makeQuestion(index + 1)) });
});

test("unusable, uncertain, stale, or mismatched marking versions are excluded", async () => {
  const currentQuestion = makeQuestion(1);
  const prepared = questionMarkingService.buildQuestionInput(currentQuestion, sourcePaper);
  const currentVersion = makeMarkingVersion(currentQuestion, sourcePaper);
  const invalidVersion = makeMarkingVersion(makeQuestion(2), sourcePaper, { status: "invalid" });
  const uncertainQuestion = makeQuestion(3);
  const uncertainVersion = makeMarkingVersion(uncertainQuestion, sourcePaper, { status: "uncertain" });
  const wrongHashQuestion = makeQuestion(4);
  const wrongHashVersion = makeMarkingVersion(wrongHashQuestion, sourcePaper, {
    contentHash: "not-current-content"
  });
  const malformedQuestion = makeQuestion(5);
  const malformedVersion = makeMarkingVersion(malformedQuestion, sourcePaper, {
    marking: { objective: { correctOptionId: "wrong", verificationOptionId: "wrong", explanation: "x" } }
  });
  const mismatchQuestion = makeQuestion(6);
  const mismatchVersion = makeMarkingVersion(mismatchQuestion, sourcePaper, {
    course: COURSE_B
  });
  const latestStatusQuestion = makeQuestion(7);
  const olderReady = makeMarkingVersion(latestStatusQuestion, sourcePaper);
  const newerUncertain = makeMarkingVersion(latestStatusQuestion, sourcePaper, {
    version: 2,
    status: "uncertain",
    createdAt: new Date("2026-01-03T00:00:00.000Z")
  });

  assert.ok(prepared.input);
  await withMocks(async () => {
    const pool = await practiceTestService.getEligibleQuestionsForCourse(courseA);
    assert.deepEqual(pool.map((question) => question._id), [currentQuestion._id]);
  }, {
    questions: [
      currentQuestion,
      makeQuestion(2),
      uncertainQuestion,
      wrongHashQuestion,
      malformedQuestion,
      mismatchQuestion,
      latestStatusQuestion
    ],
    markingVersions: [
      currentVersion,
      invalidVersion,
      uncertainVersion,
      wrongHashVersion,
      malformedVersion,
      mismatchVersion,
      olderReady,
      newerUncertain
    ]
  });
});

test("legacy untyped objective questions need source provenance and a current objective marking", async () => {
  const legacyTypedByShape = makeQuestion(1, { questionType: undefined });
  const legacyWithoutProvenance = makeQuestion(2, {
    questionType: undefined,
    sourcePaper: undefined,
    sourcePaperMetadata: undefined
  });
  await withMocks(async () => {
    const pool = await practiceTestService.getEligibleQuestionsForCourse(courseA);
    assert.deepEqual(pool.map((question) => question._id), [legacyTypedByShape._id]);
  }, { questions: [legacyTypedByShape, legacyWithoutProvenance] });
});

test("source paper, course, and department provenance must match exactly", async () => {
  const valid = makeQuestion(1);
  const missingPaper = makeQuestion(2, { sourcePaper: "507f1f77bcf86cd799439099" });
  const wrongDepartmentPaper = {
    ...sourcePaper,
    _id: "507f1f77bcf86cd799439098",
    department: DEPARTMENT_B
  };
  const wrongCoursePaper = {
    ...sourcePaper,
    _id: "507f1f77bcf86cd799439097",
    course: COURSE_B
  };
  const wrongDepartmentQuestion = makeQuestion(5, {
    sourcePaper: wrongDepartmentPaper._id,
    sourcePaperMetadata: metadataFor(wrongDepartmentPaper)
  });
  const wrongCourseQuestion = makeQuestion(6, {
    sourcePaper: wrongCoursePaper._id,
    sourcePaperMetadata: metadataFor(wrongCoursePaper)
  });
  const mismatchMetadata = makeQuestion(3, {
    sourcePaperMetadata: { ...metadataFor(sourcePaper), title: "Different paper" }
  });
  const wrongSourceYear = makeQuestion(4, { sourceExamYear: "2021" });
  await withMocks(async () => {
    const pool = await practiceTestService.getEligibleQuestionsForCourse(courseA);
    assert.deepEqual(pool.map((question) => question._id), [valid._id]);
  }, {
    questions: [
      valid,
      missingPaper,
      wrongDepartmentQuestion,
      wrongCourseQuestion,
      mismatchMetadata,
      wrongSourceYear
    ],
    papers: [sourcePaper, wrongDepartmentPaper, wrongCoursePaper]
  });
});

test("coverage is batched across accessible courses and excludes cross-department questions", async () => {
  const courseC = {
    _id: "507f1f77bcf86cd799439023",
    title: "Computer Networks",
    code: "NCC222",
    department: DEPARTMENT_A,
    level: "HND2",
    semester: "First"
  };
  const paperForCourseC = {
    ...sourcePaper,
    _id: "507f1f77bcf86cd799439050",
    title: "Computer Networks 2025",
    course: courseC._id,
    examinationYear: "2025"
  };
  const otherCourse = makeQuestion(1, {
    course: COURSE_B,
    department: DEPARTMENT_B,
    sourcePaper: "507f1f77bcf86cd799439051",
    sourcePaperMetadata: metadataFor(sourcePaper)
  });
  const paperForOtherCourse = {
    ...sourcePaper,
    _id: "507f1f77bcf86cd799439051",
    course: COURSE_B,
    department: DEPARTMENT_B
  };
  const questionForCourseC = makeQuestion(3, {
    course: courseC._id,
    year: paperForCourseC.examinationYear,
    sourcePaper: paperForCourseC._id,
    sourcePaperMetadata: metadataFor(paperForCourseC),
    sourceExamYear: paperForCourseC.examinationYear
  });

  await withMocks(async (state) => {
    const coverage = await practiceTestService.getAccessibleCourseCoverage({
      ...student,
      department: DEPARTMENT_A
    });
    assert.deepEqual(coverage.map((item) => item.courseId), [COURSE_A, courseC._id]);
    assert.deepEqual(coverage.map((item) => item.eligibleQuestionCount), [1, 1]);
    assert.equal(state.questionFindCount, 1);
    assert.equal(state.paperFindCount, 1);
    assert.equal(state.markingFindCount, 1);
  }, {
    questions: [makeQuestion(2), questionForCourseC, otherCourse],
    courses: [courseA, courseC, courseB],
    papers: [sourcePaper, paperForCourseC, paperForOtherCourse],
    accessibleCourseIds: [COURSE_A, courseC._id]
  });
});

test("coverage API requires authentication and exposes no answers, marking data, or source URLs", async () => {
  const validQuestion = makeQuestion(1, { answer: "Sensitive answer" });

  await withMocks(async (state) => {
    const unauthorized = await request(buildApp(null)).get("/api/quiz/coverage");
    assert.equal(unauthorized.status, 401);

    const response = await request(buildApp()).get("/api/quiz/coverage");
    assert.equal(response.status, 200);
    assert.equal(state.userLookups, 1);
    assert.deepEqual(response.body.courses.map((course) => course.courseId), [COURSE_A]);
    const serialized = JSON.stringify(response.body);
    for (const hiddenValue of [
      "answer",
      "Sensitive answer",
      "correctOptionId",
      "referenceAnswer",
      "acceptableAnswers",
      "gradingCriteria",
      "promptVersion",
      "private-paper-url",
      "private-storage-key",
      "approvedBy",
      "fileUrl",
      "storageKey",
      "lecturers"
    ]) {
      assert.equal(serialized.includes(hiddenValue), false);
    }
    assert.deepEqual(response.body.supportedQuestionCounts, [10, 20, 30, 40, 50]);
    assert.equal(response.body.courses[0].objectiveQuestionCount, 1);
  }, { questions: [validQuestion] });
});

test("selection uses the exact coverage eligibility pool and never duplicates or pads", async () => {
  const questions = Array.from({ length: 12 }, (_, index) => makeQuestion(index + 1));
  const duplicatedRecords = [...questions, questions[0]];
  await withMocks(async () => {
    const coverage = await practiceTestService.buildCourseCoverage(courseA);
    const eligiblePool = await practiceTestService.getEligibleQuestionsForCourse(courseA);
    const assembled = await practiceTestService.assemblePracticeTest(courseA, 10);
    const short = await practiceTestService.assemblePracticeTest(courseA, 20);
    const unsupported = await practiceTestService.assemblePracticeTest(courseA, 11);

    assert.equal(coverage.eligibleQuestionCount, eligiblePool.length);
    assert.equal(assembled.eligibleQuestionCount, coverage.eligibleQuestionCount);
    assert.equal(assembled.ok, true);
    assert.equal(assembled.questions.length, 10);
    assert.equal(new Set(assembled.questions.map((question) => question._id)).size, 10);
    assert.ok(assembled.questions.every((question) =>
      eligiblePool.some((eligible) => eligible._id === question._id)
    ));
    assert.equal(short.ok, false);
    assert.equal(short.questions.length, 0);
    const deduplicatedSelection = practiceTestService.selectUniqueQuestions(duplicatedRecords, 13);
    assert.equal(deduplicatedSelection.length, 12);
    assert.equal(new Set(deduplicatedSelection.map((question) => question._id)).size, 12);
    assert.equal(unsupported.code, "unsupported_question_count");
  }, { questions: duplicatedRecords });
});

test("non-AI CBT selects only complete administrator-marked questions and never reuses AI versions", async () => {
  const previousMode = process.env.CBT_NON_AI_MODE;
  process.env.CBT_NON_AI_MODE = "true";
  const questions = Array.from({ length: 10 }, (_, index) =>
    makeQuestion(index + 1, { year: sourcePaper.examinationYear })
  );
  const invalidAnswer = makeQuestion(11, {
    answer: "Not one of the stored options.",
    year: sourcePaper.examinationYear
  });
  const fill = makeQuestion(12, {
    questionType: "fill_in_gap",
    options: [],
    optionIds: [],
    blankCount: 1,
    adminMarking: {
      acceptedAnswersByBlank: [{
        blankNumber: 1,
        acceptedAnswers: ["network", "a network"],
        marks: 2
      }]
    },
    answer: "",
    year: sourcePaper.examinationYear
  });
  const theory = makeQuestion(13, {
    questionType: "theory",
    options: [],
    optionIds: [],
    adminMarking: {
      theoryRubric: [{
        criterionId: "criterion-1",
        description: "Explains the key concept.",
        marks: 2,
        acceptableAlternatives: ["An equivalent explanation."]
      }]
    },
    answer: "",
    year: sourcePaper.examinationYear
  });
  const aiOnly = makeQuestion(14, { year: sourcePaper.examinationYear });
  const failedAiVersion = makeMarkingVersion(aiOnly, sourcePaper, {
    status: "failed",
    markingSource: "ai_generated",
    provider: "gemini"
  });
  const candidates = [...questions, invalidAnswer, fill, theory, aiOnly];
  const adminVersions = [
    ...questions.map((question) => makeAdminMarkingVersion(question, sourcePaper)),
    makeMarkingVersion(invalidAnswer, sourcePaper),
    makeAdminMarkingVersion(fill, sourcePaper),
    makeAdminMarkingVersion(theory, sourcePaper),
    failedAiVersion
  ].filter(Boolean);

  try {
    await withMocks(async () => {
      const coverage = await practiceTestService.buildCourseCoverage(courseA);
      const selected = await practiceTestService.assemblePracticeTest(courseA, 10);
      assert.equal(coverage.eligibleQuestionCount, 12);
      assert.equal(coverage.objectiveQuestionCount, 10);
      assert.equal(coverage.fillInGapQuestionCount, 1);
      assert.equal(coverage.theoryQuestionCount, 1);
      assert.equal(selected.ok, true);
      assert.equal(selected.questions.length, 10);
      assert.equal(selected.questions.some((question) => question._id === invalidAnswer._id), false);
      assert.equal(selected.questions.some((question) => question._id === aiOnly._id), false);
    }, { questions: candidates, markingVersions: adminVersions });
  } finally {
    if (previousMode === undefined) delete process.env.CBT_NON_AI_MODE;
    else process.env.CBT_NON_AI_MODE = previousMode;
  }
});
