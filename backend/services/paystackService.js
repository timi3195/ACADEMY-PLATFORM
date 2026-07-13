const axios = require("axios");

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
if (!PAYSTACK_SECRET_KEY) {
  console.error("PAYSTACK_SECRET_KEY is not configured");
}

const initializePayment = async ({ email, amount, metadata }) => {
  if (!PAYSTACK_SECRET_KEY) {
    const error = new Error("Paystack configuration missing");
    error.statusCode = 500;
    throw error;
  }
  const response = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    {
      email,
      amount: Math.round(amount * 100),
      metadata
    },
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

module.exports = {
  initializePayment,
  verifyPayment
};
