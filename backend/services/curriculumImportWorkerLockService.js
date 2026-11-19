const CurriculumImportWorkerLock = require("../models/CurriculumImportWorkerLock");
const limits = require("../config/curriculumExtractionLimits");

const LOCK_ID = "curriculum-import-worker";
const LEASE_TOKEN_PATTERN = "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$";

const isDuplicateKeyError = (error) =>
  error?.code === 11000 || error?.code === 11001;

const validLockExpression = {
  $and: [
    { $eq: [{ $type: "$leaseToken" }, "string"] },
    {
      $regexMatch: {
        input: {
          $convert: {
            input: "$leaseToken",
            to: "string",
            onError: "",
            onNull: ""
          }
        },
        regex: LEASE_TOKEN_PATTERN
      }
    },
    { $eq: [{ $type: "$leaseExpiresAt" }, "date"] },
    { $eq: [{ $type: "$heartbeatAt" }, "date"] }
  ]
};

const acquireWorkerLock = async ({
  leaseToken,
  WorkerLockModel = CurriculumImportWorkerLock
} = {}) => {
  try {
    return await WorkerLockModel.findOneAndUpdate({
      _id: LOCK_ID,
      $expr: {
        $or: [
          { $not: [validLockExpression] },
          { $lte: ["$leaseExpiresAt", "$$NOW"] }
        ]
      }
    }, [{
      $set: {
        leaseToken,
        leaseExpiresAt: { $add: ["$$NOW", limits.processingLeaseMs] },
        heartbeatAt: "$$NOW"
      }
    }], {
      new: true,
      upsert: true,
      runValidators: false,
      timestamps: false
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
};

const renewWorkerLock = async ({
  leaseToken,
  WorkerLockModel = CurriculumImportWorkerLock
} = {}) => {
  const record = await WorkerLockModel.findOneAndUpdate({
    _id: LOCK_ID,
    leaseToken,
    $expr: {
      $and: [
        validLockExpression,
        { $gt: ["$leaseExpiresAt", "$$NOW"] }
      ]
    }
  }, [{
    $set: {
      leaseExpiresAt: { $add: ["$$NOW", limits.processingLeaseMs] },
      heartbeatAt: "$$NOW"
    }
  }], {
    new: true,
    projection: { _id: 1 },
    timestamps: false
  });
  return Boolean(record);
};

const releaseWorkerLock = async ({
  leaseToken,
  WorkerLockModel = CurriculumImportWorkerLock
} = {}) => {
  const result = await WorkerLockModel.updateOne({
    _id: LOCK_ID,
    leaseToken
  }, {
    $set: {
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null
    }
  }, { timestamps: false });
  return Boolean(result.modifiedCount);
};

module.exports = {
  LOCK_ID,
  acquireWorkerLock,
  releaseWorkerLock,
  renewWorkerLock
};
