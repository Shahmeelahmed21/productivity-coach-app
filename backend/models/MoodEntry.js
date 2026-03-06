const mongoose = require("mongoose");

const MoodEntrySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    mood: { type: Number, min: 1, max: 5, required: true },   // 1..5
    stress: { type: Number, min: 1, max: 5, required: true }, // 1..5
    energy: { type: Number, min: 1, max: 5, required: true }, // 1..5
    note: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("MoodEntry", MoodEntrySchema);
