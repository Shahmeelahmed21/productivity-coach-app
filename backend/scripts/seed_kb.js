require("dotenv").config();

const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const KnowledgeChunk = require("../models/KnowledgeChunk");
const { ollamaEmbed } = require("../lib/ollamaClient");

// ✅ chunker: simple + good enough
function chunkText(text, maxChars = 900) {
  const clean = String(text).replace(/\r/g, "").trim();
  if (!clean) return [];
  const parts = clean.split(/\n\s*\n/g).map(s => s.trim()).filter(Boolean);

  const chunks = [];
  let buf = "";
  for (const p of parts) {
    const next = buf ? buf + "\n\n" + p : p;
    if (next.length > maxChars) {
      if (buf) chunks.push(buf);
      buf = p;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

// ✅ turn your JSON into "docs" (strings)
function buildDocs(data) {
  const docs = [];

  // user profiles
  for (const p of data.userProfiles || []) {
    docs.push({
      userId: p.userId || "global",
      source: "demo_user_context.json",
      docType: "user_profile",
      docId: p.userId || "",
      text:
        `USER PROFILE\n` +
        `Name: ${p.displayName}\nTimezone: ${p.timezone}\nUniversity: ${p.university}\nLevel: ${p.studyLevel}\n\n` +
        `Preferences: ${JSON.stringify(p.preferences)}\n` +
        `Constraints: ${JSON.stringify(p.constraints)}\n\n` +
        `Notes:\n- ${(p.personalNotes || []).join("\n- ")}`
    });
  }

  // tasks
  for (const t of data.tasks || []) {
    docs.push({
      userId: t.userId || "global",
      source: "demo_user_context.json",
      docType: "task",
      docId: t._id || "",
      text:
        `TASK\nTitle: ${t.title}\nSubject: ${t.subject || "General"}\nPriority: ${t.priority}\n` +
        `Deadline: ${t.deadline || "None"}\nEstimated minutes: ${t.estMinutes}\n` +
        `Completed: ${t.completed}\n`
    });
  }

  // mood entries
  for (const m of data.moodEntries || []) {
    docs.push({
      userId: m.userId || "global",
      source: "demo_user_context.json",
      docType: "mood",
      docId: m._id || "",
      text:
        `MOOD ENTRY\nMood: ${m.mood}/5\nStress: ${m.stress}/5\nEnergy: ${m.energy}/5\n` +
        `Note: ${m.note || ""}\nDate: ${m.createdAt}\n`
    });
  }

  // study sessions
  for (const s of data.studySessions || []) {
    docs.push({
      userId: s.userId || "global",
      source: "demo_user_context.json",
      docType: "study_session",
      docId: s._id || "",
      text:
        `STUDY SESSION\nTaskId: ${s.taskId || "None"}\nPlanned: ${s.plannedMinutes} mins\n` +
        `Actual: ${s.actualMinutes} mins\nCompleted: ${s.completed}\n` +
        `Started: ${s.startedAt}\nEnded: ${s.endedAt}\n`
    });
  }

  // chat history (optional context)
  for (const c of data.chatHistory || []) {
    docs.push({
      userId: c.userId || "global",
      source: "demo_user_context.json",
      docType: "chat_history",
      docId: c._id || "",
      text: `CHAT HISTORY (${c.role})\n${c.content}\nDate: ${c.createdAt}`
    });
  }

  // knowledge base seeds (general docs)
  for (const k of data.knowledgeBaseSeeds || []) {
    docs.push({
      userId: "global",
      source: k.source || "kb_seed",
      docType: "kb_seed",
      docId: k.title || "",
      text: `KNOWLEDGE BASE\nTitle: ${k.title}\n\n${k.text}`
    });
  }

  return docs;
}

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) throw new Error("Missing MONGO_URI");

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("✅ Mongo connected");

  const filePath = path.join(__dirname, "..", "data", "demo_user_context.json");
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  const docs = buildDocs(data);
  console.log(`Built ${docs.length} docs`);

  // optional: clear old KB
  await KnowledgeChunk.deleteMany({ source: "demo_user_context.json" });
  console.log("🧹 Cleared old chunks from this source");

  let inserted = 0;

  for (const d of docs) {
    const chunks = chunkText(d.text, 900);

    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i];
      const embedding = await ollamaEmbed(text);

      await KnowledgeChunk.create({
        userId: d.userId,
        source: d.source,
        docType: d.docType,
        docId: d.docId,
        text,
        embedding,
      });

      inserted++;
      if (inserted % 25 === 0) console.log(`Inserted ${inserted} chunks...`);
    }
  }

  console.log(`Done. Inserted ${inserted} chunks total.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Seed error:", e.message);
  process.exit(1);
});
