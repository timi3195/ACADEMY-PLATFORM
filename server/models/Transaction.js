const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  email: {
    type: String,
    required: true
  },

  amount: {
    type: Number,
    required: true
  },

  reference: {
    type: String,
    required: true,
    unique: true
  },

  status: {
    type: String,
    default: "pending"
  },

  plan: {
    type: String,
    enum: ["basic", "premium"],
    default: "premium"
  },

  semester: {
    type: String,
    enum: ["2024-1", "2024-2", "2025-1", "2025-2", "2026-1", "2026-2"],
    required: true
  },

  expiresAt: {
    type: Date,
    required: true
  },

  paidAt: Date,

  createdAt: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.model(
  "Transaction",
  transactionSchema
);