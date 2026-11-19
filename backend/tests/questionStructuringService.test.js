const test = require("node:test");
const assert = require("node:assert/strict");
const gemini = require("../utils/gemini");
const structuringService = require("../services/questionStructuringService");

const originalStructure = gemini.structureQuestionDrafts;

test.after(() => {
  gemini.structureQuestionDrafts = originalStructure;
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

test("structuring refuses to silently truncate more than the supported draft count", async () => {
  gemini.structureQuestionDrafts = async () => ({
    message: JSON.stringify({ questions: Array.from({ length: 101 }, (_, index) => ({ questionText: `Question ${index}` })) }),
    model: "mock-model"
  });
  await assert.rejects(
    structuringService.structureQuestionDrafts({
      pages: [{ imageId: "image-1", pageNumber: 1, text: "OCR", confidence: 80 }],
      userId: "user-1"
    }),
    /draft limit/
  );
});

test("malformed model responses are rejected instead of becoming question drafts", async () => {
  gemini.structureQuestionDrafts = async () => ({
    message: '{"questions":[{"questionText":"Incomplete JSON"}]',
    model: "mock-model"
  });
  await assert.rejects(
    structuringService.structureQuestionDrafts({
      pages: [{ imageId: "image-1", pageNumber: 1, text: "OCR source text", confidence: 90 }],
      userId: "user-1"
    }),
    /invalid question structure/
  );
});
