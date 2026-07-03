/**
 * Database Cleanup Script
 * Deletes all courses and related materials to start with a clean state
 * 
 * WARNING: This is destructive and cannot be undone!
 * Run with: node scripts/clean_database.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const Course = require('../models/course');
const File = require('../models/File');
const Question = require('../models/Question');
const QuizSession = require('../models/QuizSession');
const PastQuestionExplanation = require('../models/PastQuestionExplanation');
const StudentPerformance = require('../models/StudentPerformance');
const LearningPath = require('../models/LearningPath');

async function cleanDatabase() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Display current counts
    console.log('\n📊 Current Database State:');
    const coursesCount = await Course.countDocuments();
    const filesCount = await File.countDocuments();
    const questionsCount = await Question.countDocuments();
    const quizSessionsCount = await QuizSession.countDocuments();
    const explanationsCount = await PastQuestionExplanation.countDocuments();
    const performanceCount = await StudentPerformance.countDocuments();
    const learningPathsCount = await LearningPath.countDocuments();

    console.log(`  - Courses: ${coursesCount}`);
    console.log(`  - Files/Materials: ${filesCount}`);
    console.log(`  - Questions: ${questionsCount}`);
    console.log(`  - Quiz Sessions: ${quizSessionsCount}`);
    console.log(`  - Question Explanations: ${explanationsCount}`);
    console.log(`  - Student Performance Records: ${performanceCount}`);
    console.log(`  - Learning Paths: ${learningPathsCount}`);

    console.log('\n⚠️  WARNING: This will delete ALL the above records!');
    console.log('Proceeding with cleanup in 3 seconds...\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Delete in dependency order (children first, then parents)
    console.log('🗑️  Deleting dependent records...');

    // Delete Quiz Sessions (depends on nothing we're deleting)
    console.log('  ▸ Deleting Quiz Sessions...');
    const deletedSessions = await QuizSession.deleteMany({});
    console.log(`    ✓ Deleted ${deletedSessions.deletedCount} quiz sessions`);

    // Delete Student Performance (depends on nothing we're deleting)
    console.log('  ▸ Deleting Student Performance Records...');
    const deletedPerformance = await StudentPerformance.deleteMany({});
    console.log(`    ✓ Deleted ${deletedPerformance.deletedCount} performance records`);

    // Delete Learning Paths (depends on nothing we're deleting)
    console.log('  ▸ Deleting Learning Paths...');
    const deletedPaths = await LearningPath.deleteMany({});
    console.log(`    ✓ Deleted ${deletedPaths.deletedCount} learning paths`);

    // Delete Question Explanations (depends on nothing we're deleting)
    console.log('  ▸ Deleting Question Explanations...');
    const deletedExplanations = await PastQuestionExplanation.deleteMany({});
    console.log(`    ✓ Deleted ${deletedExplanations.deletedCount} question explanations`);

    // Delete Questions (depends on nothing we're deleting, but references courses)
    console.log('  ▸ Deleting Questions...');
    const deletedQuestions = await Question.deleteMany({});
    console.log(`    ✓ Deleted ${deletedQuestions.deletedCount} questions`);

    // Delete Files/Materials (depends on courses, delete before courses)
    console.log('  ▸ Deleting Files/Materials...');
    const deletedFiles = await File.deleteMany({});
    console.log(`    ✓ Deleted ${deletedFiles.deletedCount} files/materials`);

    // Finally, delete Courses
    console.log('  ▸ Deleting Courses...');
    const deletedCourses = await Course.deleteMany({});
    console.log(`    ✓ Deleted ${deletedCourses.deletedCount} courses`);

    // Display final counts
    console.log('\n📊 Database After Cleanup:');
    console.log(`  - Courses: ${await Course.countDocuments()}`);
    console.log(`  - Files/Materials: ${await File.countDocuments()}`);
    console.log(`  - Questions: ${await Question.countDocuments()}`);
    console.log(`  - Quiz Sessions: ${await QuizSession.countDocuments()}`);
    console.log(`  - Question Explanations: ${await PastQuestionExplanation.countDocuments()}`);
    console.log(`  - Student Performance: ${await StudentPerformance.countDocuments()}`);
    console.log(`  - Learning Paths: ${await LearningPath.countDocuments()}`);

    console.log('\n✅ Database cleanup completed successfully!');
    console.log('✅ Database is now in a clean state - ready for new courses and materials');

  } catch (error) {
    console.error('❌ Error during database cleanup:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

// Run the cleanup
cleanDatabase();
