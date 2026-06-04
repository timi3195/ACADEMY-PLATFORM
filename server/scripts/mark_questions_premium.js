const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const Question = require('../models/Question');

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const res1 = await Question.updateMany({}, { $set: { isPremium: true } });
    const matched1 = res1.matchedCount ?? res1.n ?? 0;
    const modified1 = res1.modifiedCount ?? res1.nModified ?? 0;
    console.log(`Questions updated: matched=${matched1} modified=${modified1}`);

    const res2 = await Question.updateMany({ 'subQuestions.0': { $exists: true } }, { $set: { 'subQuestions.$[].isPremium': true } });
    const matched2 = res2.matchedCount ?? res2.n ?? 0;
    const modified2 = res2.modifiedCount ?? res2.nModified ?? 0;
    console.log(`Sub-questions updated: matched=${matched2} modified=${modified2}`);

    await mongoose.disconnect();
    console.log('Done. All existing past questions marked as premium.');
    process.exit(0);
  } catch (err) {
    console.error('Error marking questions premium:', err);
    process.exit(1);
  }
}

run();
