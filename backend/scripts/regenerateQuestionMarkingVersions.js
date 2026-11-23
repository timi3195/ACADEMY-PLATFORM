const path = require("node:path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);

const MONGOOSE_CONNECTION_OPTIONS = Object.freeze({
  autoIndex: false,
  autoCreate: false
});
const Course = require("../models/course");
const Question = require("../models/Question");
const questionMarkingService = require("../services/questionMarkingService");
const practiceTestService = require("../services/practiceTestService");

const TARGET_COURSE_CODE = "NCC424";
const CONFIRMATION = "REGENERATE-NCC424-MARKING-VERSIONS";
const MAX_QUESTIONS = 12;
const MARKING_STATUSES = new Set([
  "ready",
  "generating",
  "uncertain",
  "invalid",
  "failed",
  "needs_source"
]);
const FAILURE_CODES = new Set(["", "not_configured", "rate_limited", "provider_error"]);
const GENERATION_ERROR_TYPES = new Set([
  "CastError",
  "Error",
  "MongoNetworkError",
  "MongoServerError",
  "MongoServerSelectionError",
  "MongooseError",
  "ValidationError"
]);

const parseArguments = (args) => {
  const options = {
    questionIds: [],
    courseCode: "",
    apply: false,
    actorId: "",
    confirmation: ""
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--question-id") {
      options.questionIds.push(args[++index] || "");
    } else if (argument === "--course-code") {
      options.courseCode = args[++index] || "";
    } else if (argument === "--actor-id") {
      options.actorId = args[++index] || "";
    } else if (argument === "--confirm") {
      options.confirmation = args[++index] || "";
    } else if (argument === "--apply") {
      options.apply = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
};

const validateArguments = (options) => {
  if (!options.questionIds.length || options.questionIds.length > MAX_QUESTIONS) {
    throw new Error(`Provide between 1 and ${MAX_QUESTIONS} explicit --question-id values.`);
  }
  if (options.courseCode !== TARGET_COURSE_CODE) {
    throw new Error(`This repair is restricted to --course-code ${TARGET_COURSE_CODE}.`);
  }
  if (new Set(options.questionIds).size !== options.questionIds.length ||
      options.questionIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw new Error("Question IDs must be unique valid MongoDB ObjectIds.");
  }
  if (!options.apply) return;
  if (options.confirmation !== CONFIRMATION) {
    throw new Error(`Applying changes requires --confirm ${CONFIRMATION}.`);
  }
  if (!mongoose.Types.ObjectId.isValid(options.actorId)) {
    throw new Error("Applying changes requires a valid --actor-id.");
  }
};

const safeSummary = (diagnostic) => ({
  questionSuffix: diagnostic.questionId.slice(-6),
  approvalStatus: diagnostic.question.approvalStatus,
  origin: diagnostic.question.origin,
  eligible: diagnostic.eligible,
  questionChecks: {
    originExplicit: diagnostic.question.originExplicit,
    approvedByValid: diagnostic.question.approvedByValid,
    approvedAtValid: diagnostic.question.approvedAtValid,
    courseMatches: diagnostic.question.courseMatches,
    departmentMatches: diagnostic.question.departmentMatches,
    contentValid: diagnostic.question.contentValid,
    sourcePaperMatches: diagnostic.question.sourcePaperMatches
  },
  markingVersionExists: diagnostic.markingVersionExists,
  matchingContentVersionExists: diagnostic.matchingContentVersionExists,
  selectedVersion: diagnostic.selectedMarkingVersion
    ? {
      version: diagnostic.selectedMarkingVersion.version,
      status: diagnostic.selectedMarkingVersion.status,
      failureCode: diagnostic.selectedMarkingVersion.failureCode,
      contentHashMatches: diagnostic.selectedMarkingVersion.contentHashMatches,
      questionMetadataMatches: diagnostic.selectedMarkingVersion.questionMetadataMatches,
      sourceMetadataMatches: diagnostic.selectedMarkingVersion.sourceMetadataMatches,
      markingUsable: diagnostic.selectedMarkingVersion.markingUsable,
      eligibilityFailureReasons: diagnostic.selectedMarkingVersion.eligibilityFailureReasons
    }
    : null,
  eligibilityFailureReasons: diagnostic.eligibilityFailureReasons
});

const summarizeResult = (result, questionSuffix) => {
  const status = MARKING_STATUSES.has(result?.status) ? result.status : "unknown";
  const failureCode = FAILURE_CODES.has(result?.version?.failureCode)
    ? result.version.failureCode
    : "";
  const isReady = status === "ready" && result.version?.status === "ready";
  return {
    questionSuffix,
    outcome: isReady ? "successful" : "unsuccessful",
    status,
    version: Number.isInteger(result?.version?.version) ? result.version.version : null,
    failureCode
  };
};

const run = async (args = process.argv.slice(2), dependencies = {}) => {
  const options = parseArguments(args);
  validateArguments(options);
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGO_URI is required.");

  const mongooseClient = dependencies.mongoose || mongoose;
  const CourseModel = dependencies.Course || Course;
  const QuestionModel = dependencies.Question || Question;
  const markingService = dependencies.questionMarkingService || questionMarkingService;
  const diagnosticsService = dependencies.practiceTestService || practiceTestService;
  const log = dependencies.log || ((value) => console.log(JSON.stringify(value, null, 2)));

  await mongooseClient.connect(mongoUri, MONGOOSE_CONNECTION_OPTIONS);
  try {
    const course = await CourseModel.findOne({ code: TARGET_COURSE_CODE }).select("_id").lean();
    if (!course) throw new Error(`Course ${TARGET_COURSE_CODE} was not found.`);

    const diagnostics = [];
    for (const questionId of options.questionIds) {
      const question = await QuestionModel.findById(questionId).select("course").lean();
      if (!question) throw new Error(`Question ${questionId.slice(-6)} was not found.`);
      if (String(question.course) !== String(course._id)) {
        throw new Error(`Question ${questionId.slice(-6)} is outside course ${TARGET_COURSE_CODE}.`);
      }

      const diagnostic = await diagnosticsService.getQuestionMarkingDiagnostic(questionId);
      if (!diagnostic) throw new Error(`Question ${questionId.slice(-6)} was not found.`);
      diagnostics.push(diagnostic);
    }

    log({
      mode: options.apply ? "apply" : "dry-run",
      courseCode: TARGET_COURSE_CODE,
      operation: "Call questionMarkingService.generateForQuestion for explicitly selected approved questions.",
      writesQuestionRecords: false,
      writesQuestionMarkingVersions: options.apply,
      writesQuizSessions: false,
      questions: diagnostics.map(safeSummary)
    });

    if (!options.apply) {
      return {
        mode: "dry-run",
        selectedCount: diagnostics.length,
        exitCode: 0
      };
    }

    const summary = {
      mode: "apply",
      courseCode: TARGET_COURSE_CODE,
      selectedCount: diagnostics.length,
      processedCount: 0,
      successful: [],
      unsuccessful: [],
      skipped: [],
      results: [],
      partialCompletion: false,
      outcome: "failed",
      exitCode: 1
    };
    let stopAfterException = false;
    let exceptionQuestionSuffix = "";
    let processedBeforeException = 0;
    const expectedCourseId = String(course._id);

    for (let index = 0; index < diagnostics.length; index += 1) {
      const diagnostic = diagnostics[index];
      const questionSuffix = diagnostic.questionId.slice(-6);
      if (stopAfterException) {
        const result = {
          questionSuffix,
          outcome: "skipped",
          status: "not_processed",
          reason: "previous_generation_exception"
        };
        summary.skipped.push(result);
        summary.results.push(result);
        continue;
      }
      if (diagnostic.question.approvalStatus !== "approved") {
        const result = {
          questionSuffix,
          outcome: "skipped",
          status: "not_approved"
        };
        summary.skipped.push(result);
        summary.results.push(result);
        continue;
      }

      summary.processedCount += 1;
      try {
        const generated = await markingService.generateForQuestion(
          diagnostic.questionId,
          options.actorId,
          { expectedCourseId }
        );
        const result = summarizeResult(generated, questionSuffix);
        summary[result.outcome].push(result);
        summary.results.push(result);
      } catch (error) {
        const result = {
          questionSuffix,
          outcome: "unsuccessful",
          status: "error",
          reason: "generation_exception",
          errorType: GENERATION_ERROR_TYPES.has(error?.name) ? error.name : "Error"
        };
        summary.unsuccessful.push(result);
        summary.results.push(result);
        stopAfterException = true;
        exceptionQuestionSuffix = questionSuffix;
        processedBeforeException = summary.processedCount - 1;
      }
    }

    const hasUnsuccessfulOrSkipped = summary.unsuccessful.length > 0 || summary.skipped.length > 0;
    summary.partialCompletion = hasUnsuccessfulOrSkipped &&
      (summary.successful.length > 0 || processedBeforeException > 0);
    if (summary.successful.length === summary.selectedCount) {
      summary.outcome = "successful";
      summary.exitCode = 0;
    } else if (summary.partialCompletion) {
      summary.outcome = "partial";
    }
    if (exceptionQuestionSuffix) {
      summary.exception = {
        questionSuffix: exceptionQuestionSuffix,
        processedBeforeException
      };
    }

    log({ type: "repair-summary", ...summary });
    return summary;
  } finally {
    await mongooseClient.disconnect();
  }
};

if (require.main === module) {
  run()
    .then((summary) => {
      process.exitCode = summary.exitCode;
    })
    .catch((error) => {
      console.error(error.message || "Unable to process question marking versions.");
      process.exitCode = 1;
    });
}

module.exports = {
  MONGOOSE_CONNECTION_OPTIONS,
  parseArguments,
  run,
  validateArguments
};
