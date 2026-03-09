const TASK_CREATE_LEAD =
  /^(please\s+)?(can you\s+|could you\s+|would you\s+)?(create|add|make|setup|set up|set|formalise)\s+(me\s+)?((an?|another|new|my)\s+)*(task|tasks|todo|to-do)\b/i;

const TASK_CREATE_PREFIX =
  /^(please\s+)?(can you\s+|could you\s+|would you\s+)?(create|add|make|setup|set up|set|formalise)\s+(me\s+)?((an?|another|new|my)\s+)*(task|tasks|todo|to-do)\s*(to|for)?\s*/i;

function normalizeIntentText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isPlanIntent(text) {
  const m = normalizeIntentText(text);

  if (
    m.includes("plan my day") ||
    m.includes("schedule my day") ||
    m.includes("make me a plan") ||
    m.includes("time block") ||
    m.includes("timeblock") ||
    m === "plan"
  ) {
    return true;
  }

  if (/^(plan|schedule)\b/.test(m)) return true;

  if (
    /\bplan\b/.test(m) &&
    /\b(today|tomorrow|tonight|next|this|on|by|before|after)\b/.test(m)
  ) {
    return true;
  }

  return false;
}

function isTaskCreateIntent(text) {
  const m = normalizeIntentText(text);

  if (!m) return false;
  if (/^remind me to\b/.test(m)) return true;

  return TASK_CREATE_LEAD.test(m);
}

function isMicroStepIntent(text) {
  const m = normalizeIntentText(text);

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
  const m = normalizeIntentText(text);

  const actionVerbs =
    /\b(create|make|generate|give me|add|build|write|list|get|prepare|set up|come up with|draft|form|set)\b/;
  const subtaskNouns =
    /\b(subtasks?|sub-tasks?|sub tasks?|steps?|checklists?|action items?|objectives?|breakdown|chunks?|pieces?|parts?)\b/;

  if (m.includes("subtask")) return true;
  if (m.includes("sub-task")) return true;
  if (m.includes("actionable steps")) return true;
  if (m.includes("actionable objectives")) return true;
  if (m.includes("break this task")) return true;
  if (m.includes("split this task")) return true;
  if (m.includes("split into")) return true;
  if (m.includes("turn into")) return true;

  if (/break.{0,30}\binto\b/.test(m)) return true;
  if (/break.{0,20}\bdown\b.{0,20}\b(steps?|tasks?|parts?|chunks?|pieces?)/.test(m)) {
    return true;
  }

  if (actionVerbs.test(m) && subtaskNouns.test(m)) return true;
  if (/split.{0,40}into/.test(m)) return true;
  if (/divide.{0,40}into/.test(m)) return true;
  if (/what.{0,10}(are|would be).{0,15}steps?\b/.test(m)) return true;

  if (
    /how\s+(do|should|can|would)\s+(i|we)\s+(start|tackle|approach|do|break|begin|work on)\b/.test(
      m
    )
  ) {
    return true;
  }

  return false;
}

function isStartFocusIntent(text) {
  const m = normalizeIntentText(text);

  if (m.includes("pomodoro")) return true;
  if (m.includes("focus session")) return true;
  if (m.includes("focus timer")) return true;
  if (m.includes("start focus")) return true;
  if (m.includes("focus now")) return true;
  if (m.includes("focus mode")) return true;
  if (m.includes("work session")) return true;
  if (m.includes("study session")) return true;
  if (m.includes("study timer")) return true;

  if (/(start|begin|run|set|kick off|launch)\s+(a\s+)?(timer|session|focus|clock)\b/.test(m)) {
    return true;
  }

  if (/^focus\b/.test(m)) return true;
  if (/\bfocus\s+for\b/.test(m)) return true;
  if (/\btimer\b/.test(m) && /\d+/.test(m)) return true;
  if (/\btime\s+me\b/.test(m)) return true;

  if (/(i\s+want\s+to|let\s+me|help\s+me|i('ll|'m going to|will))\s+focus\b/.test(m)) {
    return true;
  }

  if (/\bwork\s+for\s+\d+/.test(m)) return true;
  if (/\bstudy\s+for\s+(\d+|a|an)\b/.test(m)) return true;

  if (/\b(do|run|start|begin)\s+(a\s+)?\d+[\s-]?(min|minute|hour|hr)/.test(m)) {
    return true;
  }

  if (/\d+\s*(min|mins|minutes|hr|hrs|hours?)\s+of\s+(focus|work|study|studying|working)\b/.test(m)) {
    return true;
  }

  return false;
}

function stripTaskCreateLead(text) {
  return String(text || "").replace(TASK_CREATE_PREFIX, "");
}

module.exports = {
  isMicroStepIntent,
  isPlanIntent,
  isStartFocusIntent,
  isSubtaskCreateIntent,
  isTaskCreateIntent,
  normalizeIntentText,
  stripTaskCreateLead,
};
