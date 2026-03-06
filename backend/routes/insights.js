// backend/routes/insights.js
const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/requireAuth");
const UserPrefs = require("../models/UserPrefs");
const Task = require("../models/task");


const FocusSession = require("../models/StudySession");

router.use(requireAuth);


function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function dateKeyInTZ(dateLike, timeZone) {
  const d = new Date(dateLike);
  if (!Number.isFinite(d.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!y || !m || !day) return null;
  return `${y}-${m}-${day}`; 
}

function addDaysKey(yyyyMmDd, deltaDays) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function weekdayLetter(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const map = ["S", "M", "T", "W", "T", "F", "S"];
  return map[dt.getUTCDay()];
}

function computeStreak(workDaySet, todayKey) {
  
  let cur = 0;
  let k = todayKey;
  while (workDaySet.has(k)) {
    cur += 1;
    k = addDaysKey(k, -1);
  }


  const keys = Array.from(workDaySet).sort();
  let best = 0;
  let run = 0;
  for (let i = 0; i < keys.length; i++) {
    if (i === 0) run = 1;
    else {
      const expected = addDaysKey(keys[i - 1], 1);
      run = keys[i] === expected ? run + 1 : 1;
    }
    best = Math.max(best, run);
  }

  return { current: cur, best };
}


function taskCompletedDate(t) {
  return t.completedAt || t.updatedAt || t.createdAt;
}


function buildDayKeys(now, days, timeZone) {
  const todayKey = dateKeyInTZ(now, timeZone);
  if (!todayKey) return [];
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(addDaysKey(todayKey, -i));
  return out;
}


async function computeInsights({ userId, days, timeZone }) {
  const now = new Date();
  const dayKeys = buildDayKeys(now, days, timeZone);
  if (!dayKeys.length) throw new Error("Failed to compute day keys");

 
  const startKey = dayKeys[0];
  const [y, m, d] = startKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d)); 

 
  const sessions = await FocusSession.find({
    userId,
    endedAt: { $ne: null, $gte: start },
  })
    .sort({ endedAt: -1 })
    .lean();

 
  const tasksCompletedDocs = await Task.find({
    userId,
    completed: true,
    $or: [
      { completedAt: { $gte: start } },
     
      { completedAt: { $exists: false }, updatedAt: { $gte: start } },
      { completedAt: null, updatedAt: { $gte: start } },
    ],
  })
    .sort({ updatedAt: -1 })
    .lean();


  const dailyMap = {};
  dayKeys.forEach((k) => {
    dailyMap[k] = {
      date: k,
      weekday: weekdayLetter(k),
      focusMinutes: 0,
      sessionsCompleted: 0,
      sessionsEndedEarly: 0,
      tasksCompleted: 0,
    };
  });


  for (const s of sessions) {
    const key = dateKeyInTZ(s.endedAt || s.startedAt, timeZone);
    if (!key || !dailyMap[key]) continue;

    const actual = Number(s.actualMinutes ?? 0);
    const planned = Number(s.plannedMinutes ?? 0);
    const addMinutes = Number.isFinite(actual) && actual > 0 ? actual : planned;

    if (Number.isFinite(addMinutes) && addMinutes > 0) {
      dailyMap[key].focusMinutes += addMinutes;
    }

    if (s.completed) dailyMap[key].sessionsCompleted += 1;
    else dailyMap[key].sessionsEndedEarly += 1;
  }

 
  for (const t of tasksCompletedDocs) {
    const when = taskCompletedDate(t);
    const key = dateKeyInTZ(when, timeZone);
    if (!key || !dailyMap[key]) continue;
    dailyMap[key].tasksCompleted += 1;
  }

  const daily = dayKeys.map((k) => dailyMap[k]);

  const totalFocusMinutes = daily.reduce((a, d) => a + d.focusMinutes, 0);
  const totalSessionsCompleted = daily.reduce((a, d) => a + d.sessionsCompleted, 0);
  const totalSessionsEndedEarly = daily.reduce((a, d) => a + d.sessionsEndedEarly, 0);
  const totalTasksCompleted = daily.reduce((a, d) => a + d.tasksCompleted, 0);

  const totalSessionsEnded = totalSessionsCompleted + totalSessionsEndedEarly;
  const completionRate =
    totalSessionsEnded === 0 ? 0 : Math.round((totalSessionsCompleted / totalSessionsEnded) * 100);


  const WORKDAY_MIN_FOCUS = 10;
  const lookbackDays = 120;
  const lookbackStart = new Date(Date.now() - (lookbackDays - 1) * 86400000);

  const sessionsLB = await FocusSession.find({
    userId,
    endedAt: { $ne: null, $gte: lookbackStart },
  })
    .select("endedAt startedAt actualMinutes plannedMinutes completed")
    .lean();

  const tasksLB = await Task.find({
    userId,
    completed: true,
    $or: [
      { completedAt: { $gte: lookbackStart } },
      { completedAt: { $exists: false }, updatedAt: { $gte: lookbackStart } },
      { completedAt: null, updatedAt: { $gte: lookbackStart } },
    ],
  })
    .select("completedAt updatedAt createdAt")
    .lean();

  const dayAgg = new Map();
  const bump = (k, patch) => {
    const cur = dayAgg.get(k) || { focus: 0, tasks: 0 };
    dayAgg.set(k, {
      focus: cur.focus + (patch.focus || 0),
      tasks: cur.tasks + (patch.tasks || 0),
    });
  };

  for (const s of sessionsLB) {
    const k = dateKeyInTZ(s.endedAt || s.startedAt, timeZone);
    if (!k) continue;
    const actual = Number(s.actualMinutes ?? 0);
    const planned = Number(s.plannedMinutes ?? 0);
    const add = Number.isFinite(actual) && actual > 0 ? actual : planned;
    bump(k, { focus: Number.isFinite(add) ? add : 0 });
  }

  for (const t of tasksLB) {
    const k = dateKeyInTZ(taskCompletedDate(t), timeZone);
    if (!k) continue;
    bump(k, { tasks: 1 });
  }

  const workDaysAll = new Set();
  for (const [k, v] of dayAgg.entries()) {
    if (v.focus >= WORKDAY_MIN_FOCUS || v.tasks >= 1) workDaysAll.add(k);
  }

  const todayKey = dateKeyInTZ(now, timeZone);
  const streak = todayKey ? computeStreak(workDaysAll, todayKey) : { current: 0, best: 0 };

  
  const workDoneScore = totalFocusMinutes + totalTasksCompleted * 30;

  const recentSessions = sessions.slice(0, 5).map((s) => ({
    _id: s._id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    plannedMinutes: s.plannedMinutes,
    actualMinutes: s.actualMinutes,
    completed: !!s.completed,
    endReason: s.endReason || "",
    endNote: s.endNote || "",
  }));

  const recentTasks = tasksCompletedDocs.slice(0, 5).map((t) => ({
    _id: t._id,
    title: t.title,
    subject: t.subject || "",
    completedAt: taskCompletedDate(t),
  }));

  return {
    timeZone,
    days,
    totals: {
      focusMinutes: totalFocusMinutes,
      sessionsCompleted: totalSessionsCompleted,
      sessionsEndedEarly: totalSessionsEndedEarly,
      completionRate,
      tasksCompleted: totalTasksCompleted,
      workDoneScore,
    },
    streak,
    daily,
    recent: { sessions: recentSessions, tasks: recentTasks },
  };
}

router.get("/stats", async (req, res) => {
  try {
    const userId = req.userId;
    const days = clampInt(req.query.days, 1, 365, 7);

    const prefs = (await UserPrefs.findOne({ userId }).lean()) || {};
    const timeZone = prefs.timezone || "Europe/London";

    const data = await computeInsights({ userId, days, timeZone });

    
    return res.json({
      ok: true,
      timeZone: data.timeZone,
      days: data.days,
      totals: data.totals,
      streak: data.streak,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});


router.get("/dashboard", async (req, res) => {
  try {
    const userId = req.userId;
    const days = clampInt(req.query.days, 1, 60, 7);

    const prefs = (await UserPrefs.findOne({ userId }).lean()) || {};
    const timeZone = prefs.timezone || "Europe/London";

    const data = await computeInsights({ userId, days, timeZone });

    return res.json({ ok: true, ...data });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
