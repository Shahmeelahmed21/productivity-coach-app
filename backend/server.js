
const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const ragRoutes = require("./routes/rag");
const taskRoutes = require("./routes/tasks");
const moodRoutes = require("./routes/mood");
const sessionRoutes = require("./routes/session");
const chatRoutes = require("./routes/chat");
const llmRoutes = require("./routes/llm");
const authRoutes = require("./routes/auth");
const prefsRoutes = require("./routes/prefs");
const planRoutes = require("./routes/plan");
const progressRoutes = require("./routes/progress");



const app = express();
app.use(cors());
app.use(express.json());

function asRouter(mod, name) {
  const candidate = mod?.default || mod?.router || mod;
  if (typeof candidate !== "function") {
    throw new TypeError(`Route module '${name}' does not export an Express router`);
  }
  return candidate;
}

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/llm", asRouter(llmRoutes, "llm"));
app.use("/rag", asRouter(ragRoutes, "rag"));
app.use("/chat", asRouter(chatRoutes, "chat"));
app.use("/tasks", asRouter(taskRoutes, "tasks"));
app.use("/mood", asRouter(moodRoutes, "mood"));
app.use("/sessions", asRouter(sessionRoutes, "session"));
app.use("/auth", asRouter(authRoutes, "auth"));
app.use("/prefs", asRouter(prefsRoutes, "prefs"));
app.use("/plan", asRouter(planRoutes, "plan"));
app.use("/insights", require("./routes/insights"));
app.use("/progress", asRouter(progressRoutes, "progress"));

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0"; // ✅ important for Expo/phone access
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("Missing MONGO_URI in .env");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => {
    console.log("Connected to MongoDB");
    app.listen(PORT, HOST, () => {
      console.log(`Server running on http://${HOST}:${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });
