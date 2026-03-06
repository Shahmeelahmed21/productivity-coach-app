// backend/lib/retriever.js
const KnowledgeChunk = require("../models/KnowledgeChunk");
const { ollamaEmbed } = require("./ollamaClient");

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function cosineSim(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  return dot(a, b) / (na * nb);
}

// Prefer user-relevant doc types over generic KB
const DOC_TYPE_WEIGHT = {
  task: 1.18,
  prefs: 1.15,
  mood: 1.12,
  session: 1.08,
  chat_history: 1.02,
  kb_seed: 0.92,
};

function weightForDocType(docType) {
  const k = String(docType || "").toLowerCase();
  return DOC_TYPE_WEIGHT[k] ?? 1.0;
}

// Small recency boost if createdAt exists
function recencyBoost(createdAt) {
  if (!createdAt) return 0;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 0;
  // up to +0.03 for recent docs, fades over ~30 days
  return Math.max(0, 0.03 - ageDays * 0.001);
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Retrieve topK chunks by cosine similarity.
 * Filters to userId OR "global".
 *
 * Improvements:
 * - weights by docType (task/prefs/mood > kb_seed)
 * - boosts user chunks over global
 * - optional recency boost if createdAt exists
 * - de-dupe + diversity limits
 * - truncates text so prompts stay sharp
 */
async function retrieveTopK({
  userId,
  query,
  topK = 4,
  maxScan = 1200,
  maxTextChars = 900,
  minScore = 0.18,
}) {
  const q = String(query || "").trim();
  if (!q) return [];

  const qVec = await ollamaEmbed(q);

  const chunks = await KnowledgeChunk.find({
    $or: [{ userId }, { userId: "global" }],
  })
    .select("userId source docType docId text embedding createdAt")
    .limit(maxScan)
    .lean();

  // Score
  const scored = chunks.map((c) => {
    const base = cosineSim(qVec, c.embedding);
    const weighted = base * weightForDocType(c.docType);

    const userBoost = c.userId === userId ? 0.03 : -0.01; // prefer user data
    const recent = recencyBoost(c.createdAt);

    const final = weighted + userBoost + recent;

    return {
      ...c,
      score: final,
      _base: base,
    };
  });

  // Drop weak results (prevents irrelevant “garbage”)
  const filtered = scored.filter((c) => c.score >= minScore);

  // Sort
  filtered.sort((a, b) => b.score - a.score);

  // De-dupe by docType+docId+source (keep best)
  const bestByKey = new Map();
  for (const c of filtered) {
    const key = `${c.docType}::${c.docId}::${c.source}`;
    const prev = bestByKey.get(key);
    if (!prev || c.score > prev.score) bestByKey.set(key, c);
  }
  const deduped = Array.from(bestByKey.values()).sort((a, b) => b.score - a.score);

  // Diversity limits: don’t return 4 KB seeds, etc.
  const maxPerDocType = 2;
  const maxPerSource = 3;

  const docTypeCount = new Map();
  const sourceCount = new Map();

  const picked = [];
  for (const c of deduped) {
    const dt = String(c.docType || "unknown");
    const src = String(c.source || "unknown");

    const dtN = docTypeCount.get(dt) || 0;
    const srcN = sourceCount.get(src) || 0;

    if (dtN >= maxPerDocType) continue;
    if (srcN >= maxPerSource) continue;

    docTypeCount.set(dt, dtN + 1);
    sourceCount.set(src, srcN + 1);

    // truncate
    const text = String(c.text || "");
    const trimmed = text.length > maxTextChars ? text.slice(0, maxTextChars) + "…" : text;

    picked.push({
      score: Number(c.score.toFixed(4)),
      userId: c.userId,
      source: c.source,
      docType: c.docType,
      docId: c.docId,
      text: trimmed,
      baseScore: Number(clamp01(c._base).toFixed(4)),
    });

    if (picked.length >= topK) break;
  }

  return picked;
}

module.exports = { retrieveTopK };