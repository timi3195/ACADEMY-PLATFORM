const mongoose = require("mongoose");

const workerLockSchema = new mongoose.Schema({
  _id: { type: String, default: "curriculum-import-worker" },
  leaseToken: {
    type: String,
    default: null,
    maxlength: 36,
    match: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  },
  leaseExpiresAt: { type: Date, default: null },
  heartbeatAt: { type: Date, default: null }
}, {
  collection: "curriculum_import_worker_locks",
  versionKey: false
});

module.exports = mongoose.models.CurriculumImportWorkerLock ||
  mongoose.model("CurriculumImportWorkerLock", workerLockSchema);
