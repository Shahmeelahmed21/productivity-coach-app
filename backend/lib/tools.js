// backend/lib/tools.js
const mongoose = require("mongoose");
const Task = require("../models/task");

function cleanTitle(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

async function createSubtasks({ userId, parentTaskId, subtasks }) {
  if (!mongoose.Types.ObjectId.isValid(parentTaskId)) {
    throw new Error("Invalid parentTaskId");
  }

  const parent = await Task.findOne({ _id: parentTaskId, userId }).lean();
  if (!parent) throw new Error("Parent task not found");
  if (parent.isSubtask) throw new Error("Cannot create subtasks for a subtask");

  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    throw new Error("No subtasks provided");
  }

  const items = subtasks.slice(0, 8).map((s, idx) => ({
    userId,
    title: cleanTitle(s.title),
    subject: parent.subject || "",
    priority: parent.priority || "medium",
    deadline: parent.deadline || null,
    estMinutes: clamp(s.estMinutes ?? 10, 5, 30),
    completed: false,
    completedAt: null,

    parentId: parent._id,
    isSubtask: true,
    order: clamp(s.order ?? idx + 1, 1, 1000),
  }));

  // Remove empty & duplicates by title
  const seen = new Set();
  const deduped = items.filter((t) => {
    if (!t.title) return false;
    const key = t.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const created = await Task.insertMany(deduped);
  return { parent, created };
}

module.exports = { createSubtasks };