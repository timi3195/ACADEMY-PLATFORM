const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
const app = require("../app");

test("app initializes Passport without Express session middleware", async () => {
  const middlewareNames = app.router.stack.map(({ handle }) => handle.name);

  assert.ok(middlewareNames.includes("initialize"));
  assert.ok(!middlewareNames.includes("session"));
  assert.ok(!middlewareNames.includes("authenticate"));

  app.get("/__test/no-express-session", (req, res) => {
    res.json({
      hasSession: req.session !== undefined,
      passportInitialized: Boolean(req._passport)
    });
  });

  const response = await request(app).get("/__test/no-express-session");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    hasSession: false,
    passportInitialized: true
  });
});
