const test = require("node:test");
const assert = require("node:assert/strict");

function loadClient() {
  process.env.OPENAI_API_KEY = "test-key";
  delete require.cache[require.resolve("../lib/ollamaClient")];
  return require("../lib/ollamaClient");
}

test("buildChatRequestBody uses json_schema for schema-formatted requests", () => {
  const { buildChatRequestBody } = loadClient();

  const body = buildChatRequestBody(
    [{ role: "user", content: "Break this down" }],
    {
      format: {
        type: "object",
        additionalProperties: false,
        properties: {
          tool: { type: "string" },
        },
      },
      schemaName: "create_subtasks",
    }
  );

  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.name, "create_subtasks");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.type, "object");
});

test("ollamaChat falls back to json_object when json_schema is rejected", async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);

    if (calls.length === 1) {
      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: "response_format json_schema is not supported for this model",
            },
          }),
      };
    }

    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"tool":"create_subtasks","args":{"subtasks":[]}}',
              },
            },
          ],
        }),
    };
  };

  try {
    const { ollamaChat } = loadClient();

    const result = await ollamaChat([{ role: "user", content: "Break this task down" }], {
      format: {
        type: "object",
        additionalProperties: false,
        properties: {
          tool: { type: "string" },
        },
      },
      schemaName: "create_subtasks",
    });

    assert.equal(result, '{"tool":"create_subtasks","args":{"subtasks":[]}}');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].response_format.type, "json_schema");
    assert.equal(calls[1].response_format.type, "json_object");
  } finally {
    global.fetch = originalFetch;
  }
});
