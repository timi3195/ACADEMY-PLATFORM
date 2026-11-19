const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "admin-content-access-test-secret";
const { generateAccessToken } = require("../utils/token");
const contentController = require("../controllers/lecturerController");
let dashboardCalls = 0;
const originalGetDashboard = contentController.getDashboard;
contentController.getDashboard = (_req, res) => {
  dashboardCalls += 1;
  return res.json({ success: true, dashboard: { materialCount: 1 } });
};
const adminContentRoutes = require("../routes/lecturer");

test.after(() => {
  contentController.getDashboard = originalGetDashboard;
});

const buildApp = (role) => {
  const app = express();
  app.use(express.json());
  if (role) {
    const token = generateAccessToken("507f1f77bcf86cd799439011", { role });
    app.use((req, _res, next) => {
      req.headers.authorization = `Bearer ${token}`;
      next();
    });
  }
  app.use("/api/admin/content", adminContentRoutes);
  return app;
};

test("the existing admin content dashboard is mounted and available to administrators", async () => {
  dashboardCalls = 0;
  const response = await request(buildApp("admin")).get("/api/admin/content/dashboard");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.dashboard, { materialCount: 1 });
  assert.equal(dashboardCalls, 1);
});

test("students cannot access admin content or invoke content-management handlers", async () => {
  dashboardCalls = 0;
  const app = buildApp("student");
  const dashboard = await request(app).get("/api/admin/content/dashboard");
  const upload = await request(app).post("/api/admin/content/materials").send({
    title: "Not permitted"
  });

  assert.equal(dashboard.status, 403);
  assert.equal(upload.status, 403);
  assert.equal(dashboardCalls, 0);
});

test("admin content APIs reject unauthenticated requests", async () => {
  const response = await request(buildApp()).get("/api/admin/content/dashboard");
  assert.equal(response.status, 401);
});
