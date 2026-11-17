const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const express = require("express");
const request = require("supertest");
const axios = require("axios");

process.env.JWT_SECRET = process.env.JWT_SECRET || "free-student-access-test-secret";
process.env.PAYSTACK_SECRET_KEY = "free-student-access-webhook-test-secret";

const { generateAccessToken } = require("../utils/token");
const paymentsRouter = require("../routes/payments");
const purchaseRouter = require("../routes/purchase");
const marketplaceRouter = require("../routes/marketplace");
const lecturerRouter = require("../routes/lecturer");
const lecturerService = require("../services/lecturerService");
const storageService = require("../services/storageService");
const File = require("../models/File");
const Transaction = require("../models/Transaction");
const User = require("../models/User");

const STUDENT_ID = "507f1f77bcf86cd799439011";
const LECTURER_ID = "507f1f77bcf86cd799439013";
const MESSAGE = "Payments and marketplace commerce are unavailable in this release.";
const withApprovedLecturer = async (run) => {
  const originalFindById = User.findById;
  User.findById = () => ({
    select: async () => ({ role: "lecturer", lecturerStatus: "approved" })
  });
  try {
    await run();
  } finally {
    User.findById = originalFindById;
  }
};

const buildApp = (userId = STUDENT_ID, role = "student") => {
  const app = express();
  app.use(express.json({
    verify: (req, res, buffer) => {
      if (req.originalUrl === "/api/payments/webhook") {
        req.rawBody = Buffer.from(buffer);
      }
    }
  }));
  const token = generateAccessToken(userId, { email: "user@example.test", role });
  app.use((req, res, next) => {
    req.headers.authorization = `Bearer ${token}`;
    next();
  });
  app.use("/api/payments", paymentsRouter);
  app.use("/api/purchase", purchaseRouter);
  app.use("/api/marketplace", marketplaceRouter);
  app.use("/api/lecturer", lecturerRouter);
  return app;
};

test("payment and material-purchase APIs cannot initialize or verify commerce", async () => {
  const original = {
    transactionCreate: Transaction.create,
    transactionFindOne: Transaction.findOne,
    transactionUpdate: Transaction.findOneAndUpdate,
    userFindById: User.findById,
    axiosGet: axios.get,
    axiosPost: axios.post
  };
  let sideEffects = 0;
  for (const [object, method] of [
    [Transaction, "create"],
    [Transaction, "findOne"],
    [Transaction, "findOneAndUpdate"],
    [User, "findById"],
    [axios, "get"],
    [axios, "post"]
  ]) {
    object[method] = async () => {
      sideEffects += 1;
      throw new Error("Disabled commerce must not cause payment side effects");
    };
  }

  try {
    const app = buildApp();
    const endpoints = [
      () => request(app).post("/api/payments/initialize").send({ plan: "premium" }),
      () => request(app).get("/api/payments/verify/reference"),
      () => request(app).post("/api/purchase/marketplace/materials/material/purchase"),
      () => request(app).post("/api/purchase/marketplace/materials/material/verify"),
      () => request(app).post("/api/marketplace/materials/material/purchase/initialize"),
      () => request(app).get("/api/marketplace/materials/material/purchase/verify/reference")
    ];

    for (const invoke of endpoints) {
      const response = await invoke();
      assert.equal(response.status, 410);
      assert.equal(response.body.code, "COMMERCE_UNAVAILABLE");
      assert.equal(response.body.message, MESSAGE);
    }
    assert.equal(sideEffects, 0);
  } finally {
    Transaction.create = original.transactionCreate;
    Transaction.findOne = original.transactionFindOne;
    Transaction.findOneAndUpdate = original.transactionUpdate;
    User.findById = original.userFindById;
    axios.get = original.axiosGet;
    axios.post = original.axiosPost;
  }
});

test("signed Paystack webhook events are acknowledged without creating entitlements", async () => {
  const original = {
    create: Transaction.create,
    findOne: Transaction.findOne,
    findOneAndUpdate: Transaction.findOneAndUpdate,
    findById: User.findById
  };
  let databaseCalls = 0;
  for (const method of ["create", "findOne", "findOneAndUpdate"]) {
    Transaction[method] = async () => {
      databaseCalls += 1;
      throw new Error("Commerce transaction processing must remain disabled");
    };
  }
  User.findById = async () => {
    databaseCalls += 1;
    throw new Error("Webhook must not update subscription access");
  };

  try {
    const app = buildApp();
    const payload = JSON.stringify({
      event: "charge.success",
      data: { status: "success", reference: "verified-test-payment" }
    });
    const signature = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(payload)
      .digest("hex");

    const response = await request(app)
      .post("/api/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(payload);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      success: true,
      ignored: true,
      commerceDisabled: true
    });
    assert.equal(databaseCalls, 0);
  } finally {
    Transaction.create = original.create;
    Transaction.findOne = original.findOne;
    Transaction.findOneAndUpdate = original.findOneAndUpdate;
    User.findById = original.findById;
  }
});

test("invalid Paystack webhook signatures are rejected", async () => {
  const response = await request(buildApp())
    .post("/api/payments/webhook")
    .set("Content-Type", "application/json")
    .set("x-paystack-signature", "invalid")
    .send(JSON.stringify({ event: "charge.success", data: { status: "success" } }));

  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Invalid Paystack webhook signature");
});

test("lecturer educational uploads continue to work as free materials", async () => {
  const originalCreate = lecturerService.createLecturerMaterial;
  let uploadedPath;
  let serviceCalls = 0;
  lecturerService.createLecturerMaterial = async ({ file }) => {
    serviceCalls += 1;
    uploadedPath = file.path;
    return {
      _id: "507f1f77bcf86cd799439099",
      price: 0,
      isFree: true,
      isPaid: false,
      isPremium: false
    };
  };

  try {
    await withApprovedLecturer(async () => {
      const response = await request(buildApp(LECTURER_ID, "lecturer"))
        .post("/api/lecturer/materials")
        .field("title", "Course book")
        .field("description", "A free course book")
        .field("course", "MATH101")
        .field("materialType", "Book")
        .attach("file", Buffer.from("educational material"), "course-book.pdf");

      assert.equal(response.status, 201, JSON.stringify(response.body));
      assert.equal(serviceCalls, 1);
      assert.equal(response.body.material.isFree, true);
      assert.equal(response.body.material.isPaid, false);
    });
  } finally {
    lecturerService.createLecturerMaterial = originalCreate;
    if (uploadedPath) await fs.unlink(uploadedPath);
  }
});

test("lecturer paid selling operations are unavailable", async () => {
  await withApprovedLecturer(async () => {
    const app = buildApp(LECTURER_ID, "lecturer");
    const response = await request(app)
      .post("/api/lecturer/materials")
      .field("title", "Paid book")
      .field("description", "A paid course book")
      .field("course", "MATH101")
      .field("materialType", "Book")
      .field("price", "500")
      .attach("file", Buffer.from("paid material"), "paid-book.pdf");

    assert.equal(response.status, 410);
    assert.equal(response.body.code, "COMMERCE_UNAVAILABLE");
    assert.equal(response.body.message, MESSAGE);
  });
});

test("lecturer educational material create and update always persist free access fields", async () => {
  const original = {
    userFindById: User.findById,
    fileCreate: File.create,
    fileFindById: File.findById,
    uploadUploadedFile: storageService.uploadUploadedFile
  };
  let createdData;
  const material = {
    _id: "507f1f77bcf86cd799439099",
    lecturer: LECTURER_ID,
    isDeleted: false,
    price: 500,
    isFree: false,
    isPaid: true,
    isPremium: true,
    async save() { return this; }
  };
  User.findById = () => ({
    select: () => ({ lean: async () => ({ name: "Lecturer" }) })
  });
  storageService.uploadUploadedFile = async () => ({ storageProvider: "local-disk" });
  File.create = async (data) => {
    createdData = data;
    return { ...data, async save() { return this; } };
  };
  File.findById = async () => material;

  try {
    await lecturerService.createLecturerMaterial({
      user: { id: LECTURER_ID, email: "lecturer@example.test" },
      body: { title: "Course book", price: "500", isPaid: "true" },
      file: { originalname: "course-book.pdf" }
    });
    assert.equal(createdData.price, 0);
    assert.equal(createdData.isFree, true);
    assert.equal(createdData.isPaid, false);
    assert.equal(createdData.isPremium, false);

    await lecturerService.updateLecturerMaterial({
      user: { id: LECTURER_ID },
      materialId: material._id,
      body: { price: "750", isPaid: "true" }
    });
    assert.equal(material.price, 0);
    assert.equal(material.isFree, true);
    assert.equal(material.isPaid, false);
    assert.equal(material.isPremium, false);
  } finally {
    User.findById = original.userFindById;
    File.create = original.fileCreate;
    File.findById = original.fileFindById;
    storageService.uploadUploadedFile = original.uploadUploadedFile;
  }
});

test("lecturer marketplace create and update routes are unavailable", async () => {
  await withApprovedLecturer(async () => {
    const app = buildApp(LECTURER_ID, "lecturer");
    const create = await request(app).post("/api/marketplace/materials");
    const update = await request(app).put("/api/marketplace/materials/material-id");

    for (const response of [create, update]) {
      assert.equal(response.status, 410);
      assert.equal(response.body.code, "COMMERCE_UNAVAILABLE");
      assert.equal(response.body.message, MESSAGE);
    }
  });
});
