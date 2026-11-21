const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSanitizer } = require("../src/js/aiSanitizer");
const { buildRequest, fromOpenAiResponse } = require("../src/js/deepseek");

const sanitize = buildSanitizer({
  rules: [
    { value: "SecretBot", alias: "Bot" },
    { value: "me@mail.com", alias: "[redacted]" },
    { value: "play.myserver.net", alias: "[server]" },
  ],
});

test("sanitizer removes identity, network and credential data", () => {
  const out = sanitize(
    [
      "Your username: SecretBot",
      "joined play.myserver.net:25565 from 192.168.1.20",
      "mail me@mail.com or other@x.org",
      "see https://example.com/a?token=1",
      "/login hunter2",
      "/register pw1 pw1",
      "password=abc123 and Bearer abcdefghijkl",
      "key sk-abcdefghijklmnopqrstuvwxyz123456",
      "file /home/ancymon/.config/app.json and C:\\Users\\Bob\\x.txt",
      "uuid 123e4567-e89b-12d3-a456-426614174000",
    ].join("\n"),
  );
  for (const leak of [
    "SecretBot",
    "myserver",
    "192.168",
    "me@mail.com",
    "other@x.org",
    "example.com",
    "hunter2",
    "pw1",
    "abc123",
    "abcdefghijkl",
    "sk-abc",
    "ancymon",
    "Bob",
    "123e4567",
  ]) {
    assert.ok(!out.includes(leak), `${leak} leaked: ${out}`);
  }
  assert.match(out, /Your username: Bot/);
});

test("sanitizer keeps normal game text and plain commands", () => {
  const text =
    "Steve: mine 5 oak_log at 100, 64, -200 then /home and craft wooden_pickaxe";
  assert.equal(sanitize(text), text);
});

test("code mode keeps key=value source intact", () => {
  const code = sanitizeCode("const token = getOption('a'); // /login x");
  assert.match(code, /const token = getOption/);
});

function sanitizeCode(s) {
  return buildSanitizer({ code: true })(s);
}

test("request translation: tool ids, unanswered calls, json mode, sanitizing", () => {
  const body = {
    model: "deepseek-flash",
    format: "json",
    options: { temperature: 0.2, num_predict: 100, num_ctx: 4096 },
    messages: [
      { role: "system", content: "I am SecretBot" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "a", arguments: { x: 1 } } },
          { function: { name: "b", arguments: {} } },
        ],
      },
      { role: "tool", tool_name: "a", content: "done" },
      { role: "user", content: "next" },
    ],
  };
  const req = buildRequest(body, { sanitize });
  assert.equal(req.max_tokens, 100);
  assert.deepEqual(req.thinking, { type: "disabled" });
  assert.deepEqual(req.response_format, { type: "json_object" });
  assert.equal(req.num_ctx, undefined);
  assert.equal(req.messages[0].content, "I am Bot");
  const tools = req.messages.filter((m) => m.role === "tool");
  assert.equal(tools.length, 2, "every call is answered");
  const ids = req.messages[2].tool_calls.map((c) => c.id);
  assert.deepEqual(
    tools.map((t) => t.tool_call_id).sort(),
    ids.slice().sort(),
  );
  assert.equal(req.messages[2].tool_calls[0].function.arguments, '{"x":1}');
  assert.equal(req.messages.at(-1).role, "user");
});

test("response translation returns Ollama-shaped tool calls", () => {
  const res = fromOpenAiResponse({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { function: { name: "go", arguments: '{"to":"Steve"}' } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 5 },
  });
  assert.equal(res.message.tool_calls[0].function.name, "go");
  assert.deepEqual(res.message.tool_calls[0].function.arguments, {
    to: "Steve",
  });
});

test("manager.complete routes script calls through the active provider", async () => {
  const { ollamaManager: m } = require("../src/js/ollamaManager");
  const calls = [];
  m.config.provider = "deepseek";
  m.deepseekKey = "k";
  m.chat = async (body) => {
    calls.push(body);
    return { message: { content: "<think>x</think> hi" } };
  };
  assert.equal(await m.complete("hello", { system: "s", json: true }), "hi");
  assert.equal(calls[0].format, "json");
  assert.equal(calls[0].messages[0].role, "system");
  assert.equal(calls[0].model, "deepseek-v4-pro");
  m.scriptAiCalls = Array(20).fill(Date.now());
  await assert.rejects(m.complete("again"), /rate limit/);
});
