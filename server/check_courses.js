const Course = require('./models/course');
const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const courses = await Course.find().populate('department');
  console.log('\n📚 Total courses:', courses.length);
  
  const byDept = {};
  courses.forEach(c => {
    const dept = c.department?.name || 'Unknown';
    if (!byDept[dept]) byDept[dept] = [];
    byDept[dept].push(c);
  });
  
  Object.entries(byDept).forEach(([dept, courses]) => {
    console.log(`\n🏢 ${dept}:`);
    const byLevel = {};
    courses.forEach(c => {
      if (!byLevel[c.level]) byLevel[c.level] = [];
      byLevel[c.level].push(c);
    });
    
    Object.entries(byLevel).forEach(([level, crs]) => {
      console.log(`  ${level}:`);
      crs.forEach(c => {
        console.log(`    - ${c.code}: ${c.title} ${c.isPremium ? '(⭐ Premium)' : ''}`);
      });
    });
  });
  
  process.exit(0);
});
