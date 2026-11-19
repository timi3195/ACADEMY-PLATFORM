const mongoose = require("mongoose");
const crypto = require("node:crypto");
const Question = require("../models/Question");
const QuestionMarkingVersion = require("../models/QuestionMarkingVersion");
const Course = require("../models/course");
const PastQuestionPaper = require("../models/PastQuestionPaper");
const courseMembership = require("./courseMembershipService");
const questionMarkingService = require("./questionMarkingService");
const { stableOptionIds } = require("./questionAccessService");
const shuffle = require("../utils/shuffle");

const PRACTICE_TEST_LENGTHS = Object.freeze([10, 20, 30, 40, 50]);
const PRACTICE_ATTEMPTS_ENABLED = true;
const QUESTION_FIELDS = [
  "_id",
  "course",
  "department",
  "topic",
  "question",
  "questionType",
  "blankCount",
  "options",
  "optionIds",
  "marks",
  "year",
  "session",
  "approvalStatus",
  "approvedBy",
  "approvedAt",
  "sourcePaper",
  "sourcePaperMetadata",
  "sourceExamYear",
  "sourceAcademicSession",
  "sourcePage",
  "sourceExcerpt",
  "questionNumber"
].join(" ");

const idOf = (value) => String(value?._id || value || "");
const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
const isObjectId = (value) => /^[a-f\d]{24}$/i.test(idOf(value));
const text = (value) => typeof value === "string" ? value.trim() : "";
const sameText = (left, right) => String(left == null ? "" : left) === String(right == null ? "" : right);
const closeEnough = (left, right) => Math.abs(Number(left) - Number(right)) <= 0.01;

const findRecords = async (Model, filter, fields) => {
  let query = Model.find(filter);
  if (typeof query.select === "function") query = query.select(fields);
  if (typeof query.lean === "function") query = query.lean();
  return query;
};

const hasReviewerApproval = (question) =>
  isObjectId(question.approvedBy) &&
  question.approvedAt instanceof Date &&
  Number.isFinite(question.approvedAt.getTime());

const questionTypeOf = (question) => question.questionType ||
  (Array.isArray(question.options) && question.options.length >= 2 ? "objective" : "");

const hasValidQuestionContent = (question) => {
  if (!question || !isObjectId(question._id) ||
      typeof question.question !== "string" ||
      !text(question.question) ||
      text(question.question).length > 5000 ||
      !Number.isFinite(Number(question.marks)) ||
      Number(question.marks) <= 0 ||
      Number(question.marks) > 100) return false;

  const type = questionTypeOf(question);
  if (type === "objective") {
    const options = question.options;
    if (!Array.isArray(options) || options.length < 2 || options.length > 8 ||
        options.some((option) => typeof option !== "string" || !text(option) || option.trim().length > 1000)) {
      return false;
    }
    const optionIds = stableOptionIds(question);
    return optionIds.length === options.length &&
      new Set(optionIds).size === optionIds.length &&
      new Set(options.map((option) => text(option).toLowerCase())).size === options.length;
  }
  if (type === "fill_in_gap") {
    return Number.isInteger(question.blankCount) && question.blankCount >= 1 && question.blankCount <= 20;
  }
  return type === "theory";
};

const isEligibleQuestion = (question, course, paper, markingVersion) => {
  if (!question || !course ||
      idOf(question.course) !== idOf(course._id) ||
      idOf(question.department) !== idOf(course.department) ||
      question.approvalStatus !== "approved" ||
      !hasReviewerApproval(question) ||
      !hasValidQuestionContent(question) ||
      !paper ||
      !isObjectId(question.sourcePaper) ||
      idOf(question.sourcePaper) !== idOf(paper._id) ||
      idOf(paper.course) !== idOf(course._id) ||
      idOf(paper.department) !== idOf(course.department)) return false;

  const prepared = questionMarkingService.buildQuestionInput(question, paper);
  if (!prepared.input) return false;
  const expectedHash = questionMarkingService.buildContentHash(question, prepared.input);
  return isUsableMarkingVersion(markingVersion, question, paper, expectedHash);
};

const metadataMatchesPaper = (metadata, paper) =>
  isRecord(metadata) &&
  metadata.title === paper.title &&
  sameText(metadata.examinationYear, paper.examinationYear) &&
  metadata.level === paper.level &&
  metadata.semester === paper.semester;

const sourceMetadataMatches = (question, paper) => {
  if (question.sourcePaperMetadata &&
      !metadataMatchesPaper(question.sourcePaperMetadata, paper)) return false;
  return !text(question.sourceExamYear) ||
    sameText(question.sourceExamYear, paper.examinationYear);
};

const isObjectiveMarkingUsable = (question, marking) => {
  const objective = marking?.objective;
  if (!isRecord(objective) ||
      !text(objective.explanation) ||
      objective.explanation.length > 2000) return false;
  const optionIds = stableOptionIds(question);
  return optionIds.includes(objective.correctOptionId) &&
    objective.verificationOptionId === objective.correctOptionId;
};

const isFillInGapMarkingUsable = (question, marking) => {
  const fillInGap = marking?.fillInGap;
  const totalMarks = Number(question.marks);
  if (!isRecord(fillInGap) ||
      !Array.isArray(fillInGap.blanks) ||
      fillInGap.blanks.length !== question.blankCount ||
      !Number.isFinite(fillInGap.totalMarks) ||
      !closeEnough(fillInGap.totalMarks, totalMarks) ||
      !text(fillInGap.explanation) ||
      fillInGap.explanation.length > 2000) return false;

  const blankNumbers = new Set();
  let totalAllocated = 0;
  for (const blank of fillInGap.blanks) {
    if (!isRecord(blank) ||
        !Number.isInteger(blank.blankNumber) ||
        blank.blankNumber < 1 ||
        blank.blankNumber > question.blankCount ||
        blankNumbers.has(blank.blankNumber) ||
        !text(blank.expectedAnswer) ||
        !Array.isArray(blank.acceptableAnswers) ||
        blank.acceptableAnswers.length > 20 ||
        blank.acceptableAnswers.some((answer) => !text(answer) || answer.length > 300) ||
        !blank.acceptableAnswers.some((answer) =>
          text(answer).toLowerCase() === text(blank.expectedAnswer).toLowerCase()) ||
        !Array.isArray(blank.gradingCriteria) ||
        blank.gradingCriteria.length < 1 ||
        !text(blank.semanticGuidance)) return false;
    let blankAllocated = 0;
    for (const criterion of blank.gradingCriteria) {
      if (!isRecord(criterion) ||
          !text(criterion.criterion) ||
          !Number.isFinite(criterion.marks) ||
          criterion.marks < 0 ||
          criterion.marks > totalMarks) return false;
      blankAllocated += criterion.marks;
    }
    if (blankAllocated <= 0) return false;
    blankNumbers.add(blank.blankNumber);
    totalAllocated += blankAllocated;
  }
  return blankNumbers.size === question.blankCount && closeEnough(totalAllocated, totalMarks);
};

const isTheoryMarkingUsable = (question, marking) => {
  const theory = marking?.theory;
  const totalMarks = Number(question.marks);
  if (!isRecord(theory) ||
      !text(theory.referenceAnswer) ||
      theory.referenceAnswer.length > 5000 ||
      !text(theory.explanation) ||
      theory.explanation.length > 2000 ||
      !Array.isArray(theory.criteria) ||
      theory.criteria.length < 1 ||
      theory.criteria.length > 20 ||
      !Number.isFinite(theory.totalMarks) ||
      !closeEnough(theory.totalMarks, totalMarks)) return false;
  const ids = new Set();
  let totalAllocated = 0;
  for (const criterion of theory.criteria) {
    if (!isRecord(criterion) ||
        !text(criterion.criterionId) ||
        ids.has(criterion.criterionId) ||
        !text(criterion.description) ||
        !Number.isFinite(criterion.marks) ||
        criterion.marks <= 0 ||
        criterion.marks > totalMarks ||
        !Array.isArray(criterion.acceptableAlternatives) ||
        criterion.acceptableAlternatives.length > 20 ||
        criterion.acceptableAlternatives.some((answer) => !text(answer) || answer.length > 500)) return false;
    ids.add(criterion.criterionId);
    totalAllocated += criterion.marks;
  }
  return closeEnough(totalAllocated, totalMarks);
};

const isUsableMarkingVersion = (version, question, paper, expectedHash) => {
  if (!version ||
      version.status !== "ready" ||
      !Number.isInteger(version.version) ||
      version.version < 1 ||
      version.contentHash !== expectedHash ||
      idOf(version.question) !== idOf(question._id) ||
      idOf(version.course) !== idOf(question.course) ||
      idOf(version.department) !== idOf(question.department) ||
      version.questionType !== questionTypeOf(question) ||
      !sameText(version.questionYear, question.year) ||
      !sameText(version.questionSession, question.session || "Rain") ||
      !sameText(version.sourceExamYear, question.sourceExamYear || "") ||
      !sameText(version.sourceAcademicSession, question.sourceAcademicSession || "") ||
      idOf(version.sourcePaper) !== idOf(paper._id) ||
      !metadataMatchesPaper(version.sourcePaperMetadata, paper) ||
      (version.sourcePage || null) !== (question.sourcePage || null) ||
      (version.sourceExcerpt || "") !== text(question.sourceExcerpt).slice(0, 1000)) return false;

  const type = questionTypeOf(question);
  if (type === "objective") return isObjectiveMarkingUsable(question, version.marking);
  if (type === "fill_in_gap") return isFillInGapMarkingUsable(question, version.marking);
  return type === "theory" && isTheoryMarkingUsable(question, version.marking);
};

const buildQuestionFilter = (courses) => {
  const approval = {
    approvalStatus: "approved",
    approvedBy: { $exists: true, $ne: null },
    approvedAt: { $type: "date" }
  };
  if (courses.length === 1) {
    return {
      ...approval,
      course: new mongoose.Types.ObjectId(idOf(courses[0]._id)),
      department: new mongoose.Types.ObjectId(idOf(courses[0].department))
    };
  }
  return {
    ...approval,
    $or: courses.map((course) => ({
      course: new mongoose.Types.ObjectId(idOf(course._id)),
      department: new mongoose.Types.ObjectId(idOf(course.department))
    }))
  };
};

const getEligibleEntriesForCourses = async (courses) => {
  const validCourses = (courses || []).filter((course) =>
    course && isObjectId(course._id) && isObjectId(course.department)
  );
  if (!validCourses.length) return new Map();

  const questionRecords = await findRecords(
    Question,
    buildQuestionFilter(validCourses),
    QUESTION_FIELDS
  );
  const coursesById = new Map(validCourses.map((course) => [idOf(course._id), course]));
  const uniqueQuestions = new Map();
  for (const question of questionRecords || []) {
    const course = coursesById.get(idOf(question.course));
    if (!course ||
        idOf(question.department) !== idOf(course.department) ||
        question.approvalStatus !== "approved" ||
        !hasReviewerApproval(question) ||
        !hasValidQuestionContent(question) ||
        !isObjectId(question.sourcePaper)) continue;
    const key = idOf(question._id);
    if (!uniqueQuestions.has(key)) uniqueQuestions.set(key, { question, course });
  }

  const candidateEntries = [...uniqueQuestions.values()];
  const sourceIds = [...new Set(candidateEntries.map(({ question }) => idOf(question.sourcePaper)))];
  const sourcePapers = sourceIds.length
    ? await findRecords(
      PastQuestionPaper,
      { _id: { $in: sourceIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      "_id course department title examinationYear level semester"
    )
    : [];
  const papersById = new Map((sourcePapers || []).map((paper) => [idOf(paper._id), paper]));
  const preparedEntries = [];
  for (const entry of candidateEntries) {
    const paper = papersById.get(idOf(entry.question.sourcePaper));
    if (!paper ||
        idOf(paper.course) !== idOf(entry.course._id) ||
        idOf(paper.department) !== idOf(entry.course.department) ||
        !sourceMetadataMatches(entry.question, paper)) continue;
    const prepared = questionMarkingService.buildQuestionInput(entry.question, paper);
    if (!prepared.input) continue;
    preparedEntries.push({
      ...entry,
      paper,
      expectedHash: questionMarkingService.buildContentHash(entry.question, prepared.input)
    });
  }

  const questionIds = [...new Set(preparedEntries.map(({ question }) => idOf(question._id)))];
  const hashes = [...new Set(preparedEntries.map(({ expectedHash }) => expectedHash))];
  const expectedByQuestion = new Map(preparedEntries.map((entry) => [
    idOf(entry.question._id),
    entry.expectedHash
  ]));
  const markingVersions = questionIds.length && hashes.length
    ? await findRecords(
      QuestionMarkingVersion,
      {
        question: { $in: questionIds.map((id) => new mongoose.Types.ObjectId(id)) },
        contentHash: { $in: hashes }
      },
      "_id question course department questionYear questionSession sourceExamYear sourceAcademicSession version questionType contentHash status marking sourcePaper sourcePaperMetadata sourcePage sourceExcerpt createdAt"
    )
    : [];
  const versionsByQuestion = new Map();
  for (const version of markingVersions || []) {
    const questionId = idOf(version.question);
    if (expectedByQuestion.get(questionId) !== version.contentHash) continue;
    const existing = versionsByQuestion.get(questionId);
    if (!existing || version.version > existing.version ||
        (version.version === existing.version &&
         new Date(version.createdAt || 0).getTime() > new Date(existing.createdAt || 0).getTime())) {
      versionsByQuestion.set(questionId, version);
    }
  }

  const result = new Map(validCourses.map((course) => [idOf(course._id), {
    course,
    entries: [],
    sourcePapers: new Map()
  }]));
  for (const entry of preparedEntries) {
    const version = versionsByQuestion.get(idOf(entry.question._id));
    if (!isEligibleQuestion(entry.question, entry.course, entry.paper, version)) continue;
    const courseResult = result.get(idOf(entry.course._id));
    courseResult.entries.push({
      question: entry.question,
      paper: entry.paper,
      markingVersion: version
    });
    courseResult.sourcePapers.set(idOf(entry.paper._id), entry.paper);
  }
  return result;
};

const getEligibleQuestionsForCourse = async (course) => {
  const results = await getEligibleEntriesForCourses([course]);
  return (results.get(idOf(course?._id))?.entries || []).map(({ question }) => question);
};

const getEligibleQuestionEntriesForCourse = async (course) => {
  const results = await getEligibleEntriesForCourses([course]);
  return results.get(idOf(course?._id))?.entries || [];
};

const selectUniqueQuestions = (questions, count) => {
  const uniqueQuestions = new Map();
  for (const question of questions || []) {
    const questionId = idOf(question?._id);
    if (questionId && !uniqueQuestions.has(questionId)) uniqueQuestions.set(questionId, question);
  }
  return shuffle([...uniqueQuestions.values()]).slice(0, count);
};

const selectUniqueEntries = (entries, count) => {
  const uniqueEntries = new Map();
  for (const entry of entries || []) {
    const questionId = idOf(entry?.question?._id);
    if (questionId && !uniqueEntries.has(questionId)) uniqueEntries.set(questionId, entry);
  }
  return shuffle([...uniqueEntries.values()]).slice(0, count);
};

const assemblePracticeTest = async (course, count) => {
  if (!PRACTICE_TEST_LENGTHS.includes(count)) {
    return {
      ok: false,
      code: "unsupported_question_count",
      entries: [],
      questions: [],
      eligibleQuestionCount: 0
    };
  }
  const eligibleEntries = await getEligibleQuestionEntriesForCourse(course);
  const entries = selectUniqueEntries(eligibleEntries, count);
  if (entries.length !== count) {
    return {
      ok: false,
      code: "insufficient_questions",
      entries: [],
      questions: [],
      eligibleQuestionCount: eligibleEntries.length
    };
  }
  return {
    ok: true,
    code: "",
    entries,
    questions: entries.map(({ question }) => question),
    eligibleQuestionCount: eligibleEntries.length
  };
};

const buildCourseCoverage = async (
  course,
  entriesByCourse,
  { includeEligibilityFingerprint = false, includeTopicQuestionCounts = false } = {}
) => {
  const context = entriesByCourse || await getEligibleEntriesForCourses([course]);
  const courseContext = context.get(idOf(course._id)) || { entries: [], sourcePapers: new Map() };
  const entries = courseContext.entries;
  const questions = entries.map(({ question }) => question);
  const sourcePapers = courseContext.sourcePapers;
  const topicCategories = [...new Map(questions
    .map((question) => text(question.topic))
    .filter(Boolean)
    .map((topic) => [topic.toLowerCase(), topic])).values()]
    .sort((left, right) => left.localeCompare(right));
  const topicQuestionCounts = Object.fromEntries([...questions
    .reduce((counts, question) => {
      const topic = text(question.topic);
      if (topic) counts.set(topic, (counts.get(topic) || 0) + 1);
      return counts;
    }, new Map())
    .entries()]
    .sort(([left], [right]) => left.localeCompare(right)));
  const eligibilityFingerprint = includeEligibilityFingerprint
    ? crypto.createHash("sha256")
      .update(JSON.stringify(entries.map(({ question, expectedHash, markingVersion }) => ({
        questionId: idOf(question._id),
        expectedHash: expectedHash || "",
        markingVersionId: idOf(markingVersion?._id),
        markingVersion: markingVersion?.version || 0
      })).sort((left, right) => left.questionId.localeCompare(right.questionId))))
      .digest("hex")
    : undefined;
  const academicYears = new Set();
  const examSessions = new Set();
  const academicSessions = new Set();
  const pastPaperSemesters = new Set();
  const questionTypeCounts = { objective: 0, fill_in_gap: 0, theory: 0 };

  for (const { question, paper } of entries) {
    const type = questionTypeOf(question);
    questionTypeCounts[type] += 1;
    for (const yearValue of [question.year, question.sourceExamYear, paper.examinationYear]) {
      const year = text(yearValue);
      if (/^\d{4}$/.test(year)) academicYears.add(year);
    }
    if (["Rain", "Harmattan"].includes(question.session)) examSessions.add(question.session);
    if (text(question.sourceAcademicSession)) academicSessions.add(text(question.sourceAcademicSession));
    if (["First", "Second"].includes(paper.semester)) pastPaperSemesters.add(paper.semester);
  }

  const eligibleQuestionCount = questions.length;
  const availableTestLengths = PRACTICE_ATTEMPTS_ENABLED
    ? PRACTICE_TEST_LENGTHS.filter((length) => eligibleQuestionCount >= length)
    : [];
  const insufficientQuestionsMessage = eligibleQuestionCount < PRACTICE_TEST_LENGTHS[0]
    ? `Only ${eligibleQuestionCount} eligible approved questions are available. At least ${PRACTICE_TEST_LENGTHS[0]} reviewed questions are needed for a practice test.`
    : null;

  return {
    courseId: idOf(course._id),
    courseName: course.title,
    courseCode: course.code,
    eligibleQuestionCount,
    objectiveQuestionCount: questionTypeCounts.objective,
    fillInGapQuestionCount: questionTypeCounts.fill_in_gap,
    theoryQuestionCount: questionTypeCounts.theory,
    questionTypeCounts,
    ...(includeTopicQuestionCounts ? { topicQuestionCounts } : {}),
    distinctSourcePaperCount: sourcePapers.size,
    academicYears: [...academicYears].sort((left, right) => right.localeCompare(left)),
    academicSessions: [...academicSessions].sort(),
    examSessions: [...examSessions].sort(),
    pastPaperSemesters: [...pastPaperSemesters].sort(),
    topicCategories,
    verifiedSourceQuestionCount: eligibleQuestionCount,
    availableTestLengths,
    enoughForPracticeTest: availableTestLengths.length > 0,
    ...(eligibilityFingerprint ? { eligibilityFingerprint } : {}),
    practiceAttemptsEnabled: PRACTICE_ATTEMPTS_ENABLED,
    availabilityMessage: PRACTICE_ATTEMPTS_ENABLED
      ? null
      : "Coverage is available, but practice attempts remain unavailable until Stage 3C enables the attempt engine for all supported question formats.",
    insufficientQuestionsMessage
  };
};

const getAccessibleCourseCoverage = async (user, options = {}) => {
  const accessibleCourseIds = await courseMembership.getValidAccessibleCourseIds(user);
  if (Array.isArray(accessibleCourseIds) && accessibleCourseIds.length === 0) return [];

  const filter = accessibleCourseIds === null
    ? {}
    : { _id: { $in: accessibleCourseIds } };
  const courses = await findRecords(Course, filter, "_id title code department");
  const validCourses = (courses || []).filter((course) =>
    isObjectId(course._id) && isObjectId(course.department)
  );
  const entriesByCourse = await getEligibleEntriesForCourses(validCourses);
  return Promise.all(validCourses.map((course) =>
    buildCourseCoverage(course, entriesByCourse, options)
  ));
};

module.exports = {
  PRACTICE_TEST_LENGTHS,
  PRACTICE_ATTEMPTS_ENABLED,
  isEligibleQuestion,
  getEligibleQuestionsForCourse,
  getEligibleQuestionEntriesForCourse,
  selectUniqueQuestions,
  selectUniqueEntries,
  assemblePracticeTest,
  buildCourseCoverage,
  getAccessibleCourseCoverage
};
