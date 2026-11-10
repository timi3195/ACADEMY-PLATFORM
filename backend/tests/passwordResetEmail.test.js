const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const nodemailer = require("nodemailer");
const axios = require("axios");
const sgMail = require("@sendgrid/mail");
const User = require("../models/User");
const { logger } = require("../utils/logger");
const { sendPasswordResetEmail } = require("../utils/email");
const authRouter = require("../routes/auth");

const TEST_EMAIL = "reset-recipient@example.test";
const RESET_TOKEN = "private-reset-token-for-test";
const API_KEY = "SG.private-api-key-for-test";
const BREVO_API_KEY = "brevo-private-api-key-for-test";

const withEmailConfig = async (run, values = {}) => {
  const keys = [
    "NODE_ENV", "BREVO_API_KEY", "SENDGRID_API_KEY", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
    "SMTP_USER", "SMTP_PASS", "EMAIL_FROM", "FRONTEND_URL", "SKIP_EMAIL_IN_DEV"
  ];
  const previous = Object.fromEntries(keys.map((key) => [
    key,
    { present: Object.prototype.hasOwnProperty.call(process.env, key), value: process.env[key] }
  ]));

  for (const key of keys) delete process.env[key];
  process.env.NODE_ENV = "production";
  process.env.FRONTEND_URL = "https://academy.example.test";
  process.env.EMAIL_FROM = "noreply@example.test";
  Object.assign(process.env, values);

  try {
    await run();
  } finally {
    for (const key of keys) {
      if (previous[key].present) process.env[key] = previous[key].value;
      else delete process.env[key];
    }
  }
};

const captureLogs = async (run, onLog = () => {}) => {
  const originalLog = console.log;
  const originalError = console.error;
  const lines = [];
  const capture = (...parts) => {
    const line = parts.map(String).join(" ");
    lines.push(line);
    onLog(line, lines);
  };
  console.log = capture;
  console.error = capture;
  try {
    return { result: await run(), lines };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
};

test("Brevo reset mail uses its HTTPS API, preserves template content, and reports acceptance", async () => {
  const originalPost = axios.post;
  const originalCreateTransport = nodemailer.createTransport;
  let requestOptions;
  let requestBody;
  let sendAttemptLogCount;
  let capturedLogLines;
  axios.post = async (url, body, options) => {
    requestBody = body;
    requestOptions = { url, ...options };
    sendAttemptLogCount = capturedLogLines.length;
    return { status: 201, data: { messageId: "<brevo-message-id>" } };
  };
  nodemailer.createTransport = () => {
    throw new Error("SMTP must not be used for Brevo");
  };

  try {
    await withEmailConfig(async () => {
      const { result, lines } = await captureLogs(
        () => sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-brevo-ok"),
        (_line, captured) => { capturedLogLines = captured; }
      );
      assert.equal(requestOptions.url, "https://api.brevo.com/v3/smtp/email");
      assert.equal(requestOptions.headers["api-key"], BREVO_API_KEY);
      assert.equal(requestOptions.timeout, 15000);
      assert.deepEqual(requestBody.sender, { email: "noreply@example.test" });
      assert.deepEqual(requestBody.to, [{ email: TEST_EMAIL }]);
      assert.equal(requestBody.subject, "Password Reset Request - Academy Platform");
      assert.match(requestBody.htmlContent, new RegExp(RESET_TOKEN));
      assert.match(requestBody.htmlContent, /https:\/\/academy\.example\.test\/reset-password/);
      assert.equal(result.success, true);
      assert.equal(result.accepted, true);
      assert.equal(result.delivered, false);
      assert.equal(result.outcome, "accepted_by_provider");
      assert.equal(result.messageId, "<brevo-message-id>");
      const accepted = lines.map((line) => JSON.parse(line))
        .find((entry) => entry.event === "password_reset_email_provider_accepted");
      assert.equal(accepted.provider, "brevo");
      assert.equal(accepted.providerMessageId, "<brevo-message-id>");
      const sendAttemptIndex = lines.findIndex((line) =>
        line.includes('"event":"password_reset_email_send_attempted"')
      );
      assert.ok(sendAttemptIndex >= 0);
      assert.equal(sendAttemptLogCount, sendAttemptIndex + 1);
      assert.ok(lines.every((line) =>
        !line.includes(TEST_EMAIL) &&
        !line.includes(RESET_TOKEN) &&
        !line.includes("https://academy.example.test/reset-password") &&
        !line.includes(BREVO_API_KEY)
      ));
    }, {
      BREVO_API_KEY,
      SENDGRID_API_KEY: API_KEY,
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "smtp-user-test",
      SMTP_PASS: "smtp-password-test"
    });
  } finally {
    axios.post = originalPost;
    nodemailer.createTransport = originalCreateTransport;
  }
});

test("Brevo HTTP errors return safe diagnostics without provider details", async () => {
  const originalPost = axios.post;
  axios.post = async () => {
    const error = new Error(`rejected ${BREVO_API_KEY} ${RESET_TOKEN} ${TEST_EMAIL}`);
    error.response = {
      status: 401,
      data: { message: `private provider detail ${BREVO_API_KEY}` }
    };
    throw error;
  };

  try {
    await withEmailConfig(async () => {
      const { result, lines } = await captureLogs(() =>
        sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-brevo-fail")
      );
      assert.equal(result.success, false);
      assert.equal(result.outcome, "provider_authentication_failed");
      const diagnostics = lines.join("\n");
      assert.ok(diagnostics.includes('"provider":"brevo"'));
      assert.ok(diagnostics.includes('"code":"401"'));
      assert.ok(diagnostics.includes("provider rejected the configured credentials"));
      assert.ok(!diagnostics.includes(BREVO_API_KEY));
      assert.ok(!diagnostics.includes(RESET_TOKEN));
      assert.ok(!diagnostics.includes(TEST_EMAIL));
      assert.ok(!diagnostics.includes("private provider detail"));
    }, { BREVO_API_KEY });
  } finally {
    axios.post = originalPost;
  }
});

test("Brevo sender accepts display-name and plain-address formats", async () => {
  const originalPost = axios.post;
  const senders = [];
  axios.post = async (_url, body) => {
    senders.push(body.sender);
    return { status: 201, data: { messageId: "<sender-format-test>" } };
  };

  try {
    await withEmailConfig(async () => {
      for (const [from, expected] of [
        ["AcademyPlatform <verified-email@example.com>", {
          email: "verified-email@example.com",
          name: "AcademyPlatform"
        }],
        ["verified-email@example.com", { email: "verified-email@example.com" }]
      ]) {
        process.env.EMAIL_FROM = from;
        const result = await sendPasswordResetEmail(
          TEST_EMAIL,
          RESET_TOKEN,
          "Test Student",
          "request-sender-format"
        );
        assert.equal(result.success, true);
        assert.deepEqual(senders.at(-1), expected);
      }
    }, { BREVO_API_KEY });
  } finally {
    axios.post = originalPost;
  }
});

test("invalid or missing production sender fails safely before provider request", async () => {
  const originalPost = axios.post;
  let apiCalls = 0;
  axios.post = async () => {
    apiCalls += 1;
    return { status: 201, data: { messageId: "<should-not-send>" } };
  };

  try {
    await withEmailConfig(async () => {
      for (const sender of ["", "invalid sender", "AcademyPlatform <not-an-email>", "sender@example.com\r\nBcc: other@example.com"]) {
        process.env.EMAIL_FROM = sender;
        const { result, lines } = await captureLogs(() =>
          sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-invalid-sender")
        );
        assert.equal(result.success, false);
        assert.equal(result.outcome, "configuration_missing");
        assert.match(result.error, /Email delivery is not configured/);
        if (sender) assert.ok(!lines.join("\n").includes(sender));
      }
      delete process.env.EMAIL_FROM;
      const { result } = await captureLogs(() =>
        sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-missing-sender")
      );
      assert.equal(result.success, false);
      assert.equal(result.outcome, "configuration_missing");
      assert.equal(apiCalls, 0);
    }, { BREVO_API_KEY });
  } finally {
    axios.post = originalPost;
  }
});

test("SendGrid receives the original configured sender format", async () => {
  const originalSend = sgMail.send;
  let sentMessage;
  sgMail.send = async (message) => {
    sentMessage = message;
    return [{ statusCode: 202, headers: { "x-message-id": "sendgrid-sender-test" } }];
  };

  try {
    await withEmailConfig(async () => {
      const from = "AcademyPlatform <verified-email@example.com>";
      process.env.EMAIL_FROM = from;
      const result = await sendPasswordResetEmail(
        TEST_EMAIL,
        RESET_TOKEN,
        "Test Student",
        "request-sendgrid-sender"
      );
      assert.equal(result.success, true);
      assert.equal(sentMessage.from, from);
    }, { SENDGRID_API_KEY: API_KEY });
  } finally {
    sgMail.send = originalSend;
  }
});

test("SendGrid API errors are reported without exposing provider response details", async () => {
  const originalSend = sgMail.send;
  sgMail.send = async () => {
    const error = new Error(`rejected ${API_KEY} ${RESET_TOKEN} ${TEST_EMAIL}`);
    error.response = { statusCode: 403, body: { errors: [{ message: "private provider detail" }] } };
    throw error;
  };

  try {
    await withEmailConfig(async () => {
      const { result, lines } = await captureLogs(() =>
        sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-sendgrid-fail")
      );
      assert.equal(result.success, false);
      assert.equal(result.outcome, "provider_authentication_failed");
      const diagnostics = lines.join("\n");
      assert.ok(diagnostics.includes('"provider":"sendgrid"'));
      assert.ok(diagnostics.includes('"code":"403"'));
      assert.ok(!diagnostics.includes(API_KEY));
      assert.ok(!diagnostics.includes(RESET_TOKEN));
      assert.ok(!diagnostics.includes("https://academy.example.test/reset-password"));
      assert.ok(!diagnostics.includes("smtp-password-test"));
      assert.ok(!diagnostics.includes("smtp-user-test"));
      assert.ok(!diagnostics.includes(TEST_EMAIL));
      assert.ok(!diagnostics.includes("private provider detail"));
    }, { SENDGRID_API_KEY: API_KEY });
  } finally {
    sgMail.send = originalSend;
  }
});

test("production ignores SMTP configuration when API provider keys are missing", async () => {
  const originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => {
    throw new Error("SMTP must not be used in production");
  };
  try {
    await withEmailConfig(async () => {
      const { result, lines } = await captureLogs(() =>
        sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-no-api")
      );
      const started = lines.map((line) => JSON.parse(line))
        .find((entry) => entry.event === "password_reset_email_send_started");
      assert.equal(started.provider, "unconfigured");
      assert.equal(started.configurationComplete, false);
      assert.equal(result.success, false);
      assert.equal(result.outcome, "configuration_missing");
      assert.ok(!lines.join("\n").includes("smtp.example.test"));
    }, { SMTP_HOST: "smtp.example.test", SMTP_USER: "smtp-user-test", SMTP_PASS: "smtp-password-test" });
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test("missing production email configuration is rejected and diagnosed", async () => {
  await withEmailConfig(async () => {
    const { result, lines } = await captureLogs(() =>
      sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-no-provider")
    );
    assert.equal(result.success, false);
    assert.equal(result.outcome, "configuration_missing");
    assert.ok(lines.some((line) =>
      line.includes('"provider":"unconfigured"') && line.includes('"configurationComplete":false')
    ));
    assert.ok(!lines.join("\n").includes(RESET_TOKEN));
  });
});

test("Brevo network timeouts are distinguished from rejected or accepted email", async () => {
  const originalPost = axios.post;
  axios.post = async () => new Promise(() => {});

  try {
    await withEmailConfig(async () => {
      const { result, lines } = await captureLogs(() =>
        sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-brevo-timeout", 5)
      );
      assert.equal(result.success, false);
      assert.equal(result.outcome, "timeout_delivery_unknown");
      assert.match(lines.join("\n"), /acceptance is unknown/);
      assert.ok(!lines.join("\n").includes(RESET_TOKEN));
    }, { BREVO_API_KEY });
  } finally {
    axios.post = originalPost;
  }
});

test("forgot-password keeps the same generic response for known and unknown accounts", async () => {
  const originalFindOne = User.findOne;
  const originalSave = User.prototype.save;
  const originalGenerate = User.prototype.generatePasswordResetToken;
  const originalPost = axios.post;
  axios.post = async () => ({ status: 201, data: { messageId: "<route-brevo-id>" } });
  User.prototype.save = async function saveWithoutDatabase() { return this; };
  User.prototype.generatePasswordResetToken = function generateTestToken() {
    this.resetPasswordToken = RESET_TOKEN;
    this.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
    return RESET_TOKEN;
  };

  const app = express();
  app.use(express.json());
  app.use(logger.requestLogger);
  app.use("/api/auth", authRouter);

  try {
    await withEmailConfig(async () => {
      const { result, lines } = await captureLogs(async () => {
        User.findOne = async () => null;
        const unknown = await request(app)
          .post("/api/auth/forgot-password")
          .send({ email: TEST_EMAIL });

        User.findOne = async () => ({
          email: TEST_EMAIL,
          name: "Test Student",
          generatePasswordResetToken: User.prototype.generatePasswordResetToken,
          save: async () => {}
        });
        const known = await request(app)
          .post("/api/auth/forgot-password")
          .send({ email: TEST_EMAIL });

        await new Promise((resolve) => setTimeout(resolve, 10));
        return { unknown, known };
      });

      assert.equal(result.known.status, 200);
      assert.equal(result.unknown.status, 200);
      assert.deepEqual(result.known.body, result.unknown.body);
      assert.equal(result.known.body.success, true);
      const events = lines.map((line) => JSON.parse(line));
      const lookupEvents = events.filter((entry) => entry.event === "password_reset_account_lookup");
      assert.deepEqual(lookupEvents.map((entry) => entry.outcome).sort(), ["matched", "not_found"]);
      assert.ok(lookupEvents.every((entry) =>
        entry.requestId && Object.keys(entry).every((key) => key !== "email" && key !== "token")
      ));

      const knownLookup = lookupEvents.find((entry) => entry.outcome === "matched");
      const unknownLookup = lookupEvents.find((entry) => entry.outcome === "not_found");
      const knownRequest = events.find((entry) =>
        entry.event === "request" && entry.requestId === knownLookup.requestId
      );
      const unknownRequest = events.find((entry) =>
        entry.event === "request" && entry.requestId === unknownLookup.requestId
      );
      assert.ok(knownRequest);
      assert.ok(unknownRequest);
      assert.ok(events.some((entry) =>
        entry.event === "password_reset_email_send_started" && entry.requestId === knownLookup.requestId
      ));
      assert.ok(events.some((entry) =>
        entry.event === "password_reset_email_send_attempted" &&
        entry.requestId === knownLookup.requestId &&
        entry.provider === "brevo"
      ));
      assert.ok(!lines.join("\n").includes(TEST_EMAIL));
      assert.ok(!lines.join("\n").includes(RESET_TOKEN));
      assert.ok(!lines.join("\n").includes("https://academy.example.test/reset-password"));
      assert.ok(!lines.join("\n").includes(BREVO_API_KEY));
    }, { BREVO_API_KEY });
  } finally {
    User.findOne = originalFindOne;
    User.prototype.save = originalSave;
    User.prototype.generatePasswordResetToken = originalGenerate;
    axios.post = originalPost;
  }
});

test("email values are redacted from structured request logs", () => {
  const { sanitizeForLog } = require("../utils/logger");
  assert.deepEqual(sanitizeForLog({
    email: TEST_EMAIL,
    userEmail: TEST_EMAIL,
    password: "private-password",
    resetToken: RESET_TOKEN,
    apiKey: API_KEY
  }), {
    email: "********",
    userEmail: "********",
    password: "********",
    resetToken: "********",
    apiKey: "********"
  });
});
