// backend/routes/rag.js
const express = require("express");
const { retrieveTopK } = require("../lib/retriever");

const router = express.Router();

// GET /rag/ping  (quick mount test)
router.get("/ping", (req, res) => {
  res.json({ ok: true, message: "rag route mounted" });
});

// POST /rag/search
router.post("/search", async (req, res) => {
  try {
    const { userId, query, topK } = req.body || {};
    if (!userId) return res.status(400).json({ message: "userId is required" });
    if (!query || !String(query).trim()) return res.status(400).json({ message: "query is required" });

    const results = await retrieveTopK({
      userId,
      query: String(query),
      topK: Number(topK || 4),
    });

    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
