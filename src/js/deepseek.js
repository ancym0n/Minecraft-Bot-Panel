// DeepSeek (OpenAI-compatible) transport. Callers keep speaking the Ollama
// request/response shape; this module translates both directions.

const https = require("https");
const http = require("http");
const { sanitizeMessages } = require("./aiSanitizer");

const DEFAULT_BASE_URL = "https://api.deepseek.com";

// deepseek-flash: very cheap and fast, tools + JSON; used for chat and the
// self-review pass. deepseek-v4-pro: ~4x the price but far better at tool
// use and code, so it drives the agent and Script Studio. Thinking mode is
// switched off for both (default is on): it costs latency and output tokens
// that live bot control doesn't need.
const DEEPSEEK_MODELS = [
  {
    name: "deepseek-flash",
    label: "DeepSeek V4.1 Flash",
    sizeLabel: "API",
    minRamGb: 0,
    tier: "api",
    tags: ["chat", "tools", "code"],
    badges: ["fast", "chat", "code"],
    desc: "Fastest and cheapest. Best for chat and simple actions",
  },
  {
    name: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    sizeLabel: "API",
    minRamGb: 0,
    tier: "api",
    tags: ["chat", "tools", "code"],
    badges: ["accuracy", "logic", "code"],
    desc: "Smarter, still cheap. Best for the agent and scripts",
  },
];

const DEFAULT_MODELS = {
  chat: "deepseek-v4-pro",
  agent: "deepseek-v4-pro",
  script: "deepseek-v4-pro",
};

function isDeepseekModel(name) {
  return /^deepseek-(flash|v4-pro)$/.test(String(name || ""));
}

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw || "{}"));
  } catch (_) {
    return {};
  }
}

// Ollama-style messages -> OpenAI-style. Tool calls need ids and every call
// needs an answer, so unanswered ones get a placeholder.
function toOpenAiMessages(messages) {
  const out = [];
  let pending = [];
  let counter = 0;
  const flush = () => {
    for (const p of pending) {
      out.push({ role: "tool", tool_call_id: p.id, content: "skipped" });
    }
    pending = [];
  };
  for (const m of messages) {
    if (m.role === "tool") {
      const idx = pending.findIndex((p) => p.name === m.tool_name);
      const hit = idx >= 0 ? pending.splice(idx, 1)[0] : pending.shift();
      if (!hit) continue;
      out.push({
        role: "tool",
        tool_call_id: hit.id,
        content: String(m.content ?? ""),
      });
      continue;
    }
    flush();
    if (
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length
    ) {
      const calls = m.tool_calls.map((c) => {
        const id = c.id || `call_${++counter}`;
        const name = c.function?.name || "";
        pending.push({ id, name });
        return {
          id,
          type: "function",
          function: {
            name,
            arguments: JSON.stringify(parseArgs(c.function?.arguments)),
          },
        };
      });
      out.push({
        role: "assistant",
        content: m.content || "",
        tool_calls: calls,
      });
    } else {
      out.push({ role: m.role, content: String(m.content ?? "") });
    }
  }
  flush();
  return out;
}

function buildRequest(body, { sanitize = (s) => s } = {}) {
  const opts = body.options || {};
  const req = {
    model: body.model,
    messages: sanitizeMessages(toOpenAiMessages(body.messages || []), sanitize),
    stream: Boolean(body.stream),
  };
  if (Number.isFinite(opts.temperature)) req.temperature = opts.temperature;
  if (Number.isFinite(opts.num_predict)) req.max_tokens = opts.num_predict;
  req.thinking = { type: "disabled" };
  if (req.stream) req.stream_options = { include_usage: true };
  if (Array.isArray(body.tools) && body.tools.length) req.tools = body.tools;
  if (body.format === "json") req.response_format = { type: "json_object" };
  return req;
}

function fromOpenAiResponse(res) {
  const choice = res?.choices?.[0]?.message || {};
  const calls = Array.isArray(choice.tool_calls)
    ? choice.tool_calls.map((c) => ({
        function: {
          name: c.function?.name || "",
          arguments: parseArgs(c.function?.arguments),
        },
      }))
    : [];
  const message = { role: "assistant", content: choice.content || "" };
  if (calls.length) message.tool_calls = calls;
  return { message, usage: res?.usage || null };
}

function friendlyError(status, raw) {
  let detail = "";
  try {
    detail = JSON.parse(raw)?.error?.message || "";
  } catch (_) {}
  detail = detail || String(raw || "").slice(0, 160);
  if (status === 401) return "DeepSeek: invalid API key.";
  if (status === 402) return "DeepSeek: insufficient balance. Top up credits.";
  if (status === 429) return "DeepSeek: rate limited, try again shortly.";
  if (status >= 500) return `DeepSeek: server busy (HTTP ${status}).`;
  return `DeepSeek: HTTP ${status} ${detail}`.trim();
}

function openRequest(
  baseUrl,
  route,
  { method, apiKey, payload, timeout },
  onRes,
) {
  const u = new URL(`${baseUrl.replace(/\/+$/, "")}${route}`);
  const lib = u.protocol === "https:" ? https : http;
  const headers = { Authorization: `Bearer ${apiKey}` };
  if (payload) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }
  const req = lib.request(
    {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers,
    },
    onRes,
  );
  req.setTimeout(timeout, () => req.destroy(new Error("Request timed out")));
  return req;
}

function deepseekChat({ baseUrl, apiKey, body, sanitize, timeout = 60000 }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new Error("DeepSeek API key is not set."));
    const payload = JSON.stringify(
      buildRequest({ ...body, stream: false }, { sanitize }),
    );
    const req = openRequest(
      baseUrl,
      "/chat/completions",
      { method: "POST", apiKey, payload, timeout },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300)
            return reject(new Error(friendlyError(res.statusCode, raw)));
          try {
            resolve(fromOpenAiResponse(JSON.parse(raw)));
          } catch (_) {
            reject(new Error("DeepSeek: unreadable response."));
          }
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

// Server-sent events; onToken receives the visible text so far.
function deepseekStream({
  baseUrl,
  apiKey,
  body,
  sanitize,
  onToken = () => {},
  onUsage = () => {},
  signal,
  timeout = 300000,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    if (!apiKey)
      return finish({ ok: false, error: "DeepSeek API key is not set." });
    const payload = JSON.stringify(
      buildRequest({ ...body, stream: true }, { sanitize }),
    );
    const req = openRequest(
      baseUrl,
      "/chat/completions",
      { method: "POST", apiKey, payload, timeout },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () =>
            finish({ ok: false, error: friendlyError(res.statusCode, raw) }),
          );
          return;
        }
        let buffer = "";
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const l = line.trim();
            if (!l.startsWith("data:")) continue;
            const data = l.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const evt = JSON.parse(data);
              if (evt.usage) onUsage(evt.usage);
              const piece = evt.choices?.[0]?.delta?.content || "";
              if (piece) {
                text += piece;
                onToken(text);
              }
            } catch (_) {}
          }
        });
        res.on("end", () => finish({ ok: true, text }));
        res.on("error", (err) => finish({ ok: false, error: err.message }));
      },
    );
    req.on("error", (err) =>
      finish({ ok: false, error: signal?.aborted ? "Cancelled" : err.message }),
    );
    if (signal)
      signal.addEventListener("abort", () =>
        req.destroy(new Error("Cancelled")),
      );
    req.end(payload);
  });
}

// Cheap key check: model listing costs nothing.
function deepseekCheckKey({ baseUrl, apiKey, timeout = 10000 }) {
  return new Promise((resolve) => {
    if (!apiKey) return resolve({ ok: false, error: "No API key set." });
    const req = openRequest(
      baseUrl,
      "/models",
      { method: "GET", apiKey, timeout },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () =>
          resolve(
            res.statusCode >= 200 && res.statusCode < 300
              ? { ok: true }
              : { ok: false, error: friendlyError(res.statusCode, raw) },
          ),
        );
      },
    );
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.end();
  });
}

module.exports = {
  DEFAULT_BASE_URL,
  DEEPSEEK_MODELS,
  DEFAULT_MODELS,
  isDeepseekModel,
  toOpenAiMessages,
  buildRequest,
  fromOpenAiResponse,
  deepseekChat,
  deepseekStream,
  deepseekCheckKey,
};
