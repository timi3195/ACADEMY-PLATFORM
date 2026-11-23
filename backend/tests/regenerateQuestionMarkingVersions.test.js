const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const mongoose = require("mongoose");
const repairScript = require("../scripts/regenerateQuestionMarkingVersions");
const Course = require("../models/course");
const Question = require("../models/Question");
const QuestionMarkingVersion = require("../models/QuestionMarkingVersion");
const QuizSession = require("../models/QuizSession");

const SCRIPT_PATH = path.resolve(
  __dirname,
  "../scripts/regenerateQuestionMarkingVersions.js"
);
const COURSE_ID = "507f1f77bcf86cd799439021";
const OTHER_COURSE_ID = "507f1f77bcf86cd799439099";
const ACTOR_ID = "507f1f77bcf86cd799439013";
const QUESTION_IDS = [
  "507f1f77bcf86cd799439051",
  "507f1f77bcf86cd799439052",
  "507f1f77bcf86cd799439053",
  "507f1f77bcf86cd799439054",
  "507f1f77bcf86cd799439055",
  "507f1f77bcf86cd799439056"
];

const makeDiagnostic = (questionId, approvalStatus = "approved", overrides = {}) => {
  const diagnostic = {
    questionId,
    eligible: false,
    eligibilityFailureReasons: ["marking_version_missing"],
    question: {
    origin: "original_practice",
    originExplicit: true,
    approvalStatus,
    approvedByValid: true,
    approvedAtValid: true,
    reviewerApprovalValid: true,
    courseMatches: true,
    departmentMatches: true,
    contentValid: true,
    markingInputValid: true,
    hasSourcePaper: false,
    hasSourcePaperMetadata: false,
    hasExtractionProvenance: false,
    sourcePaperMatches: true
    },
    markingVersionExists: false,
    matchingContentVersionExists: false,
    selectedMarkingVersion: null
  };
  return {
    ...diagnostic,
    ...overrides,
    question: { ...diagnostic.question, ...overrides.question }
  };
};

const makeHarness = ({
  questionIds = QUESTION_IDS.slice(0, 1),
  approvalStatuses = new Map(),
  generatedResults = new Map(),
  onDiagnostic,
  generate
} = {}) => {
  const state = {
    courseByQuestion: new Map(questionIds.map((id) => [id, COURSE_ID])),
    connectOptions: null,
    generatorCalls: [],
    questionWrites: 0,
    courseWrites: 0,
    markingVersionWrites: 0,
    quizSessionWrites: 0,
    output: []
  };
  const query = (value) => ({
    select() { return this; },
    lean: async () => value
  });
  const dependencies = {
    mongoose: {
      connect: async (_uri, options) => { state.connectOptions = options; },
      disconnect: async () => {}
    },
    Course: {
      findOne: (filter) => {
        assert.deepEqual(filter, { code: "NCC424" });
        return query({ _id: COURSE_ID });
      },
      create: async () => { state.courseWrites += 1; },
      updateOne: async () => { state.courseWrites += 1; }
    },
    Question: {
      findById: (id) => query({
        course: state.courseByQuestion.get(String(id))
      }),
      create: async () => { state.questionWrites += 1; },
      updateOne: async () => { state.questionWrites += 1; },
      findOneAndUpdate: async () => { state.questionWrites += 1; }
    },
    practiceTestService: {
      getQuestionMarkingDiagnostic: async (id) => {
        if (onDiagnostic) onDiagnostic(id, state);
        return makeDiagnostic(
          id,
          approvalStatuses.get(id) || "approved",
          generatedResults.get(`diagnostic:${id}`)
        );
      }
    },
    questionMarkingService: {
      generateForQuestion: async (id, _actorId, options) => {
        state.generatorCalls.push({ id, options });
        if (generate) return generate(id, options, state);
        if (state.courseByQuestion.get(id) !== options.expectedCourseId) {
          return { status: "invalid", reason: "course_scope_changed" };
        }
        state.markingVersionWrites += 1;
        return generatedResults.get(id) || {
          status: "ready",
          version: { status: "ready", version: 1 }
        };
      }
    },
    log: (value) => state.output.push(value)
  };
  return { state, dependencies };
};

const interceptModelWrites = () => {
  const methods = [
    "create",
    "insertMany",
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "bulkWrite",
    "createCollection",
    "ensureIndexes",
    "createIndexes",
    "syncIndexes"
  ];
  const models = [Course, Question, QuestionMarkingVersion, QuizSession];
  const restorations = [];
  const calls = [];

  for (const model of models) {
    for (const method of methods) {
      if (typeof model[method] !== "function") continue;
      const hadOwnMethod = Object.prototype.hasOwnProperty.call(model, method);
      const original = model[method];
      model[method] = (..._args) => {
        calls.push(`${model.modelName}.${method}`);
        return Promise.resolve(null);
      };
      restorations.push(() => {
        if (hadOwnMethod) model[method] = original;
        else delete model[method];
      });
    }

    const prototype = model.prototype;
    if (typeof prototype.save === "function") {
      const originalSave = prototype.save;
      prototype.save = (..._args) => {
        calls.push(`${model.modelName}.save`);
        return Promise.resolve(null);
      };
      restorations.push(() => { prototype.save = originalSave; });
    }
  }

  return {
    calls,
    restore: () => restorations.reverse().forEach((restore) => restore())
  };
};

const argsFor = (questionIds, apply = false) => [
  ...questionIds.flatMap((id) => ["--question-id", id]),
  "--course-code", "NCC424",
  ...(apply
    ? [
      "--actor-id", ACTOR_ID,
      "--apply",
      "--confirm", "REGENERATE-NCC424-MARKING-VERSIONS"
    ]
    : [])
];

const withMongoUri = async (run) => {
  const previous = process.env.MONGO_URI;
  process.env.MONGO_URI = "mongodb://repair-script-test.invalid/academy";
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = previous;
  }
};

test("repair script requires explicit IDs and rejects other courses or missing confirmation", () => {
  assert.throws(() => repairScript.validateArguments({
    questionIds: [],
    courseCode: "NCC424",
    apply: false
  }), /explicit --question-id/);
  assert.throws(() => repairScript.validateArguments({
    questionIds: [QUESTION_IDS[0]],
    courseCode: "OTHER",
    apply: false
  }), /restricted to --course-code NCC424/);
  assert.throws(() => repairScript.validateArguments({
    questionIds: [QUESTION_IDS[0]],
    courseCode: "NCC424",
    apply: true,
    actorId: ACTOR_ID,
    confirmation: ""
  }), /REGENERATE-NCC424-MARKING-VERSIONS/);
});

test("dry-run disables model initialization writes and never invokes generation", async () => {
  await withMongoUri(async () => {
    const harness = makeHarness();
    const writeSpies = interceptModelWrites();
    let result;
    try {
      result = await repairScript.run(
        argsFor([QUESTION_IDS[0]]),
        harness.dependencies
      );
    } finally {
      writeSpies.restore();
    }

    assert.equal(mongoose.get("autoIndex"), false);
    assert.equal(mongoose.get("autoCreate"), false);
    for (const model of [Course, Question, QuestionMarkingVersion, QuizSession]) {
      assert.notEqual(model.schema.options.autoIndex, true);
      assert.notEqual(model.schema.options.autoCreate, true);
    }
    assert.deepEqual(harness.state.connectOptions, {
      autoIndex: false,
      autoCreate: false
    });
    assert.equal(harness.state.generatorCalls.length, 0);
    assert.equal(harness.state.questionWrites, 0);
    assert.equal(harness.state.courseWrites, 0);
    assert.equal(harness.state.markingVersionWrites, 0);
    assert.equal(harness.state.quizSessionWrites, 0);
    assert.deepEqual(writeSpies.calls, []);
    assert.equal(result.mode, "dry-run");
    assert.equal(result.exitCode, 0);
    assert.equal(result.regenerationRequiredCount, 1);
    assert.deepEqual(harness.state.output[0].questions[0].regenerationPlan, {
      action: "regenerate",
      reason: "marking_version_missing"
    });
    assert.equal(harness.state.output[0].writesQuestionMarkingVersions, false);
    assert.equal(harness.state.output[0].writesQuizSessions, false);
  });
});

test("regeneration plan retries failed and unusable versions but reuses valid ready versions", () => {
  const failed = makeDiagnostic(QUESTION_IDS[0], "approved", {
    markingVersionExists: true,
    matchingContentVersionExists: true,
    selectedMarkingVersion: {
      status: "failed",
      eligibilityFailureReasons: ["marking_payload_unusable"]
    }
  });
  const unusable = makeDiagnostic(QUESTION_IDS[1], "approved", {
    markingVersionExists: true,
    matchingContentVersionExists: true,
    selectedMarkingVersion: {
      status: "ready",
      eligibilityFailureReasons: ["marking_payload_unusable"],
      markingUsable: false,
      questionMetadataMatches: true,
      sourceMetadataMatches: true
    }
  });
  const ready = makeDiagnostic(QUESTION_IDS[2], "approved", {
    eligible: true,
    markingVersionExists: true,
    matchingContentVersionExists: true,
    eligibilityFailureReasons: [],
    selectedMarkingVersion: {
      status: "ready",
      eligibilityFailureReasons: [],
      markingUsable: true,
      questionMetadataMatches: true,
      sourceMetadataMatches: true
    }
  });

  assert.equal(repairScript.getRegenerationPlan(failed).action, "regenerate");
  assert.equal(repairScript.getRegenerationPlan(unusable).action, "regenerate");
  assert.deepEqual(repairScript.getRegenerationPlan(ready), {
    action: "reuse",
    reason: "marking_version_ready"
  });
  assert.deepEqual(
    repairScript.getRegenerationPlan(makeDiagnostic(QUESTION_IDS[3], "draft")),
    { action: "skip", reason: "question_not_ready_for_marking" }
  );
  assert.deepEqual(
    repairScript.getRegenerationPlan(makeDiagnostic(QUESTION_IDS[4], "approved", {
      markingVersionExists: true,
      matchingContentVersionExists: true,
      selectedMarkingVersion: {
        status: "uncertain",
        eligibilityFailureReasons: ["marking_uncertain"]
      }
    })),
    { action: "skip", reason: "marking_version_status_uncertain" }
  );
});

test("apply reuses a valid ready version without invoking marking generation", async () => {
  await withMongoUri(async () => {
    const id = QUESTION_IDS[0];
    const generatedResults = new Map([[
      `diagnostic:${id}`,
      {
        eligible: true,
        eligibilityFailureReasons: [],
        markingVersionExists: true,
        matchingContentVersionExists: true,
        selectedMarkingVersion: {
          version: 3,
          status: "ready",
          failureCode: "",
          contentHashMatches: true,
          questionMetadataMatches: true,
          sourceMetadataMatches: true,
          markingUsable: true,
          eligibilityFailureReasons: []
        }
      }
    ]]);
    const harness = makeHarness({ questionIds: [id], generatedResults });
    const result = await repairScript.run(argsFor([id], true), harness.dependencies);
    const summary = harness.state.output.at(-1);

    assert.equal(result.exitCode, 0);
    assert.equal(summary.outcome, "successful");
    assert.equal(summary.successful[0].status, "already_ready");
    assert.deepEqual(harness.state.generatorCalls, []);
    assert.equal(harness.state.markingVersionWrites, 0);
  });
});

test("apply summarizes ready, non-ready, and skipped questions and fails if any are unrepaired", async () => {
  await withMongoUri(async () => {
    const ids = QUESTION_IDS.slice(0, 6);
    const approvalStatuses = new Map([[ids[5], "draft"]]);
    const generatedResults = new Map([
      [ids[1], { status: "failed", version: { status: "failed", version: 1 } }],
      [ids[2], { status: "invalid", version: { status: "invalid", version: 1 } }],
      [ids[3], { status: "uncertain", version: { status: "uncertain", version: 1 } }],
      [ids[4], { status: "needs_source", version: { status: "needs_source", version: 1 } }]
    ]);
    const harness = makeHarness({ questionIds: ids, approvalStatuses, generatedResults });
    const result = await repairScript.run(argsFor(ids, true), harness.dependencies);
    const summary = harness.state.output.at(-1);

    assert.equal(summary.type, "repair-summary");
    assert.equal(summary.selectedCount, 6);
    assert.equal(summary.successful.length, 1);
    assert.deepEqual(
      summary.unsuccessful.map((item) => item.status),
      ["failed", "invalid", "uncertain", "needs_source"]
    );
    assert.equal(summary.skipped.length, 1);
    assert.equal(summary.results.length, 6);
    assert.equal(summary.outcome, "partial");
    assert.equal(summary.exitCode, 1);
    assert.equal(result.exitCode, 1);
  });
});

test("apply reports partial completion and skips remaining questions after an exception", async () => {
  await withMongoUri(async () => {
    const ids = QUESTION_IDS.slice(0, 3);
    const harness = makeHarness({
      questionIds: ids,
      generate: async (id) => {
        if (id === ids[1]) throw new Error("simulated generator failure");
        harness.state.markingVersionWrites += 1;
        return { status: "ready", version: { status: "ready", version: 1 } };
      }
    });
    const result = await repairScript.run(argsFor(ids, true), harness.dependencies);
    const summary = harness.state.output.at(-1);

    assert.equal(summary.outcome, "partial");
    assert.equal(summary.partialCompletion, true);
    assert.equal(summary.exception.processedBeforeException, 1);
    assert.equal(summary.successful.length, 1);
    assert.equal(summary.unsuccessful[0].reason, "generation_exception");
    assert.equal(summary.unsuccessful[0].errorType, "Error");
    assert.equal(summary.skipped.length, 1);
    assert.equal(summary.results.length, 3);
    assert.equal(harness.state.generatorCalls.length, 2);
    assert.equal(result.exitCode, 1);
  });
});

test("apply refuses a question reassigned after preflight", async () => {
  await withMongoUri(async () => {
    const id = QUESTION_IDS[0];
    const harness = makeHarness({
      questionIds: [id],
      onDiagnostic: (_questionId, state) => {
        state.courseByQuestion.set(id, OTHER_COURSE_ID);
      }
    });
    const result = await repairScript.run(argsFor([id], true), harness.dependencies);
    const summary = harness.state.output.at(-1);

    assert.deepEqual(harness.state.generatorCalls, [{
      id,
      options: { expectedCourseId: COURSE_ID }
    }]);
    assert.equal(summary.unsuccessful[0].status, "invalid");
    assert.equal(summary.exitCode, 1);
    assert.equal(harness.state.markingVersionWrites, 0);
    assert.equal(result.exitCode, 1);
  });
});

test("repair script defaults to dry-run when invoked as a CLI", () => {
  const result = spawnSync(process.execPath, [
    SCRIPT_PATH,
    "--question-id", QUESTION_IDS[0],
    "--course-code", "NCC424"
  ], {
    encoding: "utf8",
    env: { ...process.env, MONGO_URI: "" }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MONGO_URI is required/);
});
