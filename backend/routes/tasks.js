// backend/routes/tasks.js
const express = require("express");
const mongoose = require("mongoose");
const Task = require("../models/task");
const requireAuth = require("../middleware/requireAuth");

// ✅ Gamification (you must create these files)
// backend/models/UserProgress.js
// backend/lib/gamification.js
const UserProgress = require("../models/UserProgress");
const { computeTaskXp, applyXp } = require("../lib/gamification");

const router = express.Router();
router.use(requireAuth);

const ALLOWED_PRIORITIES = new Set(["low", "medium", "high"]);

function parseBool(v) {
  if (v === true || v === false) return v;
  if (typeof v !== "string") return undefined;
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  return undefined;
}

function parseDateOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? "INVALID" : d;
}

function priorityWeight(p) {
  const x = String(p || "medium").toLowerCase();
  if (x === "high") return 3;
  if (x === "medium") return 2;
  return 1;
}

// Used only for sorting/ranking lists (not XP calc)
function rankScore(t) {
  const p = String(t.priority || "medium").toLowerCase();
  const pScore = p === "high" ? 100 : p === "low" ? 30 : 60;

  let urgency = 0;
  if (t.deadline) {
    const dueMs = new Date(t.deadline).getTime();
    if (Number.isFinite(dueMs)) {
      const hours = (dueMs - Date.now()) / 36e5;
      if (hours <= 24) urgency = 40;
      else if (hours <= 72) urgency = 20;
      else if (hours <= 168) urgency = 10;
    }
  }

  const effort = Math.min(Math.floor((t.estMinutes || 60) / 10), 10);
  return pScore + urgency + effort;
}

async function ensureProgress(session, userId) {
  return UserProgress.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        level: 1,
        xp: 0,
        totalXp: 0,
        tasksCompleted: 0,
        streak: 0,
        lastCompletedAt: null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
}

/**
 * GET /tasks?limit=50&completed=true|false&priority=high&subject=Math&sort=deadline|priority|ranked|createdAt
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;

    const limit = Math.min(Number(req.query.limit || 50), 300);
    const completed = parseBool(req.query.completed);

    const filter = { userId };

    if (completed !== undefined) filter.completed = completed;

    if (req.query.priority) {
      const p = String(req.query.priority).toLowerCase();
      if (!ALLOWED_PRIORITIES.has(p)) {
        return res.status(400).json({ message: "priority must be low|medium|high" });
      }
      filter.priority = p;
    }

    if (req.query.subject) filter.subject = String(req.query.subject);

    if (req.query.deadlineFrom || req.query.deadlineTo) {
      filter.deadline = {};
      if (req.query.deadlineFrom) {
        const dFrom = parseDateOrNull(req.query.deadlineFrom);
        if (dFrom === "INVALID") return res.status(400).json({ message: "Invalid deadlineFrom" });
        filter.deadline.$gte = dFrom;
      }
      if (req.query.deadlineTo) {
        const dTo = parseDateOrNull(req.query.deadlineTo);
        if (dTo === "INVALID") return res.status(400).json({ message: "Invalid deadlineTo" });
        filter.deadline.$lte = dTo;
      }
    }

    const sortKey = String(req.query.sort || "createdAt");

    // ✅ ranked/priority sorting needs custom ordering, so we sort in memory
    if (sortKey === "ranked" || sortKey === "priority") {
      const tasks = await Task.find(filter).limit(limit).lean();

      if (sortKey === "priority") {
        tasks.sort((a, b) => {
          const pw = priorityWeight(b.priority) - priorityWeight(a.priority);
          const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
          const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
          return pw || ad - bd || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      } else {
        // ranked
        tasks.sort((a, b) => {
          const s = rankScore(b) - rankScore(a);
          const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
          const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
          return s || ad - bd || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      }

      return res.json(tasks);
    }

    // Default DB sorts
    let sort = { createdAt: -1 };
    if (sortKey === "deadline") sort = { deadline: 1, createdAt: -1 };

    const tasks = await Task.find(filter).sort(sort).limit(limit);
    return res.json(tasks);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

/**
 * GET /tasks/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid task id" });
    }

    const task = await Task.findOne({ _id: id, userId });
    if (!task) return res.status(404).json({ message: "Task not found" });

    return res.json(task);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

/**
 * POST /tasks
 */
router.post("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { title, subject, priority, deadline, estMinutes } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ message: "title is required" });
    }

    let p = priority ? String(priority).toLowerCase() : "medium";
    if (!ALLOWED_PRIORITIES.has(p)) {
      return res.status(400).json({ message: "priority must be low|medium|high" });
    }

    const d = parseDateOrNull(deadline);
    if (d === "INVALID") return res.status(400).json({ message: "Invalid deadline" });

    const minutes = estMinutes !== undefined ? Number(estMinutes) : 60;
    if (!Number.isFinite(minutes) || minutes < 0) {
      return res.status(400).json({ message: "estMinutes must be a valid number >= 0" });
    }

    const task = await Task.create({
      userId,
      title: String(title).trim(),
      subject: typeof subject === "string" ? subject : "",
      priority: p,
      deadline: d || undefined,
      estMinutes: minutes,
      // xpAwarded defaults false in schema
    });

    return res.status(201).json(task);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

/**
 * PATCH /tasks/:id
 * - When completed=true: awards XP ONCE (xpAwarded guard) + updates UserProgress
 * - When completed=false: does NOT remove XP (prevents farming); xpAwarded stays true if it was awarded
 */
router.patch("/:id", async (req, res) => {
  const userId = req.userId;
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid task id" });
  }

  // Build validated updates (keep your existing validations)
  const update = {};

  if (req.body.title !== undefined) {
    const t = String(req.body.title).trim();
    if (!t) return res.status(400).json({ message: "title cannot be empty" });
    update.title = t;
  }

  if (req.body.subject !== undefined) {
    update.subject = typeof req.body.subject === "string" ? req.body.subject : "";
  }

  if (req.body.priority !== undefined) {
    const p = String(req.body.priority).toLowerCase();
    if (!ALLOWED_PRIORITIES.has(p)) return res.status(400).json({ message: "priority must be low|medium|high" });
    update.priority = p;
  }

  if (req.body.deadline !== undefined) {
    const d = parseDateOrNull(req.body.deadline);
    if (d === "INVALID") return res.status(400).json({ message: "Invalid deadline" });
    update.deadline = d === null ? undefined : d;
  }

  if (req.body.estMinutes !== undefined) {
    const minutes = Number(req.body.estMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) {
      return res.status(400).json({ message: "estMinutes must be a valid number >= 0" });
    }
    update.estMinutes = minutes;
  }

  // If completion isn't being changed, keep old fast path
  if (req.body.completed === undefined) {
    try {
      const updated = await Task.findOneAndUpdate({ _id: id, userId }, update, { new: true });
      if (!updated) return res.status(404).json({ message: "Task not found" });
      return res.json(updated);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }

  // ✅ Completion is being changed -> transactional award logic
  const desiredCompleted = Boolean(req.body.completed);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const task = await Task.findOne({ _id: id, userId }).session(session);
    if (!task) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Task not found" });
    }

    // Apply other updates
    for (const [k, v] of Object.entries(update)) {
      task[k] = v;
    }

    let xpGained = 0;
    let leveledUp = false;
    let progressSnapshot = null;

    if (desiredCompleted) {
      task.completed = true;
      task.completedAt = new Date();

      // Award XP once only
      if (!task.xpAwarded) {
        xpGained = computeTaskXp(task);
        task.xpAwarded = true;

        const progress = await ensureProgress(session, userId);
        const before = { level: progress.level, xp: progress.xp, totalXp: progress.totalXp };
        const after = applyXp(before, xpGained);

        leveledUp = after.level > before.level;

        progress.level = after.level;
        progress.xp = after.xp;
        progress.totalXp = after.totalXp;
        progress.tasksCompleted += 1;
        progress.lastCompletedAt = new Date();

        await progress.save({ session });

        progressSnapshot = after;
      }
    } else {
      // Un-complete: DO NOT remove XP; prevent XP farming
      task.completed = false;
      task.completedAt = undefined;
      // keep xpAwarded as-is
    }

    await task.save({ session });
    await session.commitTransaction();

    // ✅ Backwards-compatible: return task as before, plus optional _gamification metadata
    const out = task.toObject();
    if (desiredCompleted) {
      out._gamification = {
        xpGained,
        leveledUp,
        progress: progressSnapshot, // null if xp was already awarded
      };
    }

    return res.json(out);
  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({ message: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * DELETE /tasks/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid task id" });

    const deleted = await Task.findOneAndDelete({ _id: id, userId });
    if (!deleted) return res.status(404).json({ message: "Task not found" });

    return res.json({ ok: true, deletedId: id });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;

