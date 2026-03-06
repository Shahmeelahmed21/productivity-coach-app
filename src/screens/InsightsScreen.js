// src/screens/InsightsScreen.js
import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, API_BASE, getProgressSafe } from "../api";

// Palette
const GREEN = "#0F7A4A";
const GREEN_LIGHT = "#4DC88A";
const GREEN_PALE = "#E6F7EF";
const CREAM = "#FAFAF8";
const SURFACE = "#FFFFFF";
const INK = "#0D1F17";
const INK2 = "#3D5248";
const GOLD = "#F5A623";

function xpToNextLevel(level) {
  return 100 + (Math.max(1, Number(level || 1)) - 1) * 50;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatShort(yyyyMmDd) {
  try {
    const [y, m, d] = yyyyMmDd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${pad2(dt.getUTCDate())} ${months[dt.getUTCMonth()]}`;
  } catch {
    return yyyyMmDd;
  }
}

function dayLabel(d) {
  if (!d?.date) return d?.weekday || "•";
  return `${d.weekday || "•"} ${formatShort(d.date)}`;
}

export default function InsightsScreen() {
  const [rangeDays, setRangeDays] = useState(7);
  const [loading, setLoading] = useState(true);

  const [data, setData] = useState(null);
  const [progress, setProgress] = useState(null);

  const fetchDashboard = async (days) => {
    try {
      setLoading(true);
      const res = await api.get("/insights/dashboard", { params: { days } });
      if (res.data?.ok === false) throw new Error(res.data?.message || "Failed");
      setData(res.data);
    } catch (e) {
      Alert.alert("Insights error", e?.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchProgress = async () => {
    const p = await getProgressSafe();
    if (p) setProgress(p);
  };

  useEffect(() => {
    fetchDashboard(rangeDays);
    fetchProgress();
  }, [rangeDays]);

  const totals = useMemo(() => data?.totals || {}, [data?.totals]);
  const daily = useMemo(() => data?.daily || [], [data?.daily]);
  const streak = useMemo(() => data?.streak || { current: 0, best: 0 }, [data?.streak]);
  const recent = useMemo(() => data?.recent || { sessions: [], tasks: [] }, [data?.recent]);

  const weekDaily = useMemo(() => daily.slice(-7), [daily]);

  const maxWeekScore = useMemo(() => {
    let mx = 1;
    for (const d of weekDaily) {
      const score = Number(d.focusMinutes || 0) + Number(d.tasksCompleted || 0) * 30;
      mx = Math.max(mx, score);
    }
    return mx;
  }, [weekDaily]);

  const weekStrip = useMemo(() => {
    return weekDaily.map((d) => {
      const workScore = Number(d.focusMinutes || 0) + Number(d.tasksCompleted || 0) * 30;
      const pct = Math.round((workScore / maxWeekScore) * 100);
      return { ...d, workScore, pct: Math.max(0, Math.min(100, pct)) };
    });
  }, [weekDaily, maxWeekScore]);

  const workDoneLabel = useMemo(() => {
    const mins = totals.focusMinutes || 0;
    const tasks = totals.tasksCompleted || 0;
    return `${mins} mins + ${tasks} tasks`;
  }, [totals]);

  const weekTotals = useMemo(() => {
    const out = {
      focusMinutes: 0,
      tasksCompleted: 0,
      sessionsCompleted: 0,
      sessionsEndedEarly: 0,
    };

    for (const d of weekDaily) {
      out.focusMinutes += Number(d.focusMinutes || 0);
      out.tasksCompleted += Number(d.tasksCompleted || 0);
      out.sessionsCompleted += Number(d.sessionsCompleted || 0);
      out.sessionsEndedEarly += Number(d.sessionsEndedEarly || 0);
    }

    const ended = out.sessionsCompleted + out.sessionsEndedEarly;
    out.completionRate = ended > 0 ? Math.round((out.sessionsCompleted / ended) * 100) : 0;
    out.avgMinsPerCompleted =
      out.sessionsCompleted > 0 ? Math.round(out.focusMinutes / out.sessionsCompleted) : 0;

    return out;
  }, [weekDaily]);

  const bestWeekDay = useMemo(() => {
    let best = null;
    let bestScore = -1;

    for (const d of weekDaily) {
      const score = Number(d.focusMinutes || 0) + Number(d.tasksCompleted || 0) * 30;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }

    return best;
  }, [weekDaily]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.bg}>
        {/* Header */}
        <View style={styles.topHeader}>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <View style={styles.titleDot} />
              <Text style={styles.h1}>Insights</Text>
            </View>
            <Text style={styles.hint}>API: {API_BASE}</Text>
            <Text style={styles.hint2} numberOfLines={1}>
              Timezone: {data?.timeZone || "—"}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.refresh}
            onPress={() => {
              fetchDashboard(rangeDays);
              fetchProgress();
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh" size={16} color={SURFACE} />
            <Text style={styles.refreshText}> Refresh</Text>
          </TouchableOpacity>
        </View>

        {/* Range pills */}
        <View style={styles.rangeRow}>
          <RangePill label="7 days" active={rangeDays === 7} onPress={() => setRangeDays(7)} />
          <RangePill label="30 days" active={rangeDays === 30} onPress={() => setRangeDays(30)} />
        </View>

        {/* Panel */}
        <ScrollView style={styles.panel} contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={GREEN} size="large" />
              <Text style={{ marginTop: 10, color: INK2, fontWeight: "800" }}>Loading insights…</Text>
            </View>
          ) : (
            <>
              {/* ✅ Level card */}
              {progress ? (
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconChip, { backgroundColor: "#FFF7E0" }]}>
                      <Ionicons name="game-controller" size={16} color={GOLD} />
                    </View>
                    <Text style={styles.cardTitle}>Level</Text>
                  </View>

                  <View style={styles.bigGrid}>
                    <BigStat
                      label="Current level"
                      value={`Level ${progress.level}`}
                      sub={`Total XP: ${progress.totalXp || 0}`}
                    />
                    <BigStat
                      label="XP progress"
                      value={`${progress.xp || 0}/${xpToNextLevel(progress.level)}`}
                      sub="To next level"
                    />
                  </View>

                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.round(
                            (Number(progress.xp || 0) / xpToNextLevel(progress.level)) * 100
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              ) : null}

              {/* Streak + WD */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.iconChip, { backgroundColor: GREEN_PALE }]}>
                    <Ionicons name="flame" size={16} color={GREEN} />
                  </View>
                  <Text style={styles.cardTitle}>Streak & Work Done</Text>
                </View>

                <View style={styles.bigGrid}>
                  <BigStat
                    label="Current streak"
                    value={`${streak.current || 0} day${(streak.current || 0) === 1 ? "" : "s"}`}
                    sub={`Best: ${streak.best || 0}`}
                  />
                  <BigStat
                    label="Work done (WD)"
                    value={`${totals.workDoneScore || 0}`}
                    sub={workDoneLabel}
                  />
                </View>

                <View style={styles.weekRow}>
                  {weekStrip.map((d) => (
                    <View key={d.date} style={styles.dayCol}>
                      <Text style={styles.dayLetter}>{d.weekday || "·"}</Text>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { height: `${Math.max(8, d.pct)}%` }]} />
                      </View>
                      <Text style={styles.dayMini}>{(d.focusMinutes || 0) > 0 ? `${d.focusMinutes}m` : "—"}</Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.miniHint}>
                  A “work day” = ≥10 focus minutes or ≥1 completed task (timezone-aware).
                </Text>
              </View>

              {/* This week summary */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.iconChip, { backgroundColor: GREEN_PALE }]}>
                    <Ionicons name="calendar" size={16} color={GREEN} />
                  </View>
                  <Text style={styles.cardTitle}>This week (last 7 days)</Text>
                </View>

                <View style={styles.statsGrid}>
                  <StatBox label="Focus mins" value={weekTotals.focusMinutes} accent="#CBF0DC" />
                  <StatBox label="Tasks done" value={weekTotals.tasksCompleted} accent="#CBF0DC" />
                  <StatBox label="Completed sessions" value={weekTotals.sessionsCompleted} accent="#CBF0DC" />
                  <StatBox label="Ended early" value={weekTotals.sessionsEndedEarly} accent="#FFF3CD" />
                  <StatBox label="Completion %" value={`${weekTotals.completionRate}%`} accent="#CBF0DC" />
                  <StatBox
                    label="Avg mins / completed"
                    value={weekTotals.avgMinsPerCompleted ? `${weekTotals.avgMinsPerCompleted}m` : "—"}
                    accent="#CBF0DC"
                  />
                </View>

                {bestWeekDay ? (
                  <View style={styles.weekSummaryBox}>
                    <Text style={styles.weekSummaryTitle}>Best day</Text>
                    <Text style={styles.weekSummaryText}>
                      {dayLabel(bestWeekDay)} • {bestWeekDay.focusMinutes || 0}m •{" "}
                      {bestWeekDay.tasksCompleted || 0} task
                      {(bestWeekDay.tasksCompleted || 0) === 1 ? "" : "s"} •{" "}
                      {bestWeekDay.sessionsCompleted || 0} completed session
                      {(bestWeekDay.sessionsCompleted || 0) === 1 ? "" : "s"}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Recent */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.iconChip, { backgroundColor: "#FFF7E0" }]}>
                    <Ionicons name="trophy" size={16} color={GOLD} />
                  </View>
                  <Text style={styles.cardTitle}>Recent wins</Text>
                </View>

                {recent.tasks?.length === 0 && recent.sessions?.length === 0 ? (
                  <Text style={styles.muted}>Nothing yet — do one small session and it shows up here ✅</Text>
                ) : (
                  <>
                    {recent.tasks?.slice(0, 5).map((t) => (
                      <View key={t._id} style={styles.rowLine}>
                        <Text style={styles.rowMain}>✅ {t.title}</Text>
                        <Text style={styles.rowSub}>{formatShort(String(t.completedAt).slice(0, 10))}</Text>
                      </View>
                    ))}

                    {recent.sessions?.slice(0, 5).map((s) => (
                      <View key={s._id} style={styles.rowLine}>
                        <Text style={styles.rowMain}>
                          {s.completed ? "🔥" : "⏸️"} Session • {s.actualMinutes ?? 0}m
                        </Text>
                        <Text style={styles.rowSub}>
                          {s.endReason ? s.endReason : s.completed ? "completed" : "ended early"}
                        </Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function RangePill({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.pill, active && styles.pillActive]}>
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function BigStat({ label, value, sub }) {
  return (
    <View style={styles.bigStat}>
      <Text style={styles.bigLabel}>{label}</Text>
      <Text style={styles.bigValue}>{value}</Text>
      <Text style={styles.bigSub}>{sub}</Text>
    </View>
  );
}

function StatBox({ label, value, accent }) {
  return (
    <View style={[styles.statBox, { borderLeftColor: accent, borderLeftWidth: 4 }]}>
      <Text style={styles.statValue}>{String(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GREEN },
  bg: { flex: 1, backgroundColor: GREEN },

  topHeader: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  titleDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: GREEN_LIGHT },
  h1: { fontSize: 30, fontWeight: "900", color: SURFACE, letterSpacing: -0.5 },
  hint: { marginTop: 3, color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "700" },
  hint2: { marginTop: 3, color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "700" },

  refresh: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
  },
  refreshText: { fontWeight: "800", color: SURFACE, fontSize: 13 },

  rangeRow: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 10,
    flexDirection: "row",
    gap: 10,
  },
  pill: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
  },
  pillActive: { backgroundColor: SURFACE, borderColor: SURFACE },
  pillText: { fontSize: 13, fontWeight: "900", color: SURFACE },
  pillTextActive: { color: INK },

  panel: {
    marginTop: 6,
    backgroundColor: CREAM,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 14,
  },

  card: {
    marginTop: 12,
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: "rgba(0,0,0,0.08)",
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: "900", color: INK, letterSpacing: -0.2 },
  iconChip: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },

  muted: { color: INK2, fontWeight: "700", fontSize: 14 },

  bigGrid: { flexDirection: "row", gap: 10 },
  bigStat: {
    flex: 1,
    backgroundColor: CREAM,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  bigLabel: { fontSize: 12, fontWeight: "900", color: INK2, textTransform: "uppercase" },
  bigValue: { marginTop: 6, fontSize: 22, fontWeight: "900", color: INK, letterSpacing: -0.4 },
  bigSub: { marginTop: 4, fontSize: 12, fontWeight: "800", color: INK2 },

  weekRow: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  dayCol: { alignItems: "center", flex: 1 },
  dayLetter: { fontSize: 12, fontWeight: "900", color: INK2 },
  barTrack: {
    marginTop: 8,
    width: "70%",
    height: 42,
    borderRadius: 10,
    backgroundColor: "rgba(15,122,74,0.10)",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  barFill: {
    width: "100%",
    backgroundColor: GREEN_LIGHT,
    borderRadius: 10,
  },
  dayMini: { marginTop: 6, fontSize: 11, fontWeight: "900", color: INK2 },

  miniHint: { marginTop: 10, fontSize: 12, fontWeight: "700", color: INK2 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statBox: {
    width: "48%",
    backgroundColor: CREAM,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.07)",
    borderRadius: 14,
    padding: 12,
  },
  statValue: { fontSize: 22, fontWeight: "900", color: INK, letterSpacing: -0.5 },
  statLabel: { marginTop: 4, color: INK2, fontWeight: "800", fontSize: 12 },

  progressTrack: {
    marginTop: 10,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(15,122,74,0.10)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: GREEN_LIGHT, borderRadius: 999 },

  weekSummaryBox: {
    marginTop: 14,
    backgroundColor: CREAM,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
    padding: 12,
  },
  weekSummaryTitle: { fontWeight: "900", color: INK, fontSize: 12, textTransform: "uppercase" },
  weekSummaryText: { marginTop: 6, color: INK2, fontWeight: "800", fontSize: 13, lineHeight: 18 },

  rowLine: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.06)" },
  rowMain: { fontWeight: "900", color: INK },
  rowSub: { marginTop: 3, fontWeight: "700", color: INK2, fontSize: 12 },

  center: { paddingVertical: 40, alignItems: "center", justifyContent: "center" },
});

