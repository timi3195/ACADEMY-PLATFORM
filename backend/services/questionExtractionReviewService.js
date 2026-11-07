const crypto = require("crypto");
const mongoose = require("mongoose");
const Question = require("../models/Question");
const QuestionExtraction = require("../models/QuestionExtraction");
const Course = require("../models/course");
const Department = require("../models/Department");

const REVIEW_FIELDS = [
  "questionNumber",
  "questionText",
  "options",
  "explanation",
  "topic",
  "difficulty",
  "marks"
];

const reviewError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const idOf = (value) => String(value?._id || value || "");
const questionIdForExtraction = (extractionKey) => new mongoose.Types.ObjectId(
  crypto.createHash("sha256").update(extractionKey).digest("hex").slice(0, 24)
);

const findDraft = (batch, draftId) =>
  (batch.drafts || []).find((draft) => idOf(draft._id) === String(draftId));

const getReviewValues = (draft) => Object.fromEntries(REVIEW_FIELDS.map((field) => [
  field,
  field === "options"
    ? (draft.options || []).map((option) => ({
      optionId: option.optionId || "",
      label: option.label || "",
      text: option.text || ""
    }))
    : draft[field]
]));

const recordBatchReviewStatus = async (batchId) => {
  const batch = await QuestionExtraction.findOne({ batchId });
  if (!batch) return;
  const drafts = batch.drafts || [];
  const reviewStatus = drafts.length && drafts.every((draft) =>
    ["approved", "rejected"].includes(draft.reviewStatus)
  ) ? "completed" : drafts.some((draft) => draft.reviewStatus !== "pending") ? "in_progress" : "pending";
  await QuestionExtraction.updateOne({ batchId }, { $set: { reviewStatus } });
};

const normalizeOptions = (input, currentOptions) => {
  if (!Array.isArray(input) || input.length < 2 || input.length > 8) {
    throw reviewError(400, "Provide between 2 and 8 answer options.");
  }
  const existingIds = new Set((currentOptions || []).map((option) => option.optionId).filter(Boolean));
  const usedIds = new Set();
  return input.map((option, index) => {
    if (!option || typeof option !== "object" || typeof option.text !== "string") {
      throw reviewError(400, "Each answer option must contain text.");
    }
    const text = option.text.trim();
    if (!text || text.length > 1000) {
      throw reviewError(400, "Answer options must contain 1 to 1000 characters.");
    }
    let optionId = option.optionId || "";
    if (optionId && !existingIds.has(optionId)) {
      throw reviewError(400, "An answer option identifier does not belong to this draft.");
    }
    if (!optionId) optionId = crypto.randomUUID();
    if (usedIds.has(optionId)) throw reviewError(400, "Answer option identifiers must be unique.");
    usedIds.add(optionId);
    return {
      optionId,
      label: String.fromCharCode(65 + index),
      text
    };
  });
};

const editDraft = async ({ batchId, draftId, userId, payload }) => {
  const batch = await QuestionExtraction.findOne({ batchId });
  const draft = batch && findDraft(batch, draftId);
  if (!draft) throw reviewError(404, "Extraction draft not found.");
  if (draft.reviewStatus !== "pending") {
    throw reviewError(409, "Only pending drafts can be edited.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw reviewError(400, "A draft update payload is required.");
  }
  const allowedFields = new Set([
    ...REVIEW_FIELDS,
    "confirmedAnswerOptionId",
    "confirmCorrectAnswer"
  ]);
  if (Object.keys(payload).some((field) => !allowedFields.has(field))) {
    throw reviewError(400, "The request contains unsupported draft fields.");
  }

  const currentValues = getReviewValues(draft);
  const nextValues = { ...currentValues };
  if (Object.hasOwn(payload, "questionNumber")) {
    if (typeof payload.questionNumber !== "string" || payload.questionNumber.trim().length > 40) {
      throw reviewError(400, "Question number must be 40 characters or fewer.");
    }
    nextValues.questionNumber = payload.questionNumber.trim();
  }
  if (Object.hasOwn(payload, "questionText")) {
    if (typeof payload.questionText !== "string" || !payload.questionText.trim() || payload.questionText.trim().length > 5000) {
      throw reviewError(400, "Question text must contain 1 to 5000 characters.");
    }
    nextValues.questionText = payload.questionText.trim();
  }
  if (Object.hasOwn(payload, "options")) {
    nextValues.options = normalizeOptions(payload.options, draft.options);
  }
  if (Object.hasOwn(payload, "explanation")) {
    if (typeof payload.explanation !== "string" || payload.explanation.length > 3000) {
      throw reviewError(400, "Explanation must be 3000 characters or fewer.");
    }
    nextValues.explanation = payload.explanation.trim();
  }
  if (Object.hasOwn(payload, "topic")) {
    if (typeof payload.topic !== "string" || payload.topic.trim().length > 200) {
      throw reviewError(400, "Topic must be 200 characters or fewer.");
    }
    nextValues.topic = payload.topic.trim();
  }
  if (Object.hasOwn(payload, "difficulty")) {
    if (!["easy", "medium", "hard"].includes(payload.difficulty)) {
      throw reviewError(400, "Difficulty must be easy, medium, or hard.");
    }
    nextValues.difficulty = payload.difficulty;
  }
  if (Object.hasOwn(payload, "marks")) {
    const marks = Number(payload.marks);
    if (!Number.isFinite(marks) || marks < 0.1 || marks > 100) {
      throw reviewError(400, "Marks must be between 0.1 and 100.");
    }
    nextValues.marks = marks;
  }

  const optionsChanged = JSON.stringify(currentValues.options) !== JSON.stringify(nextValues.options);
  const requestedAnswerId = Object.hasOwn(payload, "confirmedAnswerOptionId")
    ? payload.confirmedAnswerOptionId
    : draft.confirmedAnswerOptionId || "";
  const validAnswer = typeof requestedAnswerId === "string" &&
    nextValues.options.some((option) => option.optionId === requestedAnswerId);
  const explicitlyConfirmed = payload.confirmCorrectAnswer === true;
  const questionChanged = currentValues.questionText !== nextValues.questionText;
  const confirmationMustReset = optionsChanged || questionChanged;
  const answerConfirmed = explicitlyConfirmed
    ? validAnswer
    : payload.confirmCorrectAnswer === false
      ? false
      : confirmationMustReset
        ? false
        : Boolean(draft.answerConfirmedAt && draft.answerConfirmedBy && validAnswer);

  if (explicitlyConfirmed && !validAnswer) {
    throw reviewError(400, "Select a valid answer option before confirming the correct answer.");
  }
  if (Object.hasOwn(payload, "confirmedAnswerOptionId") && requestedAnswerId && !validAnswer) {
    throw reviewError(400, "The confirmed answer must refer to an option in this draft.");
  }

  const now = new Date();
  const setValues = {};
  for (const field of REVIEW_FIELDS) setValues[`drafts.$.${field}`] = nextValues[field];
  setValues["drafts.$.confirmedAnswerOptionId"] = answerConfirmed ? requestedAnswerId : "";
  setValues["drafts.$.answerConfirmedBy"] = answerConfirmed ? userId : null;
  setValues["drafts.$.answerConfirmedAt"] = answerConfirmed ? now : null;
  if (!draft.originalContent) setValues["drafts.$.originalContent"] = getReviewValues(draft);
  const history = {
    reviewer: userId,
    action: "edited",
    reviewedAt: now,
    previousValues: currentValues,
    updatedValues: nextValues
  };
  const update = await QuestionExtraction.updateOne({
    batchId,
    drafts: { $elemMatch: { _id: draft._id, reviewStatus: "pending" } }
  }, {
    $set: setValues,
    $push: { "drafts.$.reviewHistory": history }
  });
  if (!update.matchedCount) throw reviewError(409, "This draft was reviewed while you were editing it.");
  return QuestionExtraction.findOne({ batchId });
};

const validateApproval = async (batch, draft) => {
  if (!draft.questionText?.trim() || draft.questionText.length > 5000) {
    throw reviewError(400, "A valid question text is required before approval.");
  }
  if (!Array.isArray(draft.options) || draft.options.length < 2 || draft.options.length > 8 ||
      draft.options.some((option) => !option.text?.trim() || !option.optionId) ||
      new Set(draft.options.map((option) => option.optionId)).size !== draft.options.length) {
    throw reviewError(400, "The draft must have 2 to 8 valid answer options with unique identifiers.");
  }
  const answer = draft.options.find((option) => option.optionId === draft.confirmedAnswerOptionId);
  if (!answer || !draft.answerConfirmedBy || !draft.answerConfirmedAt) {
    throw reviewError(400, "A reviewer must explicitly confirm a correct answer option before approval.");
  }
  if (!draft.topic?.trim()) throw reviewError(400, "A topic is required before approval.");
  if (!["easy", "medium", "hard"].includes(draft.difficulty)) {
    throw reviewError(400, "A valid difficulty is required before approval.");
  }
  if (!Number.isFinite(Number(draft.marks)) || Number(draft.marks) <= 0) {
    throw reviewError(400, "Valid marks are required before approval.");
  }
  if (!mongoose.Types.ObjectId.isValid(idOf(batch.course)) ||
      !mongoose.Types.ObjectId.isValid(idOf(batch.department)) ||
      !["ND1", "ND2", "HND1", "HND2"].includes(batch.academicLevel) ||
      !["First", "Second"].includes(batch.semester)) {
    throw reviewError(400, "The extraction course, department, level, or semester is invalid.");
  }

  const [course, department] = await Promise.all([
    Course.findById(batch.course),
    Department.findById(batch.department)
  ]);
  if (!course || !department ||
      idOf(course.department) !== idOf(batch.department) ||
      course.level !== batch.academicLevel ||
      course.semester !== batch.semester) {
    throw reviewError(400, "The extraction course, department, level, and semester associations do not match.");
  }
  const year = String(batch.sourceExamYear || String(batch.academicSession || "").slice(0, 4));
  if (!/^\d{4}$/.test(year)) throw reviewError(400, "A valid examination year is required before approval.");
  return { answer, year };
};

const approveDraft = async ({ batchId, draftId, userId }) => {
  let batch = await QuestionExtraction.findOne({ batchId });
  let draft = batch && findDraft(batch, draftId);
  if (!draft) throw reviewError(404, "Extraction draft not found.");
  const extractionKey = `${batchId}:${draftId}`;
  if (draft.reviewStatus === "approved") {
    const question = await Question.findOne({ extractionKey });
    if (!question) throw reviewError(409, "The approved question record is unavailable; contact an administrator.");
    return { question, alreadyApproved: true, batch };
  }
  if (draft.reviewStatus === "rejected") throw reviewError(409, "Rejected drafts cannot be approved.");

  if (!["pending", "approving"].includes(draft.reviewStatus)) {
    throw reviewError(409, "This draft is already being reviewed.");
  }
  if (draft.reviewStatus === "approving" && draft.reviewLockUntil &&
      new Date(draft.reviewLockUntil) > new Date()) {
    throw reviewError(409, "This draft is currently being approved. Retry after the review finishes.");
  }
  const reviewLockToken = crypto.randomUUID();
  const lockUntil = new Date(Date.now() + 2 * 60 * 1000);
  const claimFilter = {
    batchId,
    drafts: {
      $elemMatch: draft.reviewStatus === "pending"
        ? { _id: draft._id, reviewStatus: "pending" }
        : {
          _id: draft._id,
          reviewStatus: "approving",
          reviewLockUntil: draft.reviewLockUntil || null
        }
    }
  };
  const claim = await QuestionExtraction.findOneAndUpdate(claimFilter, {
    $set: {
      "drafts.$.reviewStatus": "approving",
      "drafts.$.reviewLockToken": reviewLockToken,
      "drafts.$.reviewLockUntil": lockUntil
    }
  }, { new: true });
  if (!claim) {
    batch = await QuestionExtraction.findOne({ batchId });
    draft = batch && findDraft(batch, draftId);
    if (draft?.reviewStatus === "approved") {
      const question = await Question.findOne({ extractionKey });
      if (!question) throw reviewError(409, "The approved question record is unavailable; contact an administrator.");
      return { question, alreadyApproved: true, batch };
    }
    throw reviewError(409, "This draft is already being reviewed.");
  }
  batch = claim;
  draft = findDraft(batch, draftId);
  let answer;
  let year;
  try {
    ({ answer, year } = await validateApproval(batch, draft));
  } catch (error) {
    await QuestionExtraction.updateOne({
      batchId,
      drafts: { $elemMatch: { _id: draft._id, reviewStatus: "approving", reviewLockToken } }
    }, {
      $set: {
        "drafts.$.reviewStatus": "pending",
        "drafts.$.reviewLockToken": "",
        "drafts.$.reviewLockUntil": null
      }
    });
    throw error;
  }

  let question = await Question.findOne({ extractionKey });
  if (!question) {
    try {
      question = await Question.create({
        _id: questionIdForExtraction(extractionKey),
        course: batch.course,
        department: batch.department,
        topic: draft.topic.trim(),
        questionNumber: draft.questionNumber || "",
        question: draft.questionText.trim(),
        options: draft.options.map((option) => option.text.trim()),
        optionIds: draft.options.map((option) => option.optionId),
        answer: answer.text.trim(),
        explanation: draft.explanation || "",
        year,
        session: "Rain",
        marks: Number(draft.marks),
        difficulty: draft.difficulty,
        isPremium: false,
        approvalStatus: "approved",
        approvedBy: userId,
        approvedAt: new Date(),
        extractionKey,
        extractionBatchId: batchId,
        extractionDraftId: String(draftId)
      });
    } catch (error) {
      if (error.code !== 11000) {
        await QuestionExtraction.updateOne({
          batchId,
          drafts: { $elemMatch: { _id: draft._id, reviewStatus: "approving", reviewLockToken } }
        }, {
          $set: {
            "drafts.$.reviewStatus": "pending",
            "drafts.$.reviewLockToken": "",
            "drafts.$.reviewLockUntil": null
          }
        });
        throw error;
      }
      question = await Question.findOne({ extractionKey });
      if (!question) throw error;
    }
  }

  const now = new Date();
  const update = await QuestionExtraction.updateOne({
    batchId,
    drafts: { $elemMatch: { _id: draft._id, reviewStatus: "approving", reviewLockToken } }
  }, {
    $set: {
      "drafts.$.reviewStatus": "approved",
      "drafts.$.reviewer": userId,
      "drafts.$.reviewedAt": now,
      "drafts.$.approvedQuestion": question._id,
      "drafts.$.reviewLockToken": "",
      "drafts.$.reviewLockUntil": null
    },
    $push: {
      "drafts.$.reviewHistory": {
        reviewer: userId,
        action: "approved",
        reviewedAt: now,
        question: question._id
      }
    }
  });
  batch = await QuestionExtraction.findOne({ batchId });
  draft = batch && findDraft(batch, draftId);
  if (!update.matchedCount && draft?.reviewStatus !== "approved") {
    throw reviewError(409, "The draft approval is still being finalized. Retry the request.");
  }
  await recordBatchReviewStatus(batchId);
  return { question, alreadyApproved: !update.matchedCount, batch };
};

const rejectDraft = async ({ batchId, draftId, userId, reason = "" }) => {
  if (typeof reason !== "string" || reason.trim().length > 1000) {
    throw reviewError(400, "Rejection reason must be 1000 characters or fewer.");
  }
  const batch = await QuestionExtraction.findOne({ batchId });
  const draft = batch && findDraft(batch, draftId);
  if (!draft) throw reviewError(404, "Extraction draft not found.");
  if (draft.reviewStatus === "rejected") return { batch, alreadyRejected: true };
  if (draft.reviewStatus !== "pending") throw reviewError(409, "Only pending drafts can be rejected.");
  const now = new Date();
  const rejectionReason = reason.trim();
  const update = await QuestionExtraction.updateOne({
    batchId,
    drafts: { $elemMatch: { _id: draft._id, reviewStatus: "pending" } }
  }, {
    $set: {
      "drafts.$.reviewStatus": "rejected",
      "drafts.$.reviewer": userId,
      "drafts.$.reviewedAt": now,
      "drafts.$.rejectionReason": rejectionReason
    },
    $push: {
      "drafts.$.reviewHistory": {
        reviewer: userId,
        action: "rejected",
        reviewedAt: now,
        rejectionReason
      }
    }
  });
  if (!update.matchedCount) throw reviewError(409, "This draft was reviewed by someone else.");
  await recordBatchReviewStatus(batchId);
  return { batch: await QuestionExtraction.findOne({ batchId }), alreadyRejected: false };
};

module.exports = { approveDraft, editDraft, rejectDraft, reviewError };
