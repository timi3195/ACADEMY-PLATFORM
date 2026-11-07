const express = require("express");
const router = express.Router();
const axios = require("axios");
const crypto = require("crypto");
const protect = require("../config/middleware/authMiddleware");

const User = require("../models/User");
const Transaction = require("../models/Transaction");
const paymentIntegrity = require("../services/paymentIntegrityService");

const DEFAULT_PAYSTACK_CURRENCY = (process.env.PAYSTACK_CURRENCY || "NGN").toUpperCase();
const SUBSCRIPTION_PRICES = Object.freeze({ basic: 7500, premium: 15000 });
const AVAILABLE_SEMESTERS = new Set(["2024-1", "2024-2", "2025-1", "2025-2", "2026-1", "2026-2"]);

// Verify environment variables on startup
if (!process.env.PAYSTACK_SECRET_KEY) {
  console.error("❌ PAYSTACK_SECRET_KEY not found in environment variables");
}

const validateCurrency = (currency) => {
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (!normalizedCurrency || normalizedCurrency !== DEFAULT_PAYSTACK_CURRENCY) {
    const error = new Error(`Unsupported payment currency: ${currency || "missing"}. Expected ${DEFAULT_PAYSTACK_CURRENCY}.`);
    error.statusCode = 400;
    throw error;
  }

  return normalizedCurrency;
};

// Helper function to get semester expiration date
const getSemesterExpirationDate = (semester) => {
  const [year, sem] = semester.split("-");
  const semesterYear = parseInt(year);
  const semesterNum = parseInt(sem);
  
  // Semester 1 ends June 30, Semester 2 ends December 31
  if (semesterNum === 1) {
    return new Date(`${semesterYear}-06-30`);
  } else {
    return new Date(`${semesterYear}-12-31`);
  }
};

const applySubscriptionAccess = async (transaction) => {
  if (transaction.status !== "success" ||
      transaction.paymentType !== "semester" ||
      !Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PRICES, transaction.plan) ||
      Number(transaction.amount) !== SUBSCRIPTION_PRICES[transaction.plan] ||
      !AVAILABLE_SEMESTERS.has(transaction.semester)) {
    const error = new Error("Successful subscription transaction is invalid");
    error.statusCode = 400;
    throw error;
  }

  const user = await User.findById(transaction.user);
  if (!user || String(user._id) !== String(transaction.user) ||
      String(user.email).trim().toLowerCase() !== String(transaction.email).trim().toLowerCase()) {
    const error = new Error("Pending transaction user does not match");
    error.statusCode = 403;
    throw error;
  }

  const expiresAt = transaction.expiresAt || getSemesterExpirationDate(transaction.semester);
  const alreadyApplied = user.plan === transaction.plan &&
    user.subscriptionType === transaction.plan &&
    user.subscriptionSemester === transaction.semester &&
    user.subscriptionExpiresAt &&
    new Date(user.subscriptionExpiresAt).getTime() === new Date(expiresAt).getTime();

  if (!alreadyApplied) {
    user.plan = transaction.plan;
    user.subscriptionType = transaction.plan;
    user.subscriptionSemester = transaction.semester;
    user.subscriptionExpiresAt = expiresAt;
    await user.save();
  }

  return user;
};

// INITIALIZE PAYMENT - Semester based (Protected route)
router.post("/initialize", protect, async (req, res) => {
  let pendingTransaction;
  try {
    const { semester, plan, currency } = req.body || {};
    const normalizedPlan = String(plan || "").trim().toLowerCase();
    const validatedCurrency = validateCurrency(currency || DEFAULT_PAYSTACK_CURRENCY);
    if (!Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PRICES, normalizedPlan)) {
      return res.status(400).json({ success: false, message: "A valid subscription plan is required" });
    }
    if (!AVAILABLE_SEMESTERS.has(semester)) {
      return res.status(400).json({ success: false, message: "A valid semester is required" });
    }

    const user = await User.findById(req.user.id);
    const email = user?.email;
    if (!user || !email) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecretKey) {
      return res.status(500).json({
        success: false,
        message: "Payment configuration error. Please try again."
      });
    }

    const expectedAmount = SUBSCRIPTION_PRICES[normalizedPlan];
    const reference = `academy_${crypto.randomUUID()}`;
    pendingTransaction = await Transaction.create({
      user: user._id,
      email: user.email,
      amount: expectedAmount,
      currency: validatedCurrency,
      reference,
      status: "pending",
      plan: normalizedPlan,
      paymentType: "semester",
      semester,
      paymentProvider: "paystack"
    });

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: paymentIntegrity.toMinorUnits(expectedAmount),
        currency: validatedCurrency,
        reference,
        callback_url: `${frontendUrl}/upgrade`,
        metadata: {
          semester,
          plan: normalizedPlan,
          userId: String(user._id),
          paymentType: "semester"
        }
      },
      {
        headers: {
          Authorization: "Bearer " + paystackSecretKey,
          "Content-Type": "application/json"
        }
      }
    );

    const paystackData = response.data?.status === true ? response.data.data : null;
    if (!paystackData?.authorization_url || paystackData.reference !== reference) {
      const error = new Error("Paystack returned an invalid initialization response");
      error.statusCode = 502;
      throw error;
    }

    return res.json({
      success: true,
      data: paystackData
    });
  } catch (err) {
    if (pendingTransaction?._id) {
      await Transaction.findOneAndUpdate(
        { _id: pendingTransaction._id, status: "pending" },
        { $set: { status: "failed", failureReason: "Payment initialization failed" } }
      );
    }
    console.error("Payment initialization error:", err.message);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.response?.data?.message || err.message || "Unable to start payment. Try again."
    });
  }
});

// VERIFY PAYMENT - Update user with semester subscription
router.get("/verify/:reference", protect, async (req, res) => {
  let transaction;
  let paymentVerified = false;
  try {
    const reference = req.params.reference;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackSecretKey) {
      return res.status(500).json({
        success: false,
        message: "Payment configuration error"
      });
    }

    const claim = await paymentIntegrity.claimPendingTransaction(reference, req.user.id);
    transaction = claim.transaction;
    if (claim.alreadyProcessed) {
      if (transaction.paymentType !== "semester") {
        return res.status(409).json({ success: false, message: "Payment reference is not a subscription transaction" });
      }
      const user = await applySubscriptionAccess(transaction);
      return res.json({
        success: true,
        message: "Already verified",
        transaction,
        user
      });
    }

    let response;
    try {
      response = await axios.get(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          headers: {
            Authorization: "Bearer " + paystackSecretKey
          }
        }
      );
    } catch (error) {
      error.retryablePaymentError = true;
      throw error;
    }

    if (response.data?.status !== true || !response.data?.data) {
      const error = new Error("Paystack verification response is invalid");
      error.statusCode = 502;
      error.retryablePaymentError = true;
      throw error;
    }
    const paymentData = response.data.data;
    paymentIntegrity.validatePaystackPayment(transaction, paymentData, reference);
    if (transaction.paymentType !== "semester" ||
        !Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PRICES, transaction.plan) ||
        Number(transaction.amount) !== SUBSCRIPTION_PRICES[transaction.plan] ||
        !AVAILABLE_SEMESTERS.has(transaction.semester)) {
      const error = new Error("Pending subscription transaction is invalid");
      error.statusCode = 400;
      throw error;
    }

    paymentVerified = true;
    const expiresAt = getSemesterExpirationDate(transaction.semester);
    transaction = await paymentIntegrity.markTransactionSuccessful(transaction, paymentData, { expiresAt });
    const user = await applySubscriptionAccess(transaction);

    return res.json({
      success: true,
      message: "Payment verified - Semester subscription activated",
      transaction,
      user
    });
  } catch (err) {
    if (transaction?.status === "processing") {
      if (err.retryablePaymentError || paymentVerified) {
        await paymentIntegrity.releaseTransactionForRetry(transaction, err.message);
      } else {
        await paymentIntegrity.markTransactionFailed(transaction, err.message);
      }
    }
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.response?.data?.message || err.message
    });
  }
});

// GET USER SUBSCRIPTION STATUS
router.get("/status/:userId", protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const actingUserId = req.user?.id || req.user?._id;

    if (req.user.role !== "admin" && String(actingUserId) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this subscription status."
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const isActive = user.subscriptionExpiresAt && new Date() < user.subscriptionExpiresAt;

    return res.json({
      success: true,
      subscription: {
        type: user.subscriptionType,
        semester: user.subscriptionSemester,
        expiresAt: user.subscriptionExpiresAt,
        isActive
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let transaction;
  let paymentVerified = false;
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers["x-paystack-signature"];
    const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);

    if (!secret || typeof signature !== "string" || !rawBody) {
      return res.status(401).json({ success: false, message: "Invalid Paystack webhook signature" });
    }

    const expectedSignature = crypto.createHmac("sha512", secret).update(rawBody).digest();
    const suppliedSignature = /^[a-f\d]{128}$/i.test(signature)
      ? Buffer.from(signature, "hex")
      : Buffer.alloc(0);
    if (suppliedSignature.length !== expectedSignature.length ||
        !crypto.timingSafeEqual(expectedSignature, suppliedSignature)) {
      return res.status(401).json({ success: false, message: "Invalid Paystack webhook signature" });
    }

    const payload = JSON.parse(rawBody.toString("utf8"));
    const event = payload.event;
    const data = payload.data || {};

    if (event !== "charge.success") {
      return res.json({ success: true, ignored: true, event });
    }

    if (data.status !== "success" || typeof data.reference !== "string" || !data.reference) {
      return res.status(400).json({ success: false, message: "Invalid successful payment event" });
    }

    const claim = await paymentIntegrity.claimPendingTransaction(data.reference);
    transaction = claim.transaction;
    if (claim.alreadyProcessed) {
      if (transaction.paymentType === "semester") {
        await applySubscriptionAccess(transaction);
      } else if (transaction.paymentType === "material") {
        const marketplaceService = require("../services/marketplaceService");
        await marketplaceService.reconcilePurchaseMetrics(transaction);
      }
      return res.json({ success: true, message: "Duplicate webhook ignored", transaction });
    }

    paymentIntegrity.validatePaystackPayment(transaction, data, data.reference);
    if (transaction.paymentType === "material") {
      paymentVerified = true;
      const marketplaceService = require("../services/marketplaceService");
      const completed = await marketplaceService.completeWebhookPurchase(transaction, data);
      return res.json({ success: true, message: "Webhook processed", transaction: completed });
    }

    if (transaction.paymentType !== "semester" ||
        !Object.prototype.hasOwnProperty.call(SUBSCRIPTION_PRICES, transaction.plan) ||
        Number(transaction.amount) !== SUBSCRIPTION_PRICES[transaction.plan] ||
        !AVAILABLE_SEMESTERS.has(transaction.semester)) {
      const error = new Error("Pending transaction is invalid");
      error.statusCode = 400;
      throw error;
    }

    paymentVerified = true;
    const expiresAt = getSemesterExpirationDate(transaction.semester);
    transaction = await paymentIntegrity.markTransactionSuccessful(transaction, data, { expiresAt });
    await applySubscriptionAccess(transaction);

    return res.json({ success: true, message: "Webhook processed", transaction });
  } catch (error) {
    if (transaction?.status === "processing") {
      if (error.retryablePaymentError || paymentVerified) {
        await paymentIntegrity.releaseTransactionForRetry(transaction, error.message);
      } else {
        await paymentIntegrity.markTransactionFailed(transaction, error.message);
      }
    }
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
});

module.exports = router;
module.exports.validateCurrency = validateCurrency;
module.exports.SUBSCRIPTION_PRICES = SUBSCRIPTION_PRICES;