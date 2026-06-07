const express = require("express")
const Department = require("../models/Department")
const router = express.Router()

console.log("DEPARTMENT ROUTES LOADED")

router.get("/", async (req, res) => {
  try {
    const departments = await Department.find()
      .select("_id name code description")
      .populate("school", "name")
      .sort({ name: 1 });
    
    if (!departments || departments.length === 0) {
      return res.json({
        success: true,
        departments: [],
        message: 'No departments found. Please create departments in admin panel first.'
      });
    }
    
    res.json({
      success: true,
      departments,
      count: departments.length
    })
  } catch (err) {
    console.error("Departments fetch error:", err)
    res.status(500).json({
      success: false,
      message: err.message
    })
  }
})

module.exports = router
