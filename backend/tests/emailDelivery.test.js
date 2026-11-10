const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const axios = require("axios");
const User = require("../models/User");
const Department = require("../models/Department");
const authRouter = require("../routes/auth");
const { sendVerificationEmail } = require("../utils/email");

const withProductionEmailConfig = async (run, { frontendUrl = "https://academy.example" } = {}) => {
  const keys = [
    "NODE_ENV",
    "BREVO_API_KEY",
    "SENDGRID_API_KEY",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASS",
    "EMAIL_FROM",
    "FRONTEND_URL"
  ];
  const originalEnvironment = Object.fromEntries(
    keys.map((key) => [key, { exists: Object.prototype.hasOwnProperty.call(process.env, key), value: process.env[key] }])
  );
  process.env.NODE_ENV = "production";
  process.env.EMAIL_FROM = "noreply@example.test";
  delete process.env.BREVO_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  if (frontendUrl) process.env.FRONTEND_URL = frontendUrl;
  else delete process.env.FRONTEND_URL;

  try {
    await run();
  } finally {
    for (const key of keys) {
      if (originalEnvironment[key].exists) process.env[key] = originalEnvironment[key].value;
      else delete process.env[key];
    }
  }
};

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  return app;
};

test("production verification email fails explicitly when no real provider is configured", async () => {
  await withProductionEmailConfig(async () => {
    const result = await sendVerificationEmail("student@example.test", "token", "Student");
    assert.equal(result.success, false);
    assert.match(result.error, /Email delivery is not configured/);
  });
});

test("production verification email requires a frontend URL", async () => {
  await withProductionEmailConfig(async () => {
    const result = await sendVerificationEmail("student@example.test", "token", "Student");
    assert.equal(result.success, false);
    assert.match(result.error, /FRONTEND_URL must be configured/);
  }, { frontendUrl: "" });
});

test("registration verification email is accepted by Brevo over HTTPS", async () => {
  const originals = {
    post: axios.post,
    userFindOne: User.findOne,
    departmentFindById: Department.findById,
    userSave: User.prototype.save,
    consoleError: console.error
  };
  let brevoRequest;
  axios.post = async (url, body, options) => {
    brevoRequest = { url, body, options };
    return { status: 201, data: { messageId: "<verification-message-id>" } };
  };
  User.findOne = async () => null;
  Department.findById = async (departmentId) => ({ _id: departmentId });
  User.prototype.save = async function saveWithoutDatabase() { return this; };
  console.error = () => {};

  try {
    await withProductionEmailConfig(async () => {
      process.env.BREVO_API_KEY = "test-brevo-api-key";
      const response = await request(buildApp()).post("/api/auth/register").send({
        name: "Test Student",
        email: "student@example.test",
        password: "valid-password",
        confirmPassword: "valid-password",
        department: "507f1f77bcf86cd799439031",
        yearOfStudy: "HND2",
        semester: "First"
      });

      assert.equal(response.status, 201);
      assert.equal(response.body.success, true);
      assert.equal(response.body.emailSent, true);
      assert.equal(brevoRequest.url, "https://api.brevo.com/v3/smtp/email");
      assert.equal(brevoRequest.options.headers["api-key"], "test-brevo-api-key");
      assert.equal(brevoRequest.body.subject, "Verify Your Email - Academy Platform");
      assert.deepEqual(brevoRequest.body.to, [{ email: "student@example.test" }]);
      assert.match(brevoRequest.body.htmlContent, /https:\/\/academy\.example\/verify-email\?token=/);
    });
  } finally {
    axios.post = originals.post;
    User.findOne = originals.userFindOne;
    Department.findById = originals.departmentFindById;
    User.prototype.save = originals.userSave;
    console.error = originals.consoleError;
  }
});

test("unverified account can successfully request another verification email through Brevo", async () => {
  const originalPost = axios.post;
  const originalFindOne = User.findOne;
  let apiCalls = 0;
  axios.post = async () => {
    apiCalls += 1;
    return { status: 201, data: { messageId: "<resend-message-id>" } };
  };
  User.findOne = async () => ({
    email: "student@example.test",
    name: "Test Student",
    emailVerified: false,
    generateEmailVerificationToken() { return "synthetic-verification-token"; },
    async save() {}
  });

  try {
    await withProductionEmailConfig(async () => {
      process.env.BREVO_API_KEY = "test-brevo-api-key";
      const response = await request(buildApp())
        .post("/api/auth/send-verification-email")
        .send({ email: "student@example.test" });

      assert.equal(response.status, 200);
      assert.equal(response.body.success, true);
      assert.equal(apiCalls, 1);
    });
  } finally {
    axios.post = originalPost;
    User.findOne = originalFindOne;
  }
});

test("registration does not report delivery when Brevo rejects verification email", async () => {
  const originals = {
    post: axios.post,
    userFindOne: User.findOne,
    departmentFindById: Department.findById,
    userSave: User.prototype.save,
    consoleError: console.error
  };
  axios.post = async () => ({ status: 400, data: { message: "rejected" } });
  User.findOne = async () => null;
  Department.findById = async (departmentId) => ({ _id: departmentId });
  User.prototype.save = async function saveWithoutDatabase() { return this; };
  console.error = () => {};

  try {
    await withProductionEmailConfig(async () => {
      process.env.BREVO_API_KEY = "test-brevo-api-key";
      const response = await request(buildApp()).post("/api/auth/register").send({
        name: "Test Student",
        email: "student@example.test",
        password: "valid-password",
        confirmPassword: "valid-password",
        department: "507f1f77bcf86cd799439031",
        yearOfStudy: "HND2",
        semester: "First"
      });

      assert.equal(response.status, 201);
      assert.equal(response.body.success, true);
      assert.equal(response.body.emailSent, false);
      assert.match(response.body.message, /account was created, but the verification email could not be sent/i);
    });
  } finally {
    axios.post = originals.post;
    User.findOne = originals.userFindOne;
    Department.findById = originals.departmentFindById;
    User.prototype.save = originals.userSave;
    console.error = originals.consoleError;
  }
});

test("resend endpoint does not claim delivery when the email provider is unavailable", async () => {
  const originalFindOne = User.findOne;
  const originalError = console.error;
  User.findOne = async () => ({
    email: "student@example.test",
    name: "Test Student",
    emailVerified: false,
    generateEmailVerificationToken() { return "new-token"; },
    async save() {}
  });
  console.error = () => {};

  try {
    await withProductionEmailConfig(async () => {
      const response = await request(buildApp())
        .post("/api/auth/send-verification-email")
        .send({ email: "student@example.test" });

      assert.equal(response.status, 503);
      assert.equal(response.body.success, false);
      assert.match(response.body.message, /could not be sent/i);
    });
  } finally {
    User.findOne = originalFindOne;
    console.error = originalError;
  }
});
