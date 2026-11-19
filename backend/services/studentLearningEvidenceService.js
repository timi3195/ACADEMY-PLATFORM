const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Course = require("../models/course");
const CourseMaterialProgress = require("../models/CourseMaterialProgress");
const User = require("../models/User");
const courseMembership = require("./courseMembershipService");
const courseMaterialService = require("./courseMaterialService");
const practiceTestService = require("./practiceTestService");
const studentAnalyticsService = require("./studentAnalyticsService");

const idOf = (value) => String(value?._id || value || "");
const text = (value) => typeof value === "string" ? value.trim() : "";
const normalizedTopic = (value) => text(value).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
const TOPIC_THRESHOLDS = studentAnalyticsService.TOPIC_THRESHOLDS;
const MINIMUM_QUESTIONS_PER_TYPE = 3;
const MAX_GEMINI_CANDIDATES = 12;
const MAX_RECOMMENDATIONS = 5;
const RECOMMENDATION_CACHE_TTL_MS = 10 * 60 * 1000;
const RECOMMENDATION_CACHE_LIMIT = 500;
const GEMINI_PRIORITIZATION_TIMEOUT_MS = 12000;
const CANDIDATE_KINDS = Object.freeze({
  MATERIAL: "study_material",
  PRACTICE: "practice_test"
});
const recommendationCache = new Map();
const recommendationRequests = new Map();

const EXPLANATION_TEXT = Object.freeze({
  topic_performance: "Prioritized using verified topic performance.",
  continued_progress: "Prioritized to support continued progress.",
  available_practice: "Prioritized because an eligible practice test is available.",
  general_study: "Suggested for general course study while more evidence is gathered.",
  available_learning_option: "Selected from the available learning options."
});

const hashEvidence = (evidence) => crypto.createHash("sha256")
  .update(JSON.stringify(evidence))
  .digest("hex");

const exactTopicTitle = (materialTitle, topics) => {
  const title = normalizedTopic(materialTitle);
  if (!title) return null;
  const matches = topics.filter((topic) => normalizedTopic(topic.name) === title);
  return matches.length === 1 ? matches[0].name : null;
};

const summarizeTopicEvidence = (analytics, courseId) => (analytics.topics || [])
  .filter((topic) => idOf(topic.courseId) === courseId)
  .map((topic) => ({
    topic: topic.topic,
    classification: topic.classification,
    sufficiency: topic.classification === "Insufficient data" ? "insufficient" : "sufficient",
    questionsAnswered: topic.questionsAnswered,
    questionsGraded: topic.questionsGraded,
    correctAnswers: topic.correctAnswers,
    accuracy: topic.accuracy,
    trend: topic.trend
  }));

const summarizeQuestionTypeEvidence = (items = []) => items.map((item) => ({
  questionType: item.questionType,
  questionsGraded: item.questionsGraded || 0,
  accuracy: item.accuracy,
  sufficiency: item.questionsGraded >= MINIMUM_QUESTIONS_PER_TYPE &&
    Number.isFinite(item.accuracy)
    ? "sufficient"
    : "insufficient"
}));

const buildEvidenceFingerprint = (evidence) => {
  const courses = evidence.courses.map((course) => ({
    courseId: course.courseId,
    title: course.title,
    code: course.code,
    canonicalTopics: course.canonicalTopics,
    cbt: course.cbt,
    materials: course.materials.map((material) => ({
      materialId: material.materialId,
      title: material.title,
      description: material.description,
      materialType: material.materialType,
      category: material.category,
      available: material.available,
      topic: material.topic,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
      completionState: material.completionState,
      completedAt: material.completedAt,
      progressUpdatedAt: material.progressUpdatedAt
    })).sort((left, right) => left.materialId.localeCompare(right.materialId)),
    practice: course.practice
  })).sort((left, right) => left.courseId.localeCompare(right.courseId));
  return hashEvidence({ studentId: evidence.studentId, courses });
};

const createCourseCandidates = (course) => {
  const candidates = [];
  const topicByName = new Map(course.cbt.topics.map((topic) => [topic.topic, topic]));
  const matchedTopicNames = new Set();
  for (const material of course.materials) {
    if (!mongoose.Types.ObjectId.isValid(material.materialId) ||
        !material.available ||
        material.completionState === "completed") continue;
    const topic = material.topic ? topicByName.get(material.topic) : null;
    if (topic && ["Needs improvement", "Developing"].includes(topic.classification)) {
      matchedTopicNames.add(topic.topic);
      const needsImprovement = topic.classification === "Needs improvement";
      candidates.push({
        candidateId: `material:${course.courseId}:${material.materialId}:${needsImprovement ? "revisit" : "study"}`,
        kind: CANDIDATE_KINDS.MATERIAL,
        course: { courseId: course.courseId, title: course.title, code: course.code },
        action: {
          type: needsImprovement ? "revisit_material" : "study_material",
          materialId: material.materialId,
          title: material.title,
          materialType: material.materialType || material.category || "Course material"
        },
        reason: needsImprovement
          ? `Verified CBT results show ${topic.accuracy}% accuracy across ${topic.questionsAnswered} answered question(s) for ${topic.topic}. This existing material has an exact title match to a canonical course topic.`
          : `Verified CBT results classify ${topic.topic} as developing (${topic.accuracy}% across ${topic.questionsAnswered} answered question(s)). This existing material has an exact title match to a canonical course topic.`,
        evidence: {
          category: "verified_topic_performance",
          sufficiency: "sufficient",
          topic: topic.topic,
          classification: topic.classification,
          questionsAnswered: topic.questionsAnswered,
          accuracy: topic.accuracy,
          completionState: "incomplete",
          completionIsSelfReported: true,
          materialTopicRelation: "exact_course_topic_title"
        }
      });
    } else if (topic?.trend?.direction === "improving") {
      matchedTopicNames.add(topic.topic);
      candidates.push({
        candidateId: `material:${course.courseId}:${material.materialId}:improving`,
        kind: CANDIDATE_KINDS.MATERIAL,
        course: { courseId: course.courseId, title: course.title, code: course.code },
        action: {
          type: "study_material",
          materialId: material.materialId,
          title: material.title,
          materialType: material.materialType || material.category || "Course material"
        },
        reason: `Verified results for ${topic.topic} are improving across ${topic.trend.comparedAttempts} attempts. This existing material has an exact title match to a canonical course topic.`,
        evidence: {
          category: "verified_topic_improvement",
          sufficiency: "sufficient",
          topic: topic.topic,
          trend: topic.trend,
          completionState: "incomplete",
          completionIsSelfReported: true,
          materialTopicRelation: "exact_course_topic_title"
        }
      });
    }
  }

  const hasVerifiedCbt = course.cbt.verifiedAttemptCount > 0;
  const hasSufficientTopicEvidence = course.cbt.topics.some((topic) =>
    topic.sufficiency === "sufficient"
  );
  if (!hasVerifiedCbt || !hasSufficientTopicEvidence) {
    for (const material of course.materials) {
      if (!material.available || material.completionState === "completed") continue;
      candidates.push({
        candidateId: `material:${course.courseId}:${material.materialId}:general`,
        kind: CANDIDATE_KINDS.MATERIAL,
        course: { courseId: course.courseId, title: course.title, code: course.code },
        action: {
          type: "study_material",
          materialId: material.materialId,
          title: material.title,
          materialType: material.materialType || material.category || "Course material"
        },
        reason: hasVerifiedCbt
          ? "There is not enough topic-specific CBT evidence for targeted guidance. This available material is suggested for general course study."
          : "There is not enough verified CBT evidence for topic-specific guidance. This available material is suggested for general course study.",
        evidence: {
          category: hasVerifiedCbt ? "insufficient_topic_evidence" : "insufficient_cbt_evidence",
          sufficiency: "insufficient",
          completionState: "incomplete",
          completionIsSelfReported: true,
          topicSpecificRelevance: "not_established"
        }
      });
    }
  }

  const improvingTopic = course.cbt.topics.find((topic) =>
    topic.sufficiency === "sufficient" && topic.trend?.direction === "improving"
  );
  const weakTopic = course.cbt.topics.find((topic) =>
    topic.classification === "Needs improvement"
  );
  const developingTopic = course.cbt.topics.find((topic) =>
    topic.classification === "Developing"
  );
  const availableTestLengths = course.practice.availableTestLengths.filter((questionCount) =>
    practiceTestService.PRACTICE_TEST_LENGTHS.includes(questionCount) &&
    questionCount <= course.practice.eligibleQuestionCount
  );
  const canPractice = availableTestLengths.length > 0;
  if (canPractice) {
    for (const questionCount of availableTestLengths) {
      const evidence = improvingTopic
        ? {
            category: "verified_topic_improvement",
            sufficiency: "sufficient",
            topic: improvingTopic.topic,
            trend: improvingTopic.trend
          }
        : weakTopic
          ? {
              category: "verified_topic_performance",
              sufficiency: "sufficient",
              topic: weakTopic.topic,
              classification: weakTopic.classification,
              questionsAnswered: weakTopic.questionsAnswered,
              accuracy: weakTopic.accuracy
            }
          : developingTopic
            ? {
                category: "verified_topic_performance",
                sufficiency: "sufficient",
                topic: developingTopic.topic,
                classification: developingTopic.classification,
                questionsAnswered: developingTopic.questionsAnswered,
                accuracy: developingTopic.accuracy
              }
            : {
                category: hasVerifiedCbt ? "practice_coverage" : "insufficient_cbt_evidence",
                sufficiency: hasVerifiedCbt ? "sufficient" : "insufficient"
              };
      const resultReason = improvingTopic
        ? `Verified results for ${improvingTopic.topic} are improving. Continue practising with this course-wide test; it is not restricted to that topic.`
        : weakTopic
          ? `Verified results show ${weakTopic.topic} needs improvement. This eligible practice test covers the course generally and is not restricted to that topic.`
          : developingTopic
            ? `Verified results classify ${developingTopic.topic} as developing. This eligible practice test covers the course generally and is not restricted to that topic.`
            : hasVerifiedCbt
              ? "An eligible course-wide practice test is available using reviewed questions."
              : "There is not enough verified CBT evidence for topic-specific guidance; an eligible course-wide practice test is available.";
      candidates.push({
        candidateId: `practice:${course.courseId}:${questionCount}`,
        kind: CANDIDATE_KINDS.PRACTICE,
        course: { courseId: course.courseId, title: course.title, code: course.code },
        action: { type: "start_practice_test", questionCount },
        reason: resultReason,
        evidence: {
          ...evidence,
          eligibleQuestionCount: course.practice.eligibleQuestionCount,
          supportedTestSizes: [...course.practice.availableTestLengths],
          relevantTopicCoverage: course.practice.topicQuestionCounts
        }
      });
    }
  }

  for (const topic of course.cbt.topics) {
    if (topic.sufficiency === "sufficient" &&
        topic.trend?.direction === "improving" &&
        !matchedTopicNames.has(topic.topic) &&
        !canPractice) {
      candidates.push({
        candidateId: `topic:${course.courseId}:${encodeURIComponent(topic.topic)}:improving`,
        kind: "study_action",
        course: { courseId: course.courseId, title: course.title, code: course.code },
        action: { type: "continue_practising_topic", topic: topic.topic },
        reason: `Verified results for ${topic.topic} are improving across ${topic.trend.comparedAttempts} attempts. Continue studying and check future results for progress.`,
        evidence: {
          category: "verified_topic_improvement",
          sufficiency: "sufficient",
          topic: topic.topic,
          trend: topic.trend
        }
      });
    }
  }

  return candidates;
};

const buildRecommendationCandidates = (evidence) =>
  evidence.courses.flatMap(createCourseCandidates);

const explanationCodesFor = (candidate) => {
  switch (candidate.evidence?.category) {
    case "verified_topic_performance":
      return ["topic_performance"];
    case "verified_topic_improvement":
      return ["continued_progress"];
    case "practice_coverage":
      return ["available_practice"];
    case "insufficient_topic_evidence":
    case "insufficient_cbt_evidence":
      return ["general_study"];
    default:
      return ["available_learning_option"];
  }
};

const boundedText = (value, limit) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

const buildGeminiCandidateInput = (candidates) =>
  candidates.slice(0, MAX_GEMINI_CANDIDATES).map((candidate) => {
    const action = candidate.action || {};
    const evidence = candidate.evidence || {};
    const item = {
      candidateId: candidate.candidateId,
      actionType: action.type,
      course: {
        title: boundedText(candidate.course?.title, 100),
        code: boundedText(candidate.course?.code, 40)
      },
      evidence: {
        category: boundedText(evidence.category, 60),
        sufficiency: boundedText(evidence.sufficiency, 20)
      },
      allowedExplanationCodes: explanationCodesFor(candidate)
    };
    if (action.title) item.actionTitle = boundedText(action.title, 100);
    if (action.materialType) item.materialType = boundedText(action.materialType, 60);
    if (action.topic) item.topic = boundedText(action.topic, 80);
    if (Number.isInteger(action.questionCount)) item.questionCount = action.questionCount;
    for (const field of ["topic", "classification"]) {
      if (typeof evidence[field] === "string") {
        item.evidence[field] = boundedText(evidence[field], 80);
      }
    }
    for (const field of ["accuracy", "questionsAnswered", "eligibleQuestionCount"]) {
      if (Number.isFinite(evidence[field])) item.evidence[field] = evidence[field];
    }
    if (typeof evidence.trend?.direction === "string") {
      item.evidence.trend = boundedText(evidence.trend.direction, 30);
    }
    return item;
  });

const validatePrioritizationResponse = (message, candidates) => {
  const parsed = JSON.parse(String(message || ""));
  const expectedCount = Math.min(MAX_RECOMMENDATIONS, candidates.length);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 || !Array.isArray(parsed.recommendations) ||
      parsed.recommendations.length !== expectedCount) {
    throw new Error("invalid_learning_prioritization");
  }

  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const seen = new Set();
  return parsed.recommendations.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).length !== 3 ||
        typeof item.candidateId !== "string" ||
        !candidateById.has(item.candidateId) ||
        seen.has(item.candidateId)) {
      throw new Error("invalid_learning_prioritization");
    }
    const candidate = candidateById.get(item.candidateId);
    const candidateActionType = candidate.action?.type || candidate.actionType;
    if (item.actionType !== candidateActionType ||
        !explanationCodesFor(candidate).includes(item.explanationCode)) {
      throw new Error("invalid_learning_prioritization");
    }
    seen.add(item.candidateId);
    return {
      candidateId: item.candidateId,
      actionType: item.actionType,
      explanationCode: item.explanationCode
    };
  });
};

const withTimeout = (promise, timeoutMs) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("learning_prioritization_timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
};

const readCachedPrioritization = (key, candidates, now) => {
  const cached = recommendationCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    recommendationCache.delete(key);
    return null;
  }

  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const resolved = cached.recommendations.map((item) => {
    const candidate = candidateById.get(item.candidateId);
    if (!candidate || candidate.action?.type !== item.actionType ||
        !explanationCodesFor(candidate).includes(item.explanationCode)) return null;
    return {
      ...candidate,
      prioritizationExplanation: EXPLANATION_TEXT[item.explanationCode]
    };
  });
  if (resolved.some((candidate) => !candidate)) {
    recommendationCache.delete(key);
    return null;
  }

  recommendationCache.delete(key);
  recommendationCache.set(key, cached);
  return resolved;
};

const cachePrioritization = (key, recommendations, expiresAt, now) => {
  for (const [cacheKey, entry] of recommendationCache) {
    if (entry.expiresAt <= now) recommendationCache.delete(cacheKey);
  }
  while (recommendationCache.size >= RECOMMENDATION_CACHE_LIMIT) {
    const oldestKey = recommendationCache.keys().next().value;
    if (!oldestKey) break;
    recommendationCache.delete(oldestKey);
  }
  recommendationCache.set(key, { recommendations, expiresAt });
};

const buildStudentLearningEvidence = async (authenticatedUserId, generatedAt = new Date()) => {
  if (!mongoose.Types.ObjectId.isValid(String(authenticatedUserId || ""))) {
    const error = new Error("Authenticated user ID is invalid.");
    error.statusCode = 401;
    throw error;
  }
  const student = await User.findById(authenticatedUserId).select("_id role department");
  if (!student || student.role !== "student") {
    const error = new Error("Learning recommendations are available to students only.");
    error.statusCode = student ? 403 : 404;
    throw error;
  }

  const accessibleCourseIds = await courseMembership.getValidAccessibleCourseIds(student);
  const ids = Array.isArray(accessibleCourseIds) ? accessibleCourseIds : [];
  const courses = ids.length
    ? await Course.find({ _id: { $in: ids } })
      .select("_id title code department topicsBreakdown")
      .lean()
    : [];
  const validCourses = (courses || []).filter((course) =>
    mongoose.Types.ObjectId.isValid(idOf(course._id)) &&
    mongoose.Types.ObjectId.isValid(idOf(course.department)) &&
    text(course.title)
  );

  const [analytics, coverage] = await Promise.all([
    studentAnalyticsService.getStudentAnalytics(student._id, generatedAt, {
      accessibleCourseIds: validCourses.map((course) => course._id)
    }),
    practiceTestService.getAccessibleCourseCoverage(student, {
      includeEligibilityFingerprint: true,
      includeTopicQuestionCounts: true
    })
  ]);
  const coverageByCourse = new Map((coverage || [])
    .filter((item) => validCourses.some((course) => idOf(course._id) === idOf(item.courseId)))
    .map((item) => [idOf(item.courseId), item]));

  const coursesWithMaterials = await Promise.all(validCourses.map(async (course) => {
    const listedMaterials = await courseMaterialService.listCourseMaterials({ course, user: student });
    const materials = (listedMaterials || []).filter((item) =>
      item?.material &&
      mongoose.Types.ObjectId.isValid(idOf(item.material._id)) &&
      text(item.material.title)
    );
    const availableMaterialIds = materials
      .filter((item) => item.available === true)
      .map((item) => item.material._id);
    const progressRecords = availableMaterialIds.length
      ? await CourseMaterialProgress.find({
          student: student._id,
          course: course._id,
          material: { $in: availableMaterialIds }
        }).select("material completed completedAt updatedAt").lean()
      : [];
    const progressByMaterial = new Map((progressRecords || []).map((record) => [
      idOf(record.material),
      record
    ]));
    const canonicalTopics = (Array.isArray(course.topicsBreakdown) ? course.topicsBreakdown : [])
      .filter((topic) => text(topic?.name).length > 0)
      .map((topic) => ({ name: text(topic.name) }));
    const normalized = materials.map(({ material, available }) => {
      const progress = progressByMaterial.get(idOf(material._id));
      const canonicalTopic = exactTopicTitle(material.title, canonicalTopics);
      return {
        materialId: idOf(material._id),
        title: text(material.title),
        description: text(material.description),
        materialType: text(material.materialType),
        category: text(material.category),
        available: available === true,
        topic: canonicalTopic,
        topicRelation: canonicalTopic ? "exact_course_topic_title" : "general_course_material",
        completionState: progress?.completed === true ? "completed" : "incomplete",
        completedAt: progress?.completed === true ? progress.completedAt || null : null,
        progressUpdatedAt: progress?.updatedAt || null,
        createdAt: material.createdAt || null,
        updatedAt: material.updatedAt || null
      };
    });
    const courseId = idOf(course._id);
    const analyticsCourse = (analytics.courses || []).find((item) =>
      idOf(item.courseId) === courseId
    ) || {};
    const topicEvidence = summarizeTopicEvidence(analytics, courseId);
    const typeEvidence = summarizeQuestionTypeEvidence(analyticsCourse.questionTypeBreakdown);
    const verifiedAttemptCount = analyticsCourse.gradedAttempts || 0;
    const courseTrend = analyticsCourse.trend || { direction: "insufficient_data", comparedAttempts: 0 };
    const practiceCoverage = coverageByCourse.get(courseId);
    const verifiedResults = (analyticsCourse.performanceTrend || []).map((attempt) => ({
      attemptId: idOf(attempt.attemptId),
      completedAt: attempt.completedAt || null,
      accuracy: attempt.accuracy,
      scorePercentage: attempt.scorePercentage,
      questionsAnswered: attempt.questionsAnswered,
      correctAnswers: attempt.correctAnswers
    }));
    return {
      courseId,
      title: text(course.title),
      code: text(course.code),
      canonicalTopics: canonicalTopics.map((topic) => topic.name),
      cbt: {
        verifiedAttemptCount,
        verifiedResults,
        topics: topicEvidence,
        questionTypes: typeEvidence,
        trend: {
          direction: courseTrend.direction || "insufficient_data",
          comparedAttempts: courseTrend.comparedAttempts || 0,
          changePercentagePoints: courseTrend.changePercentagePoints ?? null,
          sufficiency: courseTrend.direction === "insufficient_data" ? "insufficient" : "sufficient"
        },
        insufficientEvidence: [
          ...(verifiedAttemptCount === 0 ? ["no_verified_cbt_results"] : []),
          ...topicEvidence.filter((topic) => topic.sufficiency === "insufficient")
            .map((topic) => `topic:${topic.topic}`),
          ...typeEvidence.filter((item) => item.sufficiency === "insufficient")
            .map((item) => `question_type:${item.questionType}`),
          ...(courseTrend.direction === "insufficient_data" ? ["insufficient_trend_attempts"] : [])
        ]
      },
      materials: normalized,
      practice: {
        eligibleQuestionCount: practiceCoverage?.eligibleQuestionCount || 0,
        questionTypeCounts: practiceCoverage?.questionTypeCounts || {
          objective: 0,
          fill_in_gap: 0,
          theory: 0
        },
        topicQuestionCounts: practiceCoverage?.topicQuestionCounts || {},
        availableTestLengths: practiceCoverage?.practiceAttemptsEnabled
          ? (practiceCoverage.availableTestLengths || []).filter((count) =>
              practiceTestService.PRACTICE_TEST_LENGTHS.includes(count) &&
              count <= (practiceCoverage.eligibleQuestionCount || 0)
            )
          : [],
        eligibilityFingerprint: practiceCoverage?.eligibilityFingerprint || hashEvidence([])
      }
    };
  }));

  const evidence = {
    studentId: idOf(student._id),
    generatedAt,
    courses: coursesWithMaterials
  };
  evidence.evidenceFingerprint = buildEvidenceFingerprint(evidence);
  return evidence;
};

const prioritizeRecommendationCandidates = async (authenticatedUserId, evidence, candidates) => {
  const fallback = () => ({
    generatedAt: evidence.generatedAt,
    evidenceFingerprint: evidence.evidenceFingerprint,
    candidates,
    prioritizationStatus: "deterministic_fallback"
  });
  if (!candidates.length) return fallback();

  const candidateInput = buildGeminiCandidateInput(candidates);
  const cacheKey = JSON.stringify([
    String(authenticatedUserId),
    evidence.evidenceFingerprint
  ]);
  const cached = readCachedPrioritization(cacheKey, candidates, Date.now());
  if (cached) {
    return {
      generatedAt: evidence.generatedAt,
      evidenceFingerprint: evidence.evidenceFingerprint,
      candidates: cached,
      prioritizationStatus: "ai_prioritized"
    };
  }

  let pending = recommendationRequests.get(cacheKey);
  if (!pending) {
    const gemini = require("../utils/gemini");
    pending = withTimeout(
      Promise.resolve().then(() =>
        gemini.prioritizeStudentLearningCandidates(candidateInput, authenticatedUserId)
      ),
      GEMINI_PRIORITIZATION_TIMEOUT_MS
    ).then((response) =>
      validatePrioritizationResponse(response?.message, candidateInput)
    );
    recommendationRequests.set(cacheKey, pending);
  }

  try {
    const prioritized = await pending;
    cachePrioritization(
      cacheKey,
      prioritized,
      Date.now() + RECOMMENDATION_CACHE_TTL_MS,
      Date.now()
    );
    const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
    return {
      generatedAt: evidence.generatedAt,
      evidenceFingerprint: evidence.evidenceFingerprint,
      candidates: prioritized.map((item) => ({
        ...candidateById.get(item.candidateId),
        prioritizationExplanation: EXPLANATION_TEXT[item.explanationCode]
      })),
      prioritizationStatus: "ai_prioritized"
    };
  } catch {
    return fallback();
  } finally {
    if (recommendationRequests.get(cacheKey) === pending) {
      recommendationRequests.delete(cacheKey);
    }
  }
};

const getStudentLearningRecommendations = async (authenticatedUserId, generatedAt) => {
  const evidence = await buildStudentLearningEvidence(authenticatedUserId, generatedAt);
  const candidates = buildRecommendationCandidates(evidence);
  return prioritizeRecommendationCandidates(authenticatedUserId, evidence, candidates);
};

module.exports = {
  MINIMUM_QUESTIONS_PER_TYPE,
  MAX_GEMINI_CANDIDATES,
  MAX_RECOMMENDATIONS,
  exactTopicTitle,
  buildEvidenceFingerprint,
  buildRecommendationCandidates,
  buildStudentLearningEvidence,
  getStudentLearningRecommendations,
  prioritizeRecommendationCandidates,
  buildGeminiCandidateInput,
  validatePrioritizationResponse,
  clearRecommendationCache: () => recommendationCache.clear()
};
