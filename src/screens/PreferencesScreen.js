import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, API_BASE } from "../api";

const GREEN = "#2EAD67";
const LIGHT_GREEN = "#62C77C";
const TEXT = "#111";

export default function PreferencesScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [timezone, setTimezone] = useState("Europe/London");
  const [sleepStart, setSleepStart] = useState("01:00");
  const [sleepEnd, setSleepEnd] = useState("09:00");
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("17:00");

  const [focusBlockMinutes, setFocusBlockMinutes] = useState("25");
  const [shortBreakMinutes, setShortBreakMinutes] = useState("5");
  const [longBreakMinutes, setLongBreakMinutes] = useState("15");

  const [tone, setTone] = useState("friendly"); // friendly|direct|motivational

  const [studyDays, setStudyDays] = useState([1, 2, 3, 4, 5]); // Mon-Fri

  const toggleDay = (d) => {
    setStudyDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  };

  const loadPrefs = async () => {
    try {
      setLoading(true);
      const res = await api.get("/prefs");
      const prefs = res.data?.prefs || res.data; // supports either shape
      if (!prefs) throw new Error("No prefs returned");

      setTimezone(prefs.timezone || "Europe/London");
      setSleepStart(prefs.sleepStart || "01:00");
      setSleepEnd(prefs.sleepEnd || "09:00");

      setWorkStart(prefs.workHours?.start || "09:00");
      setWorkEnd(prefs.workHours?.end || "17:00");

      setFocusBlockMinutes(String(prefs.focusBlockMinutes ?? 25));
      setShortBreakMinutes(String(prefs.shortBreakMinutes ?? 5));
      setLongBreakMinutes(String(prefs.longBreakMinutes ?? 15));

      setTone(prefs.tone || "friendly");
      setStudyDays(Array.isArray(prefs.studyDays) ? prefs.studyDays : [1, 2, 3, 4, 5]);
    } catch (e) {
      Alert.alert("Error loading prefs", e?.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  const savePrefs = async () => {
    // quick client validation
    const num = (v) => Number(v);
    if (!Number.isFinite(num(focusBlockMinutes))) return Alert.alert("Invalid", "Focus block must be a number");
    if (!Number.isFinite(num(shortBreakMinutes))) return Alert.alert("Invalid", "Short break must be a number");
    if (!Number.isFinite(num(longBreakMinutes))) return Alert.alert("Invalid", "Long break must be a number");

    try {
      setSaving(true);
      const payload = {
        timezone,
        sleepStart,
        sleepEnd,
        workHours: { start: workStart, end: workEnd },
        focusBlockMinutes: num(focusBlockMinutes),
        shortBreakMinutes: num(shortBreakMinutes),
        longBreakMinutes: num(longBreakMinutes),
        tone,
        studyDays,
      };

      const res = await api.patch("/prefs", payload);
      const ok = res.data?.ok;
      if (ok === false) throw new Error(res.data?.message || "Save failed");

      Alert.alert("Saved ✅", "Preferences updated.");
    } catch (e) {
      Alert.alert("Error saving prefs", e?.response?.data?.message || e.message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    loadPrefs();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={GREEN} />
          <Text style={{ marginTop: 10, color: "#444" }}>Loading preferences…</Text>
          <Text style={{ marginTop: 6, color: "#666" }}>API: {API_BASE}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Preferences</Text>
        <Text style={styles.sub}>Make the bot feel like it knows you.</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <Card title="Daily rhythm">
          <LabeledInput label="Timezone" value={timezone} onChangeText={setTimezone} placeholder="Europe/London" />
          <Row>
            <SmallInput label="Sleep start" value={sleepStart} onChangeText={setSleepStart} placeholder="01:00" />
            <SmallInput label="Sleep end" value={sleepEnd} onChangeText={setSleepEnd} placeholder="09:00" />
          </Row>
          <Row>
            <SmallInput label="Work/Study start" value={workStart} onChangeText={setWorkStart} placeholder="09:00" />
            <SmallInput label="Work/Study end" value={workEnd} onChangeText={setWorkEnd} placeholder="17:00" />
          </Row>
        </Card>

        <Card title="Focus blocks">
          <Row>
            <SmallInput label="Focus (mins)" value={focusBlockMinutes} onChangeText={setFocusBlockMinutes} keyboardType="number-pad" />
            <SmallInput label="Short break" value={shortBreakMinutes} onChangeText={setShortBreakMinutes} keyboardType="number-pad" />
            <SmallInput label="Long break" value={longBreakMinutes} onChangeText={setLongBreakMinutes} keyboardType="number-pad" />
          </Row>
        </Card>

        <Card title="Study days">
          <View style={styles.daysRow}>
            {[
              { d: 0, t: "Sun" },
              { d: 1, t: "Mon" },
              { d: 2, t: "Tue" },
              { d: 3, t: "Wed" },
              { d: 4, t: "Thu" },
              { d: 5, t: "Fri" },
              { d: 6, t: "Sat" },
            ].map((x) => (
              <DayPill
                key={x.d}
                text={x.t}
                active={studyDays.includes(x.d)}
                onPress={() => toggleDay(x.d)}
              />
            ))}
          </View>
        </Card>

        <Card title="Bot style">
          <View style={styles.toneRow}>
            <ToneBtn label="Friendly" active={tone === "friendly"} onPress={() => setTone("friendly")} />
            <ToneBtn label="Direct" active={tone === "direct"} onPress={() => setTone("direct")} />
            <ToneBtn label="Motivational" active={tone === "motivational"} onPress={() => setTone("motivational")} />
          </View>
        </Card>

        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.7 }]} onPress={savePrefs} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#111" />
          ) : (
            <>
              <Ionicons name="save" size={18} color="#111" />
              <Text style={styles.saveText}> Save preferences</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children }) {
  return <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>{children}</View>;
}

function LabeledInput({ label, ...props }) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="rgba(0,0,0,0.45)" {...props} />
    </View>
  );
}

function SmallInput({ label, ...props }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="rgba(0,0,0,0.45)" {...props} />
    </View>
  );
}

function DayPill({ text, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.dayPill, active && styles.dayPillActive]}
      activeOpacity={0.85}
    >
      <Text style={[styles.dayText, active && styles.dayTextActive]}>{text}</Text>
    </TouchableOpacity>
  );
}

function ToneBtn({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.toneBtn, active && styles.toneBtnActive]} activeOpacity={0.85}>
      <Text style={[styles.toneText, active && styles.toneTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff", paddingHorizontal: 18 },
  header: { paddingTop: 14, paddingBottom: 6 },
  title: { fontSize: 34, fontWeight: "900", color: TEXT },
  sub: { marginTop: 6, color: "#555", fontWeight: "700" },

  card: {
    marginTop: 14,
    backgroundColor: "#F7F7F7",
    borderWidth: 2,
    borderColor: "#222",
    borderRadius: 16,
    padding: 14,
  },
  cardTitle: { fontWeight: "900", fontSize: 16, color: "#111" },
  label: { marginTop: 10, fontWeight: "900", color: "#111" },
  input: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#222",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontWeight: "800",
    color: "#111",
  },

  daysRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  dayPill: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#222",
    backgroundColor: "#EEE",
  },
  dayPillActive: { backgroundColor: LIGHT_GREEN },
  dayText: { fontWeight: "900", color: "#111" },
  dayTextActive: { color: "#0B2416" },

  toneRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  toneBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#222",
    backgroundColor: "#EEE",
    alignItems: "center",
  },
  toneBtnActive: { backgroundColor: LIGHT_GREEN },
  toneText: { fontWeight: "900", color: "#111" },
  toneTextActive: { color: "#0B2416" },

  saveBtn: {
    marginTop: 16,
    marginBottom: 18,
    backgroundColor: LIGHT_GREEN,
    borderWidth: 2,
    borderColor: "#222",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  saveText: { fontWeight: "900", color: "#111" },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
