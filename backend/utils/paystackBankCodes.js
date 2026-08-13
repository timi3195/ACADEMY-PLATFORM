/**
 * Paystack Nigerian Bank Codes and Names
 * Reference: https://paystack.com/docs/api/miscellaneous/#retrieve-banks
 * 
 * This mapping is used to validate bank codes when creating lecturer subaccounts.
 * The code field must match Paystack's bank code system exactly.
 */

const PAYSTACK_BANKS = {
  "Access Bank": "044",
  "Citibank": "023",
  "Ecobank": "050",
  "Fidelity Bank": "070",
  "First Bank": "011",
  "First City Monument Bank": "100",
  "Globus Bank": "103",
  "Guaranty Trust Bank": "058",
  "Heritage Bank": "030",
  "Jaiz Bank": "078",
  "Keystone Bank": "082",
  "Polaris Bank": "076",
  "Stanbic IBTC Bank": "221",
  "Standard Chartered Bank": "068",
  "Sterling Bank": "232",
  "Sun Trust Bank": "100",  // Note: May conflict with FCMB
  "Union Bank": "032",
  "United Bank for Africa": "033",
  "Unity Bank": "215",
  "Wema Bank": "035",
  "Zenith Bank": "057"
};

/**
 * Get Paystack bank code from bank name
 * @param {string} bankName - The bank name (e.g., "Guaranty Trust Bank")
 * @returns {string|null} - The Paystack bank code or null if not found
 */
const getPaystackBankCode = (bankName) => {
  if (!bankName) return null;
  return PAYSTACK_BANKS[bankName] || null;
};

/**
 * Get bank name from Paystack bank code
 * @param {string} code - The Paystack bank code (e.g., "058")
 * @returns {string|null} - The bank name or null if not found
 */
const getBankNameFromCode = (code) => {
  if (!code) return null;
  for (const [name, bankCode] of Object.entries(PAYSTACK_BANKS)) {
    if (bankCode === code) return name;
  }
  return null;
};

/**
 * Get all banks with their codes formatted for API responses
 * @returns {Array} - Array of {name, code} objects
 */
const getAllBanksWithCodes = () => {
  return Object.entries(PAYSTACK_BANKS).map(([name, code]) => ({
    name,
    code
  }));
};

module.exports = {
  PAYSTACK_BANKS,
  getPaystackBankCode,
  getBankNameFromCode,
  getAllBanksWithCodes
};
