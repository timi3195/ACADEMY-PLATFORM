const express = require("express")
const Department = require("../models/Department")
const router = express.Router()

console.log("DEPARTMENT ROUTES LOADED")

router.get("/", async (req, res) => {
  try {
    const departments = await Department.find().select("name code")
    res.json({
      success: true,
      departments
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
