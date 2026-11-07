const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const User = require("../models/User");
const Department = require("../models/Department");
const authRouter = require("../routes/auth");
const { sendVerificationEmail } = require("../utils/email");

const withProductionEmailConfig = async (run, { frontendUrl = "https://academy.example" } = {}) => {
  const keys = [
    "NODE_ENV",
    "SENDGRID_API_KEY",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASS",
    "FRONTEND_URL"
  ];
  const originalEnvironment = Object.fromEntries(
    keys.map((key) => [key, { exists: Object.prototype.hasOwnProperty.call(process.env, key), value: process.env[key] }])
  );
  process.env.NODE_ENV = "production";
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

test("registration reports that the account exists when verification delivery fails", async () => {
  const originals = {
    userFindOne: User.findOne,
    departmentFindById: Department.findById,
    userSave: User.prototype.save,
    consoleError: console.error
  };
  User.findOne = async () => null;
  Department.findById = async (departmentId) => ({ _id: departmentId });
  User.prototype.save = async function saveWithoutDatabase() { return this; };
  console.error = () => {};

  try {
    await withProductionEmailConfig(async () => {
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
