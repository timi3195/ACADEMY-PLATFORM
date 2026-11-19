const test = require("node:test");
const assert = require("node:assert/strict");
const limits = require("../config/curriculumExtractionLimits");
const lockService = require("../services/curriculumImportWorkerLockService");
const { applyUpdate, matches } = require("./helpers/curriculumJobPersistenceFake");

class WorkerLockFake {
  constructor(serverNow = new Date()) {
    this.record = null;
    this.serverNow = new Date(serverNow);
  }

  async findOneAndUpdate(filter, update, options) {
    if (this.record && matches(this.record, filter, this.serverNow)) {
      applyUpdate(this.record, update, this.serverNow);
      return this.record;
    }
    if (!options.upsert) return null;
    if (!this.record) {
      this.record = { _id: lockService.LOCK_ID };
      applyUpdate(this.record, update, this.serverNow);
      return this.record;
    }
    const error = new Error("duplicate key");
    error.code = 11000;
    throw error;
  }

  async updateOne(filter, update) {
    if (!this.record || !matches(this.record, filter, this.serverNow)) return { modifiedCount: 0 };
    applyUpdate(this.record, update, this.serverNow);
    return { modifiedCount: 1 };
  }
}

test("singleton worker lock permits one owner and fencing prevents stale renewal/release", async () => {
  const model = new WorkerLockFake();
  const start = new Date("2025-01-01T00:00:00.000Z");
  model.serverNow = new Date(start);
  const ownerA = "11111111-1111-4111-8111-111111111111";
  const ownerB = "22222222-2222-4222-8222-222222222222";

  assert.ok(await lockService.acquireWorkerLock({
    leaseToken: ownerA,
    WorkerLockModel: model,
    now: start
  }));
  assert.equal(await lockService.acquireWorkerLock({
    leaseToken: ownerB,
    WorkerLockModel: model,
    now: start
  }), null);
  assert.equal(await lockService.renewWorkerLock({
    leaseToken: ownerB,
    WorkerLockModel: model,
    now: new Date(start.getTime() + 1)
  }), false);
  model.serverNow = new Date(start.getTime() + 1);
  assert.equal(await lockService.renewWorkerLock({
    leaseToken: ownerA,
    WorkerLockModel: model,
    now: new Date(start.getTime() + 1)
  }), true);
  assert.equal(
    model.record.leaseExpiresAt.getTime(),
    start.getTime() + 1 + limits.processingLeaseMs
  );
  assert.equal(await lockService.releaseWorkerLock({
    leaseToken: ownerB,
    WorkerLockModel: model
  }), false);
  assert.equal(await lockService.releaseWorkerLock({
    leaseToken: ownerA,
    WorkerLockModel: model
  }), true);
});

test("expired singleton lock can be atomically acquired by a new worker", async () => {
  const model = new WorkerLockFake();
  const start = new Date("2025-01-01T00:00:00.000Z");
  model.serverNow = new Date(start);
  const ownerA = "11111111-1111-4111-8111-111111111111";
  const ownerB = "22222222-2222-4222-8222-222222222222";
  await lockService.acquireWorkerLock({
    leaseToken: ownerA,
    WorkerLockModel: model,
    now: start
  });
  const expiredAt = new Date(start.getTime() + limits.processingLeaseMs);
  model.serverNow = expiredAt;
  const lock = await lockService.acquireWorkerLock({
    leaseToken: ownerB,
    WorkerLockModel: model,
    now: expiredAt
  });
  assert.equal(lock.leaseToken, ownerB);
});

test("concurrent worker startup grants exactly one singleton lock", async () => {
  const model = new WorkerLockFake();
  const start = new Date("2025-01-01T00:00:00.000Z");
  model.serverNow = new Date(start);
  const owners = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"
  ];
  const locks = await Promise.all(owners.map((leaseToken) =>
    lockService.acquireWorkerLock({
      leaseToken,
      WorkerLockModel: model,
      now: start
    })));
  assert.equal(locks.filter(Boolean).length, 1);
});

test("server time drives lock expiration even when caller clocks disagree", async () => {
  const start = new Date("2025-01-01T00:00:00.000Z");
  const model = new WorkerLockFake(start);
  const ownerA = "11111111-1111-4111-8111-111111111111";
  const ownerB = "22222222-2222-4222-8222-222222222222";
  await lockService.acquireWorkerLock({
    leaseToken: ownerA,
    WorkerLockModel: model,
    now: new Date("2035-01-01T00:00:00.000Z")
  });
  assert.equal(model.record.leaseExpiresAt.getTime(), start.getTime() + limits.processingLeaseMs);
  model.serverNow = new Date(start.getTime() + limits.processingLeaseMs);
  assert.ok(await lockService.acquireWorkerLock({
    leaseToken: ownerB,
    WorkerLockModel: model,
    now: new Date("2020-01-01T00:00:00.000Z")
  }));
  assert.equal(model.record.leaseToken, ownerB);
});

test("an expired worker lock cannot be renewed", async () => {
  const start = new Date("2025-01-01T00:00:00.000Z");
  const model = new WorkerLockFake(start);
  const owner = "11111111-1111-4111-8111-111111111111";
  await lockService.acquireWorkerLock({ leaseToken: owner, WorkerLockModel: model });
  model.serverNow = new Date(start.getTime() + limits.processingLeaseMs);
  assert.equal(await lockService.renewWorkerLock({ leaseToken: owner, WorkerLockModel: model }), false);
});
