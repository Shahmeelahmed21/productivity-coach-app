// backend/lib/ollamaClient.js
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "qwen2.5:7b-instruct";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "all-minilm";

async function ollamaChat(messages, opts = {}) {
  const {
    numPredict = 220,
    temperature = 0.35,
    topP = 0.9,
    keepAlive = "10m",
    numCtx,
    format, // ✅ NEW: "json" or JSON schema object
  } = opts;

  const body = {
    model: CHAT_MODEL,
    messages,
    stream: false,
    keep_alive: keepAlive,
    options: {
      num_predict: numPredict,
      temperature,
      top_p: topP,
      ...(Number.isFinite(numCtx) ? { num_ctx: numCtx } : {}),
    },
    ...(format ? { format } : {}), // ✅ NEW
  };

  const r = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw };
  }

  if (!r.ok) throw new Error(data?.error || `Ollama chat failed (${r.status})`);
  return data?.message?.content || "";
}

async function ollamaEmbed(text) {
  const r = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
    }),
  });

  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw };
  }

  if (!r.ok) throw new Error(data?.error || `Ollama embed failed (${r.status})`);

  const vec = data?.embeddings?.[0];
  if (!Array.isArray(vec)) throw new Error("No embedding returned from Ollama");
  return vec;
}

module.exports = { ollamaChat, ollamaEmbed };

