const test = require("node:test");
const assert = require("node:assert/strict");
const gemini = require("../utils/gemini");
const structuringService = require("../services/questionStructuringService");

const originalStructure = gemini.structureQuestionDrafts;
const originalReserve = gemini.reserveQuestionStructuringRequests;

test.beforeEach(() => {
  gemini.reserveQuestionStructuringRequests = async () => ({ testReservation: true });
});

test.after(() => {
  gemini.structureQuestionDrafts = originalStructure;
  gemini.reserveQuestionStructuringRequests = originalReserve;
});

test("AI drafts remain pending and an answer not explicitly present in an answer key is omitted", async () => {
  gemini.structureQuestionDrafts = async () => ({
    message: JSON.stringify({
      questions: [{
        questionNumber: "1",
        questionText: "Which option is correct?",
        options: [{ label: "A", text: "First" }, { label: "B", text: "Second" }],
        possibleAnswer: "B",
        sourceImageIndex: 0,
        sourcePage: 1,
        structuringConfidence: 0.9
      }]
    }),
    model: "mock-model"
  });

  const result = await structuringService.structureQuestionDrafts({
    pages: [{ imageId: "image-1", pageNumber: 1, text: "1. Which option is correct? A. First B. Second", confidence: 91 }],
    userId: "user-1"
  });
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].possibleAnswer, "");
  assert.equal(result.drafts[0].answerStatus, "unconfirmed");
  assert.equal(result.drafts[0].reviewStatus, "pending");
  assert.ok(result.drafts[0].extractionWarnings.length > 0);
});

test("an explicitly printed answer remains only a possible unconfirmed answer", async () => {
  gemini.structureQuestionDrafts = async () => ({
    message: JSON.stringify({
      questions: [{
        questionText: "Which option is correct?",
        options: [{ label: "A", text: "First" }, { label: "B", text: "Second" }],
        possibleAnswer: "B",
        sourceImageIndex: 0,
        sourcePage: 1
      }]
    }),
    model: "mock-model"
  });
  const result = await structuringService.structureQuestionDrafts({
    pages: [{ imageId: "image-1", pageNumber: 1, text: "Question 1. Which option is correct? A. First B. Second. Answer: B.", confidence: 90 }],
    userId: "user-1"
  });
  assert.equal(result.drafts[0].possibleAnswer, "B");
  assert.equal(result.drafts[0].answerStatus, "unconfirmed");
  assert.equal(result.drafts[0].reviewStatus, "pending");
});

test("structuring preserves objective, fill-in-the-gap, and theory formats for content review", async () => {
  gemini.structureQuestionDrafts = async () => ({
    message: JSON.stringify({
      questions: [
        {
          questionType: "objective",
          questionText: "Which option is correct?",
          options: [{ label: "A", text: "First" }, { label: "B", text: "Second" }],
          sourceImageIndex: 0,
          sourcePage: 1
        },
        {
          questionType: "fill_in_gap",
          blankCount: 2,
          questionText: "Fill the gaps: ____ and ____.",
          options: [],
          sourceImageIndex: 0,
          sourcePage: 1
        },
        {
          questionType: "theory",
          questionText: "Explain the concept.",
          options: [],
          sourceImageIndex: 0,
          sourcePage: 1
        }
      ]
    }),
    model: "mock-model"
  });
  const result = await structuringService.structureQuestionDrafts({
    pages: [{
      imageId: "image-1",
      pageNumber: 1,
      text: "Which option is correct? A. First B. Second. Fill the gaps: ____ and ____. Explain the concept.",
      confidence: 90
    }],
    userId: "user-1"
  });
  assert.deepEqual(result.drafts.map((draft) => draft.questionType), ["objective", "fill_in_gap", "theory"]);
  assert.equal(result.drafts[1].blankCount, 2);
  assert.equal(result.drafts[2].options.length, 0);
  assert.ok(result.drafts.every((draft) => draft.reviewStatus === "pending"));
});

test("structuring reports a draft-limit failure rather than silently truncating output", async () => {
  gemini.structureQuestionDrafts = async () => ({
    message: JSON.stringify({ questions: Array.from({ length: 101 }, (_, index) => ({ questionText: `Question ${index}` })) }),
    model: "mock-model"
  });
  const result = await structuringService.structureQuestionDrafts({
    pages: [{ imageId: "image-1", pageNumber: 1, text: "OCR", confidence: 80 }],
    userId: "user-1"
  });
  assert.equal(result.drafts.length, 0);
  assert.equal(result.failures[0].category, "draft_limit");
});

test("malformed model responses are reported without creating drafts", async () => {
  gemini.structureQuestionDrafts = async () => ({
    message: '{"questions":[{"questionText":"Incomplete JSON"}]',
    model: "mock-model"
  });
  const result = await structuringService.structureQuestionDrafts({
    pages: [{ imageId: "image-1", pageNumber: 1, text: "OCR source text", confidence: 90 }],
    userId: "user-1"
  });
  assert.equal(result.drafts.length, 0);
  assert.equal(result.failures[0].category, "invalid_response");
});

test("provider failures are categorized and do not discard completed sections", async () => {
  const pages = [{
    imageId: "image-1",
    pageNumber: 1,
    text: Array.from({ length: 1200 }, (_, index) => `${index + 1}. Explain term-${index}.`).join("\n"),
    confidence: 70
  }];
  const completed = [];
  let calls = 0;
  gemini.structureQuestionDrafts = async ([page]) => {
    calls += 1;
    if (calls === 2) {
      const error = new Error("provider details must not be surfaced");
      error.code = "AI_RATE_LIMITED";
      error.statusCode = 429;
      error.providerStatus = 429;
      throw error;
    }
    return {
      message: JSON.stringify({
        questions: [{
          questionType: "theory",
          questionText: page.text.split("\n")[0],
          sourceImageIndex: 0,
          sourcePage: 1
        }]
      }),
      model: "mock-model"
    };
  };
  const result = await structuringService.structureQuestionDrafts({
    pages,
    userId: "user-1",
    onChunkSuccess: async (section) => completed.push(section)
  });

  assert.ok(calls >= 3);
  assert.equal(completed.length, calls - 1);
  assert.equal(result.drafts.length, completed.length);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].category, "rate_limit");
  assert.equal(result.failures[0].providerStatus, 429);
  assert.doesNotMatch(JSON.stringify(result.failures), /provider details/);
});

test("retry skips completed chunks and only resumes unfinished sections", async () => {
  const pages = [{
    imageId: "image-1",
    pageNumber: 1,
    text: Array.from({ length: 1200 }, (_, index) => `${index + 1}. Explain term-${index}.`).join("\n"),
    confidence: 80
  }];
  const chunks = structuringService.createStructuringChunks(pages);
  const completedChunkKeys = chunks
    .filter((_, index) => index !== 1)
    .map((chunk) => chunk.chunkKey);
  const existingDrafts = [{
    sourceImage: "image-1",
    sourcePage: 1,
    questionText: chunks[0].page.text.split("\n")[0],
    reviewStatus: "pending"
  }];
  let calls = 0;
  gemini.structureQuestionDrafts = async ([page]) => {
    calls += 1;
    return {
      message: JSON.stringify({
        questions: [{
          questionType: "theory",
          questionText: page.text.split("\n")[0],
          sourceImageIndex: 0,
          sourcePage: 1
        }]
      }),
      model: "mock-model"
    };
  };

  const result = await structuringService.structureQuestionDrafts({
    pages,
    userId: "user-1",
    completedChunkKeys,
    existingDrafts
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.completedChunkKeys, [chunks[1].chunkKey]);
  assert.equal(result.drafts.length, 1);
});

test("poor OCR wording is preserved and explicitly flagged for human review", async () => {
  const noisyText = "1. Wh4t is a tr@nsistor in th1s c1rcuit?";
  gemini.structureQuestionDrafts = async () => ({
    message: JSON.stringify({
      questions: [{
        questionType: "unclassified",
        questionText: noisyText,
        sourceImageIndex: 0,
        sourcePage: 1,
        warnings: ["The technical term is unclear in the OCR."]
      }]
    }),
    model: "mock-model"
  });

  const result = await structuringService.structureQuestionDrafts({
    pages: [{ imageId: "image-1", pageNumber: 1, text: noisyText, confidence: 35 }],
    userId: "user-1"
  });
  const prompt = gemini.buildQuestionStructuringPrompt([{
    imageId: "image-1",
    pageNumber: 1,
    text: noisyText
  }]);

  assert.equal(result.drafts[0].questionText, noisyText);
  assert.equal(result.drafts[0].questionType, "unclassified");
  assert.ok(result.drafts[0].extractionWarnings.includes("The technical term is unclear in the OCR."));
  assert.match(prompt, /true\/false questions/i);
  assert.match(prompt, /do not silently repair/i);
});

test("true/false questions remain classified without inventing unseen choices", async () => {
  const questionText = "1. True or false: all conductors have zero resistance.";
  gemini.structureQuestionDrafts = async () => ({
    message: JSON.stringify({
      questions: [{
        questionType: "objective",
        questionText,
        options: [],
        sourceImageIndex: 0,
        sourcePage: 1
      }]
    }),
    model: "mock-model"
  });
  const result = await structuringService.structureQuestionDrafts({
    pages: [{ imageId: "image-1", pageNumber: 1, text: questionText, confidence: 90 }],
    userId: "user-1"
  });
  assert.equal(result.drafts[0].questionType, "objective");
  assert.deepEqual(result.drafts[0].options, []);
  assert.ok(result.drafts[0].extractionWarnings.some((warning) => /no objective choices were readable/i.test(warning)));
});

test("duplicate drafts returned for one chunk are saved only once", async () => {
  gemini.structureQuestionDrafts = async () => ({
    message: JSON.stringify({
      questions: Array.from({ length: 2 }, () => ({
        questionType: "theory",
        questionText: "Explain the source-supported concept.",
        sourceImageIndex: 0,
        sourcePage: 1
      }))
    }),
    model: "mock-model"
  });
  const result = await structuringService.structureQuestionDrafts({
    pages: [{
      imageId: "image-1",
      pageNumber: 1,
      text: "Explain the source-supported concept.",
      confidence: 90
    }],
    userId: "user-1"
  });
  assert.equal(result.drafts.length, 1);
  assert.ok(result.warnings.some((warning) => /duplicate/i.test(warning)));
});

test("missing AI configuration is returned as an actionable safe failure", async () => {
  gemini.reserveQuestionStructuringRequests = async () => {
    const error = new Error("Gemini is not configured.");
    error.code = "AI_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  };
  const result = await structuringService.structureQuestionDrafts({
    pages: [{ imageId: "image-1", pageNumber: 1, text: "Question text", confidence: 80 }],
    userId: "user-1"
  });
  assert.equal(result.failures[0].category, "configuration");
  assert.match(result.failures[0].message, /Configure Gemini access/);
});
