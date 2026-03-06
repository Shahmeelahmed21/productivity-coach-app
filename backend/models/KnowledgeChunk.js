// backend/models/KnowledgeChunk.js
const mongoose = require("mongoose");

const KnowledgeChunkSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "global", index: true },
    source: { type: String, default: "" },
    docType: { type: String, default: "" },
    docId: { type: String, default: "" },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("KnowledgeChunk", KnowledgeChunkSchema);

