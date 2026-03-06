import React, { useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, API_BASE } from "../api";
import { useNavigation } from "@react-navigation/native";
import * as chrono from "chrono-node";

const GREEN = "#2EAD67";
const LIGHT_GREEN = "#62C77C";
const TEXT = "#111";

// ---------------------------
// Task creation wizard helpers
// ---------------------------
function isCreateTaskIntent(text) {
  const t = String(text || "").trim().toLowerCase();
  return (
    /(^|\b)(create|add|make)\b.*\b(task|todo|to-do)\b/.test(t) ||
    /^remind me to\b/.test(t) ||
    /^i need to\b/.test(t) ||
    /^i have to\b/.test(t)
  );
}

function parseChronoDate(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  const ref = new Date();
  const results = chrono.en.GB.parse(text, ref, { forwardDate: true });
  const first = Array.isArray(results) && results.length > 0 ? results[0] : null;
  if (!first?.start) return null;

  const date = first.start.date();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  const hasHour = first.start.isCertain("hour");
  const hasMinute = first.start.isCertain("minute");

  const out = new Date(date);
  if (!hasHour && !hasMinute) out.setHours(23, 59, 0, 0);

  return { date: out, matchIndex: first.index, matchText: String(first.text || "") };
}

function extractDraftFromUtterance(text) {
  const t = String(text || "").trim();

  let title = t
    .replace(/^create\s+(a\s+)?(task|todo|to-do)\s*(to)?\s*/i, "")
    .replace(/^add\s+(a\s+)?(task|todo|to-do)\s*(to)?\s*/i, "")
    .replace(/^make\s+(a\s+)?(task|todo|to-do)\s*(to)?\s*/i, "")
    .replace(/^remind me to\s*/i, "")
    .replace(/^i need to\s*/i, "")
    .replace(/^i have to\s*/i, "")
    .trim();

  let deadline = null;
  const parsed = parseChronoDate(title);
  if (parsed?.date) {
    deadline = parsed.date;
    if (Number.isFinite(parsed.matchIndex) && parsed.matchText) {
      title = `${title.slice(0, parsed.matchIndex)} ${title.slice(
        parsed.matchIndex + parsed.matchText.length
      )}`;
    }
  }

  title = title
    .replace(/^to\s+/i, "")
    .replace(/\b(on|by|for|at|before|after|due)\b\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (title.length < 3) title = "";
  return { title, deadline };
}

function isCancel(text) {
  const t = String(text || "").trim().toLowerCase();
  return t === "cancel" || t === "stop" || t === "exit" || t === "quit";
}

function isYes(text) {
  const t = String(text || "").trim().toLowerCase();
  return t === "y" || t === "yes" || t === "yeah" || t === "yep" || t === "sure";
}

function isNo(text) {
  const t = String(text || "").trim().toLowerCase();
  return t === "n" || t === "no" || t === "nope";
}

function parsePriority(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  if (t.startsWith("h")) return "high";
  if (t.startsWith("l")) return "low";
  if (t.startsWith("m")) return "medium";
  return null;
}

function parseEstMinutes(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  if (t === "skip" || t === "default") return 60;

  const num = parseInt(t.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(num)) return null;

  if (/\b(h|hr|hrs|hour|hours)\b/.test(t)) {
    const mins = num * 60;
    return Math.min(240, Math.max(10, mins));
  }
  return Math.min(240, Math.max(5, num));
}

function parseDeadlineInput(text) {
  const raw = String(text || "").trim();
  const t = raw.toLowerCase();
  if (!t) return null;
  if (t === "none" || t === "no" || t === "skip") return null;

  const now = new Date();

  if (t === "today") {
    const d = new Date(now);
    d.setHours(23, 59, 0, 0);
    return d;
  }

  if (t === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    return d;
  }

  // Accept: YYYY-MM-DD or YYYY-MM-DD HH:MM
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const da = parseInt(m[3], 10);
    const hh = m[4] ? parseInt(m[4], 10) : 23;
    const mm = m[5] ? parseInt(m[5], 10) : 59;

    const d = new Date(y, mo, da, hh, mm, 0, 0);
    if (Number.isNaN(d.getTime())) return "INVALID";
    return d;
  }

  const parsed = parseChronoDate(raw);
  if (parsed?.date) return parsed.date;

  return "INVALID";
}

function prettyDeadline(d) {
  if (!d) return "none";
  try {
    return d.toLocaleString();
  } catch {
    return "none";
  }
}

export default function ChatScreen() {
  const navigation = useNavigation();

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      content: "Hey! Tell me what you need to do + your next deadline, and I’ll plan your day.",
    },
  ]);

  // ✅ Frontend-only task wizard (safe, does not touch backend chat state)
  const [taskWizard, setTaskWizard] = useState({
    active: false,
    step: null, // "TITLE" | "DEADLINE" | "PRIORITY" | "EST" | "SUBJECT" | "CONFIRM"
    draft: { title: "", deadline: null, priority: "medium", estMinutes: 60, subject: "" },
  });

  const listRef = useRef(null);
  const inFlightRef = useRef(false);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  const scrollToEndSoon = () => {
    setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 50);
  };

  const addAssistant = (content) => {
    setMessages((prev) => [
      ...prev,
      { id: String(Date.now()) + Math.random().toString(16).slice(2), role: "assistant", content },
    ]);
    scrollToEndSoon();
  };

  const startTaskWizard = (initialUserText) => {
    const inferred = extractDraftFromUtterance(initialUserText);

    const draft = {
      title: inferred.title || "",
      deadline: inferred.deadline || null,
      priority: "medium",
      estMinutes: 60,
      subject: "",
    };

    if (draft.title && draft.deadline) {
      setTaskWizard({
        active: true,
        step: "PRIORITY",
        draft,
      });

      addAssistant(
        `Okay - creating a task: **${draft.title}**.\n\nI set the deadline to **${prettyDeadline(
          draft.deadline
        )}**.\n\nPriority? (low / medium / high) - default is medium.`
      );
      return;
    }

    setTaskWizard({
      active: true,
      step: draft.title ? "DEADLINE" : "TITLE",
      draft,
    });

    addAssistant(
      draft.title
        ? `Okay - creating a task: **${draft.title}**.\n\nWhen is it due? (optional)\nUse \`YYYY-MM-DD\`, \`YYYY-MM-DD HH:MM\`, \`tomorrow\`, \`27th march\`, or \`none\`.\n(Reply \`cancel\` anytime.)`
        : draft.deadline
        ? `Sure - what's the task title?\n\nI can keep the deadline as **${prettyDeadline(
            draft.deadline
          )}**.\n(Reply \`cancel\` anytime.)`
        : `Sure - what's the task title?\n(Reply \`cancel\` anytime.)`
    );
  };

  const cancelTaskWizard = () => {
    setTaskWizard({
      active: false,
      step: null,
      draft: { title: "", deadline: null, priority: "medium", estMinutes: 60, subject: "" },
    });
    addAssistant("Cancelled. If you want, say **create a task** again.");
  };

  // ✅ matches your backend POST /tasks schema exactly
  const createTaskFromDraft = async (draft) => {
    const pendingId = `pending-create-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: pendingId, role: "assistant", content: "Creating task…", pending: true },
    ]);
    scrollToEndSoon();

    inFlightRef.current = true;
    setLoading(true);

    try {
      const payload = {
        title: draft.title,
        subject: draft.subject || "",
        priority: draft.priority || "medium",
        estMinutes: Number.isFinite(Number(draft.estMinutes)) ? Number(draft.estMinutes) : 60,
        deadline: draft.deadline ? draft.deadline.toISOString() : null,
      };

      const res = await api.post("/tasks", payload, { timeout: 30000 });

      // your route returns the task object directly
      const taskId = res.data?._id || null;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId ? { ...m, pending: false, content: `✅ Task created: **${draft.title}**` } : m
        )
      );

      setTaskWizard({
        active: false,
        step: null,
        draft: { title: "", deadline: null, priority: "medium", estMinutes: 60, subject: "" },
      });

      navigation.navigate("Tasks", { highlightTaskId: taskId });
    } catch (e) {
      const errMsg = e?.response?.data?.message || e.message || "Failed to create task.";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId ? { ...m, pending: false, error: true, content: `⚠️ ${errMsg}` } : m
        )
      );
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      scrollToEndSoon();
    }
  };

  const handleTaskWizardAnswer = async (answer) => {
    if (isCancel(answer)) {
      cancelTaskWizard();
      return;
    }

    const step = taskWizard.step;
    const draft = { ...taskWizard.draft };

    if (step === "TITLE") {
      const title = String(answer || "").trim();
      if (title.length < 3) {
        addAssistant("That title looks too short - what's the task called?");
        return;
      }
      draft.title = title;

      if (draft.deadline) {
        setTaskWizard({ active: true, step: "PRIORITY", draft });
        addAssistant(
          `Keeping deadline as **${prettyDeadline(
            draft.deadline
          )}**.\n\nPriority? (low / medium / high) - default is medium.`
        );
        return;
      }

      setTaskWizard({ active: true, step: "DEADLINE", draft });
      addAssistant(
        "When is it due? (optional)\nUse `YYYY-MM-DD`, `YYYY-MM-DD HH:MM`, `tomorrow`, `27th march`, or `none`."
      );
      return;
    }

    if (step === "DEADLINE") {
      const parsed = parseDeadlineInput(answer);
      if (parsed === "INVALID") {
        addAssistant(
          "I couldn't parse that. Use `YYYY-MM-DD`, `YYYY-MM-DD HH:MM`, `tomorrow`, `27th march`, or `none`."
        );
        return;
      }
      draft.deadline = parsed; // Date or null
      setTaskWizard({ active: true, step: "PRIORITY", draft });
      addAssistant("Priority? (low / medium / high) — default is medium.");
      return;
    }

    if (step === "PRIORITY") {
      draft.priority = parsePriority(answer) || "medium";
      setTaskWizard({ active: true, step: "EST", draft });
      addAssistant("Rough estimate in minutes? (e.g., 30, 60, 90) or `skip` for 60.");
      return;
    }

    if (step === "EST") {
      const mins = parseEstMinutes(answer);
      if (mins === null) {
        addAssistant("Give a number like `30` or `90`, or type `skip`.");
        return;
      }
      draft.estMinutes = mins;
      setTaskWizard({ active: true, step: "SUBJECT", draft });
      addAssistant("Subject/module? (optional) Type a subject or `skip`.");
      return;
    }

    if (step === "SUBJECT") {
      const t = String(answer || "").trim();
      draft.subject = t.toLowerCase() === "skip" ? "" : t;
      setTaskWizard({ active: true, step: "CONFIRM", draft });

      addAssistant(
        `Confirm?\n\n• Title: **${draft.title}**\n• Deadline: **${prettyDeadline(draft.deadline)}**\n• Priority: **${draft.priority}**\n• Estimate: **${draft.estMinutes} min**\n• Subject: **${draft.subject || "none"}**\n\nReply **yes** to create, or **no** to cancel.`
      );
      return;
    }

    if (step === "CONFIRM") {
      if (isYes(answer)) {
        await createTaskFromDraft(draft);
        return;
      }
      if (isNo(answer)) {
        cancelTaskWizard();
        return;
      }
      addAssistant("Please reply **yes** to create, or **no** to cancel.");
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (inFlightRef.current) return;

    // ✅ wizard active => handle locally (no /chat/rag)
    if (taskWizard.active) {
      const userMsg = { id: String(Date.now()), role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      scrollToEndSoon();

      await handleTaskWizardAnswer(text);
      return;
    }

    // ✅ create-task intent => start wizard locally (no /chat/rag)
    if (isCreateTaskIntent(text)) {
      const userMsg = { id: String(Date.now()), role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      scrollToEndSoon();

      startTaskWizard(text);
      return;
    }

    // default => existing backend chat flow
    inFlightRef.current = true;
    setLoading(true);

    const userMsg = { id: String(Date.now()), role: "user", content: text };
    const pendingId = `pending-${Date.now() + 1}`;
    const pendingMsg = {
      id: pendingId,
      role: "assistant",
      content: "Thinking…",
      pending: true,
    };

    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setInput("");

    scrollToEndSoon();

    try {
      const res = await api.post("/chat/rag", { message: text, topK: 4 }, { timeout: 90000 });

      const reply = res.data?.reply || "No reply.";
      const sources = res.data?.sources || [];

      setMessages((prev) =>
        prev.map((m) => (m.id === pendingId ? { ...m, content: reply, sources, pending: false } : m))
      );

      const mode = res.data?.mode;

      if (mode === "tool_create_subtasks" && res.data?.parentTaskId) {
        navigation.navigate("Tasks", { focusParentId: res.data.parentTaskId });
      }

      if (mode === "tool_start_focus" && res.data?.focus) {
        navigation.navigate("Focus", {
          autoStart: true,
          startId: Date.now(),
          minutes: res.data.focus.minutes,
          taskId: res.data.focus.taskId,
          taskTitle: res.data.focus.taskTitle,
        });
      }
    } catch (e) {
      const msg =
        e?.code === "ECONNABORTED"
          ? "Timed out. The model took too long. Try again (or shorten the request)."
          : e?.response?.data?.message || e.message || "Unknown error";

      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId ? { ...m, content: `⚠️ ${msg}`, pending: false, error: true } : m
        )
      );
      console.log("CHAT ERROR:", e?.response?.status, e?.response?.data || e?.message);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      scrollToEndSoon();
    }
  };

  const renderItem = ({ item }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.bubbleWrap, isUser ? styles.right : styles.left]}>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
          <Text style={[styles.bubbleText, isUser ? styles.userText : styles.botText]}>
            {item.content}
          </Text>

          {!isUser && item.pending ? (
            <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center" }}>
              <ActivityIndicator color={GREEN} size="small" />
              <Text style={{ color: "#444", fontWeight: "800", marginLeft: 8 }}>Working…</Text>
            </View>
          ) : null}

          {!isUser && Array.isArray(item.sources) && item.sources.length > 0 ? (
            <View style={styles.sourcesBox}>
              <Text style={styles.sourcesTitle}>Sources used</Text>
              {item.sources.slice(0, 4).map((s, idx) => (
                <Text key={idx} style={styles.sourceLine}>
                  • {s.docType} ({String(s.score).slice(0, 5)})
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Coach Chat</Text>
        <Text style={styles.subtitle}>API: {API_BASE}</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, paddingBottom: 10 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: true })}
        />

        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask for a schedule, plan, or motivation…"
            placeholderTextColor="rgba(0,0,0,0.45)"
            style={styles.input}
            multiline
          />

          <TouchableOpacity
            style={[styles.sendBtn, !canSend && { opacity: 0.5 }]}
            onPress={send}
            disabled={!canSend}
            activeOpacity={0.85}
          >
            <Ionicons name="send" size={18} color={TEXT} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFF" },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#EEE",
  },
  title: { fontSize: 24, fontWeight: "900", color: TEXT },
  subtitle: { marginTop: 4, color: "#666", fontWeight: "700" },

  bubbleWrap: { marginVertical: 6, maxWidth: "88%" },
  left: { alignSelf: "flex-start" },
  right: { alignSelf: "flex-end" },

  bubble: { borderRadius: 14, padding: 12, borderWidth: 2, borderColor: "#222" },
  userBubble: { backgroundColor: LIGHT_GREEN },
  botBubble: { backgroundColor: "#F1F1F1" },

  bubbleText: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  userText: { color: "#0B2416" },
  botText: { color: TEXT },

  sourcesBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.15)",
  },
  sourcesTitle: { fontWeight: "900", marginBottom: 6, color: TEXT },
  sourceLine: { color: "#333", fontWeight: "700", marginBottom: 2 },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#EEE",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: "#FAFAFA",
    borderWidth: 2,
    borderColor: "#222",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: TEXT,
    fontWeight: "800",
    marginRight: 10,
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: LIGHT_GREEN,
    borderWidth: 2,
    borderColor: "#222",
    alignItems: "center",
    justifyContent: "center",
  },
});



