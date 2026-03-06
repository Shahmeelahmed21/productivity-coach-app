// backend/lib/gamification.js

function priorityBaseXp(priority) {
  const p = String(priority || "medium").toLowerCase();
  if (p === "high") return 50;
  if (p === "low") return 15;
  return 30;
}

function urgencyBonus(deadline) {
  if (!deadline) return 0;
  const dueMs = new Date(deadline).getTime();
  if (!Number.isFinite(dueMs)) return 0;

  const hours = (dueMs - Date.now()) / 36e5;

  if (hours <= 24) return 40;
  if (hours <= 72) return 20;
  if (hours <= 168) return 10;
  return 0;
}

function computeTaskXp(task) {
  if (!task) return 0;

  if (Number.isFinite(task.xpValue)) return Math.max(0, Math.floor(task.xpValue));

  const base = priorityBaseXp(task.priority);
  const urgency = urgencyBonus(task.deadline);
  const effort = Math.min(Math.floor((task.estMinutes || 60) / 10), 10);

  let xp = base + urgency + effort;

  // subtasks give less
  if (task.isSubtask) xp = Math.floor(xp * 0.3);

  return Math.max(5, xp);
}

function xpToNextLevel(level) {
  return 100 + (Math.max(1, Number(level || 1)) - 1) * 50;
}

function applyXp({ level, xp, totalXp }, gainedXp) {
  let L = Number(level || 1);
  let X = Number(xp || 0);
  let T = Number(totalXp || 0);

  let remaining = Math.max(0, Math.floor(gainedXp || 0));

  while (remaining > 0) {
    const need = xpToNextLevel(L) - X;

    if (remaining >= need) {
      X += need;
      T += need;
      remaining -= need;

      // level up
      L += 1;
      X = 0;
    } else {
      X += remaining;
      T += remaining;
      remaining = 0;
    }
  }

  return { level: L, xp: X, totalXp: T };
}

module.exports = { computeTaskXp, xpToNextLevel, applyXp };

function computeTaskXp(task) {
  if (!task) return 0;

  // Optional fixed XP override
  if (Number.isFinite(task.xpValue)) return Math.max(0, Math.floor(task.xpValue));

  const base = priorityBaseXp(task.priority);
  const urgency = urgencyBonus(task.deadline);
  const effort = Math.min(Math.floor((task.estMinutes || 60) / 10), 10);

  let xp = base + urgency + effort;

  // Subtasks give less XP
  if (task.isSubtask) xp = Math.floor(xp * 0.3);

  return Math.max(5, xp);
}

function xpToNextLevel(level) {
  return 100 + (Math.max(1, level) - 1) * 50;
}

function applyXp({ level, xp, totalXp }, gainedXp) {
  let L = Number(level || 1);
  let X = Number(xp || 0);
  let T = Number(totalXp || 0);

  let remaining = Math.max(0, Math.floor(gainedXp || 0));

  while (remaining > 0) {
    const need = xpToNextLevel(L) - X;
    if (remaining >= need) {
      X += need;
      T += need;
      remaining -= need;

      // level up
      L += 1;
      X = 0;
    } else {
      X += remaining;
      T += remaining;
      remaining = 0;
    }
  }

  return { level: L, xp: X, totalXp: T };
}

module.exports = { computeTaskXp, xpToNextLevel, applyXp };