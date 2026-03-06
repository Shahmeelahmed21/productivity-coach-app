// backend/routes/chat.js

const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/requireAuth");
const ChatMessage = require("../models/ChatMessage");
const UserPrefs = require("../models/UserPrefs");
const Task = require("../models/task");
const MoodEntry = require("../models/MoodEntry");

const { ollamaChat } = require("../lib/ollamaClient");
const { retrieveTopK } = require("../lib/retriever");
const { generateDailyPlan } = require("../lib/planner");
const { createSubtasks } = require("../lib/tools");

// Date parsing libs
const chrono = require("chrono-node");
const { DateTime } = require("luxon");

const MAX_TASKS_IN_PROMPT = 5;
const MAX_HISTORY_LINES = 3;
const MAX_RETRIEVED_CONTEXT_CHARS = 1200;

const DEFAULT_TASK_COLOR = "#2EAD67"; // safe fallback if your Task schema requires color

// -----------------------------
// Timezone + date helpers
// -----------------------------
function getUserZone(prefs) {
  const z = prefs?.timezone;
  return typeof z === "string" && z.trim() ? z.trim() : "Europe/London";
}

function chronoResultToUtcISO(result, zone, { defaultToEndOfDay = true } = {}) {
  const start = result?.start;
  if (!start) return null;

  const year = start.get("year");
  const month = start.get("month");
  const day = start.get("day");
  if (!year || !month || !day) return null;

  const hasHour = start.isCertain("hour");
  const hasMinute = start.isCertain("minute");

  let hour, minute;
  if (hasHour || hasMinute) {
    hour = hasHour ? start.get("hour") : 0;
    minute = hasMinute ? start.get("minute") : 0;
  } else if (defaultToEndOfDay) {
    hour = 23;
    minute = 59;
  } else {
    hour = 9;
    minute = 0;
  }

  const dt = DateTime.fromObject(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { zone }
  );

  if (!dt.isValid) return null;
  return dt.toUTC().toISO();
}

function parseDateFromMessage(msg, prefs, opts) {
  const zone = getUserZone(prefs);
  const text = String(msg || "").trim();
  if (!text) return null;

  const ref = DateTime.now().setZone(zone).toJSDate();
  const results = chrono.en.GB.parse(text, ref, { forwardDate: true });

  if (!results || results.length === 0) {
    // Fallback: ISO-like pattern
    const isoMatch = text.match(
      /\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?\b/
    );
    if (!isoMatch) return null;

    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);

    const defaultToEndOfDay = Boolean(opts?.defaultToEndOfDay);
    const hour = isoMatch[4] ? Number(isoMatch[4]) : defaultToEndOfDay ? 23 : 9;
    const minute = isoMatch[5] ? Number(isoMatch[5]) : defaultToEndOfDay ? 59 : 0;

    const dt = DateTime.fromObject({ year, month, day, hour, minute }, { zone });
    return dt.isValid ? dt.toUTC().toISO() : null;
  }

  return chronoResultToUtcISO(results[0], zone, opts);
}

// For planning: if no time is given, default to morning so schedules look sane.
function parsePlanTargetDate(msg, prefs) {
  return parseDateFromMessage(msg, prefs, { defaultToEndOfDay: false });
}

function formatTargetDateLabel(targetDateISO, prefs) {
  if (!targetDateISO) return "today";
  const zone = getUserZone(prefs);
  const dt = DateTime.fromISO(targetDateISO, { zone: "utc" }).setZone(zone);
  if (!dt.isValid) return "today";
  return dt.toFormat("cccc d LLL yyyy"); // e.g., "Tuesday 3 Mar 2026"
}

function formatAbsoluteDateLabel(dateISO, prefs) {
  if (!dateISO) return null;
  const zone = getUserZone(prefs);
  const dt = DateTime.fromISO(dateISO, { zone: "utc" }).setZone(zone);
  if (!dt.isValid) return null;
  return dt.toFormat("cccc d LLL yyyy");
}

// -----------------------------
// Intent detection
// -----------------------------
function isPlanIntent(text) {
  const m = String(text || "").toLowerCase().trim();

  if (
    m.includes("plan my day") ||
    m.includes("schedule my day") ||
    m.includes("make me a plan") ||
    m.includes("time block") ||
    m.includes("timeblock") ||
    m === "plan"
  ) return true;

  if (/^(plan|schedule)\b/.test(m)) return true;

  if (
    /\bplan\b/.test(m) &&
    /\b(today|tomorrow|tonight|next|this|on|by|before|after)\b/.test(m)
  ) return true;

  return false;
}

function isTaskCreateIntent(text) {
  const m = String(text || "").toLowerCase().trim();

  // "create/add/make/set up a task ..."
  if (/\b(create|add|make|setup|set up|set)\b.*\b(task|tasks|todo|to-do)\b/.test(m))
    return true;

  // "remind me to finish chapter 4 tomorrow"
  if (/^remind me to\b/.test(m)) return true;

  return false;
}

function isMicroStepIntent(text) {
  const m = String(text || "").toLowerCase();
  return (
    m.includes("2 minute") ||
    m.includes("2-minute") ||
    m.includes("first step") ||
    m.includes("next step") ||
    m.includes("break down") ||
    m.includes("breakdown") ||
    m.includes("break it down") ||
    m.includes("tasks further")
  );
}

function isSubtaskCreateIntent(text) {
  const m = String(text || "").toLowerCase();

  // Action verbs that signal creation
  const actionVerbs =
    /\b(create|make|generate|give me|add|build|write|list|get|prepare|set up|come up with|draft|form|set)\b/;

  // ✅ IMPORTANT: removed "tasks?" to avoid "set up task ..." triggering subtasks
  const subtaskNouns =
    /\b(subtasks?|sub-tasks?|sub tasks?|steps?|checklist|action items?|objectives?|breakdown|chunks?|pieces?|parts?)\b/;

  if (m.includes("subtask")) return true;
  if (m.includes("sub-task")) return true;
  if (m.includes("actionable steps")) return true;
  if (m.includes("actionable objectives")) return true;
  if (m.includes("break this task")) return true;
  if (m.includes("split this task")) return true;
  if (m.includes("split into")) return true;
  if (m.includes("turn into")) return true;

  // "break [anything] into ..."
  if (/break.{0,30}\binto\b/.test(m)) return true;

  // allow "break down into tasks/steps/parts" (safe; doesn't collide with "set up task")
  if (/break.{0,20}\bdown\b.{0,20}\b(steps?|tasks?|parts?|chunks?|pieces?)/.test(m))
    return true;

  if (actionVerbs.test(m) && subtaskNouns.test(m)) return true;
  if (/split.{0,40}into/.test(m)) return true;
  if (/divide.{0,40}into/.test(m)) return true;

  if (/what.{0,10}(are|would be).{0,15}steps?\b/.test(m)) return true;

  if (
    /how\s+(do|should|can|would)\s+(i|we)\s+(start|tackle|approach|do|break|begin|work on)\b/.test(m)
  ) return true;

  return false;
}

function isStartFocusIntent(text) {
  const m = String(text || "").toLowerCase().trim();

  if (m.includes("pomodoro")) return true;
  if (m.includes("focus session")) return true;
  if (m.includes("focus timer")) return true;
  if (m.includes("start focus")) return true;
  if (m.includes("focus now")) return true;
  if (m.includes("focus mode")) return true;
  if (m.includes("work session")) return true;
  if (m.includes("study session")) return true;
  if (m.includes("study timer")) return true;

  if (/(start|begin|run|set|kick off|launch)\s+(a\s+)?(timer|session|focus|clock)\b/.test(m))
    return true;

  if (/^focus\b/.test(m)) return true;
  if (/\bfocus\s+for\b/.test(m)) return true;

  if (/\btimer\b/.test(m) && /\d+/.test(m)) return true;

  if (/\btime\s+me\b/.test(m)) return true;

  if (/(i\s+want\s+to|let\s+me|help\s+me|i('ll|'m going to|will))\s+focus\b/.test(m))
    return true;

  if (/\bwork\s+for\s+\d+/.test(m)) return true;
  if (/\bstudy\s+for\s+(\d+|a|an)\b/.test(m)) return true;

  if (/\b(do|run|start|begin)\s+(a\s+)?\d+[\s-]?(min|minute|hour|hr)/.test(m))
    return true;

  if (/\d+\s*(min|mins|minutes|hr|hrs|hours?)\s+of\s+(focus|work|study|studying|working)\b/.test(m))
    return true;

  return false;
}

// -----------------------------
// Task creation helpers
// -----------------------------
function extractTaskTitleFromCreateIntent(text, prefs) {
  let t = String(text || "").trim();
  if (!t) return "";

  t = t
    .replace(/^(please\s+)?(can you|could you|would you)\s+/i, "")
    .replace(
      /^(create|add|make|setup|set up|set|formalise)\s+(me\s+)?(an?\s+)?(new\s+)?(task|tasks|todo|to-do)\s*(to|for)?\s*/i,
      ""
    )
    .replace(/^remind me to\s*/i, "")
    .trim();

  if (!t) return "";

  // Remove leading "called/named"
  t = t.replace(/^(called|named)\s+/i, "").trim();

  // Remove detected date phrase from title
  const zone = getUserZone(prefs);
  const ref = DateTime.now().setZone(zone).toJSDate();
  const hits = chrono.en.GB.parse(t, ref, { forwardDate: true });

  if (hits && hits.length > 0) {
    const first = hits[0];
    const idx = Number(first?.index);
    const raw = String(first?.text || "");
    if (Number.isFinite(idx) && raw) {
      t = `${t.slice(0, idx)} ${t.slice(idx + raw.length)}`;
    }
  }

  t = t
    .replace(/\b(on|by|for|at|before|after|due)\b\s*$/i, "")
    .replace(/^to\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!t) return "";
  if (/^(a\s+)?(task|tasks|todo|to-do)$/i.test(t)) return "";

  return t.slice(0, 140);
}

async function createTaskFromMessage({ userId, msg, prefs }) {
  const title = extractTaskTitleFromCreateIntent(msg, prefs);
  if (!title) return { task: null, title: "", deadlineISO: null, dueLabel: null };

  const deadlineISO = parseDateFromMessage(msg, prefs, { defaultToEndOfDay: true });
  const dueLabel = formatAbsoluteDateLabel(deadlineISO, prefs);

  // NOTE: adjust fields if your Task schema requires/uses different names
  const taskDoc = await Task.create({
    userId,
    title,
    completed: false,
    isSubtask: false,
    priority: "medium",
    estMinutes: 60,
    deadline: deadlineISO || null,

    // safe defaults for common schemas (remove if your schema doesn't have these)
    color: DEFAULT_TASK_COLOR,
    type: "task",
  });

  return { task: taskDoc, title, deadlineISO, dueLabel };
}

// -----------------------------
// Planner + micro-step helpers
// -----------------------------
function formatPlanToReply(plan, dateLabel = "today") {
  if (!plan?.blocks?.length) {
    return `I can't build a plan because there's no time left in your work window ${dateLabel}.\n\nTry updating your Preferences (work hours) or ask me: "plan tomorrow".`;
  }

  const firstFocus = plan.blocks.find((b) => b.type === "focus");
  const starter = firstFocus?.title
    ? `Open your notes and do 2 minutes on: **${firstFocus.title}**`
    : "Open your task list and pick 1 priority item.";

  const lines = plan.blocks.slice(0, 10).map((b) => {
    const label = b.type === "break" ? `🟡 ${b.title}` : `🟢 ${b.title}`;
    return `• ${b.start}–${b.end}  ${label}`;
  });

  const checkpoint = `After the first 2 blocks, reply: "done" and I'll adjust the next blocks.`;

  return `### Plan for ${dateLabel}\n\n**Next 2-minute starter step:**\n${starter}\n\n**Time blocks:**\n${lines.join(
    "\n"
  )}\n\n**Quick checkpoint:**\n${checkpoint}`;
}

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function pWeight(p) {
  const x = String(p || "medium").toLowerCase();
  if (x === "high") return 0;
  if (x === "medium") return 1;
  return 2;
}

function pickBestTask(message, tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;

  const q = new Set(tokenize(message));
  let best = null;
  let bestScore = -1;

  for (const t of tasks) {
    const words = tokenize(t.title);
    let score = 0;
    for (const w of words) if (q.has(w)) score += 1;

    if (String(t.priority || "").toLowerCase() === "high") score += 0.5;
    if (t.deadline) score += 0.2;

    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }

  if (bestScore <= 0) {
    const sorted = [...tasks].sort((a, b) => {
      const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      const ap = pWeight(a.priority);
      const bp = pWeight(b.priority);
      return ad - bd || ap - bp;
    });
    return sorted[0] || null;
  }

  return best;
}

function microStepReply({ taskTitle, moodNow, hasTasks, topTaskTitles }) {
  if (!hasTasks) {
    return `I don't see any incomplete tasks yet.\n\nAdd a task in **Tasks**, then say: "break it down" or "what's the next 2-minute step?"`;
  }

  const energy = moodNow?.energy;
  const lowEnergy = Number.isFinite(energy) && energy <= 2;

  const step = lowEnergy
    ? `Open **${taskTitle}** and do **60s setup** (open worksheet/notes + write today's goal), then **60s**: copy what's *given* and what it's *asking*.`
    : `Open **${taskTitle}**. Spend **2 minutes** on ONLY this: read the first question, underline what's given, and write one line: "We're finding ____ using ____ rule."`;

  const extras = topTaskTitles?.length
    ? `\n\nIf you meant a different task, pick one:\n${topTaskTitles
        .slice(0, 5)
        .map((t, i) => `• ${i + 1}) ${t}`)
        .join("\n")}`
    : "";

  return `**Next 2-minute starter step:**\n${step}\n\n**Quick question:**\nDo you want me to break it into **2-minute chunks** or **25-minute focus blocks**?${extras}`;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(String(s || ""));
  } catch {
    return null;
  }
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeSubtasks(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();

  for (let i = 0; i < arr.length; i++) {
    const raw = arr[i] || {};
    const title = String(raw.title || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 120);
    if (!title) continue;

    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      title,
      estMinutes: clamp(raw.estMinutes ?? 10, 5, 30),
      order: clamp(raw.order ?? i + 1, 1, 1000),
    });

    if (out.length >= 8) break;
  }

  return out;
}

function extractRequestedCount(msg) {
  const m = String(msg || "").toLowerCase();
  const match = m.match(/(\d+)\s*(subtasks|sub-tasks|steps|objectives)/i);
  const n = match ? parseInt(match[1], 10) : NaN;
  if (!Number.isFinite(n)) return 5;
  return Math.max(3, Math.min(8, n));
}

async function proposeSubtasksJSON({ parent, msg, moodNow }) {
  const moodLine = moodNow
    ? `mood=${moodNow.mood}/5 stress=${moodNow.stress}/5 energy=${moodNow.energy}/5`
    : "None";

  const count = extractRequestedCount(msg);

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["tool", "args"],
    properties: {
      tool: { type: "string", const: "create_subtasks" },
      args: {
        type: "object",
        additionalProperties: false,
        required: ["subtasks"],
        properties: {
          subtasks: {
            type: "array",
            minItems: count,
            maxItems: count,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "estMinutes", "order"],
              properties: {
                title: { type: "string", minLength: 3, maxLength: 120 },
                estMinutes: { type: "integer", minimum: 5, maximum: 30 },
                order: { type: "integer", minimum: 1, maximum: 1000 },
              },
            },
          },
        },
      },
    },
  };

  const system =
    "You are a tool planner. Output must match the provided JSON schema exactly. No extra text.";

  const user = `Create EXACTLY ${count} short actionable subtasks.

Parent task: "${parent.title}"
Subject: "${parent.subject || ""}"
Priority: ${parent.priority || "medium"}
Deadline: ${
    parent.deadline ? new Date(parent.deadline).toISOString().slice(0, 10) : "none"
  }
User request: "${msg}"
Mood: ${moodLine}

Rules:
- Start each title with a verb (Open/Write/Solve/Draft/Review/Outline).
- Keep each step small and concrete.
- No duplicates.
- Titles should be different and cover the full task.`;

  const raw = await ollamaChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      format: schema,
      numPredict: 700,
      temperature: 0.2,
      topP: 0.9,
      keepAlive: "10m",
    }
  );

  return safeJsonParse(raw);
}

function parseFocusMinutes(text, prefs) {
  const m = String(text || "").toLowerCase();

  if (m.includes("pomodoro")) return 25;

  const bare = m.match(/\bfocus(?:\s+for)?\s+(\d{1,3})\b/);
  if (bare) return clamp(parseInt(bare[1], 10), 5, 180);

  const minMatch = m.match(/(\d+)\s*(min|mins|minute|minutes)\b/);
  if (minMatch) return clamp(parseInt(minMatch[1], 10), 5, 180);

  const hrMatch = m.match(/(\d+)\s*(hr|hrs|hour|hours)\b/);
  if (hrMatch) return clamp(parseInt(hrMatch[1], 10) * 60, 10, 240);

  const prefMins = Number(prefs?.focusBlockMinutes);
  if (Number.isFinite(prefMins) && prefMins > 0) return clamp(prefMins, 5, 180);

  return 25;
}

function clampText(s, maxChars) {
  const t = String(s || "");
  return t.length > maxChars ? t.slice(0, maxChars) + "…" : t;
}

// -----------------------------
// Routes
// -----------------------------
router.use(requireAuth);

// Simple mode
router.post("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { message } = req.body || {};
    const msg = String(message || "").trim();

    if (!msg) return res.status(400).json({ ok: false, message: "message is required" });

    const reply =
      "Tell me your next deadline + what you've done so far, and I'll plan your next steps.";

    await ChatMessage.create({ userId, role: "user", content: msg });
    await ChatMessage.create({ userId, role: "assistant", content: reply });

    return res.json({ ok: true, reply, mode: "simple" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// RAG + tool routing
router.post("/rag", async (req, res) => {
  try {
    const userId = req.userId;
    const { message, topK } = req.body || {};
    const msg = String(message || "").trim();

    if (!msg) return res.status(400).json({ ok: false, message: "message is required" });

    // 1) Plan tool
    if (isPlanIntent(msg)) {
      const [prefs, tasks, latestMood] = await Promise.all([
        UserPrefs.findOne({ userId }).lean(),
        Task.find({ userId, completed: false, isSubtask: { $ne: true } }).lean(),
        MoodEntry.findOne({ userId }).sort({ createdAt: -1 }).lean(),
      ]);

      const targetDateISO = parsePlanTargetDate(msg, prefs);
      const dateLabel = formatTargetDateLabel(targetDateISO, prefs);

      const plan = generateDailyPlan({
        tasks: tasks || [],
        prefs: prefs || { timezone: "Europe/London" },
        mood: latestMood || null,
        targetDateISO,
      });

      const reply = formatPlanToReply(plan, dateLabel);

      await ChatMessage.create({ userId, role: "user", content: msg });
      await ChatMessage.create({ userId, role: "assistant", content: reply });

      return res.json({
        ok: true,
        mode: "tool_plan_today",
        reply,
        plan,
        targetDateISO,
      });
    }

    const [prefs, tasksNow, moodNow] = await Promise.all([
      UserPrefs.findOne({ userId }).lean().catch(() => null),
      Task.find({ userId, completed: false, isSubtask: { $ne: true } }).lean(),
      MoodEntry.findOne({ userId }).sort({ createdAt: -1 }).lean(),
    ]);

    // 2) ✅ Task creation tool (MUST be before subtask tool)
    if (isTaskCreateIntent(msg)) {
      const { task, title, deadlineISO, dueLabel } = await createTaskFromMessage({
        userId,
        msg,
        prefs,
      });

      if (!task || !title) {
        const reply = "What should I call the task?";
        await ChatMessage.create({ userId, role: "user", content: msg });
        await ChatMessage.create({ userId, role: "assistant", content: reply });
        return res.json({ ok: true, mode: "tool_create_task_needs_title", reply });
      }

      const reply = dueLabel
        ? `✅ Created task: **${title}** (due **${dueLabel}**)`
        : `✅ Created task: **${title}**`;

      await ChatMessage.create({ userId, role: "user", content: msg });
      await ChatMessage.create({ userId, role: "assistant", content: reply });

      return res.json({
        ok: true,
        mode: "tool_create_task",
        reply,
        task: {
          id: String(task._id),
          title: task.title,
          deadline: deadlineISO || null,
        },
      });
    }

    // 3) Subtask creation tool
    if (isSubtaskCreateIntent(msg)) {
      const parent = pickBestTask(msg, tasksNow || []);
      if (!parent) {
        const reply =
          "I couldn't find a task to break into subtasks. Add a task first, or tell me the exact task title.";
        await ChatMessage.create({ userId, role: "user", content: msg });
        await ChatMessage.create({ userId, role: "assistant", content: reply });
        return res.json({
          ok: true,
          mode: "tool_create_subtasks_failed",
          reply,
          createdSubtasks: [],
        });
      }

      const proposal = await proposeSubtasksJSON({ parent, msg, moodNow });
      const subtasksRaw =
        proposal?.tool === "create_subtasks" ? proposal?.args?.subtasks : null;
      const subtasks = normalizeSubtasks(subtasksRaw);

      if (subtasks.length < 3) {
        const reply = `I tried to generate subtasks for **${parent.title}** but didn't get a valid tool output.\n\nTry: "Create 5 subtasks for ${parent.title}".`;
        await ChatMessage.create({ userId, role: "user", content: msg });
        await ChatMessage.create({ userId, role: "assistant", content: reply });
        return res.json({
          ok: true,
          mode: "tool_create_subtasks_failed",
          reply,
          createdSubtasks: [],
        });
      }

      const { created } = await createSubtasks({
        userId,
        parentTaskId: String(parent._id),
        subtasks,
      });

      const checklist = created
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((t, i) => `${i + 1}) ${t.title} (${t.estMinutes ?? 10}m)`)
        .join("\n");

      const reply =
        `Broke **${parent.title}** into subtasks:\n` +
        `${checklist}\n\n` +
        `**Next 2-minute step:** Start subtask #1 for 2 minutes.`;

      await ChatMessage.create({ userId, role: "user", content: msg });
      await ChatMessage.create({ userId, role: "assistant", content: reply });

      return res.json({
        ok: true,
        mode: "tool_create_subtasks",
        reply,
        parentTaskId: String(parent._id),
        createdSubtasks: created.map((t) => ({
          id: String(t._id),
          title: t.title,
          estMinutes: t.estMinutes,
          order: t.order,
          parentId: String(t.parentId),
        })),
      });
    }

    // 4) Start focus tool
    if (isStartFocusIntent(msg)) {
      const minutes = parseFocusMinutes(msg, prefs);
      const parent = pickBestTask(msg, tasksNow || []);
      const taskTitle = parent?.title || null;
      const taskId = parent?._id ? String(parent._id) : null;

      const reply = taskTitle
        ? `Starting a **${minutes}-minute focus session** on: **${taskTitle}**\n\n**Next 2-minute starter:** open it and do the smallest setup step.\n\nSwitch to Focus and I'll run the timer.`
        : `Starting a **${minutes}-minute focus session**.\n\n**Next 2-minute starter:** pick ONE task and do the smallest setup step.\n\nSwitch to Focus and I'll run the timer.`;

      await ChatMessage.create({ userId, role: "user", content: msg });
      await ChatMessage.create({ userId, role: "assistant", content: reply });

      return res.json({
        ok: true,
        mode: "tool_start_focus",
        reply,
        focus: { minutes, taskId, taskTitle },
      });
    }

    // 5) Micro-step tool
    if (isMicroStepIntent(msg)) {
      const task = pickBestTask(msg, tasksNow || []);
      const topTaskTitles = (tasksNow || [])
        .slice(0, 8)
        .map((t) => t.title)
        .filter(Boolean);

      const reply = microStepReply({
        taskTitle: task?.title || "your task",
        moodNow,
        hasTasks: (tasksNow || []).length > 0,
        topTaskTitles,
      });

      await ChatMessage.create({ userId, role: "user", content: msg });
      await ChatMessage.create({ userId, role: "assistant", content: reply });

      return res.json({ ok: true, mode: "micro_step_tool", reply, sources: [] });
    }

    // 6) Default RAG response
    const prefsBlock = prefs
      ? `timezone=${prefs.timezone || "unknown"}
workHours=${prefs.workHours?.start || "??"}–${prefs.workHours?.end || "??"}
focusBlockMinutes=${prefs.focusBlockMinutes ?? "??"}
breaks=${prefs.shortBreakMinutes ?? "??"}/${prefs.longBreakMinutes ?? "??"}
tone=${prefs.tone || "friendly"}`
      : "None";

    const moodBlock = moodNow
      ? `mood=${moodNow.mood}/5 stress=${moodNow.stress}/5 energy=${moodNow.energy}/5`
      : "None";

    const zone = getUserZone(prefs);

    const topTasks = (tasksNow || [])
      .map((t) => ({
        ...t,
        _due: t.deadline ? new Date(t.deadline).getTime() : Number.POSITIVE_INFINITY,
        _p: pWeight(t.priority),
      }))
      .sort((a, b) => a._due - b._due || a._p - b._p)
      .slice(0, MAX_TASKS_IN_PROMPT);

    const tasksBlock = topTasks.length
      ? topTasks
          .map((t, i) => {
            const due = t.deadline
              ? DateTime.fromJSDate(new Date(t.deadline))
                  .setZone(zone)
                  .toFormat("dd LLL yyyy")
              : "no deadline";
            const pri = String(t.priority || "medium").toUpperCase();
            const mins = t.estMinutes ?? 60;
            return `${i + 1}) [${pri}] ${t.title} — due ${due} — est ${mins}m`;
          })
          .join("\n")
      : "No incomplete tasks found.";

    const history = await ChatMessage.find({ userId })
      .sort({ createdAt: -1 })
      .limit(MAX_HISTORY_LINES)
      .lean();

    history.reverse();
    const memoryBlock = history
      .map((m) => `${String(m.role).toUpperCase()}: ${clampText(m.content, 220)}`)
      .join("\n");

    const shouldRetrieve = msg.length >= 18;
    const hits = shouldRetrieve
      ? await retrieveTopK({
          userId,
          query: msg,
          topK: Number(topK || 2),
          maxScan: 450,
          maxTextChars: 350,
        })
      : [];

    const contextBlockRaw = hits
      .map((h, i) => `[#${i + 1}] (${h.docType}) ${h.text}`)
      .join("\n\n");
    const contextBlock = clampText(
      contextBlockRaw || "None",
      MAX_RETRIEVED_CONTEXT_CHARS
    );

    const system = `You are Coach Chat — a student productivity & scheduling personal assistant.

Goal: help the user start, plan, and finish tasks with minimal friction.

Rules:
- Be concise and fast. Default ≤ 160 words.
- Answer first, then "Next steps" (2–4 bullets).
- Use the user's real tasks, mood, and preferences when provided.
- If a critical detail is missing, ask ONE targeted question (only one).
- Never invent tasks, deadlines, or personal facts not in context.
- If user asks for a plan: include (1) next 2-minute starter step, (2) 3–6 time blocks max, (3) checkpoint.
Formatting: short paragraphs + bullets.`;

    const userPrompt = `USER_PREFS:
${prefsBlock}

LIVE_STATE:
Mood: ${moodBlock}
Top tasks:
${tasksBlock}

MEMORY:
${memoryBlock || "None"}

CONTEXT:
${contextBlock}

USER:
${msg}`;

    const reply = await ollamaChat(
      [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      {
        numPredict: 180,
        numCtx: 4096,
        keepAlive: "10m",
        temperature: 0.35,
        topP: 0.9,
      }
    );

    await ChatMessage.create({ userId, role: "user", content: msg });
    await ChatMessage.create({ userId, role: "assistant", content: reply });

    return res.json({
      ok: true,
      reply,
      mode: "rag",
      sources: hits.map((h) => ({
        score: h.score,
        docType: h.docType,
        docId: h.docId,
        source: h.source,
      })),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
