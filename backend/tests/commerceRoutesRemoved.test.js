const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../app");

test("marketplace, purchase, and payment endpoints are not mounted", async () => {
  const removedEndpoints = [
    ["get", "/api/marketplace"],
    ["post", "/api/marketplace"],
    ["get", "/api/library"],
    ["get", "/api/purchase"],
    ["post", "/api/payments/initialize"],
    ["post", "/api/payments/webhook"],
    ["get", "/api/lecturer/sales"],
    ["get", "/api/lecturer/earnings"],
    ["post", "/api/lecturer/withdraw"],
    ["get", "/api/lecturer/payment/settings"]
  ];

  for (const [method, path] of removedEndpoints) {
    const response = await request(app)[method](path);
    assert.equal(response.status, 404, `${method.toUpperCase()} ${path} should be unavailable`);
  }
});

test("legacy lecturer routes remain unavailable while admin content stays protected", async () => {
  const courses = await request(app).get("/api/lecturer/courses");
  const materials = await request(app).get("/api/lecturer/materials");
  const adminContent = await request(app).get("/api/admin/content/dashboard");

  assert.equal(courses.status, 404);
  assert.equal(materials.status, 404);
  assert.equal(adminContent.status, 401);
});
