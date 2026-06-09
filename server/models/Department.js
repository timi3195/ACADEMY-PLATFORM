const mongoose = require("mongoose");

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  code: {
    type: String,
    required: true,
    unique: true
  },
  school: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "School",
    required: true
  },
  description: {
    type: String,
    default: ""
  },
  hod: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  }
}, { timestamps: true });

// Indexes (unique: true on code already creates index)
departmentSchema.index({ school: 1 });
departmentSchema.index({ name: 1 });

module.exports = mongoose.models.Department || mongoose.model("Department", departmentSchema);
