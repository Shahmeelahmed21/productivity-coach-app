// backend/routes/progress.js
const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const UserProgress = require("../models/UserProgress");

const router = express.Router();
router.use(requireAuth);

router.get("/me", async (req, res) => {
  try {
    const userId = req.userId;
    const p = await UserProgress.findOne({ userId }).lean();
    return res.json({
      ok: true,
      progress: p || { userId, level: 1, xp: 0, totalXp: 0, tasksCompleted: 0, streak: 0, lastCompletedAt: null },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;