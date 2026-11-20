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

test("temporary provider failures retry with exponential backoff and eventually succeed", async () => {
  const waits = [];
  let calls = 0;
  const result = await gemini.retryProviderRequest(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("Busy"), { status: 503 });
    if (calls === 2) throw Object.assign(new Error("Rate limited"), { status: 429 });
    return "completed";
  }, async (milliseconds) => waits.push(milliseconds));

  assert.equal(result, "completed");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [750, 1500]);
});

test("temporary provider failures stop after two retries and retain the retry count", async () => {
  const waits = [];
  let calls = 0;
  await assert.rejects(
    gemini.retryProviderRequest(async () => {
      calls += 1;
      throw Object.assign(new Error("Still busy"), { status: 503 });
    }, async (milliseconds) => waits.push(milliseconds)),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.providerRetryCount, 2);
      return true;
    }
  );

  assert.equal(calls, 3);
  assert.deepEqual(waits, [750, 1500]);
});

test("permanent provider errors are not retried", async () => {
  const waits = [];
  let calls = 0;
  await assert.rejects(
    gemini.retryProviderRequest(async () => {
      calls += 1;
      throw Object.assign(new Error("Invalid request"), { status: 400 });
    }, async (milliseconds) => waits.push(milliseconds)),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.providerRetryCount, 0);
      return true;
    }
  );

  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test("exhausted temporary failures keep diagnostics and return a student-friendly message", () => {
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logs.push(args);
  let wrapped;
  try {
    wrapped = gemini.providerFailure(Object.assign(new Error("High demand"), {
      status: 503,
      statusText: "Service Unavailable",
      providerRetryCount: 2
    }), "AI_PROVIDER_ERROR", { model: "gemini-3.8-flash" });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(wrapped.message, "The AI assistant is temporarily busy. Please try again in a moment.");
  assert.equal(wrapped.statusCode, 503);
  assert.equal(wrapped.temporarilyUnavailable, true);
  const diagnostic = JSON.parse(logs[0][1]);
  assert.equal(diagnostic.httpStatus, 503);
  assert.equal(diagnostic.retryCount, 2);
});
