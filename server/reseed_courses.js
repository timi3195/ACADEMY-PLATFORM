const mongoose = require('mongoose');
const Course = require('./models/course');
const Department = require('./models/Department');
require('dotenv').config();

async function reseedCourses() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Delete all existing courses
    await Course.deleteMany({});
    console.log('✓ Cleared existing courses');

    // Get or create departments
    let departments = await Department.find();
    
    if (departments.length < 3) {
      await Department.deleteMany({});
      const schoolId = new mongoose.Types.ObjectId();
      const newDepts = await Department.create([
        { name: 'Computer Science', code: 'CS', school: schoolId },
        { name: 'Electronics', code: 'ELE', school: schoolId },
        { name: 'Mechanical Engineering', code: 'ME', school: schoolId }
      ]);
      console.log('✓ Created departments:', newDepts.length);
      departments = newDepts;
    }

    // Create sample courses with all departments
    const sampleCourses = [
      // CS ND1
      { title: 'Introduction to Programming', code: 'CS101', department: departments[0]._id, level: 'ND1', semester: 'First', creditUnits: 3, isPremium: false, description: 'Learn the fundamentals of programming with Python' },
      { title: 'Digital Logic', code: 'CS102', department: departments[0]._id, level: 'ND1', semester: 'First', creditUnits: 3, isPremium: false, description: 'Boolean algebra and digital circuit design' },
      { title: 'Mathematics for Computing', code: 'CS103', department: departments[0]._id, level: 'ND1', semester: 'Second', creditUnits: 4, isPremium: false, description: 'Discrete mathematics and calculus for CS' },
      
      // CS ND2
      { title: 'Data Structures', code: 'CS201', department: departments[0]._id, level: 'ND2', semester: 'First', creditUnits: 3, isPremium: false, description: 'Arrays, linked lists, trees, graphs and algorithms' },
      { title: 'Database Design', code: 'CS202', department: departments[0]._id, level: 'ND2', semester: 'First', creditUnits: 3, isPremium: true, description: 'Relational databases, SQL and query optimization' },
      { title: 'Web Development', code: 'CS203', department: departments[0]._id, level: 'ND2', semester: 'Second', creditUnits: 3, isPremium: false, description: 'HTML, CSS, JavaScript and modern web frameworks' },
      
      // CS HND1
      { title: 'Software Engineering', code: 'CS301', department: departments[0]._id, level: 'HND1', semester: 'First', creditUnits: 4, isPremium: false, description: 'Software development lifecycle and design patterns' },
      { title: 'Advanced Algorithms', code: 'CS302', department: departments[0]._id, level: 'HND1', semester: 'First', creditUnits: 4, isPremium: true, description: 'Advanced algorithm analysis and optimization' },
      
      // Electronics ND1
      { title: 'Basic Electronics', code: 'ELE101', department: departments[1]._id, level: 'ND1', semester: 'First', creditUnits: 3, isPremium: false, description: 'Semiconductor devices, diodes, transistors and circuits' },
      { title: 'Circuit Theory', code: 'ELE102', department: departments[1]._id, level: 'ND1', semester: 'First', creditUnits: 3, isPremium: false, description: 'Kirchhoff laws, circuit analysis and network theorems' },
      { title: 'Electrical Measurements', code: 'ELE103', department: departments[1]._id, level: 'ND1', semester: 'Second', creditUnits: 3, isPremium: true, description: 'Measurement instruments and techniques' },
      
      // Electronics ND2
      { title: 'Digital Electronics', code: 'ELE201', department: departments[1]._id, level: 'ND2', semester: 'First', creditUnits: 3, isPremium: false, description: 'Logic gates, flip-flops, counters and combinational circuits' },
      { title: 'Power Systems', code: 'ELE202', department: departments[1]._id, level: 'ND2', semester: 'First', creditUnits: 3, isPremium: true, description: 'Power generation, transmission and distribution' },
      
      // ME HND1
      { title: 'Mechanics of Solids', code: 'ME301', department: departments[2]._id, level: 'HND1', semester: 'First', creditUnits: 4, isPremium: false, description: 'Stress, strain, elasticity and material properties' },
      { title: 'Thermodynamics', code: 'ME302', department: departments[2]._id, level: 'HND1', semester: 'First', creditUnits: 4, isPremium: true, description: 'Heat, work, energy conversion and cycles' },
      { title: 'Fluid Mechanics', code: 'ME303', department: departments[2]._id, level: 'HND1', semester: 'Second', creditUnits: 4, isPremium: false, description: 'Fluid properties, flow analysis and pumps' },
      
      // ME HND2
      { title: 'Machine Design', code: 'ME401', department: departments[2]._id, level: 'HND2', semester: 'First', creditUnits: 4, isPremium: false, description: 'Design of mechanical components and systems' },
      { title: 'Manufacturing Processes', code: 'ME402', department: departments[2]._id, level: 'HND2', semester: 'First', creditUnits: 4, isPremium: true, description: 'Machining, casting, welding and manufacturing systems' }
    ];
    
    const created = await Course.create(sampleCourses);
    console.log(`✓ Created ${created.length} sample courses`);
    
    // Show summary
    console.log('\n📚 Course Summary:');
    const byDept = {};
    created.forEach(c => {
      const deptName = departments.find(d => d._id.equals(c.department))?.name || 'Unknown';
      if (!byDept[deptName]) byDept[deptName] = { total: 0, premium: 0 };
      byDept[deptName].total++;
      if (c.isPremium) byDept[deptName].premium++;
    });
    
    Object.entries(byDept).forEach(([dept, stats]) => {
      console.log(`  🏢 ${dept}: ${stats.total} courses (${stats.premium} premium)`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
}

reseedCourses();
