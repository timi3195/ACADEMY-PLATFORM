const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const nodemailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");
const User = require("../models/User");
const { logger } = require("../utils/logger");
const { sendPasswordResetEmail } = require("../utils/email");
const authRouter = require("../routes/auth");

const TEST_EMAIL = "reset-recipient@example.test";
const RESET_TOKEN = "private-reset-token-for-test";
const API_KEY = "SG.private-api-key-for-test";

const withEmailConfig = async (run, values = {}) => {
  const keys = [
    "NODE_ENV", "SENDGRID_API_KEY", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
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

test("SMTP reset mail reports provider acceptance without claiming delivery", async () => {
  const originalCreateTransport = nodemailer.createTransport;
  let sentMessage;
  let transportOptions;
  let sendMailLogCount;
  let capturedLogLines;
  nodemailer.createTransport = (options) => {
    transportOptions = options;
    return {
      sendMail: async (message) => {
        sendMailLogCount = capturedLogLines.length;
        sentMessage = message;
        return { accepted: [TEST_EMAIL], rejected: [], messageId: "smtp-test-id" };
      }
    };
  };

  try {
    await withEmailConfig(async () => {
      const { result, lines } = await captureLogs(
        () => sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-smtp-ok"),
        (_line, captured) => { capturedLogLines = captured; }
      );
      assert.equal(transportOptions.host, "smtp.example.test");
      assert.equal(transportOptions.port, "587");
      assert.equal(transportOptions.secure, false);
      assert.deepEqual(transportOptions.auth, { user: "smtp-user-test", pass: "smtp-password-test" });
      assert.match(sentMessage.html, new RegExp(RESET_TOKEN));
      assert.match(sentMessage.html, /https:\/\/academy\.example\.test\/reset-password/);
      assert.equal(result.success, true);
      assert.equal(result.accepted, true);
      assert.equal(result.delivered, false);
      assert.equal(result.outcome, "accepted_by_provider");
      assert.ok(lines.some((line) => line.includes('"provider":"smtp"') && line.includes('"delivered":false')));
      const sendAttemptLogIndex = lines.findIndex((line) =>
        line.includes('"event":"password_reset_email_send_attempted"')
      );
      assert.ok(sendAttemptLogIndex >= 0);
      assert.equal(sendMailLogCount, sendAttemptLogIndex + 1);
      assert.ok(lines.every((line) =>
        !line.includes(TEST_EMAIL) &&
        !line.includes(RESET_TOKEN) &&
        !line.includes("https://academy.example.test/reset-password") &&
        !line.includes("smtp-password-test") &&
        !line.includes("smtp-user-test")
      ));
    }, {
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587",
      SMTP_USER: "smtp-user-test",
      SMTP_PASS: "smtp-password-test"
    });
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test("SMTP authentication failures return a safe diagnostic", async () => {
  const originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    sendMail: async () => {
      const error = new Error(`authentication failed: ${API_KEY} ${RESET_TOKEN}`);
      error.code = "EAUTH";
      throw error;
    }
  });

  try {
    await withEmailConfig(async () => {
      const { result, lines } = await captureLogs(() =>
        sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-smtp-fail")
      );
      assert.equal(result.success, false);
      assert.equal(result.outcome, "provider_authentication_failed");
      const diagnostics = lines.join("\n");
      assert.ok(diagnostics.includes('"code":"EAUTH"'));
      assert.ok(diagnostics.includes("provider rejected the configured credentials"));
      assert.ok(!diagnostics.includes(TEST_EMAIL));
      assert.ok(!diagnostics.includes(RESET_TOKEN));
      assert.ok(!diagnostics.includes(API_KEY));
      assert.ok(!diagnostics.includes("authentication failed:"));
    }, {
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "smtp-user-test",
      SMTP_PASS: "smtp-password-test"
    });
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test("SMTP sender or recipient rejection is not reported as accepted", async () => {
  const originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    sendMail: async () => {
      const error = new Error(`sender rejected ${RESET_TOKEN}`);
      error.code = "EENVELOPE";
      throw error;
    }
  });

  try {
    await withEmailConfig(async () => {
      const { result, lines } = await captureLogs(() =>
        sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-smtp-rejected")
      );
      assert.equal(result.success, false);
      assert.equal(result.accepted, false);
      assert.equal(result.outcome, "provider_rejected_request");
      assert.match(lines.join("\n"), /rejected the sender or recipient address/);
      assert.ok(!lines.join("\n").includes(RESET_TOKEN));
    }, {
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "smtp-user-test",
      SMTP_PASS: "smtp-password-test"
    });
  } finally {
    nodemailer.createTransport = originalCreateTransport;
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

test("SMTP configuration is incomplete unless both credentials are present", async () => {
  const originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    sendMail: async () => ({
      accepted: [TEST_EMAIL],
      rejected: [],
      messageId: "smtp-missing-auth-test-id"
    })
  });

  try {
    for (const smtpCredentials of [{}, { SMTP_USER: "smtp-user-test" }]) {
      await withEmailConfig(async () => {
        const { result, lines } = await captureLogs(() =>
          sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-smtp-missing-auth")
        );
        const started = lines.map((line) => JSON.parse(line))
          .find((entry) => entry.event === "password_reset_email_send_started");
        assert.equal(started.configurationComplete, false);
        assert.equal(result.success, Object.keys(smtpCredentials).length === 0);
        if (Object.keys(smtpCredentials).length > 0) {
          assert.equal(result.outcome, "configuration_missing");
        }
        assert.ok(!lines.join("\n").includes(RESET_TOKEN));
        assert.ok(!lines.join("\n").includes("smtp-user-test"));
      }, { SMTP_HOST: "smtp.example.test", ...smtpCredentials });
    }
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

test("provider timeouts are distinguished from rejected or accepted email", async () => {
  const originalSend = sgMail.send;
  sgMail.send = async () => new Promise(() => {});

  try {
    await withEmailConfig(async () => {
      const { result, lines } = await captureLogs(() =>
        sendPasswordResetEmail(TEST_EMAIL, RESET_TOKEN, "Test Student", "request-sendgrid-timeout", 5)
      );
      assert.equal(result.success, false);
      assert.equal(result.outcome, "timeout_delivery_unknown");
      assert.match(lines.join("\n"), /acceptance is unknown/);
      assert.ok(!lines.join("\n").includes(RESET_TOKEN));
    }, { SENDGRID_API_KEY: API_KEY });
  } finally {
    sgMail.send = originalSend;
  }
});

test("forgot-password keeps the same generic response for known and unknown accounts", async () => {
  const originalFindOne = User.findOne;
  const originalSave = User.prototype.save;
  const originalGenerate = User.prototype.generatePasswordResetToken;
  const originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    sendMail: async (message) => ({
      accepted: [message.to],
      rejected: [],
      messageId: "route-smtp-test-id"
    })
  });
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
        entry.provider === "smtp"
      ));
      assert.ok(!lines.join("\n").includes(TEST_EMAIL));
      assert.ok(!lines.join("\n").includes(RESET_TOKEN));
      assert.ok(!lines.join("\n").includes("https://academy.example.test/reset-password"));
      assert.ok(!lines.join("\n").includes("smtp-password-test"));
      assert.ok(!lines.join("\n").includes("smtp-user-test"));
    }, {
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "smtp-user-test",
      SMTP_PASS: "smtp-password-test"
    });
  } finally {
    User.findOne = originalFindOne;
    User.prototype.save = originalSave;
    User.prototype.generatePasswordResetToken = originalGenerate;
    nodemailer.createTransport = originalCreateTransport;
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
