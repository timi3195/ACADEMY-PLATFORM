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
    enum: ["basic", "premium", "material"],
    default: "premium"
  },

  paymentType: {
    type: String,
    enum: ["semester", "material"],
    default: "semester"
  },

  material: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "File",
    default: null
  },

  materialPrice: {
    type: Number,
    default: 0
  },

  discount: {
    type: Number,
    default: 0
  },

  semester: {
    type: String,
    enum: ["2024-1", "2024-2", "2025-1", "2025-2", "2026-1", "2026-2"],
    default: null
  },

  expiresAt: {
    type: Date,
    default: null
  },

  paidAt: Date,

  createdAt: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.models.Transaction || mongoose.model(
  "Transaction",
  transactionSchema
);