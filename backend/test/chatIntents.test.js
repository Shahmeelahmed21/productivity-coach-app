const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSubtaskCreateIntent,
  isTaskCreateIntent,
  stripTaskCreateLead,
} = require("../lib/chatIntents");

test("task creation stays limited to explicit new-task phrasing", () => {
  assert.equal(isTaskCreateIntent("create a task to finish my essay tomorrow"), true);
  assert.equal(isTaskCreateIntent("set up a new task for physics revision"), true);
  assert.equal(isTaskCreateIntent("remind me to submit the lab report tomorrow"), true);
});

test("subtask prompts do not collide with task creation when they mention a parent task", () => {
  const prompt = "create 5 subtasks for my essay task";

  assert.equal(isSubtaskCreateIntent(prompt), true);
  assert.equal(isTaskCreateIntent(prompt), false);
});

test("checklist and step prompts stay in the subtask lane", () => {
  assert.equal(isSubtaskCreateIntent("make a checklist for my biology task"), true);
  assert.equal(isTaskCreateIntent("make a checklist for my biology task"), false);
  assert.equal(isSubtaskCreateIntent("break this task down into 6 steps"), true);
  assert.equal(isTaskCreateIntent("break this task down into 6 steps"), false);
});

test("task title extraction removes only the explicit task-create lead", () => {
  assert.equal(
    stripTaskCreateLead("please create a new task to finish my essay"),
    "finish my essay"
  );
  assert.equal(
    stripTaskCreateLead("create 5 subtasks for my essay task"),
    "create 5 subtasks for my essay task"
  );
});
