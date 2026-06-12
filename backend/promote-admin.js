const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const User = require('./models/User');

const email = process.argv[2];
const role = process.argv[3] || 'admin';

if (!email) {
  console.error('Usage: node promote-admin.js <email> [role]');
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('Missing MONGO_URI in .env');
  process.exit(1);
}

async function promote() {
  try {
    await mongoose.connect(MONGO_URI);
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.error(`User not found for email: ${email}`);
      process.exit(1);
    }
    user.role = role;
    await user.save();
    console.log(`User ${email} promoted to role: ${role}`);
    process.exit(0);
  } catch (err) {
    console.error('Promotion failed:', err.message);
    process.exit(1);
  }
}

promote();
