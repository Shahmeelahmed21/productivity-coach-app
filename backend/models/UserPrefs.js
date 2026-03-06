// backend/models/UserPrefs.js
const mongoose = require("mongoose");

const TimeWindowSchema = new mongoose.Schema(
  {
    start: { type: String, default: "09:00" }, // "HH:mm"
    end: { type: String, default: "17:00" },   // "HH:mm"
  },
  { _id: false }
);

const UserPrefsSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },

    timezone: { type: String, default: "Europe/London" },

    // e.g. sleep 01:00 -> 09:00
    sleepStart: { type: String, default: "01:00" },
    sleepEnd: { type: String, default: "09:00" },

    // When the user wants to plan study time
    workHours: { type: TimeWindowSchema, default: () => ({ start: "09:00", end: "17:00" }) },

    // Planning settings
    focusBlockMinutes: { type: Number, default: 25 }, // 25 or 50
    shortBreakMinutes: { type: Number, default: 5 },
    longBreakMinutes: { type: Number, default: 15 },

    // 0=Sun ... 6=Sat
    studyDays: { type: [Number], default: [1, 2, 3, 4, 5] },


    tone: { type: String, enum: ["friendly", "direct", "motivational"], default: "friendly" },
    difficulty: { type: String, enum: ["light", "balanced", "intense"], default: "balanced" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserPrefs", UserPrefsSchema);
