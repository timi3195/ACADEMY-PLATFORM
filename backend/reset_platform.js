const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const Course = require('./models/course');
const Question = require('./models/Question');
const File = require('./models/File');
const Note = require('./models/note');
const QuizSession = require('./models/QuizSession');
const Department = require('./models/Department');
const School = require('./models/School');

const uploadDir = path.join(__dirname, 'uploads');

async function clearCollection(model, label) {
  const result = await model.deleteMany({});
  console.log(`✓ Cleared ${result.deletedCount} ${label}`);
}

async function clearUploads() {
  if (!fs.existsSync(uploadDir)) {
    console.log('ℹ️ Upload directory does not exist, skipping upload cleanup.');
    return;
  }

  const files = fs.readdirSync(uploadDir);
  for (const file of files) {
    const filePath = path.join(uploadDir, file);
    if (fs.lstatSync(filePath).isFile()) {
      fs.unlinkSync(filePath);
    }
  }
  console.log(`✓ Cleared ${files.length} uploaded file(s) from ${uploadDir}`);
}

async function resetPlatform() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    await clearCollection(Course, 'courses');
    await clearCollection(Question, 'questions');
    await clearCollection(File, 'files');
    await clearCollection(Note, 'notes');
    await clearCollection(QuizSession, 'quiz sessions');
    await clearCollection(Department, 'departments');
    await clearCollection(School, 'schools');

    await clearUploads();

    console.log('✅ Platform reset completed. Content collections are empty.');
    process.exit(0);
  } catch (error) {
    console.error('✗ Platform reset failed:', error);
    process.exit(1);
  }
}

resetPlatform();
