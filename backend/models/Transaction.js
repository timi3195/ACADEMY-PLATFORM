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

  // Payment split information (for material purchases)
  lecturer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  platformFee: {
    type: Number,
    default: 0,
    description: "10% platform commission"
  },

  lecturerAmount: {
    type: Number,
    default: 0,
    description: "90% lecturer earnings"
  },

  currency: {
    type: String,
    default: "NGN"
  },

  paymentProvider: {
    type: String,
    enum: ["paystack", "other"],
    default: "paystack"
  },

  // Student information snapshot at purchase time
  studentNameAtPurchase: {
    type: String,
    default: ""
  },

  studentMatricAtPurchase: {
    type: String,
    default: ""
  },

  // Additional audit fields
  paystackTransactionId: {
    type: Number,
    default: null
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