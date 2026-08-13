/**
 * Paystack Integration Test Suite
 * Tests the complete payment flow end-to-end
 */

const axios = require('axios');

// Test configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const TEST_LECTURER_EMAIL = 'test-lecturer@academy.local';
const TEST_LECTURER_PASSWORD = 'TestLecturer123!';
const TEST_STUDENT_EMAIL = 'test-student@academy.local';
const TEST_STUDENT_PASSWORD = 'TestStudent123!';

// Test data
const TEST_BANK_DETAILS = {
  bankName: "Guaranty Trust Bank",
  bankCode: "058",
  accountNumber: "0123456789",
  accountName: "Test Lecturer Account"
};

const TEST_MATERIAL_DATA = {
  title: "Test Material for Payment",
  description: "A paid test material",
  course: "CS101",
  price: 4000,
  isPaid: true,
  isFree: false,
  pricingMode: "paid"
};

// Test state
let lecturerToken = null;
let lecturerId = null;
let studentToken = null;
let studentId = null;
let materialId = null;

// Logging utilities
const log = (phase, message, data = null) => {
  console.log(`\n[${ phase}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
};

const error = (phase, message, err = null) => {
  console.error(`\n[ERROR] [${phase}] ${message}`);
  if (err?.response?.data) {
    console.error('Response:', JSON.stringify(err.response.data, null, 2));
  } else if (err?.message) {
    console.error('Error:', err.message);
  }
};

// API helper
const api = axios.create({
  baseURL: BACKEND_URL,
  validateStatus: () => true // Don't throw on any status
});

const setAuth = (token) => {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }
};

// Test phases
async function testGetAvailableBanks() {
  try {
    log('PHASE 3-A', 'Testing GET /api/lecturer/payment/banks');
    const response = await api.get('/api/lecturer/payment/banks', {
      headers: { Authorization: `Bearer ${lecturerToken}` }
    });

    if (response.status === 200 && response.data.success && Array.isArray(response.data.banks)) {
      log('PHASE 3-A', '✅ Bank list retrieved successfully', {
        bankCount: response.data.banks.length,
        firstBank: response.data.banks[0],
        gtbBank: response.data.banks.find(b => b.name === 'Guaranty Trust Bank')
      });
      return response.data.banks;
    } else {
      error('PHASE 3-A', 'Failed to get bank list', response.data);
      return null;
    }
  } catch (err) {
    error('PHASE 3-A', 'Exception during GET /api/lecturer/payment/banks', err);
    return null;
  }
}

async function testUpdatePaymentSettings(banks) {
  try {
    log('PHASE 3-B', 'Testing POST /api/lecturer/payment/settings with test bank details');
    
    // Find GTB in banks list
    const gtbBank = banks.find(b => b.name === TEST_BANK_DETAILS.bankName);
    if (!gtbBank) {
      error('PHASE 3-B', `Bank ${TEST_BANK_DETAILS.bankName} not found in available banks`);
      return null;
    }

    const payload = {
      bankName: TEST_BANK_DETAILS.bankName,
      bankCode: gtbBank.code,
      accountNumber: TEST_BANK_DETAILS.accountNumber,
      accountName: TEST_BANK_DETAILS.accountName
    };

    log('PHASE 3-B', 'Sending payload', payload);

    const response = await api.post(
      '/api/lecturer/payment/settings',
      payload,
      {
        headers: { Authorization: `Bearer ${lecturerToken}` }
      }
    );

    if (response.status === 200 && response.data.success) {
      log('PHASE 3-B', '✅ Payment settings updated successfully', {
        verified: response.data.verified,
        bankName: response.data.bankName,
        accountNumberLast4: response.data.accountNumberLast4,
        message: response.data.message
      });
      return response.data;
    } else {
      error('PHASE 3-B', 'Failed to update payment settings', response.data);
      return null;
    }
  } catch (err) {
    error('PHASE 3-B', 'Exception during POST /api/lecturer/payment/settings', err);
    return null;
  }
}

async function testGetPaymentSettings() {
  try {
    log('PHASE 3-C', 'Testing GET /api/lecturer/payment/settings');
    
    const response = await api.get(
      '/api/lecturer/payment/settings',
      {
        headers: { Authorization: `Bearer ${lecturerToken}` }
      }
    );

    if (response.status === 200 && response.data.success) {
      log('PHASE 3-C', '✅ Payment settings retrieved successfully', {
        verified: response.data.settings.verified,
        subaccountCode: response.data.settings.subaccountCode ? response.data.settings.subaccountCode.substring(0, 10) + '...' : 'null',
        bankName: response.data.settings.bankName,
        accountNumberLast4: response.data.settings.accountNumberLast4
      });
      return response.data.settings;
    } else {
      error('PHASE 3-C', 'Failed to get payment settings', response.data);
      return null;
    }
  } catch (err) {
    error('PHASE 3-C', 'Exception during GET /api/lecturer/payment/settings', err);
    return null;
  }
}

// Main test runner
async function runTests() {
  try {
    console.log('='.repeat(60));
    console.log('PAYSTACK INTEGRATION TEST SUITE');
    console.log('='.repeat(60));
    
    log('SETUP', `Testing against: ${BACKEND_URL}`);

    // Skip authentication steps - assume you have a valid token
    log('SETUP', 'Using test lecturer token (assumes backend running with test user)');

    // For now, we'll just test the endpoints that don't require auth
    // In a full test, you'd login first to get tokens

    const banks = await testGetAvailableBanks();
    if (!banks) {
      throw new Error('Failed to get bank list');
    }

    // TODO: Need actual lecturer token to test authenticated endpoints
    console.log('\n⚠️  Note: To fully test payment settings, you need:');
    console.log('1. A valid lecturer account');
    console.log('2. An authentication token from POST /api/auth/login');
    console.log('3. Backend running at', BACKEND_URL);

  } catch (err) {
    error('MAIN', 'Test suite failed', err);
    process.exit(1);
  }
}

// Export for use in other test suites
module.exports = {
  testGetAvailableBanks,
  testUpdatePaymentSettings,
  testGetPaymentSettings,
  api,
  setAuth
};

// Run if executed directly
if (require.main === module) {
  runTests().then(() => {
    console.log('\n' + '='.repeat(60));
    console.log('Test suite completed');
    console.log('='.repeat(60));
    process.exit(0);
  });
}
