const express = require("express");
const MoodEntry = require("../models/MoodEntry");

const router = express.Router();

const is1to5 = (n) => Number.isFinite(n) && n >= 1 && n <= 5;

// GET /mood?userId=xxx&limit=30
router.get("/", async (req, res) => {
  try {
    const { userId } = req.query;
    const limit = Math.min(Number(req.query.limit || 30), 200);

    if (!userId) return res.status(400).json({ message: "userId is required" });

    const entries = await MoodEntry.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json(entries);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /mood
router.post("/", async (req, res) => {
  try {
    const { userId, mood, stress, energy, note } = req.body;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const m = Number(mood);
    const s = Number(stress);
    const e = Number(energy);

    if (!is1to5(m) || !is1to5(s) || !is1to5(e)) {
      return res.status(400).json({ message: "mood/stress/energy must be numbers 1..5" });
    }

    const entry = await MoodEntry.create({
      userId,
      mood: m,
      stress: s,
      energy: e,
      note: typeof note === "string" ? note : ""
    });

    res.status(201).json(entry);
  } catch (err) {
    // Mongoose validation -> 400
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
