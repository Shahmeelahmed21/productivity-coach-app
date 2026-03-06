import React, { useState } from "react";
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { api, API_BASE } from "../api";
import { saveToken } from "../authStorage";

export default function SignupScreen({ onAuthed, goLogin }) {
  const [name, setName] = useState("Shahmeel");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const signup = async () => {
    try {
      setLoading(true);
      const res = await api.post("/auth/signup", { name, email, password });
      const token = res.data?.token;
      if (!token) throw new Error("No token returned");

      await saveToken(token);
      await onAuthed?.(token);
    } catch (e) {
      Alert.alert("Signup failed", e?.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>Create account</Text>
      <Text style={styles.sub}>API: {API_BASE}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Name</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Your name" style={styles.input} />

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@gmail.com"
          style={styles.input}
        />

        <Text style={styles.label}>Password (min 6 chars)</Text>
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••••" style={styles.input} />

        <TouchableOpacity style={[styles.btn, loading && { opacity: 0.6 }]} disabled={loading} onPress={signup}>
          <Text style={styles.btnText}>{loading ? "Creating..." : "Sign up"}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={goLogin} style={{ marginTop: 12 }}>
          <Text style={styles.link}>Already have an account? Log in</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff", padding: 18 },
  title: { fontSize: 32, fontWeight: "900", color: "#111", marginTop: 18 },
  sub: { marginTop: 6, color: "#666", fontWeight: "700" },
  card: { marginTop: 18, padding: 16, borderWidth: 2, borderColor: "#222", borderRadius: 16, backgroundColor: "#F7F7F7" },
  label: { marginTop: 12, fontWeight: "900", color: "#111" },
  input: { marginTop: 8, borderWidth: 2, borderColor: "#222", borderRadius: 12, padding: 12, backgroundColor: "#fff", fontWeight: "800" },
  btn: { marginTop: 16, backgroundColor: "#62C77C", padding: 14, borderRadius: 12, borderWidth: 2, borderColor: "#222", alignItems: "center" },
  btnText: { fontWeight: "900", color: "#111" },
  link: { fontWeight: "900", color: "#111", textDecorationLine: "underline" },
});
