const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema({
  lecturer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  bankName: {
    type: String,
    required: true
  },
  accountNumber: {
    type: String,
    required: true
  },
  accountName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ["pending", "approved", "paid", "rejected"],
    default: "pending"
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  approvedAt: Date,
  paidAt: Date,
  rejectedAt: Date,
  notes: {
    type: String,
    default: ""
  },
  metadata: {
    type: Object,
    default: {}
  }
}, { timestamps: true });

withdrawalSchema.index({ lecturer: 1, status: 1 });

module.exports = mongoose.models.Withdrawal || mongoose.model("Withdrawal", withdrawalSchema);
