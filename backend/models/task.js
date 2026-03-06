// backend/models/task.js
const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },

    title: { type: String, required: true, trim: true },
    subject: { type: String, default: "" },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    deadline: { type: Date },
    estMinutes: { type: Number, default: 60 },

    completed: { type: Boolean, default: false },
    completedAt: { type: Date },

    
    xpAwarded: { type: Boolean, default: false, index: true },
    xpValue: { type: Number, default: null }, // optional override

    
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null, index: true },
    isSubtask: { type: Boolean, default: false, index: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

TaskSchema.index({ userId: 1, parentId: 1, order: 1 });
TaskSchema.index({ userId: 1, completed: 1, isSubtask: 1 });

module.exports = mongoose.model("Task", TaskSchema);
