const express = require("express")
const Department = require("../models/Department")
const router = express.Router()

console.log("DEPARTMENT ROUTES LOADED")

router.get("/", async (req, res) => {
  try {
    console.log('📚 Fetching departments...');
    
    // First check if Department model is properly initialized
    if (!Department || !Department.collection) {
      console.error('❌ Department model not initialized');
      return res.status(500).json({
        success: false,
        message: 'Database error: Department model not initialized'
      });
    }

    const departments = await Department.find()
      .select("_id name code description")
      .populate("school", "name")
      .sort({ name: 1 })
      .lean(); // Use lean for faster queries on read-only data
    
    console.log(`✅ Found ${departments.length} departments`);
    
    if (!departments || departments.length === 0) {
      console.warn('⚠️ No departments found in database');
      console.warn('To populate departments, run: node server/seed_departments.js');
      return res.json({
        success: true,
        departments: [],
        message: 'No departments configured. Run seed_departments.js to populate.'
      });
    }
    
    res.json({
      success: true,
      departments,
      count: departments.length
    })
  } catch (err) {
    console.error("❌ Departments fetch error:", err.message);
    console.error("Stack:", err.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch departments',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    })
  }
})

module.exports = router
