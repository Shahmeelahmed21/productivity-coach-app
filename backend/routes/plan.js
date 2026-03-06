// backend/routes/plan.js
const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/requireAuth");
const Task = require("../models/task");
const UserPrefs = require("../models/UserPrefs");
const MoodEntry = require("../models/MoodEntry");

const { generateDailyPlan } = require("../lib/planner");

router.use(requireAuth);

/**
 * GET /plan/today
 * Returns a time-block plan for today using:
 * - tasks (incomplete)
 * - prefs (work hours, focus block, timezone)
 * - latest mood (optional)
 */
router.get("/today", async (req, res) => {
  try {
    const userId = req.userId;

    const [prefs, tasks, latestMood] = await Promise.all([
      UserPrefs.findOne({ userId }).lean(),
      Task.find({ userId, completed: false }).lean(),
      MoodEntry.findOne({ userId }).sort({ createdAt: -1 }).lean(),
    ]);

    const plan = generateDailyPlan({
      tasks: tasks || [],
      prefs: prefs || { timezone: "Europe/London" },
      mood: latestMood || null,
    });

    return res.json({ ok: true, ...plan });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;