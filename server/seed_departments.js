/**
 * Seed departments into the database
 * Run this script: node server/seed_departments.js
 */
require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const Department = require('./models/Department');
const School = require('./models/School');

const seedDepartments = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Check if departments already exist
    const existingDepartments = await Department.countDocuments();
    if (existingDepartments > 0) {
      console.log(`✅ ${existingDepartments} departments already exist in database`);
      await mongoose.connection.close();
      return;
    }

    // Create or get default school
    let school = await School.findOne({ code: 'DEFAULT' });
    if (!school) {
      school = await School.create({
        name: 'Default Polytechnic',
        code: 'DEFAULT',
        description: 'Default school for departments'
      });
      console.log('✅ Created default school');
    }

    // Sample departments
    const departments = [
      { name: 'Computer Science', code: 'CSC', description: 'Computer Science and Technology' },
      { name: 'Civil Engineering', code: 'CVE', description: 'Civil Engineering' },
      { name: 'Electrical Engineering', code: 'ELE', description: 'Electrical Engineering' },
      { name: 'Mechanical Engineering', code: 'MEC', description: 'Mechanical Engineering' },
      { name: 'Business Administration', code: 'BUA', description: 'Business Administration' },
      { name: 'Accounting', code: 'ACC', description: 'Accounting' },
      { name: 'Public Administration', code: 'PAD', description: 'Public Administration' },
      { name: 'Mass Communication', code: 'MAS', description: 'Mass Communication' }
    ];

    const createdDepartments = await Department.insertMany(
      departments.map(dept => ({
        ...dept,
        school: school._id
      }))
    );

    console.log(`✅ Created ${createdDepartments.length} departments:`);
    createdDepartments.forEach(dept => {
      console.log(`   - ${dept.name} (${dept.code})`);
    });

    await mongoose.connection.close();
    console.log('✅ Database seeding complete');
  } catch (error) {
    console.error('❌ Seed error:', error.message);
    process.exit(1);
  }
};

seedDepartments();
