
const express = require("express");
const { ollamaChat, ollamaEmbed } = require("../lib/ollamaClient");

const router = express.Router();

router.get("/health", async (req, res) => {
  try {
    const reply = await ollamaChat([{ role: "user", content: "Reply with exactly: OK" }]);
    const vec = await ollamaEmbed("health check embedding");

    res.json({
      ok: true,
      chatSample: reply.trim().slice(0, 60),
      embeddingDims: vec.length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
