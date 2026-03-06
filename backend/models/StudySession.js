// backend/models/StudySession.js
const mongoose = require("mongoose");

const StudySessionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },

    // optional link to a Task
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },

    plannedMinutes: { type: Number, default: 25 },
    actualMinutes: { type: Number, default: 0 },

    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },

    // "completed" = finished as intended
    completed: { type: Boolean, default: false },

    // if ended early, store why (motivation, distraction, etc.)
    endReason: { type: String, default: "" }, // e.g. "lost_motivation"
    endNote: { type: String, default: "" },   // free text
  },
  { timestamps: true }
);

module.exports = mongoose.model("StudySession", StudySessionSchema);
