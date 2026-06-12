const mongoose = require('mongoose');
const Department = require('./models/Department');
const Course = require('./models/course');
require('dotenv').config();

async function seedCourses() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Create departments
    let departments = await Department.find();
    
    if (departments.length === 0) {
      const newDepts = await Department.create([
        { name: 'Computer Science', code: 'CS', school: new mongoose.Types.ObjectId() },
        { name: 'Electronics', code: 'ELE', school: new mongoose.Types.ObjectId() },
        { name: 'Mechanical Engineering', code: 'ME', school: new mongoose.Types.ObjectId() }
      ]);
      console.log('✓ Departments created:', newDepts.length);
      departments = newDepts;
    } else {
      console.log('✓ Departments already exist:', departments.length);
    }

    // Check if courses already exist
    const courseCount = await Course.countDocuments();
    if (courseCount > 0) {
      console.log('✓ Courses already exist:', courseCount);
      process.exit(0);
    }

    // Create sample courses
    const sampleCourses = [
      // CS ND1
      { title: 'Introduction to Programming', code: 'CS101', department: departments[0]._id, level: 'ND1', semester: 'First', creditUnits: 3, isPremium: false, description: 'Learn the fundamentals of programming' },
      { title: 'Digital Logic', code: 'CS102', department: departments[0]._id, level: 'ND1', semester: 'First', creditUnits: 3, isPremium: false, description: 'Boolean algebra and digital circuits' },
      { title: 'Mathematics for Computing', code: 'CS103', department: departments[0]._id, level: 'ND1', semester: 'Second', creditUnits: 4, isPremium: false, description: 'Discrete mathematics and calculus' },
      
      // CS ND2
      { title: 'Data Structures', code: 'CS201', department: departments[0]._id, level: 'ND2', semester: 'First', creditUnits: 3, isPremium: false, description: 'Arrays, linked lists, trees, and graphs' },
      { title: 'Database Design', code: 'CS202', department: departments[0]._id, level: 'ND2', semester: 'First', creditUnits: 3, isPremium: true, description: 'Relational databases and SQL' },
      { title: 'Web Development', code: 'CS203', department: departments[0]._id, level: 'ND2', semester: 'Second', creditUnits: 3, isPremium: false, description: 'HTML, CSS, JavaScript, and frameworks' },
      
      // Electronics ND1
      { title: 'Basic Electronics', code: 'ELE101', department: departments[1]._id, level: 'ND1', semester: 'First', creditUnits: 3, isPremium: false, description: 'Semiconductor devices and circuits' },
      { title: 'Circuit Theory', code: 'ELE102', department: departments[1]._id, level: 'ND1', semester: 'First', creditUnits: 3, isPremium: false, description: 'Kirchhoff laws and circuit analysis' },
      { title: 'Electrical Measurements', code: 'ELE103', department: departments[1]._id, level: 'ND1', semester: 'Second', creditUnits: 3, isPremium: true, description: 'Instruments and measurement techniques' },
      
      // ME HND1
      { title: 'Mechanics of Solids', code: 'ME301', department: departments[2]._id, level: 'HND1', semester: 'First', creditUnits: 4, isPremium: false, description: 'Stress, strain, and material properties' },
      { title: 'Thermodynamics', code: 'ME302', department: departments[2]._id, level: 'HND1', semester: 'First', creditUnits: 4, isPremium: true, description: 'Heat, work, and energy conversion' }
    ];
    
    await Course.create(sampleCourses);
    console.log('✓ Sample courses created:', sampleCourses.length);
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

seedCourses();
