const Course = require("../models/course");
const User = require("../models/User");
const crypto = require("crypto");
const { normalizeAcademicLevel } = require("../utils/academicLevels");

const idOf = (value) => String(value?._id || value || "");
const normalizeText = (value) => String(value == null ? "" : value).trim().toLowerCase();

const stableOptionIds = (question) => {
  const options = Array.isArray(question.options) ? question.options : [];
  const savedIds = Array.isArray(question.optionIds) ? question.optionIds : [];
  if (savedIds.length === options.length &&
      savedIds.every((id) => typeof id === "string" && id.trim().length > 0) &&
      new Set(savedIds).size === savedIds.length) {
    return savedIds;
  }

  const occurrences = new Map();
  return options.map((option) => {
    const text = normalizeText(option);
    const occurrence = occurrences.get(text) || 0;
    occurrences.set(text, occurrence + 1);
    const digest = crypto.createHash("sha256")
      .update(`${question._id}:${text}:${occurrence}`)
      .digest("hex")
      .slice(0, 24);
    return `legacy_${digest}`;
  });
};

const toSafeOptions = (options, optionIds) =>
  options.map((text, index) => ({ id: optionIds[index], text }));

const toStudentQuestion = (question) => {
  const options = Array.isArray(question.options) ? question.options : [];
  const optionIds = stableOptionIds(question);
  return {
    _id: question._id,
    course: idOf(question.course),
    department: idOf(question.department),
    topic: question.topic,
    question: question.question,
    options: toSafeOptions(options, optionIds),
    subQuestions: (question.subQuestions || []).map((subQuestion, subIndex) => {
      const subOptions = Array.isArray(subQuestion.options) ? subQuestion.options : [];
      const subOptionIds = stableOptionIds({
        _id: `${question._id}:sub:${subIndex}`,
        options: subOptions,
        optionIds: subQuestion.optionIds
      });
      return {
        label: subQuestion.label,
        question: subQuestion.question,
        options: toSafeOptions(subOptions, subOptionIds),
        year: subQuestion.year,
        session: subQuestion.session,
        marks: subQuestion.marks,
        difficulty: subQuestion.difficulty,
        isPremium: subQuestion.isPremium
      };
    }),
    year: question.year,
    session: question.session,
    marks: question.marks,
    difficulty: question.difficulty,
    isPremium: question.isPremium
  };
};

const getCourseAccess = async (userId, courseId) => {
  const [course, user] = await Promise.all([
    Course.findById(courseId),
    User.findById(userId)
  ]);

  if (!course) return { allowed: false, statusCode: 404, message: "Course not found." };
  if (!user) return { allowed: false, statusCode: 401, message: "Authenticated user not found." };

  if (user.role === "admin") {
    return { allowed: true, manager: true, course, user };
  }

  if (user.role === "lecturer") {
    const assigned = Array.isArray(course.lecturers) &&
      course.lecturers.some((lecturerId) => idOf(lecturerId) === idOf(user._id));
    if (user.lecturerStatus === "approved" && assigned) {
      return { allowed: true, manager: true, course, user };
    }
    return { allowed: false, statusCode: 403, message: "You are not authorized to access this course's question bank." };
  }

  const sameDepartment = idOf(user.department) === idOf(course.department);
  const sameLevel = normalizeAcademicLevel(user.yearOfStudy) === normalizeAcademicLevel(course.level);
  const sameSemester = !user.semester || user.semester === course.semester;
  if (user.role === "student" && sameDepartment && sameLevel && sameSemester) {
    return { allowed: true, manager: false, course, user };
  }

  return { allowed: false, statusCode: 403, message: "You do not have access to this course's question bank." };
};

module.exports = { getCourseAccess, stableOptionIds, toStudentQuestion };
