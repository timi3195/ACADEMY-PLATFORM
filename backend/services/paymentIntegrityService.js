const Transaction = require("../models/Transaction");
const crypto = require("crypto");

const PROCESSING_LEASE_MS = 2 * 60 * 1000;

const createPaymentError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toMinorUnits = (amount) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return null;
  const minorUnits = Math.round(numericAmount * 100);
  return Math.abs(numericAmount * 100 - minorUnits) < 0.000001 ? minorUnits : null;
};

const claimPendingTransaction = async (reference, userId = null) => {
  if (typeof reference !== "string" || !reference.trim()) {
    throw createPaymentError("Payment reference is required", 400);
  }

  const existing = await Transaction.findOne({ reference });
  if (!existing) {
    throw createPaymentError("Pending payment transaction not found", 404);
  }
  if (userId && String(existing.user) !== String(userId)) {
    throw createPaymentError("Payment reference does not belong to this user", 403);
  }
  if (existing.status === "success") {
    return { transaction: existing, alreadyProcessed: true };
  }
  if (existing.status !== "pending" && existing.status !== "processing") {
    throw createPaymentError("Payment transaction is no longer payable", 409);
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const query = {
    reference,
    $or: [
      { status: "pending" },
      {
        status: "processing",
        processingStartedAt: { $lte: staleBefore }
      },
      {
        status: "processing",
        processingStartedAt: { $exists: false },
        createdAt: { $lte: staleBefore }
      },
      {
        status: "processing",
        processingStartedAt: null,
        createdAt: { $lte: staleBefore }
      }
    ]
  };
  if (userId) query.user = userId;
  const processingToken = crypto.randomUUID();
  const transaction = await Transaction.findOneAndUpdate(
    query,
    {
      $set: {
        status: "processing",
        processingStartedAt: now,
        processingToken,
        failureReason: ""
      }
    },
    { new: true }
  );
  if (transaction) return { transaction, alreadyProcessed: false };

  const latest = await Transaction.findOne({ reference });
  if (latest && userId && String(latest.user) !== String(userId)) {
    throw createPaymentError("Payment reference does not belong to this user", 403);
  }
  if (latest?.status === "success") {
    return { transaction: latest, alreadyProcessed: true };
  }
  if (latest?.status === "processing") {
    throw createPaymentError("Payment transaction is already being processed", 409);
  }
  throw createPaymentError("Payment transaction is no longer payable", 409);
};

const validatePaystackPayment = (transaction, paymentData, expectedReference) => {
  if (!transaction || !paymentData || typeof paymentData !== "object" || Array.isArray(paymentData)) {
    throw createPaymentError("Paystack returned malformed transaction data", 400);
  }
  if (paymentData.status !== "success") {
    throw createPaymentError("Payment was not successful", 400);
  }
  if (typeof paymentData.reference !== "string" || paymentData.reference !== expectedReference ||
      paymentData.reference !== transaction.reference) {
    throw createPaymentError("Paystack transaction reference does not match", 400);
  }

  const expectedAmount = toMinorUnits(transaction.amount);
  const verifiedAmount = paymentData.amount;
  if (expectedAmount === null || !Number.isSafeInteger(verifiedAmount) || verifiedAmount !== expectedAmount) {
    throw createPaymentError("Paystack payment amount does not match the pending transaction", 400);
  }

  const expectedCurrency = String(transaction.currency || "").trim().toUpperCase();
  const verifiedCurrency = typeof paymentData.currency === "string"
    ? paymentData.currency.trim().toUpperCase()
    : "";
  if (!expectedCurrency || verifiedCurrency !== expectedCurrency) {
    throw createPaymentError("Paystack payment currency does not match the pending transaction", 400);
  }

  const customerEmail = paymentData.customer?.email;
  if (customerEmail && transaction.email &&
      String(customerEmail).trim().toLowerCase() !== String(transaction.email).trim().toLowerCase()) {
    throw createPaymentError("Paystack customer does not match the pending transaction", 400);
  }
};

const markTransactionFailed = async (transaction, reason) => {
  if (!transaction?._id) return;
  const filter = { _id: transaction._id, status: "processing" };
  if (transaction.processingToken) filter.processingToken = transaction.processingToken;
  await Transaction.findOneAndUpdate(
    filter,
    {
      $set: {
        status: "failed",
        failureReason: String(reason || "Payment verification failed").slice(0, 250),
        processingStartedAt: null,
        processingToken: null
      }
    },
    { new: true }
  );
};

const releaseTransactionForRetry = async (transaction, reason) => {
  if (!transaction?._id) return null;
  const filter = { _id: transaction._id, status: "processing" };
  if (transaction.processingToken) filter.processingToken = transaction.processingToken;
  return Transaction.findOneAndUpdate(
    filter,
    {
      $set: {
        status: "pending",
        failureReason: String(reason || "Payment verification will be retried").slice(0, 250),
        processingStartedAt: null,
        processingToken: null
      }
    },
    { new: true }
  );
};

const markTransactionSuccessful = async (transaction, paymentData, additionalFields = {}) => {
  const update = {
    status: "success",
    paidAt: new Date(),
    processingStartedAt: null,
    processingToken: null,
    ...additionalFields
  };
  const paystackId = Number(paymentData?.id);
  if (Number.isSafeInteger(paystackId) && paystackId > 0) {
    update.paystackTransactionId = paystackId;
  }

  const filter = { _id: transaction._id, status: "processing" };
  if (transaction.processingToken) filter.processingToken = transaction.processingToken;
  const completed = await Transaction.findOneAndUpdate(
    filter,
    { $set: update },
    { new: true }
  );
  if (!completed) {
    throw createPaymentError("Payment transaction could not be completed", 409);
  }
  return completed;
};

module.exports = {
  claimPendingTransaction,
  markTransactionFailed,
  releaseTransactionForRetry,
  markTransactionSuccessful,
  toMinorUnits,
  validatePaystackPayment
};
