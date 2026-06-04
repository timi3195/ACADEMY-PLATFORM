const mongoose = require("mongoose");

const schoolSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String,
    default: ""
  },
  code: {
    type: String,
    unique: true
  }
}, { timestamps: true });

// Note: unique: true on name and code already creates indexes automatically

module.exports = mongoose.model("School", schoolSchema);
