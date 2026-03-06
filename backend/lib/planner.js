// backend/lib/planner.js

function toMins(hhmm) {
  if (!hhmm) return null;
  const [hh, mm] = String(hhmm).split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function minsToHHMM(mins) {
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function nowHHMMInTZ(timeZone) {
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  // "HH:MM"
  return s;
}

function todayKeyInTZ(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`; // YYYY-MM-DD
}

function priorityWeight(p) {
  const x = String(p || "medium").toLowerCase();
  if (x === "high") return 0;
  if (x === "medium") return 1;
  return 2;
}

/**
 * generateDailyPlan
 * returns: { day, blocks: [{type,start,end,minutes,title,taskId?}], meta }
 */
function generateDailyPlan({ tasks, prefs, mood }) {
  const timeZone = prefs?.timezone || "Europe/London";
  const day = todayKeyInTZ(timeZone);

  const focus = Number(prefs?.focusBlockMinutes ?? 25);
  const shortBreak = Number(prefs?.shortBreakMinutes ?? 5);
  const longBreak = Number(prefs?.longBreakMinutes ?? 15);

  const workStart = prefs?.workHours?.start || "09:00";
  const workEnd = prefs?.workHours?.end || "17:00";

  const nowHHMM = nowHHMMInTZ(timeZone);
  let startMin = Math.max(toMins(nowHHMM) ?? 0, toMins(workStart) ?? 540);
  const endMin = toMins(workEnd) ?? 1020;

  // if day is basically over
  if (startMin >= endMin) {
    return {
      day,
      blocks: [],
      meta: {
        message: "No time left in today’s work window.",
        window: { start: workStart, end: workEnd, now: nowHHMM },
      },
    };
  }

  // Mood-aware tweak (lightweight)
  const energy = mood?.energy ?? null;
  const effectiveFocus =
    energy !== null && energy <= 2 ? Math.max(15, Math.min(focus, 25)) : focus;

  // Sort tasks: earliest deadline first, then priority
  const sortable = (tasks || [])
    .filter((t) => !t.completed)
    .map((t) => ({
      ...t,
      _deadline: t.deadline ? new Date(t.deadline).getTime() : Number.POSITIVE_INFINITY,
      _p: priorityWeight(t.priority),
      _remaining: Number(t.estMinutes ?? 60),
    }))
    .sort((a, b) => a._deadline - b._deadline || a._p - b._p);

  const blocks = [];
  let cursor = startMin;
  let focusCount = 0;

  const pushBlock = (b) => blocks.push(b);

  for (const task of sortable) {
    while (task._remaining > 0 && cursor < endMin) {
      const dur = Math.min(effectiveFocus, task._remaining, endMin - cursor);
      if (dur <= 0) break;

      // focus block
      pushBlock({
        type: "focus",
        taskId: String(task._id),
        title: task.title,
        start: minsToHHMM(cursor),
        end: minsToHHMM(cursor + dur),
        minutes: dur,
      });

      cursor += dur;
      task._remaining -= dur;
      focusCount += 1;

      // break
      if (cursor >= endMin) break;

      const breakDur = focusCount % 4 === 0 ? longBreak : shortBreak;
      const bdur = Math.min(breakDur, endMin - cursor);

      pushBlock({
        type: "break",
        title: focusCount % 4 === 0 ? "Long break" : "Short break",
        start: minsToHHMM(cursor),
        end: minsToHHMM(cursor + bdur),
        minutes: bdur,
      });

      cursor += bdur;
    }

    if (cursor >= endMin) break;
  }

  // If no tasks, still return a helpful skeleton
  if (blocks.length === 0) {
    return {
      day,
      blocks: [
        {
          type: "focus",
          title: "Pick 1 priority task and start",
          start: minsToHHMM(startMin),
          end: minsToHHMM(Math.min(startMin + effectiveFocus, endMin)),
          minutes: Math.min(effectiveFocus, endMin - startMin),
        },
      ],
      meta: {
        window: { start: workStart, end: workEnd, now: nowHHMM },
        note: "No tasks found, so this is a starter focus block.",
      },
    };
  }

  return {
    day,
    blocks,
    meta: {
      window: { start: workStart, end: workEnd, now: nowHHMM },
      usedFocusMinutes: effectiveFocus,
      energy: energy ?? null,
    },
  };
}

module.exports = { generateDailyPlan };