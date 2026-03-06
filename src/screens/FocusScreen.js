// FocusScreen.js (bug-resistant, backend = source of truth)
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { api, API_BASE } from "../api";

const GREEN = "#0F7A4A";
const GREEN_MID = "#1A9B5F";
const GREEN_LIGHT = "#4DC88A";
const CREAM = "#FAFAF8";
const SURFACE = "#FFFFFF";
const INK = "#0D1F17";
const INK2 = "#3D5248";

const REQ_TIMEOUT = 15000;

function pad2(n) {
  return String(n).padStart(2, "0");
}
function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function getSessionId(s) {
  return (s && (s._id || s.id || s.sessionId)) || null;
}
function safeMs(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

// ✅ Always compute from server startedAt/plannedMinutes (no local drifting)
function computeRemainingSeconds(active, fallbackMinutes, localStartedAtIso) {
  if (!active) return clamp(fallbackMinutes, 5, 240) * 60;

  const plannedMin = clamp(active.plannedMinutes ?? fallbackMinutes, 5, 240);
  const total = plannedMin * 60;

  // Prefer server startedAt; if missing, use local fallback; if both missing, show full.
  const startedAt = active.startedAt || localStartedAtIso;
  const startedMs = safeMs(startedAt);

  if (!Number.isFinite(startedMs)) return total;

  const elapsed = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
  return Math.max(0, total - elapsed);
}

export default function FocusScreen({ route, navigation }) {
  // UI state
  const [refreshing, setRefreshing] = useState(true);
  const [busy, setBusy] = useState(false);

  // Session state
  const [active, setActive] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);

  // Manual planned minutes
  const [plannedMinutes, setPlannedMinutes] = useState(25);

  // History
  const [history, setHistory] = useState([]);

  // Stop modal (optional)
  const [stopOpen, setStopOpen] = useState(false);
  const [endReason, setEndReason] = useState("distracted");
  const [endNote, setEndNote] = useState("");

  // Chat-triggered info (optional display)
  const taskTitle = String(route?.params?.taskTitle || "").trim();

  // Timer ticking
  const tickRef = useRef(null);

  // Auto-start trigger handling
  const handledStartIdRef = useRef(null);

  // Fallback startedAt if backend forgets it (rare, but prevents 00 bug)
  const localStartedAtRef = useRef(null);

  const totalSec = useMemo(() => {
    const m = clamp(active?.plannedMinutes ?? plannedMinutes, 5, 240);
    return m * 60;
  }, [active, plannedMinutes]);

  const pct = useMemo(() => {
    const p = Math.round((secondsLeft / totalSec) * 100);
    return Math.max(0, Math.min(100, p));
  }, [secondsLeft, totalSec]);

  const mm = pad2(Math.floor(secondsLeft / 60));
  const ss = pad2(secondsLeft % 60);

  const normalizeHistory = (payload) => {
    // supports: {sessions:[...]} OR array OR {data:[...]}
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.sessions)) return payload.sessions;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };

  const fetchAll = useCallback(async () => {
    try {
      setRefreshing(true);

      const [aRes, hRes] = await Promise.all([
        api.get("/sessions/active", { timeout: REQ_TIMEOUT }),
        api.get("/sessions", { params: { limit: 30 }, timeout: REQ_TIMEOUT }),
      ]);

      const nextActive = aRes.data?.active || null;

      // keep local startedAt fallback in sync
      if (nextActive?.startedAt) localStartedAtRef.current = nextActive.startedAt;

      setActive(nextActive);

      // compute countdown from backend truth
      setSecondsLeft(
        computeRemainingSeconds(nextActive, plannedMinutes, localStartedAtRef.current)
      );

      setHistory(normalizeHistory(hRes.data));
    } catch (e) {
      Alert.alert("Focus error", e?.response?.data?.message || e.message);
    } finally {
      setRefreshing(false);
    }
  }, [plannedMinutes]);

  // Refresh whenever screen is focused
  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [fetchAll])
  );

  // Tick countdown when active (always derived from startedAt)
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);

    if (!active) return;

    tickRef.current = setInterval(() => {
      setSecondsLeft(
        computeRemainingSeconds(active, plannedMinutes, localStartedAtRef.current)
      );
    }, 1000);

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [active, plannedMinutes]);

  // Manual start (backend start)
  const startSession = useCallback(
    async (mins) => {
      if (busy) return;

      try {
        setBusy(true);

        const m = clamp(mins, 5, 240);

        // set fallback startedAt immediately to avoid “00” even if backend is slow
        localStartedAtRef.current = new Date().toISOString();
        setSecondsLeft(m * 60);

        await api.post("/sessions/start", { plannedMinutes: m }, { timeout: REQ_TIMEOUT });

        await fetchAll();
      } catch (e) {
        // If already running, just refresh and continue ticking
        if (e?.response?.status === 409) {
          await fetchAll();
          return;
        }

        // rollback fallback on real failure
        localStartedAtRef.current = null;
        await fetchAll();

        Alert.alert("Start failed", e?.response?.data?.message || e.message);
      } finally {
        setBusy(false);
      }
    },
    [busy, fetchAll]
  );

  // End session (backend end)
  const endSession = useCallback(
    async ({ completed, reason = "", note = "" }) => {
      if (busy) return;

      const id = getSessionId(active);
      if (!id) return Alert.alert("No active session", "Nothing to end.");

      try {
        setBusy(true);

        // actual = (total - remaining), clamped to >= 1
        const actualMinutes = Math.max(1, Math.round((totalSec - secondsLeft) / 60));

        await api.post(
          `/sessions/end/${id}`,
          {
            completed,
            actualMinutes,
            endReason: reason,
            endNote: note,
          },
          { timeout: REQ_TIMEOUT }
        );

        localStartedAtRef.current = null;
        await fetchAll();
      } catch (e) {
        Alert.alert("End failed", e?.response?.data?.message || e.message);
      } finally {
        setBusy(false);
      }
    },
    [busy, active, totalSec, secondsLeft, fetchAll]
  );

  // ✅ Auto-start from Chat (requires ChatScreen to navigate with: { startId: Date.now(), minutes })
  useEffect(() => {
    const startId = route?.params?.startId;
    if (!startId) return;

    if (handledStartIdRef.current === startId) return;
    handledStartIdRef.current = startId;

    const mins = clamp(route?.params?.minutes ?? plannedMinutes, 5, 240);

    (async () => {
      await startSession(mins);

      // clear params to prevent re-trigger on re-focus
      navigation?.setParams?.({ startId: undefined, minutes: undefined, taskTitle: undefined });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.startId]);

  const confirmComplete = () => {
    Alert.alert("Complete session?", "Mark this session as completed?", [
      { text: "Cancel", style: "cancel" },
      { text: "Complete", onPress: () => endSession({ completed: true }) },
    ]);
  };

  const openStop = () => {
    setEndReason("distracted");
    setEndNote("");
    setStopOpen(true);
  };

  const submitStop = async () => {
    setStopOpen(false);
    await endSession({ completed: false, reason: endReason, note: endNote });
  };

  const statusText = active
    ? `Active • planned ${active.plannedMinutes}m`
    : "No active session";

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Focus</Text>
          <Text style={styles.hint}>API: {API_BASE}</Text>
          {taskTitle ? <Text style={styles.topic}>Task: {taskTitle}</Text> : null}
          <Text style={styles.status}>{statusText}</Text>
        </View>

        <TouchableOpacity style={styles.refreshBtn} onPress={fetchAll} activeOpacity={0.85}>
          {refreshing ? (
            <ActivityIndicator color={SURFACE} />
          ) : (
            <Ionicons name="refresh" size={18} color={SURFACE} />
          )}
        </TouchableOpacity>
      </View>

      {/* Timer card */}
      <View style={styles.timerCard}>
        <View style={styles.topRow}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{pct}%</Text>
          </View>
          {busy ? <ActivityIndicator color={SURFACE} /> : null}
        </View>

        <Text style={styles.time}>
          {mm}:{ss}
        </Text>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>

        {!active ? (
          <>
            <Text style={styles.small}>Pick a focus block:</Text>

            <View style={styles.chipsRow}>
              {[25, 45, 60].map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.chip, plannedMinutes === m && styles.chipActive]}
                  onPress={() => setPlannedMinutes(m)}
                  activeOpacity={0.85}
                  disabled={busy}
                >
                  <Text style={[styles.chipText, plannedMinutes === m && styles.chipTextActive]}>
                    {m}m
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.primary, busy && { opacity: 0.6 }]}
              onPress={() => startSession(plannedMinutes)}
              disabled={busy}
              activeOpacity={0.85}
            >
              <Ionicons name="play" size={18} color={INK} />
              <Text style={styles.primaryText}> Start</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.primary, busy && { opacity: 0.6 }]}
              onPress={confirmComplete}
              disabled={busy}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle" size={18} color={INK} />
              <Text style={styles.primaryText}> Complete</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondary, busy && { opacity: 0.6 }]}
              onPress={openStop}
              disabled={busy}
              activeOpacity={0.85}
            >
              <Ionicons name="close-circle-outline" size={18} color={SURFACE} />
              <Text style={styles.secondaryText}> Stop</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* History */}
      <ScrollView style={styles.panel} contentContainerStyle={{ paddingBottom: 80 }}>
        <Text style={styles.panelTitle}>Recent sessions</Text>

        {history.length === 0 ? (
          <Text style={styles.panelText}>No sessions yet.</Text>
        ) : (
          history.slice(0, 15).map((s) => {
            const id = getSessionId(s) || s._id || Math.random().toString(36);
            const started = s.startedAt ? new Date(s.startedAt) : null;
            const dateLine = started ? started.toDateString() : "Unknown date";
            const status = s.endedAt ? (s.completed ? "Completed ✅" : "Ended early") : "Active";

            return (
              <View key={id} style={styles.histRow}>
                <Text style={styles.histTop}>
                  {dateLine} • planned {s.plannedMinutes ?? "?"}m
                </Text>
                <Text style={styles.histSub}>
                  {status} • actual {s.actualMinutes ?? 0}m
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Stop modal */}
      <Modal
        visible={stopOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setStopOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Stop session</Text>
              <TouchableOpacity onPress={() => setStopOpen(false)} hitSlop={12}>
                <Ionicons name="close" size={20} color={INK} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Reason</Text>
            <TextInput value={endReason} onChangeText={setEndReason} style={styles.input} />

            <Text style={styles.modalLabel}>Note (optional)</Text>
            <TextInput
              value={endNote}
              onChangeText={setEndNote}
              style={[styles.input, { minHeight: 70 }]}
              multiline
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: "#EEE" }]}
                onPress={() => setStopOpen(false)}
              >
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: GREEN_LIGHT }]}
                onPress={submitStop}
              >
                <Text style={styles.modalBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GREEN },

  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, flexDirection: "row" },
  h1: { fontSize: 30, fontWeight: "900", color: SURFACE },
  hint: { marginTop: 4, color: "rgba(255,255,255,0.75)", fontWeight: "700", fontSize: 12 },
  topic: { marginTop: 8, color: SURFACE, fontWeight: "900", fontSize: 13 },
  status: { marginTop: 6, color: "rgba(255,255,255,0.9)", fontWeight: "800", fontSize: 12 },

  refreshBtn: {
    marginLeft: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },

  timerCard: {
    marginHorizontal: 16,
    backgroundColor: GREEN_MID,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
  },

  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pill: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: { color: SURFACE, fontWeight: "900", fontSize: 12 },

  time: { marginTop: 10, fontSize: 64, fontWeight: "900", color: SURFACE, textAlign: "center" },

  track: {
    marginTop: 14,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: GREEN_LIGHT },

  small: { marginTop: 14, color: "rgba(255,255,255,0.9)", fontWeight: "800" },

  chipsRow: { flexDirection: "row", marginTop: 12 },
  chip: {
    flex: 1,
    marginRight: 10,
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
  },
  chipActive: { backgroundColor: SURFACE },
  chipText: { color: SURFACE, fontWeight: "900" },
  chipTextActive: { color: INK },

  primary: {
    marginTop: 14,
    backgroundColor: SURFACE,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  primaryText: { fontWeight: "900", color: INK, fontSize: 16, marginLeft: 6 },

  secondary: {
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.4)",
  },
  secondaryText: { fontWeight: "900", color: SURFACE, fontSize: 16, marginLeft: 6 },

  panel: {
    marginTop: 12,
    backgroundColor: CREAM,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  panelTitle: { fontWeight: "900", color: INK, fontSize: 14 },
  panelText: { marginTop: 8, color: INK2, fontWeight: "700" },

  histRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.06)" },
  histTop: { fontWeight: "900", color: INK },
  histSub: { marginTop: 4, fontWeight: "700", color: INK2 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 18 },
  modalCard: { backgroundColor: SURFACE, borderRadius: 18, padding: 16 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { fontWeight: "900", color: INK, fontSize: 16 },
  modalLabel: { marginTop: 12, fontWeight: "900", color: INK },
  input: {
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: CREAM,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: "rgba(0,0,0,0.1)",
    fontWeight: "700",
    color: INK,
  },
  modalActions: { flexDirection: "row", marginTop: 12 },
  modalBtn: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", marginRight: 10 },
  modalBtnText: { fontWeight: "900", color: INK },
});

