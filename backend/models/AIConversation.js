const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["student", "assistant"],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  tokens: {
    type: Number,
    default: 0 // For tracking API usage
  },
  feedback: {
    type: String,
    enum: ["helpful", "unhelpful"],
    default: null
  }
});

const aiConversationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department"
  },

  // Conversation metadata
  title: {
    type: String,
    default: "New Chat"
  },
  topic: String,

  // Messages
  messages: [messageSchema],

  // Usage tracking
  totalMessages: {
    type: Number,
    default: 0
  },
  totalTokens: {
    type: Number,
    default: 0
  },

  // Performance tracking
  relatedTopics: [String],

  createdAt: {
    type: Date,
    default: Date.now
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for fast queries
aiConversationSchema.index({ user: 1, course: 1, createdAt: -1 });
aiConversationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.AIConversation || mongoose.model("AIConversation", aiConversationSchema);
