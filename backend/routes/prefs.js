// backend/routes/prefs.js
const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/requireAuth");
const UserPrefs = require("../models/UserPrefs");

const TIME_RE = /^\d{2}:\d{2}$/;

function isValidTime(s) {
  if (!s || typeof s !== "string") return false;
  if (!TIME_RE.test(s)) return false;
  const [hh, mm] = s.split(":").map(Number);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function clampNumber(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(min, Math.min(max, x));
}

// All prefs routes require auth
router.use(requireAuth);

/**
 * GET /prefs
 * Returns prefs, auto-creates defaults if missing.
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;

    let prefs = await UserPrefs.findOne({ userId });
    if (!prefs) {
      prefs = await UserPrefs.create({ userId });
    }

    res.json({ ok: true, prefs });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * PATCH /prefs
 * Body can include any of:
 * timezone, sleepStart, sleepEnd, workHours:{start,end}, focusBlockMinutes, shortBreakMinutes, longBreakMinutes, studyDays, tone, difficulty
 */
router.patch("/", async (req, res) => {
  try {
    const userId = req.userId;
    const b = req.body || {};

    const update = {};

    if (b.timezone !== undefined) update.timezone = String(b.timezone);

    if (b.sleepStart !== undefined) {
      if (!isValidTime(b.sleepStart)) return res.status(400).json({ message: "sleepStart must be HH:mm" });
      update.sleepStart = b.sleepStart;
    }

    if (b.sleepEnd !== undefined) {
      if (!isValidTime(b.sleepEnd)) return res.status(400).json({ message: "sleepEnd must be HH:mm" });
      update.sleepEnd = b.sleepEnd;
    }

    if (b.workHours !== undefined) {
      const wh = b.workHours || {};
      const next = {};
      if (wh.start !== undefined) {
        if (!isValidTime(wh.start)) return res.status(400).json({ message: "workHours.start must be HH:mm" });
        next.start = wh.start;
      }
      if (wh.end !== undefined) {
        if (!isValidTime(wh.end)) return res.status(400).json({ message: "workHours.end must be HH:mm" });
        next.end = wh.end;
      }
      update.workHours = next;
    }

    if (b.focusBlockMinutes !== undefined) {
      const v = clampNumber(b.focusBlockMinutes, 10, 90);
      if (v === null) return res.status(400).json({ message: "focusBlockMinutes must be a number" });
      update.focusBlockMinutes = v;
    }

    if (b.shortBreakMinutes !== undefined) {
      const v = clampNumber(b.shortBreakMinutes, 1, 30);
      if (v === null) return res.status(400).json({ message: "shortBreakMinutes must be a number" });
      update.shortBreakMinutes = v;
    }

    if (b.longBreakMinutes !== undefined) {
      const v = clampNumber(b.longBreakMinutes, 5, 60);
      if (v === null) return res.status(400).json({ message: "longBreakMinutes must be a number" });
      update.longBreakMinutes = v;
    }

    if (b.studyDays !== undefined) {
      if (!Array.isArray(b.studyDays)) return res.status(400).json({ message: "studyDays must be an array" });
      const days = b.studyDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      update.studyDays = [...new Set(days)];
    }

    if (b.tone !== undefined) update.tone = String(b.tone);
    if (b.difficulty !== undefined) update.difficulty = String(b.difficulty);

    const prefs = await UserPrefs.findOneAndUpdate(
      { userId },
      { $set: update, $setOnInsert: { userId } },
      { new: true, upsert: true }
    );

    res.json({ ok: true, prefs });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
