const express = require("express");
const router = express.Router();
const axios = require("axios");
const protect = require("../config/middleware/authMiddleware");

console.log("PAYMENT ROUTES LOADED");

const User = require("../models/User");
const Transaction = require("../models/Transaction");

// Verify environment variables on startup
if (!process.env.PAYSTACK_SECRET_KEY) {
  console.error("❌ PAYSTACK_SECRET_KEY not found in environment variables");
}

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

// INITIALIZE PAYMENT - Semester based (Protected route)
router.post("/initialize", protect, async (req, res) => {
  try {
    const { amount, semester, plan } = req.body;
    const email = req.user.email || req.body.email; // Use authenticated user email

    if (!semester || !plan) {
      return res.status(400).json({
        success: false,
        message: "Semester and plan are required"
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecretKey) {
      console.error("PAYSTACK_SECRET_KEY is undefined");
      return res.status(500).json({
        success: false,
        message: "Payment configuration error. Please try again."
      });
    }

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount * 100,
        metadata: {
          semester,
          plan
        }
      },
      {
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      success: true,
      data: response.data.data
    });
  } catch (err) {
    console.error("Payment initialization error:", err.message);
    res.status(500).json({
      success: false,
      message: err.response?.data?.message || err.message || "Unable to start payment. Try again."
    });
  }
});

// VERIFY PAYMENT - Update user with semester subscription
router.get("/verify/:reference", protect, async (req, res) => {
  try {
    const reference = req.params.reference;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackSecretKey) {
      return res.status(500).json({
        success: false,
        message: "Payment configuration error"
      });
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`
        }
      }
    );

    const paymentData = response.data.data;

    if (paymentData.status !== "success") {
      return res.status(400).json({
        success: false,
        message: "Payment not successful"
      });
    }

    // Prevent duplicate verification
    const existingTransaction = await Transaction.findOne({ reference });

    if (existingTransaction) {
      return res.json({
        success: true,
        message: "Already verified",
        transaction: existingTransaction
      });
    }

    // Find user
    const user = await User.findOne({
      email: paymentData.customer.email
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Extract metadata
    const { semester, plan } = paymentData.metadata;
    const expiresAt = getSemesterExpirationDate(semester);

    // Update user subscription
    user.plan = plan;
    user.subscriptionType = plan;
    user.subscriptionSemester = semester;
    user.subscriptionExpiresAt = expiresAt;

    await user.save();

    // Save transaction
    const transaction = await Transaction.create({
      user: user._id,
      email: user.email,
      amount: paymentData.amount / 100,
      reference,
      status: "success",
      plan,
      semester,
      expiresAt,
      paidAt: new Date()
    });

    res.json({
      success: true,
      message: "Payment verified - Semester subscription activated",
      transaction,
      user
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.response?.data || err.message
    });
  }
});

// GET USER SUBSCRIPTION STATUS
router.get("/status/:userId", protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const isActive = user.subscriptionExpiresAt && new Date() < user.subscriptionExpiresAt;

    res.json({
      success: true,
      subscription: {
        type: user.subscriptionType,
        semester: user.subscriptionSemester,
        expiresAt: user.subscriptionExpiresAt,
        isActive
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;