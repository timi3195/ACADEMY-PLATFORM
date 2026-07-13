const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  material: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "File",
    required: true
  },
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Transaction",
    default: null
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  review: {
    type: String,
    default: ""
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

reviewSchema.index({ material: 1, user: 1 }, { unique: true });

reviewSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.models.Review || mongoose.model("Review", reviewSchema);
