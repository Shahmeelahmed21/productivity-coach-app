// backend/lib/ollamaClient.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5-mini";
const OPENAI_EMBED_MODEL =
  process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

if (!OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY in backend environment");
}

function buildChatRequestBody(messages, opts = {}) {
  const body = {
    model: OPENAI_CHAT_MODEL,
    messages,
  };

  if (opts.format === "json") {
    body.response_format = { type: "json_object" };
  } else if (opts.format && typeof opts.format === "object") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: String(opts.schemaName || "structured_output"),
        schema: opts.format,
        strict: true,
      },
    };
  }

  return body;
}

function extractChatText(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

async function requestChatCompletion(body) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw };
  }

  if (!r.ok) {
    throw new Error(
      data?.error?.message || data?.error || `OpenAI chat failed (${r.status})`
    );
  }

  return data;
}

function shouldRetryAsJsonObject(err) {
  const message = String(err?.message || "").toLowerCase();
  return (
    message.includes("json_schema") ||
    message.includes("response_format") ||
    message.includes("not supported")
  );
}

async function ollamaChat(messages, opts = {}) {
  try {
    const data = await requestChatCompletion(buildChatRequestBody(messages, opts));
    return extractChatText(data);
  } catch (err) {
    if (!(opts.format && typeof opts.format === "object" && shouldRetryAsJsonObject(err))) {
      throw err;
    }

    const fallbackData = await requestChatCompletion(
      buildChatRequestBody(messages, { ...opts, format: "json" })
    );
    return extractChatText(fallbackData);
  }
}

async function ollamaEmbed(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_EMBED_MODEL,
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

  if (!r.ok) {
    throw new Error(
      data?.error?.message || data?.error || `OpenAI embed failed (${r.status})`
    );
  }

  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) {
    throw new Error("No embedding returned from OpenAI");
  }

  return vec;
}

module.exports = { buildChatRequestBody, ollamaChat, ollamaEmbed };

