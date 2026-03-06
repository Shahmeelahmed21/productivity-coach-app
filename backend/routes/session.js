// backend/routes/session.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const requireAuth = require("../middleware/requireAuth");
const StudySession = require("../models/StudySession");

router.use(requireAuth);

// helper: compute minutes if client doesn't send actualMinutes
function diffMinutes(start, end) {
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / 60000));
}

/**
 * GET /sessions/active
 * Returns current active session (endedAt=null) if any
 */
router.get("/active", async (req, res) => {
  try {
    const userId = req.userId;
    const active = await StudySession.findOne({ userId, endedAt: null }).sort({ startedAt: -1 });
    res.json({ ok: true, active: active || null });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * POST /sessions/start
 * body: { plannedMinutes?, taskId? }
 */
router.post("/start", async (req, res) => {
  try {
    const userId = req.userId;
    const { plannedMinutes, taskId } = req.body || {};

    // optional: prevent multiple active sessions
    const existing = await StudySession.findOne({ userId, endedAt: null });
    if (existing) {
      return res.status(409).json({
        ok: false,
        message: "You already have an active session",
        activeSessionId: existing._id,
      });
    }

    let taskObjectId = null;
    if (taskId) {
      if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return res.status(400).json({ ok: false, message: "Invalid taskId" });
      }
      taskObjectId = taskId;
    }

    const pm = plannedMinutes !== undefined ? Number(plannedMinutes) : 25;
    if (!Number.isFinite(pm) || pm <= 0 || pm > 300) {
      return res.status(400).json({ ok: false, message: "plannedMinutes must be 1..300" });
    }

    const session = await StudySession.create({
      userId,
      taskId: taskObjectId,
      plannedMinutes: pm,
      actualMinutes: 0,
      startedAt: new Date(),
      endedAt: null,
      completed: false,
      endReason: "",
      endNote: "",
    });

    res.status(201).json({ ok: true, session });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * POST /sessions/end/:id
 * body: { completed, actualMinutes?, endReason?, endNote? }
 */
router.post("/end/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "Invalid session id" });
    }

    const session = await StudySession.findOne({ _id: id, userId });
    if (!session) return res.status(404).json({ ok: false, message: "Session not found" });
    if (session.endedAt) return res.status(400).json({ ok: false, message: "Session already ended" });

    const now = new Date();
    const completed = Boolean(req.body?.completed);

    let actualMinutes = req.body?.actualMinutes;
    actualMinutes =
      actualMinutes === undefined || actualMinutes === null || actualMinutes === ""
        ? diffMinutes(session.startedAt, now)
        : Number(actualMinutes);

    if (!Number.isFinite(actualMinutes) || actualMinutes < 0 || actualMinutes > 600) {
      return res.status(400).json({ ok: false, message: "actualMinutes must be 0..600" });
    }

    const endReason = req.body?.endReason ? String(req.body.endReason) : "";
    const endNote = req.body?.endNote ? String(req.body.endNote) : "";

    session.endedAt = now;
    session.completed = completed;
    session.actualMinutes = actualMinutes;

    // only keep reason/note if NOT completed
    session.endReason = completed ? "" : endReason;
    session.endNote = completed ? "" : endNote;

    await session.save();

    res.json({ ok: true, session });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * GET /sessions?limit=50&from=ISO&to=ISO&completed=true|false
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;

    const limit = Math.min(Number(req.query.limit || 50), 200);
    const completed =
      req.query.completed === "true" ? true : req.query.completed === "false" ? false : undefined;

    const filter = { userId };

    if (completed !== undefined) filter.completed = completed;

    if (req.query.from || req.query.to) {
      filter.startedAt = {};
      if (req.query.from) filter.startedAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.startedAt.$lte = new Date(req.query.to);
    }

    const sessions = await StudySession.find(filter)
      .sort({ startedAt: -1 })
      .limit(limit);

    res.json({ ok: true, sessions });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * GET /sessions/stats?days=7
 * Returns counts + minutes in last N days
 */
router.get("/stats", async (req, res) => {
  try {
    const userId = req.userId;
    const days = Math.min(Math.max(Number(req.query.days || 7), 1), 90);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const agg = await StudySession.aggregate([
      { $match: { userId, startedAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          completedSessions: { $sum: { $cond: ["$completed", 1, 0] } },
          abandonedSessions: {
            $sum: {
              $cond: [{ $and: [{ $ne: ["$endedAt", null] }, { $eq: ["$completed", false] }] }, 1, 0],
            },
          },
          totalPlannedMinutes: { $sum: "$plannedMinutes" },
          totalActualMinutes: { $sum: "$actualMinutes" },
        },
      },
    ]);

    const s = agg[0] || {
      totalSessions: 0,
      completedSessions: 0,
      abandonedSessions: 0,
      totalPlannedMinutes: 0,
      totalActualMinutes: 0,
    };

    res.json({ ok: true, days, stats: s });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
