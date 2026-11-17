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

test("lecturer academic course and material routes remain mounted", async () => {
  const courses = await request(app).get("/api/lecturer/courses");
  const materials = await request(app).get("/api/lecturer/materials");

  assert.equal(courses.status, 401);
  assert.equal(materials.status, 401);
});
