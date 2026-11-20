const test = require("node:test");
const assert = require("node:assert/strict");
const { GoogleGenerativeAIFetchError } = require("@google/generative-ai");
const gemini = require("../utils/gemini");

test("Gemini HTTP errors retain safe provider diagnostics and redact credentials and request content", () => {
  const apiKey = "private-api-key-value";
  const prompt = "private student message";
  const errorDetails = [{
    "@type": "type.googleapis.com/google.rpc.ErrorInfo",
    reason: "API_KEY_INVALID",
    domain: "googleapis.com",
    metadata: {
      apiKey,
      prompt
    }
  }];
  const providerError = new GoogleGenerativeAIFetchError(
    `Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}: [400 Bad Request] Invalid request for ${prompt} ${JSON.stringify(errorDetails)}`,
    400,
    "Bad Request",
    errorDetails
  );
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logs.push(args);

  let wrapped;
  try {
    wrapped = gemini.providerFailure(providerError, "AI_PROVIDER_ERROR", {
      model: "gemini-3.8-flash",
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: "private system instruction"
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(wrapped.statusCode, 400);
  assert.equal(wrapped.providerStatus, 400);
  assert.equal(wrapped.providerCode, "");
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], "[GEMINI_PROVIDER_FAILURE]");
  const diagnostic = JSON.parse(logs[0][1]);
  assert.equal(diagnostic.model, "gemini-3.8-flash");
  assert.equal(diagnostic.httpStatus, 400);
  assert.equal(diagnostic.httpStatusText, "Bad Request");
  assert.match(diagnostic.googleErrorMessage, /Invalid request/);
  assert.match(diagnostic.googleErrorMessage, /\[REDACTED_REQUEST_CONTENT\]/);
  assert.equal(diagnostic.googleErrorCode, null);
  assert.equal(diagnostic.googleErrorStatus, "");
  assert.deepEqual(diagnostic.errorDetails, [{
    "@type": "type.googleapis.com/google.rpc.ErrorInfo",
    reason: "API_KEY_INVALID",
    domain: "googleapis.com"
  }]);

  const serializedLog = JSON.stringify(diagnostic);
  assert.doesNotMatch(serializedLog, /private-api-key-value|private student message|private system instruction/);
  assert.doesNotMatch(serializedLog, /generativelanguage\.googleapis\.com|metadata/);
});

test("Gemini provider diagnostics use explicit Google status and code fields when supplied", () => {
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    gemini.providerFailure(Object.assign(new Error("Invalid argument."), {
      status: 400,
      statusText: "Bad Request",
      googleErrorCode: 400,
      googleErrorStatus: "INVALID_ARGUMENT",
      errorDetails: [{ reason: "INVALID_PARAMETER", domain: "googleapis.com" }]
    }), "AI_PROVIDER_ERROR", { model: "gemini-3.8-flash" });
  } finally {
    console.error = originalConsoleError;
  }

  const diagnostic = JSON.parse(logs[0][1]);
  assert.equal(diagnostic.googleErrorCode, 400);
  assert.equal(diagnostic.googleErrorStatus, "INVALID_ARGUMENT");
  assert.deepEqual(diagnostic.errorDetails, [{
    reason: "INVALID_PARAMETER",
    domain: "googleapis.com"
  }]);
});
