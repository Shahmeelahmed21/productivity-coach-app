import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { api, API_BASE, getProgressSafe } from "../api";

const GREEN = "#2EAD67";
const LIGHT_GREEN = "#62C77C";
const GREY_CARD = "#D9D9D9";
const TEXT = "#111";

const HIDE_COMPLETED = true;
const HIGHLIGHT_MS = 2200;

function xpToNextLevel(level) {
  return 100 + (Math.max(1, Number(level || 1)) - 1) * 50;
}

export default function TasksScreen({ route, navigation }) {
  const [filter, setFilter] = useState("all"); // all | today | week
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tasks, setTasks] = useState([]);

  // expand/collapse per parent task id
  const [expanded, setExpanded] = useState({});

  // for auto-scroll when coming from chat
  const listRef = useRef(null);
  const handledFocusRef = useRef(null);

  // highlight new task created from Chat
  const handledHighlightRef = useRef(null);
  const [highlightId, setHighlightId] = useState(null);

  const focusParentId = route?.params?.focusParentId ? String(route.params.focusParentId) : null;
  const highlightTaskId = route?.params?.highlightTaskId ? String(route.params.highlightTaskId) : null;

  // Add Task modal state
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState("medium"); // low|medium|high
  const [estMinutes, setEstMinutes] = useState("60");
  const [deadlineText, setDeadlineText] = useState("");

  // ✅ Gamification UI state
  const [progress, setProgress] = useState(null);
  const [xpToast, setXpToast] = useState(null); // { xp, level }
  const [levelUp, setLevelUp] = useState(null); // { level }

  const handleApiError = (e, fallback = "Something went wrong") => {
    const status = e?.response?.status;
    const msg = e?.response?.data?.message || e?.message || fallback;

    if (status === 401) {
      Alert.alert("Session expired", "Please log in again.");
      return;
    }

    Alert.alert("Error", msg);
  };

  const fetchProgress = useCallback(async () => {
    const p = await getProgressSafe();
    if (p) setProgress(p);
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get("/tasks", {
        params: { limit: 600, sort: "ranked" }, // ✅ ranked ordering
      });
      setTasks(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      handleApiError(e, "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log("API_BASE =", API_BASE);
    fetchTasks();
    fetchProgress();
  }, [fetchTasks, fetchProgress]);

  useFocusEffect(
    useCallback(() => {
      fetchProgress();

      if (focusParentId && handledFocusRef.current !== focusParentId) {
        setFilter("all");
        fetchTasks();
      }
      if (highlightTaskId && handledHighlightRef.current !== highlightTaskId) {
        setFilter("all");
        fetchTasks();
      }
    }, [focusParentId, highlightTaskId, fetchTasks, fetchProgress])
  );

  // ----------------------------
  // Group parents + subtasks
  // ----------------------------
  const { parentTasks, subtasksByParent } = useMemo(() => {
    const parents = [];
    const map = {};

    for (const t of tasks) {
      const isSub = t?.isSubtask === true;
      if (!isSub) {
        parents.push(t);
      } else {
        const pid = String(t.parentId || "");
        if (!pid) continue;
        if (!map[pid]) map[pid] = [];
        map[pid].push(t);
      }
    }

    for (const pid of Object.keys(map)) {
      map[pid].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    return { parentTasks: parents, subtasksByParent: map };
  }, [tasks]);

  // ----------------------------
  // Filter ONLY parent tasks
  // ----------------------------
  const filteredParents = useMemo(() => {
    const now = new Date();

    const isSameDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();

    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + 7);

    return parentTasks.filter((t) => {
      if (HIDE_COMPLETED && t.completed) return false;

      if (!t.deadline) return filter === "all";
      const d = new Date(t.deadline);

      if (filter === "today") return isSameDay(d, now);
      if (filter === "week") return d >= now && d <= endOfWeek;
      return true;
    });
  }, [parentTasks, filter]);

  // After refresh, auto-expand + scroll to the parent from chat (subtasks tool)
  useEffect(() => {
    if (!focusParentId) return;
    if (handledFocusRef.current === focusParentId) return;
    if (loading) return;

    setExpanded((prev) => ({ ...prev, [focusParentId]: true }));

    const idx = filteredParents.findIndex((t) => String(t._id) === focusParentId);
    if (idx >= 0) {
      setTimeout(() => {
        try {
          listRef.current?.scrollToIndex?.({ index: idx, animated: true });
        } catch {}
      }, 150);
    }

    handledFocusRef.current = focusParentId;
    navigation?.setParams?.({ focusParentId: undefined });
  }, [focusParentId, loading, filteredParents, navigation]);

  // Highlight + scroll to newly created task (from Chat)
  useEffect(() => {
    if (!highlightTaskId) return;
    if (handledHighlightRef.current === highlightTaskId) return;
    if (loading) return;

    setHighlightId(highlightTaskId);

    const idx = filteredParents.findIndex((t) => String(t._id) === highlightTaskId);
    if (idx >= 0) {
      setTimeout(() => {
        try {
          listRef.current?.scrollToIndex?.({ index: idx, animated: true });
        } catch {}
      }, 150);
    }

    handledHighlightRef.current = highlightTaskId;
    navigation?.setParams?.({ highlightTaskId: undefined });

    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightTaskId, loading, filteredParents, navigation]);

  const toggleExpanded = (parentId) => {
    const key = String(parentId);
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ----------------------------
  // CRUD
  // ----------------------------
  const patchTask = async (id, patch) => {
    const res = await api.patch(`/tasks/${id}`, patch);
    return res.data;
  };

  const toggleComplete = async (task) => {
    try {
      // ✅ RULE: parent task cannot be completed until ALL subtasks are completed
      if (!task.isSubtask && !task.completed) {
        const pid = String(task._id);
        const subs = subtasksByParent[pid] || [];
        const hasIncomplete = subs.length > 0 && subs.some((s) => !s.completed);
        if (hasIncomplete) {
          setExpanded((prev) => ({ ...prev, [pid]: true }));
          Alert.alert(
            "Finish subtasks first",
            "You can only complete the main task once all subtasks are completed."
          );
          return;
        }
      }

      const updated = await patchTask(task._id, { completed: !task.completed });

      // Extract gamification metadata (don't store on task object long-term)
      const g = updated?._gamification;
      const updatedTask = { ...updated };
      delete updatedTask._gamification;

      setTasks((prev) => {
        const next = prev.map((t) => (t._id === task._id ? updatedTask : t));

        // keep parent completion aligned with subtasks
        if (task.isSubtask && updatedTask?.parentId) {
          const pid = String(updatedTask.parentId);
          const subs = next.filter((x) => x.isSubtask && String(x.parentId) === pid);
          const allDone = subs.length > 0 && subs.every((x) => x.completed);

          const parentIdx = next.findIndex((x) => !x.isSubtask && String(x._id) === pid);
          if (parentIdx >= 0) {
            const parent = next[parentIdx];

            // ✅ if all subtasks done, auto-complete parent WITHOUT XP
            if (allDone && !parent.completed) {
              patchTask(pid, { completed: true, _skipXp: true }).catch(() => {});
              next[parentIdx] = { ...parent, completed: true };
            }

            // if any subtask undone, uncomplete parent
            if (!allDone && parent.completed) {
              patchTask(pid, { completed: false, _skipXp: true }).catch(() => {});
              next[parentIdx] = { ...parent, completed: false };
            }
          }
        }

        return next;
      });

      // ✅ Show XP toast + level-up modal if XP was gained
      if (g?.xpGained && g.xpGained > 0) {
        if (g.progress) setProgress(g.progress);

        setXpToast({ xp: g.xpGained, level: g.progress?.level ?? null });
        setTimeout(() => setXpToast(null), 1600);

        if (g.leveledUp) {
          setLevelUp({ level: g.progress?.level ?? null });
        }
      }
    } catch (e) {
      handleApiError(e, "Failed to update task");
    }
  };

  // axios delete sometimes sends empty JSON body -> body-parser complains or request fails silently
  const apiDelete = async (path) => {
    return api.delete(path, { data: {} });
  };

  const confirmDelete = (titleText, messageText) =>
    new Promise((resolve) => {
      if (Platform.OS === "web") {
        const ok = typeof window !== "undefined" ? window.confirm(`${titleText}\n\n${messageText}`) : false;
        resolve(ok);
        return;
      }

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      Alert.alert(
        titleText,
        messageText,
        [
          { text: "Cancel", style: "cancel", onPress: () => finish(false) },
          { text: "Delete", style: "destructive", onPress: () => finish(true) },
        ],
        { cancelable: true, onDismiss: () => finish(false) }
      );
    });

  const deleteParentCascade = async (parentTask) => {
    const pid = String(parentTask._id);
    const children = subtasksByParent[pid] || [];
    const message = children.length
      ? `${parentTask.title}\n\nThis will also delete ${children.length} subtask(s).`
      : parentTask.title;

    const confirmed = await confirmDelete("Delete task?", message);
    if (!confirmed) return;

    try {
      if (children.length) {
        await Promise.allSettled(children.map((c) => apiDelete(`/tasks/${c._id}`)));
      }
      await apiDelete(`/tasks/${pid}`);

      setTasks((prev) => prev.filter((t) => String(t._id) !== pid && String(t.parentId) !== pid));
    } catch (e) {
      handleApiError(e, "Failed to delete task");
    }
  };

  const deleteSubtask = async (subtask) => {
    const confirmed = await confirmDelete("Delete subtask?", subtask.title);
    if (!confirmed) return;

    try {
      await apiDelete(`/tasks/${subtask._id}`);
      setTasks((prev) => prev.filter((t) => t._id !== subtask._id));
    } catch (e) {
      handleApiError(e, "Failed to delete subtask");
    }
  };

  // ----------------------------
  // Create Task (modal)
  // ----------------------------
  const parseDeadline = (text) => {
    const t = (text || "").trim();
    if (!t) return undefined;

    const isoTry = new Date(t);
    if (!isNaN(isoTry.getTime())) return isoTry.toISOString();

    const parts = t.split(" ");
    if (parts.length === 2) {
      const [datePart, timePart] = parts;
      const dt = new Date(`${datePart}T${timePart}:00`);
      if (!isNaN(dt.getTime())) return dt.toISOString();
    }

    return "INVALID";
  };

  const resetAddForm = () => {
    setTitle("");
    setSubject("");
    setPriority("medium");
    setEstMinutes("60");
    setDeadlineText("");
  };

  const createTask = async () => {
    const t = title.trim();
    if (!t) return Alert.alert("Missing title", "Please enter a task title.");

    const mins = Number(estMinutes);
    if (!Number.isFinite(mins) || mins < 0) {
      return Alert.alert("Invalid minutes", "estMinutes must be a number ≥ 0.");
    }

    const deadlineISO = parseDeadline(deadlineText);
    if (deadlineISO === "INVALID") {
      return Alert.alert(
        "Invalid deadline",
        'Use ISO format or "YYYY-MM-DD HH:mm" (example: 2026-02-20 18:00).'
      );
    }

    try {
      setSaving(true);
      const res = await api.post("/tasks", {
        title: t,
        subject: subject.trim(),
        priority,
        estMinutes: mins,
        ...(deadlineISO ? { deadline: deadlineISO } : {}),
      });

      const created = res.data;
      setTasks((prev) => [created, ...prev]);

      setShowAdd(false);
      resetAddForm();

      const newId = created?._id ? String(created._id) : null;
      if (newId) {
        setFilter("all");
        setHighlightId(newId);
        setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
      }
    } catch (e) {
      handleApiError(e, "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tasks &{"\n"}Deadlines</Text>
          <Text style={styles.apiHint}>API: {API_BASE}</Text>
          <Text style={styles.apiHintSmall}>Subtasks + progress ✅</Text>

          {/* ✅ Level bar */}
          {progress ? (
            <View style={styles.levelBox}>
              <Text style={styles.levelTitle}>Level {progress.level}</Text>
              <View style={styles.levelTrack}>
                <View
                  style={[
                    styles.levelFill,
                    {
                      width: `${Math.round(
                        (Number(progress.xp || 0) / xpToNextLevel(progress.level)) * 100
                      )}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.levelSub}>
                {progress.xp || 0}/{xpToNextLevel(progress.level)} XP
              </Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)} activeOpacity={0.85}>
          <Ionicons name="add" size={28} color="#111" />
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <View style={styles.filtersRow}>
        <FilterPill label="ALL" active={filter === "all"} onPress={() => setFilter("all")} />
        <FilterPill label="Today" active={filter === "today"} onPress={() => setFilter("today")} />
        <FilterPill label="This week" active={filter === "week"} onPress={() => setFilter("week")} />
      </View>

      {/* Content */}
      <View style={{ flex: 1, paddingHorizontal: 18 }}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={GREEN} />
            <Text style={{ marginTop: 10, color: "#444" }}>Loading tasks…</Text>
          </View>
        ) : filteredParents.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: TEXT }}>No tasks found</Text>
            <TouchableOpacity style={styles.refreshBtn} onPress={fetchTasks}>
              <Ionicons name="refresh" size={18} color="#111" />
              <Text style={{ fontWeight: "800" }}> Refresh</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={filteredParents}
            keyExtractor={(item) => item._id}
            contentContainerStyle={{ paddingBottom: 18 }}
            refreshing={loading}
            onRefresh={fetchTasks}
            renderItem={({ item }) => {
              const subsAll = subtasksByParent[String(item._id)] || [];
              const done = subsAll.filter((s) => s.completed).length;
              const total = subsAll.length;
              const progressPct = total > 0 ? done / total : item.completed ? 1 : 0;

              const subsVisible = HIDE_COMPLETED ? subsAll.filter((s) => !s.completed) : subsAll;

              return (
                <TaskCard
                  task={item}
                  subtasks={subsVisible}
                  expanded={!!expanded[String(item._id)]}
                  progress={progressPct}
                  doneCount={done}
                  totalCount={total}
                  highlight={highlightId && String(item._id) === String(highlightId)}
                  onToggleExpanded={() => toggleExpanded(item._id)}
                  onToggleComplete={() => toggleComplete(item)}
                  onDelete={() => deleteParentCascade(item)}
                  onToggleSubtask={(sub) => toggleComplete(sub)}
                  onDeleteSubtask={(sub) => deleteSubtask(sub)}
                />
              );
            }}
          />
        )}
      </View>

      {/* ✅ XP Toast */}
      {xpToast ? (
        <View style={styles.xpToast} pointerEvents="none">
          <Ionicons name="flash" size={18} color="#111" />
          <Text style={styles.xpToastText}>+{xpToast.xp} XP</Text>
          {xpToast.level ? <Text style={styles.xpToastSub}>Lvl {xpToast.level}</Text> : null}
        </View>
      ) : null}

      {/* ✅ Level Up Modal */}
      <Modal visible={!!levelUp} transparent animationType="fade" onRequestClose={() => setLevelUp(null)}>
        <View style={styles.levelOverlay}>
          <View style={styles.levelCard}>
            <Ionicons name="trophy" size={42} color="#111" />
            <Text style={styles.levelUpTitle}>Level Up!</Text>
            <Text style={styles.levelUpDesc}>
              {levelUp?.level ? `You reached Level ${levelUp.level}.` : "You leveled up!"}
            </Text>

            <TouchableOpacity style={styles.levelBtn} onPress={() => setLevelUp(null)} activeOpacity={0.85}>
              <Text style={styles.levelBtnText}>Nice 🔥</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add Task Modal */}
      <Modal visible={showAdd} transparent animationType="fade" onRequestClose={() => setShowAdd(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add task</Text>
                <TouchableOpacity onPress={() => setShowAdd(false)} hitSlop={12}>
                  <Ionicons name="close" size={24} color="#111" />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={{ paddingBottom: 10 }}>
                <Text style={styles.label}>Title</Text>
                <TextInput value={title} onChangeText={setTitle} style={styles.input} />

                <Text style={styles.label}>Subject (optional)</Text>
                <TextInput value={subject} onChangeText={setSubject} style={styles.input} />

                <Text style={styles.label}>Priority</Text>
                <View style={styles.priorityRow}>
                  <PriorityBtn label="Low" active={priority === "low"} onPress={() => setPriority("low")} />
                  <PriorityBtn label="Medium" active={priority === "medium"} onPress={() => setPriority("medium")} />
                  <PriorityBtn label="High" active={priority === "high"} onPress={() => setPriority("high")} />
                </View>

                <Text style={styles.label}>Estimated minutes</Text>
                <TextInput
                  value={estMinutes}
                  onChangeText={setEstMinutes}
                  keyboardType="number-pad"
                  style={styles.input}
                />

                <Text style={styles.label}>Deadline (optional)</Text>
                <Text style={styles.helper}>ISO or “YYYY-MM-DD HH:mm”</Text>
                <TextInput value={deadlineText} onChangeText={setDeadlineText} style={styles.input} />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: "#EEE" }]}
                    onPress={() => {
                      setShowAdd(false);
                      resetAddForm();
                    }}
                    disabled={saving}
                  >
                    <Text style={{ fontWeight: "900", color: "#111" }}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: LIGHT_GREEN }]}
                    onPress={createTask}
                    disabled={saving}
                    activeOpacity={0.85}
                  >
                    {saving ? <ActivityIndicator color="#111" /> : <Text style={{ fontWeight: "900" }}>Save</Text>}
                  </TouchableOpacity>
                </View>

                {HIDE_COMPLETED ? (
                  <Text style={{ marginTop: 12, color: "#555", fontWeight: "700" }}>
                    Completed tasks are hidden automatically.
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function FilterPill({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PriorityBtn({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.priorityBtn, active && styles.priorityBtnActive]}>
      <Text style={[styles.priorityText, active && styles.priorityTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
    </View>
  );
}

function TaskCard({
  task,
  subtasks,
  expanded,
  progress,
  doneCount,
  totalCount,
  highlight,
  onToggleExpanded,
  onToggleComplete,
  onDelete,
  onToggleSubtask,
  onDeleteSubtask,
}) {
  const subject = task.subject || "General";
  const priority = task.priority || "medium";
  const minutes = task.estMinutes ?? 60;
  const dueText = task.deadline ? formatDue(task.deadline) : "No deadline";

  const priorityStyle =
    priority === "high"
      ? { bg: "#FF4D4D", label: "high priority" }
      : priority === "low"
      ? { bg: "#7CFF7C", label: "low priority" }
      : { bg: "#FFD84D", label: "medium-priority" };

  const showSubs = subtasks.length > 0;

  return (
    <View style={[styles.card, highlight && styles.cardHighlight]}>
      <View style={styles.cardTop}>
        <TouchableOpacity style={styles.circle} onPress={onToggleComplete} activeOpacity={0.85}>
          {task.completed ? <Ionicons name="checkmark" size={22} color="#111" /> : null}
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, task.completed && styles.completedTitle]} numberOfLines={2}>
            {task.title}
          </Text>

          {totalCount > 0 ? (
            <Text style={styles.subProgress}>
              {doneCount}/{totalCount} subtasks
            </Text>
          ) : (
            <Text style={styles.subProgress}>{task.completed ? "Completed" : "Not started"}</Text>
          )}

          <ProgressBar value={progress} />
        </View>

        {showSubs ? (
          <TouchableOpacity onPress={onToggleExpanded} style={styles.expandBtn} activeOpacity={0.8}>
            <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color="#111" />
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          onPress={onDelete}
          activeOpacity={0.7}
          style={styles.trashBtn}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <Ionicons name="trash" size={20} color="#111" />
        </TouchableOpacity>
      </View>

      <View style={styles.tagsRow}>
        <Tag text={subject} bg="#1E90FF" />
        <Tag text={priorityStyle.label} bg={priorityStyle.bg} />
        {highlight ? <Tag text="NEW" bg={LIGHT_GREEN} /> : null}
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="calendar" size={18} color="#111" />
          <Text style={styles.metaText}>{dueText}</Text>
        </View>

        <View style={styles.metaItem}>
          <Ionicons name="time" size={18} color="#111" />
          <Text style={styles.metaText}>{minutes} mins</Text>
        </View>
      </View>

      {showSubs && expanded ? (
        <View style={styles.subtasksBox}>
          <Text style={styles.subtasksTitle}>Subtasks</Text>

          {subtasks.map((s) => (
            <View key={s._id} style={styles.subRow}>
              <TouchableOpacity
                style={[styles.subCheck, s.completed && styles.subCheckDone]}
                onPress={() => onToggleSubtask(s)}
                activeOpacity={0.85}
              >
                {s.completed ? <Ionicons name="checkmark" size={16} color="#111" /> : null}
              </TouchableOpacity>

              <Text style={[styles.subText, s.completed && styles.subTextDone]} numberOfLines={2}>
                {s.title} {s.estMinutes ? `(${s.estMinutes}m)` : ""}
              </Text>

              <TouchableOpacity onPress={() => onDeleteSubtask(s)} style={styles.subTrash} activeOpacity={0.8}>
                <Ionicons name="trash" size={16} color="#111" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Tag({ text, bg }) {
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      <Text style={styles.tagText}>{text}</Text>
    </View>
  );
}

function formatDue(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();

  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const hh = ((hours + 11) % 12) + 1;
  const mm = String(minutes).padStart(2, "0");

  return `${isToday ? "Today" : d.toDateString()}, ${hh}:${mm} ${ampm}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFF" },

  headerRow: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  title: { fontSize: 34, fontWeight: "900", color: TEXT, lineHeight: 38 },
  apiHint: { marginTop: 6, color: "#555", fontWeight: "700" },
  apiHintSmall: { marginTop: 2, color: "#666", fontWeight: "700" },

  levelBox: {
    marginTop: 12,
    backgroundColor: "#F1F1F1",
    borderWidth: 2,
    borderColor: "#222",
    borderRadius: 14,
    padding: 12,
  },
  levelTitle: { fontWeight: "900", color: "#111" },
  levelSub: { marginTop: 6, fontWeight: "800", color: "#444", fontSize: 12 },
  levelTrack: {
    marginTop: 8,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#EEE",
    borderWidth: 2,
    borderColor: "#222",
    overflow: "hidden",
  },
  levelFill: {
    height: "100%",
    backgroundColor: LIGHT_GREEN,
  },

  addBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: LIGHT_GREEN,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "#222",
  },

  filtersRow: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  pill: {
    flex: 1,
    backgroundColor: LIGHT_GREEN,
    paddingVertical: 16,
    borderRadius: 26,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3D9F61",
  },
  pillActive: { backgroundColor: "#55BA70" },
  pillText: { fontSize: 15, fontWeight: "800", color: "#111" },
  pillTextActive: { color: "#0B2416" },

  card: {
    backgroundColor: GREY_CARD,
    borderRadius: 14,
    padding: 18,
    marginTop: 18,
  },
  cardHighlight: {
    borderWidth: 3,
    borderColor: GREEN,
  },

  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  circle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 4,
    borderColor: "#222",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EDEDED",
    marginTop: 2,
  },
  cardTitle: { fontSize: 18, fontWeight: "900", color: TEXT },
  completedTitle: { textDecorationLine: "line-through", opacity: 0.65 },

  subProgress: { marginTop: 4, color: "#333", fontWeight: "800" },

  progressTrack: {
    height: 10,
    backgroundColor: "#EEE",
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#222",
    marginTop: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: LIGHT_GREEN,
  },

  expandBtn: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#EEE",
    borderWidth: 2,
    borderColor: "#222",
    marginTop: 2,
  },

  trashBtn: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#EEE",
    borderWidth: 2,
    borderColor: "#222",
    marginTop: 2,
  },

  tagsRow: { flexDirection: "row", gap: 14, marginTop: 14, paddingLeft: 50, flexWrap: "wrap" },
  tag: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999 },
  tagText: { fontSize: 14, fontWeight: "900", color: "#111" },

  metaRow: { flexDirection: "row", gap: 22, marginTop: 14, paddingLeft: 50 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaText: { fontSize: 15, fontWeight: "800", color: "#111" },

  subtasksBox: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.15)",
    paddingLeft: 50,
  },
  subtasksTitle: { fontWeight: "900", color: "#111", marginBottom: 10 },
  subRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  subCheck: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#222",
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
  },
  subCheckDone: { backgroundColor: LIGHT_GREEN },
  subText: { flex: 1, fontWeight: "800", color: "#111" },
  subTextDone: { textDecorationLine: "line-through", opacity: 0.65 },
  subTrash: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: "#EEE",
    borderWidth: 2,
    borderColor: "#222",
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  refreshBtn: {
    marginTop: 14,
    backgroundColor: "#EEE",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
  },

  // ✅ XP Toast
  xpToast: {
    position: "absolute",
    bottom: 26,
    left: 18,
    right: 18,
    backgroundColor: LIGHT_GREEN,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: "#222",
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  xpToastText: { fontWeight: "900", fontSize: 16, color: "#111" },
  xpToastSub: { marginLeft: "auto", fontWeight: "900", color: "#0B2416" },

  // ✅ Level-up modal
  levelOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  levelCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFF",
    borderRadius: 18,
    borderWidth: 3,
    borderColor: "#222",
    padding: 18,
    alignItems: "center",
  },
  levelUpTitle: { marginTop: 10, fontSize: 22, fontWeight: "900", color: "#111" },
  levelUpDesc: { marginTop: 6, fontWeight: "800", color: "#444", textAlign: "center" },
  levelBtn: {
    marginTop: 14,
    width: "100%",
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: LIGHT_GREEN,
    borderWidth: 2,
    borderColor: "#222",
    alignItems: "center",
  },
  levelBtnText: { fontWeight: "900", color: "#111" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 18,
  },
  modalWrap: { width: "100%" },
  modalCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 3,
    borderColor: "#222",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: "900", color: "#111" },
  label: { marginTop: 12, fontWeight: "900", color: "#111" },
  helper: { marginTop: 6, color: "#555", fontWeight: "700" },
  input: {
    marginTop: 8,
    backgroundColor: "#F1F1F1",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#222",
    color: "#111",
    fontWeight: "800",
  },
  priorityRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  priorityBtn: {
    flex: 1,
    backgroundColor: "#EEE",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#222",
    alignItems: "center",
  },
  priorityBtnActive: { backgroundColor: LIGHT_GREEN },
  priorityText: { fontWeight: "900", color: "#111" },
  priorityTextActive: { color: "#0B2416" },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#222",
    alignItems: "center",
    justifyContent: "center",
  },
});

