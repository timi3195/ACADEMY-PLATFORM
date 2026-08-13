const axios = require("axios");

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PLATFORM_PAYSTACK_ACCOUNT = process.env.PLATFORM_PAYSTACK_ACCOUNT;
const PLATFORM_COMMISSION_PERCENTAGE = Number(process.env.PLATFORM_COMMISSION_PERCENTAGE || 10);

if (!PAYSTACK_SECRET_KEY) {
  console.error("PAYSTACK_SECRET_KEY is not configured");
}

const initializePayment = async ({ email, amount, metadata, callbackUrl, subaccountCode = null }) => {
  if (!PAYSTACK_SECRET_KEY) {
    const error = new Error("Paystack configuration missing");
    error.statusCode = 500;
    throw error;
  }

  const payload = {
    email,
    amount: Math.round(amount * 100),
    metadata
  };

  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }

  // If subaccountCode is provided (for lecturer payment split), add it to payload
  if (subaccountCode) {
    payload.subaccount = subaccountCode;
    // Paystack will automatically deduct the subaccount's percentage charge
    // The platform keeps the difference as commission
  }

  const response = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    payload,
    {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  if (!response.data || !response.data.data) {
    const error = new Error("Unable to initialize payment");
    error.statusCode = 500;
    throw error;
  }

  return response.data.data;
};

const verifyPayment = async (reference) => {
  if (!PAYSTACK_SECRET_KEY) {
    const error = new Error("Paystack configuration missing");
    error.statusCode = 500;
    throw error;
  }
  const response = await axios.get(
    `https://api.paystack.co/transaction/verify/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
      }
    }
  );

  if (!response.data || !response.data.data) {
    const error = new Error("Unable to verify payment");
    error.statusCode = 500;
    throw error;
  }

  return response.data.data;
};

// Create a subaccount for a lecturer
const createSubaccount = async (lecturer) => {
  if (!PAYSTACK_SECRET_KEY) {
    const error = new Error("Paystack configuration missing");
    error.statusCode = 500;
    throw error;
  }

  const payload = {
    business_name: lecturer.name || "Lecturer Account",
    settlement_bank: lecturer.paystackPayment?.bankCode,
    account_number: lecturer.paystackPayment?.accountNumber,
    percentage_charge: PLATFORM_COMMISSION_PERCENTAGE // Platform keeps this percentage
  };

  try {
    const response = await axios.post(
      "https://api.paystack.co/subaccount",
      payload,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!response.data || !response.data.data) {
      const error = new Error("Unable to create subaccount");
      error.statusCode = 500;
      throw error;
    }

    return response.data.data;
  } catch (err) {
    console.error("Subaccount creation error:", err.response?.data || err.message);
    throw err;
  }
};

module.exports = {
  initializePayment,
  verifyPayment,
  createSubaccount,
  PLATFORM_COMMISSION_PERCENTAGE
};
