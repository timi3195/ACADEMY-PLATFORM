const mongoose = require("mongoose");

const questionExplanationCacheSchema = new mongoose.Schema({
  question: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Question",
    required: true
  },

  explanation: String,
  concepts: [String],
  difficulty: String,

  generatedAt: {
    type: Date,
    default: Date.now
  },
  // TTL index will be set at database level to expire after 30 days
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  }
});

// TTL index - automatically delete documents 30 days after creation
questionExplanationCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
questionExplanationCacheSchema.index({ question: 1 });

module.exports = mongoose.models.QuestionExplanationCache || mongoose.model("QuestionExplanationCache", questionExplanationCacheSchema);
