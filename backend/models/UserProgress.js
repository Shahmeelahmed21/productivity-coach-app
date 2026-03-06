// backend/models/UserProgress.js
const mongoose = require("mongoose");

const UserProgressSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },

    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 }, // XP within current level
    totalXp: { type: Number, default: 0 }, // lifetime XP
    tasksCompleted: { type: Number, default: 0 },

    // optional
    streak: { type: Number, default: 0 },
    lastCompletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserProgress", UserProgressSchema);