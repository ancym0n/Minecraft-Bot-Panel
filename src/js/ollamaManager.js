const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");

const DEFAULT_HOST = "http://127.0.0.1:11434";

// tags: chat = good for talking, tools = supports function calling (AI Agent),
// code = tuned for writing scripts. think = model emits reasoning we disable.
const RECOMMENDED_MODELS = [
  {
    name: "llama3.2:1b",
    label: "Llama 3.2 1B",
    sizeLabel: "1.3 GB",
    minRamGb: 4,
    tier: "light",
    tags: ["chat", "tools"],
    desc: "Tiny and fast, fine for low-end PCs",
  },
  {
    name: "qwen3:1.7b",
    label: "Qwen 3 1.7B",
    sizeLabel: "1.4 GB",
    minRamGb: 6,
    tier: "light",
    tags: ["chat", "tools"],
    think: true,
    desc: "Best small model, multilingual, solid tool calling",
  },
  {
    name: "gemma3:1b",
    label: "Gemma 3 1B",
    sizeLabel: "0.8 GB",
    minRamGb: 4,
    tier: "light",
    tags: ["chat"],
    desc: "Very natural short chat replies (no actions)",
  },
  {
    name: "qwen3:4b",
    label: "Qwen 3 4B",
    sizeLabel: "2.5 GB",
    minRamGb: 10,
    tier: "balanced",
    tags: ["chat", "tools"],
    think: true,
    desc: "Smart all-rounder for chat and AI Agent actions",
  },
  {
    name: "gemma3:4b",
    label: "Gemma 3 4B",
    sizeLabel: "3.3 GB",
    minRamGb: 10,
    tier: "balanced",
    tags: ["chat"],
    desc: "Most human-sounding replies in its size",
  },
  {
    name: "phi4-mini",
    label: "Phi-4 Mini 3.8B",
    sizeLabel: "2.5 GB",
    minRamGb: 10,
    tier: "balanced",
    tags: ["chat", "tools"],
    desc: "Strong reasoning and function calling",
  },
  {
    name: "llama3.2:3b",
    label: "Llama 3.2 3B",
    sizeLabel: "2.0 GB",
    minRamGb: 8,
    tier: "balanced",
    tags: ["chat", "tools"],
    desc: "Reliable balance of speed and game awareness",
  },
  {
    name: "qwen3:8b",
    label: "Qwen 3 8B",
    sizeLabel: "5.2 GB",
    minRamGb: 16,
    tier: "heavy",
    tags: ["chat", "tools"],
    think: true,
    desc: "High-intelligence agent for 16 GB+ RAM or a GPU",
  },
  {
    name: "llama3.1:8b",
    label: "Llama 3.1 8B",
    sizeLabel: "4.9 GB",
    minRamGb: 16,
    tier: "heavy",
    tags: ["chat", "tools"],
    desc: "Proven 8B model with dependable tool use",
  },
  {
    name: "gemma3:12b",
    label: "Gemma 3 12B",
    sizeLabel: "8.1 GB",
    minRamGb: 24,
    tier: "heavy",
    tags: ["chat"],
    desc: "Rich roleplay and conversation for strong GPUs",
  },
  {
    name: "qwen2.5-coder:1.5b",
    label: "Qwen 2.5 Coder 1.5B",
    sizeLabel: "1.0 GB",
    minRamGb: 4,
    tier: "light",
    tags: ["code"],
    desc: "Fast script writer for the Studio tab",
  },
  {
    name: "qwen2.5-coder:3b",
    label: "Qwen 2.5 Coder 3B",
    sizeLabel: "1.9 GB",
    minRamGb: 8,
    tier: "balanced",
    tags: ["code"],
    desc: "Better Mineflayer scripts, still quick",
  },
  {
    name: "qwen2.5-coder:7b",
    label: "Qwen 2.5 Coder 7B",
    sizeLabel: "4.7 GB",
    minRamGb: 14,
    tier: "heavy",
    tags: ["code", "tools"],
    desc: "Best local script generation quality",
  },
];

const THINKING_MODEL_RE = /^(qwen3|deepseek-r1|magistral|qwq)/i;

function modelInfo(name) {
  const clean = String(name || "").trim();
  return (
    RECOMMENDED_MODELS.find((m) => m.name === clean) ||
    RECOMMENDED_MODELS.find(
      (m) => `${m.name}:latest` === clean || m.name === `${clean}:latest`,
    ) ||
    null
  );
}

function isThinkingModel(name) {
  const info = modelInfo(name);
  return info ? Boolean(info.think) : THINKING_MODEL_RE.test(String(name));
}

// Families known to support Ollama function calling (for unknown tags).
const TOOLS_MODEL_RE =
  /^(qwen2\.5|qwen3|qwq|llama3\.[123]|llama4|mistral|mixtral|phi4-mini|granite3|granite4|command-r|hermes3|firefunction|smollm2|nemotron|cogito|gpt-oss|devstral|magistral)/i;

function supportsTools(name) {
  const info = modelInfo(name);
  if (info) return info.tags.includes("tools");
  return TOOLS_MODEL_RE.test(String(name || ""));
}

// Parses "a=1, b='x'" or "x: 1 y: 2" style arguments.
function parseLooseArgs(inner) {
  const args = {};
  const re =
    /([A-Za-z_]\w*)\s*[=:]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,\s)]+)/g;
  let m;
  let found = false;
  while ((m = re.exec(inner))) {
    found = true;
    let v = m[2];
    if (/^["']/.test(v)) v = v.slice(1, -1);
    args[m[1]] = v;
  }
  return found ? args : null;
}

// Some models (e.g. llama3.1, llama3.2:1b) print a tool call as text instead
// of using tool_calls. Turn that text back into calls. `resolve` maps a
// written name to a real tool (aliases allowed) or returns null.
function parseTextToolCalls(text, toolNames = [], resolve = null) {
  const raw = String(text || "")
    .replace(/<\|python_tag\|>/g, "")
    .replace(/<\/?tool_call>/g, "")
    .replace(/^```(?:json|js|javascript|python)?\s*|```\s*$/g, "")
    .trim();
  const norm = (n) =>
    String(n || "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  const realName = (n) =>
    toolNames.find((t) => norm(t) === norm(n)) || (resolve ? resolve(n) : null);

  // name(...) calls, one per line: follow_player("Steve"), go_to(x=1, z=2)
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const callRe = /^(?:functions\.)?([A-Za-z_][\w-]*)\s*\(([\s\S]*)\)\s*;?$/;
  if (lines.length && lines.every((l) => callRe.test(l))) {
    const calls = [];
    for (const line of lines) {
      const [, name, innerRaw] = line.match(callRe);
      const real = realName(name);
      if (!real) continue;
      const inner = innerRaw.trim();
      let args = {};
      if (/^\{[\s\S]*\}$/.test(inner)) {
        try {
          const obj = JSON.parse(inner);
          args = obj.arguments || obj.parameters || obj;
        } catch (_) {
          args = parseLooseArgs(inner) || {};
        }
      } else if (
        /^(["'`])[\s\S]*\1$/.test(inner) &&
        !/^(["'`]).*\1\s*,/.test(inner)
      ) {
        args = { value: inner.slice(1, -1) };
      } else if (inner) {
        args = parseLooseArgs(inner) || {
          value: inner.replace(/^["'`]|["'`]$/g, ""),
        };
      }
      calls.push({ function: { name: real, arguments: args } });
    }
    if (calls.length) return calls;
  }

  // "run_commands walk to Steve then say hi" (tool name, then plain text)
  const spaced = raw.match(/^([a-z]+_[a-z_]+)[:\s]+([^{\n][^\n]*)$/i);
  if (spaced) {
    const real = realName(spaced[1]);
    if (real) {
      const loose = parseLooseArgs(spaced[2]);
      return [
        {
          function: {
            name: real,
            arguments: loose || {
              value: spaced[2].trim().replace(/^["'`]|["'`]$/g, ""),
            },
          },
        },
      ];
    }
  }

  // "get_status {...}" or bare "get_status"
  const named = raw.match(/^([A-Za-z_][\w-]*)\s*(\{[\s\S]*\})?\s*$/);
  // Bare words like "stop" are normal replies, not calls.
  const callShaped = named && (named[2] || /_/.test(named[1]));
  if (named && callShaped) {
    const real = realName(named[1]);
    if (!real) return [];
    let args = {};
    try {
      const obj = named[2] ? JSON.parse(named[2]) : {};
      args = obj.arguments || obj.parameters || obj;
    } catch (_) {}
    return [{ function: { name: real, arguments: args } }];
  }
  if (!/^[[{]/.test(raw)) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    const objs = raw.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || [];
    parsed = [];
    for (const o of objs) {
      try {
        parsed.push(JSON.parse(o));
      } catch (_) {}
    }
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const calls = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const fnObj =
      item.function && typeof item.function === "object" ? item.function : item;
    const name =
      (typeof fnObj.name === "string" && fnObj.name) ||
      item.tool ||
      item.action ||
      item.command ||
      "";
    const real = realName(name);
    if (!real) continue;
    let args =
      fnObj.arguments ?? fnObj.parameters ?? item.args ?? item.params ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (_) {
        args = { value: args };
      }
    }
    calls.push({ function: { name: real, arguments: args || {} } });
  }
  return calls;
}

// Replies that explain tools, commands or errors instead of talking like a
// player. These are the model thinking out loud.
function isThinkingOutLoud(text) {
  const t = cleanModelText(text);
  if (!t) return false;
  return (
    /\b(commands?|tools?|syntax|function|parameters?|arguments?|api|scripts?|modules?|json)\b/i.test(
      t,
    ) ||
    /\b(write|type|use|format) (the |your )?(commands?|it|them) like\b/i.test(
      t,
    ) ||
    /\b(e\.g\.|for example|like this)\s*:/i.test(t) ||
    /\b(exception|undefined|null|stack trace|TypeError|SyntaxError)\b/.test(
      t,
    ) ||
    /\b(don'?t|do not) (understand|know) what you mean by\b/i.test(t) ||
    /^\s*(think|thought|thinking|plan|reasoning)\b/i.test(t) ||
    /\b(it seems|seems like there|there was an issue|there was a problem|let'?s try|let me try|i'?ll try (again|to)|i should check|i need to check|coordinates?|try again with)\b/i.test(
      t,
    ) ||
    /["'`][^"'`]{2,40}["'`]\s*(and|,)\s*["'`]/.test(t) ||
    /\|/.test(t)
  );
}

function looksLikeCode(text) {
  const t = String(text || "").trim();
  return (
    /^[[{]/.test(t) ||
    /\{\s*"/.test(t) ||
    /"\w+"\s*:/.test(t) ||
    /\b[a-z]+_[a-z_]+\(/.test(t) ||
    /<\|python_tag\|>|<tool_call>/i.test(t) ||
    // Echoed log lines or tool output instead of a real reply.
    /\b(AIAgent|ChatAI|Console):/.test(t) ||
    /\bapi\.\w+\(|\b(run_commands|get_status|start_script|stop_script|read_logs|list_scripts)\b/.test(
      t,
    )
  );
}

function cleanModelText(raw) {
  return String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

// Splits a reply into chat-sized messages, preferring sentence boundaries.
function splitIntoMessages(text, maxLen = 100, maxParts = 3) {
  const limit = Math.max(30, Math.min(250, Number(maxLen) || 100));
  const clean = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\*\*|__|`+/g, "")
    .replace(/(^|\s)[*_]([^*_\s][^*_]*?)[*_](?=\s|[.,!?]|$)/g, "$1$2")
    .replace(/^\s*[#>]+\s*/gm, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];

  const sentences = clean.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) || [
    clean,
  ];
  const wrapWords = (text, out) => {
    let line = "";
    for (const word of text.split(" ")) {
      if (word.length > limit) {
        if (line) out.push(line);
        for (let i = 0; i < word.length; i += limit) {
          out.push(word.slice(i, i + limit));
        }
        line = "";
      } else if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= limit) {
        line += ` ${word}`;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  };

  const pieces = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length <= limit) {
      pieces.push(sentence);
      continue;
    }
    // Too long: break at clause boundaries first, words only as a last resort.
    const clauses = sentence.match(/[^,;:–—]+[,;:–—]?/g) || [sentence];
    let line = "";
    for (const rawClause of clauses) {
      const clause = rawClause.trim();
      if (!clause) continue;
      if (!line) {
        line = clause;
      } else if (line.length + 1 + clause.length <= limit) {
        line += ` ${clause}`;
      } else {
        pieces.push(line);
        line = clause;
      }
      if (line.length > limit) {
        wrapWords(line, pieces);
        line = pieces.pop();
      }
    }
    if (line) pieces.push(line);
  }

  const parts = [];
  for (const piece of pieces) {
    const last = parts[parts.length - 1];
    if (last && last.length + 1 + piece.length <= limit) {
      parts[parts.length - 1] = `${last} ${piece}`;
    } else {
      parts.push(piece);
    }
  }

  const cap = Math.max(1, Math.min(6, Number(maxParts) || 3));
  if (parts.length > cap) {
    parts.length = cap;
    const tail = parts[cap - 1].replace(/[\s,;:–—-]+$/, "");
    if (!/[.!?…]$/.test(tail)) {
      parts[cap - 1] =
        tail.length + 3 <= limit
          ? `${tail}...`
          : `${tail.slice(0, limit - 3)}...`;
    }
  }
  return parts;
}

function execFilePromise(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    try {
      execFile(
        cmd,
        args,
        { timeout: opts.timeout || 4500, windowsHide: true, ...opts },
        (err, stdout, stderr) => {
          resolve({
            ok: !err,
            stdout: String(stdout || "").trim(),
            stderr: String(stderr || "").trim(),
          });
        },
      );
    } catch (e) {
      resolve({ ok: false, stdout: "", stderr: String(e?.message || "") });
    }
  });
}

function httpJsonRequest(
  urlStr,
  { method = "GET", body = null, timeout = 5000 } = {},
) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === "https:" ? https : http;
      const payload = body ? JSON.stringify(body) : null;
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          method,
          timeout,
          headers: payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {},
        },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            raw += chunk;
          });
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(raw ? JSON.parse(raw) : {});
              } catch (_) {
                resolve({ raw });
              }
            } else {
              reject(
                new Error(
                  `HTTP ${res.statusCode}: ${raw.slice(0, 180) || res.statusMessage}`,
                ),
              );
            }
          });
        },
      );
      req.on("timeout", () => {
        req.destroy(new Error("Request timed out"));
      });
      req.on("error", (err) => reject(err));
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Streams a URL to disk (follows redirects) without needing curl.
function downloadFile(url, dest, onProgress = () => {}, redirects = 6) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "minecraft-bot-panel" }, timeout: 30000 },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirects > 0
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          resolve(downloadFile(next, dest, onProgress, redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`download failed (HTTP ${res.statusCode})`));
          return;
        }
        const total = Number(res.headers["content-length"]) || 0;
        const tmp = `${dest}.part`;
        const out = fs.createWriteStream(tmp);
        let got = 0;
        let lastPct = -1;
        res.on("data", (chunk) => {
          got += chunk.length;
          const pct = total ? Math.floor((got / total) * 100) : 0;
          if (pct !== lastPct) {
            lastPct = pct;
            onProgress(
              total ? got / total : 0,
              Math.round(got / 1048576),
              Math.round(total / 1048576),
            );
          }
        });
        res.pipe(out);
        out.on("finish", () =>
          out.close(() => {
            try {
              fs.renameSync(tmp, dest);
              resolve(dest);
            } catch (err) {
              reject(err);
            }
          }),
        );
        const fail = (err) => {
          out.destroy();
          fs.rmSync(tmp, { force: true });
          reject(err);
        };
        res.on("error", fail);
        out.on("error", fail);
      },
    );
    req.on("timeout", () => req.destroy(new Error("connection timed out")));
    req.on("error", reject);
  });
}

// .tar.zst / .tgz extraction: system tar when it can, pure JS otherwise,
// so it works on any distro (even without zstd installed).
async function extractArchive(archive, dir) {
  const tar = require("tar");
  if (!archive.endsWith(".zst")) {
    await tar.x({ file: archive, cwd: dir });
    return;
  }
  const sys = await execFilePromise(
    "tar",
    ["--zstd", "-xf", archive, "-C", dir],
    {
      timeout: 600000,
    },
  );
  if (sys.ok) return;
  const { Readable } = require("stream");
  const { pipeline } = require("stream/promises");
  const { Decompress } = require("fzstd");
  async function* inflate() {
    const ready = [];
    const zstd = new Decompress((chunk) => ready.push(Buffer.from(chunk)));
    for await (const chunk of fs.createReadStream(archive, {
      highWaterMark: 1 << 20,
    })) {
      zstd.push(chunk);
      while (ready.length) yield ready.shift();
    }
    zstd.push(new Uint8Array(0), true);
    while (ready.length) yield ready.shift();
  }
  await pipeline(Readable.from(inflate()), tar.x({ cwd: dir }));
}

class OllamaManager {
  constructor() {
    this.host = process.env.OLLAMA_HOST || DEFAULT_HOST;
    if (!/^https?:\/\//i.test(this.host)) {
      this.host = `http://${this.host}`;
    }
    this.userDataDir = "";
    this.configPath = "";
    this.cachedHardware = null;
    this.serverProcess = null;
    this.chatHistory = [];
    this.lastReplyTime = 0;
    this.isGenerating = false;

    this.replyTimes = [];
    this.activePulls = new Map();
    this.installedNames = [];
    this.noToolsModels = new Set();
    this.warmModels = new Map();

    this.config = {
      enabled: false,
      agentEnabled: false,
      model: "",
      agentModel: "",
      agentAllowCode: false,
      scriptModel: "",
      triggerMode: "mention", // "mention" | "all"
      cooldownSec: 4,
      maxTokens: 160,
      includeBotContext: true,
      ignoreSelf: true,
      customTriggers: "",
      splitMessages: true,
      maxMessageLength: 100,
      maxParts: 3,
      messageDelaySec: 1.6,
      maxRepliesPerMinute: 6,
      agentAllowedPlayers: "",
      systemPrompt:
        "You are a friendly, real human Minecraft player chatting on a multiplayer server. Keep replies short and casual like real chat. Never use markdown, lists, or assistant phrases. Reply in the same language the player used.",
    };
  }

  init(userDataDir) {
    this.userDataDir = userDataDir || "";
    if (this.userDataDir) {
      this.configPath = path.join(this.userDataDir, "ollama-ai-config.json");
      this.loadConfig();
    }
  }

  loadConfig() {
    if (!this.configPath || !fs.existsSync(this.configPath)) return this.config;
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, "utf8"));
      if (raw && typeof raw === "object") {
        // Scripts always start switched off, so never resume them from disk.
        this.config = {
          ...this.config,
          ...raw,
          enabled: false,
          agentEnabled: false,
        };
      }
    } catch (_) {}
    return this.config;
  }

  saveConfig(partial = {}) {
    const clean = {};
    for (const [key, value] of Object.entries(partial || {})) {
      if (value === undefined || !(key in this.config)) continue;
      clean[key] = value;
    }
    const num = (v, min, max, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    if ("cooldownSec" in clean)
      clean.cooldownSec = num(clean.cooldownSec, 0, 120, 4);
    if ("messageDelaySec" in clean)
      clean.messageDelaySec = num(clean.messageDelaySec, 0.5, 15, 1.6);
    if ("maxMessageLength" in clean)
      clean.maxMessageLength = num(clean.maxMessageLength, 30, 250, 100);
    if ("maxParts" in clean) clean.maxParts = num(clean.maxParts, 1, 6, 3);
    if ("maxRepliesPerMinute" in clean)
      clean.maxRepliesPerMinute = num(clean.maxRepliesPerMinute, 1, 30, 6);
    if (
      "triggerMode" in clean &&
      !["all", "mention"].includes(clean.triggerMode)
    )
      clean.triggerMode = "mention";
    this.config = { ...this.config, ...clean };
    if (this.configPath) {
      try {
        fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
        fs.writeFileSync(
          this.configPath,
          JSON.stringify(this.config, null, 2),
          "utf8",
        );
      } catch (_) {}
    }
    return this.config;
  }

  async findOllamaBinary() {
    const direct = await execFilePromise(
      process.platform === "win32" ? "ollama.exe" : "ollama",
      ["--version"],
    );
    if (direct.ok) {
      return {
        found: true,
        binPath: process.platform === "win32" ? "ollama.exe" : "ollama",
        version: direct.stdout.replace(/^ollama version is\s*/i, "").trim(),
      };
    }

    const candidates =
      process.platform === "win32"
        ? [
            path.join(
              process.env.LOCALAPPDATA || "",
              "Programs",
              "Ollama",
              "ollama.exe",
            ),
            path.join(
              os.homedir(),
              "AppData",
              "Local",
              "Programs",
              "Ollama",
              "ollama.exe",
            ),
            path.join(
              process.env.PROGRAMFILES || "C:\\Program Files",
              "Ollama",
              "ollama.exe",
            ),
            this.userDataDir
              ? path.join(this.userDataDir, "ollama", "ollama.exe")
              : "",
          ]
        : [
            "/usr/local/bin/ollama",
            "/usr/bin/ollama",
            "/bin/ollama",
            "/opt/homebrew/bin/ollama",
            "/Applications/Ollama.app/Contents/Resources/ollama",
            path.join(os.homedir(), ".local", "bin", "ollama"),
            this.userDataDir
              ? path.join(this.userDataDir, "ollama", "bin", "ollama")
              : "",
            this.userDataDir
              ? path.join(this.userDataDir, "ollama", "ollama")
              : "",
          ];

    for (const candidate of candidates) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const res = await execFilePromise(candidate, ["--version"]);
      if (res.ok) {
        return {
          found: true,
          binPath: candidate,
          version: res.stdout.replace(/^ollama version is\s*/i, "").trim(),
        };
      }
    }

    return { found: false, binPath: "", version: "" };
  }

  async detectHardwareAndRecommend() {
    if (this.cachedHardware) return this.cachedHardware;

    const totalRamGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
    const cpus = os.cpus() || [];
    const cpuCores = cpus.length || 4;
    const cpuModel = cpus[0]?.model ? cpus[0].model.trim() : "CPU";

    let gpuName = "";
    let vramGb = 0;

    // Cross-platform NVIDIA GPU detection (works on both Linux and Windows)
    const smi = await execFilePromise("nvidia-smi", [
      "--query-gpu=name,memory.total",
      "--format=csv,noheader,nounits",
    ]);
    if (smi.ok && smi.stdout) {
      const firstLine = smi.stdout.split(/\r?\n/)[0] || "";
      const parts = firstLine.split(",");
      if (parts[0]) gpuName = parts[0].trim();
      if (parts[1]) {
        const mb = parseFloat(parts[1].trim());
        if (Number.isFinite(mb) && mb > 0) {
          vramGb = Math.round((mb / 1024) * 10) / 10;
        }
      }
    }

    // Linux AMD / Intel sysfs VRAM fallback
    if (!gpuName && process.platform === "linux") {
      try {
        const drmDir = "/sys/class/drm";
        if (fs.existsSync(drmDir)) {
          for (const entry of fs.readdirSync(drmDir)) {
            const vramFile = path.join(
              drmDir,
              entry,
              "device",
              "mem_info_vram_total",
            );
            if (fs.existsSync(vramFile)) {
              const bytes = parseInt(
                fs.readFileSync(vramFile, "utf8").trim(),
                10,
              );
              if (Number.isFinite(bytes) && bytes > 512 * 1024 * 1024) {
                vramGb = Math.round((bytes / 1024 ** 3) * 10) / 10;
                gpuName = `Discrete GPU (${vramGb} GB VRAM)`;
                break;
              }
            }
          }
        }
      } catch (_) {}
    }

    // Windows WMI / CIM GPU name fallback
    if (!gpuName && process.platform === "win32") {
      const ps = await execFilePromise("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name",
      ]);
      if (ps.ok && ps.stdout) {
        gpuName = ps.stdout.split(/\r?\n/)[0].trim();
      }
    }

    const gpuGb = vramGb || 0;
    let recommended = "qwen3:1.7b";
    let recommendedCode = "qwen2.5-coder:1.5b";
    let reason = `${totalRamGb} GB RAM · ${cpuCores} threads`;
    if (gpuName) {
      reason = `${gpuName}${vramGb && !/VRAM/.test(gpuName) ? ` (${vramGb} GB VRAM)` : ""} · ${totalRamGb} GB RAM`;
    }

    if (gpuGb >= 8 || totalRamGb >= 24) {
      recommended = "qwen3:8b";
      recommendedCode = "qwen2.5-coder:7b";
    } else if (gpuGb >= 4 || totalRamGb >= 14) {
      recommended = "qwen3:4b";
      recommendedCode =
        gpuGb >= 6 || totalRamGb >= 16
          ? "qwen2.5-coder:7b"
          : "qwen2.5-coder:3b";
    } else if (totalRamGb >= 6) {
      recommended = "qwen3:1.7b";
      recommendedCode =
        totalRamGb >= 8 ? "qwen2.5-coder:3b" : "qwen2.5-coder:1.5b";
    } else {
      recommended = "llama3.2:1b";
      recommendedCode = "qwen2.5-coder:1.5b";
      reason = `Lightweight for ${totalRamGb} GB RAM`;
    }

    this.cachedHardware = {
      platform: process.platform,
      arch: os.arch(),
      totalRamGb,
      cpuCores,
      cpuModel,
      gpuName,
      vramGb,
      recommendedModel: recommended,
      recommendedCodeModel: recommendedCode,
      recommendReason: reason,
      catalog: RECOMMENDED_MODELS.map((m) => ({
        ...m,
        isRecommended: m.name === recommended || m.name === recommendedCode,
        fitsHardware: totalRamGb >= m.minRamGb,
      })),
    };
    return this.cachedHardware;
  }

  async getStatus() {
    const hw = await this.detectHardwareAndRecommend();
    const binInfo = await this.findOllamaBinary();
    let serverRunning = false;
    let version = binInfo.version || "";
    let installedModels = [];

    try {
      const tagsRes = await httpJsonRequest(`${this.host}/api/tags`, {
        timeout: 2200,
      });
      serverRunning = true;
      if (Array.isArray(tagsRes?.models)) {
        installedModels = tagsRes.models.map((m) => ({
          name: m.name || m.model,
          sizeBytes: m.size || 0,
          sizeLabel: m.size
            ? `${(m.size / 1024 ** 3).toFixed(1)} GB`
            : "Installed",
          modifiedAt: m.modified_at || "",
        }));
      }
      if (!version) {
        const verRes = await httpJsonRequest(`${this.host}/api/version`, {
          timeout: 1500,
        }).catch(() => null);
        if (verRes?.version) version = verRes.version;
      }
    } catch (_) {
      serverRunning = false;
    }

    this.installedNames = installedModels.map((m) => m.name);
    if (!this.config.model) {
      if (installedModels.length > 0) {
        const recInstalled = installedModels.find(
          (m) => m.name === hw.recommendedModel,
        );
        this.config.model = recInstalled
          ? recInstalled.name
          : installedModels[0].name;
      } else {
        this.config.model = hw.recommendedModel;
      }
    }

    return {
      installed: binInfo.found || serverRunning,
      binPath: binInfo.binPath,
      serverRunning,
      version,
      host: this.host,
      installedModels,
      hardware: hw,
      config: this.config,
      agentModelResolved: this.resolveAgentModel(),
      pulling: Array.from(this.activePulls.keys()),
    };
  }

  async ensureServerRunning(onProgress = () => {}) {
    const initial = await this.getStatus();
    if (initial.serverRunning) return { ok: true, status: initial };

    if (!initial.installed || !initial.binPath) {
      return {
        ok: false,
        error: "Ollama binary is not installed yet.",
        status: initial,
      };
    }

    onProgress({
      stage: "starting",
      message: "Starting local Ollama service...",
      percent: 15,
    });

    try {
      const child = spawn(initial.binPath, ["serve"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, OLLAMA_HOST: "127.0.0.1:11434" },
      });
      child.unref();
      this.serverProcess = child;
    } catch (err) {
      return {
        ok: false,
        error: `Failed to start ollama serve: ${err.message}`,
      };
    }

    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        await httpJsonRequest(`${this.host}/api/version`, { timeout: 1200 });
        const updated = await this.getStatus();
        return { ok: true, status: updated };
      } catch (_) {}
    }

    return {
      ok: false,
      error: "Timed out waiting for Ollama server on 127.0.0.1:11434.",
    };
  }

  async installOllamaBinary(onProgress = () => {}) {
    if (process.platform === "win32") {
      onProgress({
        stage: "installing",
        message: "Installing Ollama via winget...",
        percent: 10,
      });
      const winget = await execFilePromise(
        "winget",
        [
          "install",
          "--id",
          "Ollama.Ollama",
          "-e",
          "--silent",
          "--accept-package-agreements",
          "--accept-source-agreements",
        ],
        { timeout: 180000 },
      );
      if (winget.ok) {
        return { ok: true };
      }
      return {
        ok: false,
        error:
          "Automatic winget install did not complete. Click 'Download Ollama' or install from ollama.com/download.",
      };
    }

    if (process.platform === "linux" || process.platform === "darwin") {
      const isMac = process.platform === "darwin";
      const arch = os.arch() === "arm64" ? "arm64" : "amd64";
      const targetDir = path.join(this.userDataDir || os.tmpdir(), "ollama");
      const fileName = isMac
        ? "ollama-darwin.tgz"
        : `ollama-linux-${arch}.tar.zst`;
      const archive = path.join(targetDir, fileName);
      const binPath = isMac
        ? path.join(targetDir, "ollama")
        : path.join(targetDir, "bin", "ollama");
      try {
        fs.mkdirSync(targetDir, { recursive: true });
        await downloadFile(
          `https://ollama.com/download/${fileName}`,
          archive,
          (frac, mb, totalMb) =>
            onProgress({
              stage: "installing",
              message: `Downloading Ollama ${mb} / ${totalMb || "?"} MB...`,
              percent: Math.round(5 + frac * 75),
            }),
        );
        onProgress({
          stage: "extracting",
          message: "Unpacking Ollama...",
          percent: 85,
        });
        await extractArchive(archive, targetDir);
        fs.chmodSync(binPath, 0o755);
        return { ok: true, binPath };
      } catch (err) {
        return {
          ok: false,
          error: `Could not install Ollama automatically (${err.message}). Install it from ollama.com/download and click Refresh.`,
        };
      } finally {
        fs.rmSync(archive, { force: true });
        fs.rmSync(`${archive}.part`, { force: true });
      }
    }

    return {
      ok: false,
      error: "Automatic Ollama install is not supported on this OS.",
    };
  }

  // One download per model: later callers just subscribe to its progress.
  pullModel(modelName, onProgress = () => {}, { makeActive = false } = {}) {
    const cleanModel = String(modelName || "").trim();
    if (!cleanModel) {
      return Promise.resolve({ ok: false, error: "No model name specified." });
    }
    const existing = this.activePulls.get(cleanModel);
    if (existing) {
      existing.listeners.add(onProgress);
      if (makeActive) existing.makeActive = true;
      return existing.promise;
    }
    const entry = {
      listeners: new Set([onProgress]),
      makeActive,
      promise: null,
    };
    const emit = (p) => {
      for (const fn of entry.listeners) {
        try {
          fn(p);
        } catch (_) {}
      }
    };
    entry.promise = this.pullModelRaw(cleanModel, emit, entry).finally(() => {
      this.activePulls.delete(cleanModel);
    });
    this.activePulls.set(cleanModel, entry);
    return entry.promise;
  }

  isPulling(modelName) {
    return this.activePulls.has(String(modelName || "").trim());
  }

  pullModelRaw(cleanModel, onProgress, entry) {
    return new Promise((resolve) => {
      try {
        const u = new URL(`${this.host}/api/pull`);
        const lib = u.protocol === "https:" ? https : http;
        const payload = JSON.stringify({ name: cleanModel, stream: true });

        onProgress({
          stage: "pulling",
          model: cleanModel,
          message: `Connecting to Ollama to pull ${cleanModel}...`,
          percent: 2,
        });

        const req = lib.request(
          {
            hostname: u.hostname,
            port: u.port || 11434,
            path: u.pathname,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            },
          },
          (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              let errText = "";
              res.on("data", (c) => (errText += c));
              res.on("end", () => {
                resolve({
                  ok: false,
                  error: `Pull failed (HTTP ${res.statusCode}): ${errText.slice(0, 140)}`,
                });
              });
              return;
            }

            let buffer = "";
            let pullError = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              buffer += chunk;
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const evt = JSON.parse(line);
                  if (evt.error) {
                    pullError = evt.error;
                    continue;
                  }
                  let pct = null;
                  if (
                    typeof evt.completed === "number" &&
                    typeof evt.total === "number" &&
                    evt.total > 0
                  ) {
                    pct = Math.max(
                      1,
                      Math.min(
                        99,
                        Math.round((evt.completed / evt.total) * 100),
                      ),
                    );
                  }
                  onProgress({
                    stage: "pulling",
                    model: cleanModel,
                    message: `${cleanModel}: ${evt.status || "downloading"}${pct !== null ? ` (${pct}%)` : ""}`,
                    percent: pct ?? 25,
                  });
                } catch (_) {}
              }
            });

            res.on("end", () => {
              if (pullError) {
                resolve({ ok: false, error: pullError });
                return;
              }
              const info = modelInfo(cleanModel);
              const codeOnly =
                (info && !info.tags.includes("chat")) ||
                (!info && /coder/i.test(cleanModel));
              // Only switch models when the user asked for it explicitly.
              if (entry?.makeActive) {
                this.saveConfig(
                  codeOnly
                    ? { scriptModel: cleanModel }
                    : { model: cleanModel },
                );
              }
              if (!this.installedNames.includes(cleanModel)) {
                this.installedNames.push(cleanModel);
              }
              onProgress({
                stage: "ready",
                model: cleanModel,
                message: `Model ${cleanModel} is ready!`,
                percent: 100,
              });
              resolve({ ok: true, model: cleanModel });
            });
          },
        );

        req.on("error", (err) => {
          resolve({ ok: false, error: err.message });
        });
        req.write(payload);
        req.end();
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  async autoSetup({
    preferredModel = "",
    onProgress = () => {},
    keepModel = false,
  } = {}) {
    const hw = await this.detectHardwareAndRecommend();
    const targetModel =
      preferredModel || this.config.model || hw.recommendedModel;

    onProgress({
      stage: "checking",
      message: "Checking local Ollama installation & service...",
      percent: 5,
    });

    let status = await this.getStatus();
    if (!status.installed) {
      const installRes = await this.installOllamaBinary(onProgress);
      if (!installRes.ok) {
        return { ok: false, error: installRes.error, status };
      }
      status = await this.getStatus();
    }

    if (!status.serverRunning) {
      const startRes = await this.ensureServerRunning(onProgress);
      if (!startRes.ok) {
        return { ok: false, error: startRes.error, status };
      }
      status = startRes.status;
    }

    const alreadyHasModel = status.installedModels.some(
      (m) => m.name === targetModel || m.name === `${targetModel}:latest`,
    );

    if (!alreadyHasModel) {
      const pullRes = await this.pullModel(targetModel, onProgress);
      if (!pullRes.ok) {
        return {
          ok: false,
          error: pullRes.error,
          status: await this.getStatus(),
        };
      }
    } else {
      onProgress({
        stage: "ready",
        model: targetModel,
        message: `Ollama running · ${targetModel} ready`,
        percent: 100,
      });
    }

    if (!keepModel) this.saveConfig({ model: targetModel });
    const finalStatus = await this.getStatus();
    return {
      ok: true,
      model: targetModel,
      status: finalStatus,
    };
  }

  isActive() {
    return Boolean(this.config.enabled || this.config.agentEnabled);
  }

  canCommand(sender) {
    const list = String(this.config.agentAllowedPlayers || "")
      .split(/[\s,]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (!list.length) return true;
    return list.includes(String(sender || "").toLowerCase());
  }

  recentReplyCount() {
    const cutoff = Date.now() - 60000;
    this.replyTimes = this.replyTimes.filter((t) => t > cutoff);
    return this.replyTimes.length;
  }

  markReplied() {
    this.lastReplyTime = Date.now();
    this.replyTimes.push(this.lastReplyTime);
  }

  shouldRespondToChat({ sender, message, botUsername }) {
    if (!this.isActive()) return false;
    const cleanMsg = String(message || "").trim();
    if (!cleanMsg) return false;

    const cleanSender = String(sender || "").trim();
    if (
      this.config.ignoreSelf &&
      botUsername &&
      cleanSender.toLowerCase() === botUsername.toLowerCase()
    ) {
      return false;
    }

    if (cleanMsg.startsWith("/")) return false;

    const cooldownMs = Math.max(0, Number(this.config.cooldownSec) || 0) * 1000;
    if (Date.now() - this.lastReplyTime < cooldownMs || this.isGenerating) {
      return false;
    }
    if (
      this.recentReplyCount() >=
      Math.max(1, Number(this.config.maxRepliesPerMinute) || 6)
    ) {
      return false;
    }

    if (this.config.triggerMode === "all") {
      return Boolean(cleanSender && cleanSender !== "Server");
    }

    const lowerMsg = cleanMsg.toLowerCase();
    if (botUsername && lowerMsg.includes(botUsername.toLowerCase())) {
      return true;
    }

    if (this.config.customTriggers) {
      const triggers = String(this.config.customTriggers)
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (triggers.some((t) => lowerMsg.includes(t))) {
        return true;
      }
    }

    return false;
  }

  resolveModel(overrideModel = "") {
    return String(
      overrideModel ||
        this.config.model ||
        this.cachedHardware?.recommendedModel ||
        "qwen3:1.7b",
    ).trim();
  }

  isInstalled(name) {
    const n = String(name || "");
    return this.installedNames.some((m) => m === n || m === `${n}:latest`);
  }

  // Model used for actions: explicit choice, else the chat model if it can
  // call tools, else the best installed tools model, else the recommendation.
  resolveAgentModel(overrideModel = "") {
    const explicit = String(
      overrideModel || this.config.agentModel || "",
    ).trim();
    if (explicit) return explicit;
    const chat = this.resolveModel();
    if (supportsTools(chat) && !this.noToolsModels.has(chat)) return chat;
    const toolsCatalog = RECOMMENDED_MODELS.filter((m) =>
      m.tags.includes("tools"),
    )
      .slice()
      .sort((a, b) => b.minRamGb - a.minRamGb);
    const ram = this.cachedHardware?.totalRamGb || 8;
    for (const m of toolsCatalog) {
      if (m.minRamGb <= Math.max(ram, 8) && this.isInstalled(m.name))
        return m.name;
    }
    const otherInstalled = this.installedNames.find(
      (n) =>
        supportsTools(n) && !this.noToolsModels.has(n) && !/coder/i.test(n),
    );
    if (otherInstalled) return otherInstalled;
    return this.cachedHardware?.recommendedModel || "qwen3:1.7b";
  }

  // Loads a model into memory so the first reply isn't slow.
  warmUp(model) {
    const name = String(model || "").trim();
    if (!name) return Promise.resolve(false);
    const last = this.warmModels.get(name) || 0;
    if (Date.now() - last < 10 * 60 * 1000) return Promise.resolve(true);
    this.warmModels.set(name, Date.now());
    return httpJsonRequest(`${this.host}/api/generate`, {
      method: "POST",
      timeout: 120000,
      body: { model: name, keep_alive: "30m" },
    })
      .then(() => true)
      .catch(() => {
        this.warmModels.delete(name);
        return false;
      });
  }

  buildSystemPrompt(botContext, { agent = false, model = "" } = {}) {
    let sysPrompt = String(
      this.config.systemPrompt ||
        "You are a friendly Minecraft player chatting on a server.",
    ).trim();

    const maxLen = Number(this.config.maxMessageLength) || 100;
    const maxParts = Number(this.config.maxParts) || 3;
    sysPrompt += this.config.splitMessages
      ? `\nKeep the whole reply under ${maxLen * maxParts} characters, written as up to ${maxParts} short sentences.`
      : `\nReply with exactly 1 short sentence under ${Math.min(maxLen * 2, 200)} characters.`;
    sysPrompt +=
      "\nPlain text only, no emojis, no quotes around the reply, never prefix it with your name.";
    sysPrompt +=
      "\nYou are a regular player, not an assistant: never offer help, never say things like 'how can I help', 'feel free', 'let me know' or 'just a heads-up', don't give advice or warnings nobody asked for, and don't repeat the same phrase in every message. Stay friendly and chill: never rude, never tell people to go away or leave you alone, and go along with friends' requests. Ignore ads and server announcements.";

    if (agent) {
      sysPrompt +=
        '\nYou control a real Minecraft bot through the provided tools. When a player asks you to do something (move, follow, mine, fight, equip, turn a module on or off, change module options), call a tool instead of only talking about it. The easiest tool is run_commands: pass simple lines like "walk to Steve", "mine 5 oak_log", "turn on KillAura range=4", "say hi". Use list_scripts to see every module and its options, and read_logs to see errors when something did not work. Use get_status only when you need facts. If a tool returns an error or says you are stuck, try a different approach (another tool, other coordinates, mining the obstacle, run_code if available) before giving up, and tell the player briefly if it still fails. Movement, mining and attack tools only START the action: say you are on your way or starting, never that you already arrived or finished. On lobby servers, "join kitpvp" opens the compass menu and clicks the game for you; "use compass" shows the items in a menu and "click <item name>" clicks one. Think privately with the think tool: plans, errors and retries go there, never in chat. Your chat reply is what a normal player would type: short, casual, no talk about commands, tools, syntax, errors or how to give orders, never explain how to write commands, never write JSON or code. Never invent tool results.';
    }

    if (this.config.includeBotContext && botContext) {
      const ctxParts = [];
      if (botContext.username)
        ctxParts.push(`Your username: ${botContext.username}`);
      if (typeof botContext.health === "number")
        ctxParts.push(
          `HP: ${botContext.health}/20, Food: ${botContext.food}/20`,
        );
      if (botContext.position)
        ctxParts.push(
          `Coords: ${botContext.position.x}, ${botContext.position.y}, ${botContext.position.z} (${botContext.dimension || "overworld"})`,
        );
      if (botContext.heldItem) ctxParts.push(`Holding: ${botContext.heldItem}`);
      if (botContext.nearbyPlayers?.length)
        ctxParts.push(`Nearby players: ${botContext.nearbyPlayers.join(", ")}`);
      if (botContext.activeScripts?.length)
        ctxParts.push(`Current tasks: ${botContext.activeScripts.join(", ")}`);
      if (ctxParts.length > 0) {
        sysPrompt += `\n[Game State: ${ctxParts.join(" | ")}]`;
      }
    }

    if (isThinkingModel(model) && /^qwen3/i.test(model)) {
      sysPrompt += "\n/no_think";
    }
    return sysPrompt;
  }

  chatBody(model, messages, extra = {}) {
    const body = {
      model,
      messages,
      stream: false,
      keep_alive: "30m",
      options: {
        temperature: 0.7,
        num_predict: Math.max(
          40,
          Math.min(400, Number(this.config.maxTokens) || 160),
        ),
      },
      ...extra,
    };
    if (isThinkingModel(model)) body.think = false;
    return body;
  }

  finalizeReply(rawText, botContext) {
    const cleaned = cleanModelText(rawText);
    let reply = (looksLikeCode(cleaned) ? "" : cleaned)
      .replace(/\r?\n+/g, " ")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (botContext?.username) {
      const escaped = botContext.username.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      reply = reply.replace(new RegExp(`^<?${escaped}>?:\\s*`, "i"), "").trim();
    }
    // A chat reply must never run a server command.
    if (/^[/!.]/.test(reply)) reply = "";
    reply = this.dropStaleSentences(reply);
    const maxLen = Number(this.config.maxMessageLength) || 100;
    const parts = this.config.splitMessages
      ? splitIntoMessages(reply, maxLen, this.config.maxParts)
      : splitIntoMessages(reply, Math.min(240, maxLen * 2), 1);
    return { reply: parts.join(" "), parts };
  }

  // Real players don't sound like a help desk or repeat the same tagline in
  // every message. Drops those sentences (keeps the rest of the reply).
  dropStaleSentences(reply) {
    const norm = (t) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const recent = new Set((this.recentSentences || []).map((x) => x.n));
    const ASSISTANT =
      /\b(how (can|may) i (help|assist)|feel free to|let me know|i'?m here to help|happy to help|any (questions|assistance)|need (any )?(help|assistance|tips)|just a heads[- ]up|as an ai|i can help you|is there anything)\b/i;
    const sentences = String(reply || "").match(/[^.!?]+[.!?]*/g) || [];
    const kept = sentences.filter((sen) => {
      const n = norm(sen);
      if (!n) return false;
      if (ASSISTANT.test(sen)) return false;
      if (n.split(" ").length >= 3 && recent.has(n)) return false;
      return true;
    });
    const out = kept
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
    this.recentSentences = [
      ...(this.recentSentences || []),
      ...(out.match(/[^.!?]+[.!?]*/g) || []).map((x) => ({ n: norm(x) })),
    ].slice(-20);
    return out;
  }

  rememberExchange(sender, message, reply) {
    this.chatHistory.push(
      { role: "user", content: `${sender}: ${message}` },
      { role: "assistant", content: reply },
    );
    if (this.chatHistory.length > 12) {
      this.chatHistory.splice(0, this.chatHistory.length - 12);
    }
  }

  async generateChatReply({
    sender = "Player",
    message = "",
    botContext = null,
    overrideModel = "",
    bypassCooldown = false,
  } = {}) {
    const model = this.resolveModel(overrideModel);

    if (!message || !String(message).trim()) {
      return { ok: false, error: "Empty message." };
    }
    if (!bypassCooldown && this.isGenerating) {
      return { ok: false, error: "Already generating a reply." };
    }

    this.isGenerating = true;
    const startMs = Date.now();

    try {
      const messages = [
        {
          role: "system",
          content: this.buildSystemPrompt(botContext, { model }),
        },
        ...this.chatHistory.slice(-6),
        { role: "user", content: `${sender}: ${message}` },
      ];

      const res = await httpJsonRequest(`${this.host}/api/chat`, {
        method: "POST",
        timeout: 45000,
        body: this.chatBody(model, messages),
      });

      const raw = String(res?.message?.content || "");
      const { reply, parts } = this.finalizeReply(raw, botContext);
      if (!reply) {
        // Prompts may ask the model to stay quiet (blank output) on purpose.
        return raw.length && !raw.trim()
          ? { ok: false, silent: true, model }
          : { ok: false, error: "Model returned an empty response.", model };
      }

      if (!bypassCooldown) this.markReplied();
      this.rememberExchange(sender, message, reply);

      return {
        ok: true,
        reply,
        parts,
        model,
        actions: [],
        latencyMs: Date.now() - startMs,
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message || "Failed to query Ollama API",
        model,
      };
    } finally {
      this.isGenerating = false;
    }
  }

  // Second, private pass after acting: the model checks its own work and
  // writes the one line that goes to chat. JSON output is enforced.
  async reviewAgentWork({
    model,
    sender,
    message,
    actions = [],
    draft = "",
    botContext = null,
    noRetry = false,
  }) {
    const did = actions
      .filter((a) => a.name !== "think")
      .map(
        (a, i) =>
          `${i + 1}. ${a.name}(${JSON.stringify(a.args || {})}) -> ${String(a.result).split("\n")[0].slice(0, 200)}`,
      );
    const system = [
      this.buildSystemPrompt(botContext, { agent: false, model }),
      "",
      "Now check your own work privately, then write your chat reply.",
      'Answer ONLY with JSON: {"thought": string, "ok": boolean, "retry": string, "reply": string}',
      "- thought: private, never shown. Did the actions do what the player asked? What went wrong?",
      "- ok: true if the request is handled (or was only chatting), false if it failed.",
      noRetry
        ? '- retry: always "".'
        : '- retry: if ok is false and another try could work, ONE plain command line to try instead (like "follow ancymon", "walk 10 64 -5", "join kitpvp", "turn on autoeat"), else "".',
      `- reply: what you type in chat to ${sender}. Short and casual like a real player. Never mention tools, commands, coordinates errors, JSON or that you are checking anything. Actions that "started" are still in progress: say you're on it, not that you finished.`,
    ].join("\n");
    const user = [
      `${sender} said: ${message}`,
      did.length
        ? `What you did:\n${did.join("\n")}`
        : "You did not use any actions.",
      draft ? `Your draft reply: ${cleanModelText(draft).slice(0, 300)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const res = await httpJsonRequest(`${this.host}/api/chat`, {
        method: "POST",
        timeout: 60000,
        body: this.chatBody(
          model,
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          {
            format: "json",
            options: { temperature: 0.2, num_predict: 220, num_ctx: 4096 },
          },
        ),
      });
      const raw = cleanModelText(res?.message?.content || "");
      let obj = null;
      try {
        obj = JSON.parse(raw);
      } catch (_) {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            obj = JSON.parse(m[0]);
          } catch (_) {}
        }
      }
      if (!obj || typeof obj !== "object") return null;
      const str = (v) => (typeof v === "string" ? v.trim() : "");
      return {
        thought: str(obj.thought).slice(0, 400),
        ok: obj.ok === false || obj.ok === "false" ? false : true,
        retry: noRetry ? "" : str(obj.retry).slice(0, 200),
        reply: str(obj.reply || obj.message || obj.chat),
      };
    } catch (_) {
      return null;
    }
  }

  // Chat reply where the model may call bot functions (tools) first.
  async runAgent({
    sender = "Player",
    message = "",
    botContext = null,
    tools = [],
    executeTool = async () => "Unknown tool",
    resolveTool = null,
    overrideModel = "",
    bypassCooldown = false,
    maxRounds = 5,
    remember = true,
  } = {}) {
    const model = this.resolveAgentModel(overrideModel);
    if (!message || !String(message).trim()) {
      return { ok: false, error: "Empty message." };
    }
    if (!bypassCooldown && this.isGenerating) {
      return { ok: false, error: "Already generating a reply." };
    }

    this.isGenerating = true;
    const startMs = Date.now();
    const actions = [];
    const toolNames = tools.map((t) => t.function.name);
    // Results the model must read before answering.
    const INFO_TOOLS = new Set([
      "get_status",
      "list_scripts",
      "run_code",
      "read_logs",
      "think",
    ]);
    const thoughts = [];

    const seenCalls = new Set();
    const runCalls = async (calls) => {
      let needsFollowUp = false;
      for (const call of calls.slice(0, 4)) {
        const name = call?.function?.name || "";
        let args = call?.function?.arguments || {};
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch (_) {
            args = {};
          }
        }
        // Small models repeat the exact same call; run it once.
        const key = `${name}:${JSON.stringify(args)}`;
        if (seenCalls.has(key)) continue;
        seenCalls.add(key);
        let result;
        let failed = false;
        try {
          result = await executeTool(name, args, { sender });
        } catch (err) {
          result = `Error: ${err.message || err}`;
        }
        const resultText =
          typeof result === "string" ? result : JSON.stringify(result);
        failed = /^(error|failed|no path|stuck|could not|cannot|unknown)/i.test(
          resultText,
        );
        if (failed || INFO_TOOLS.has(name)) needsFollowUp = true;
        actions.push({ name, args, result: resultText, failed });
        messages.push({
          role: "tool",
          tool_name: name,
          content: resultText.slice(0, 1500),
        });
      }
      return needsFollowUp;
    };

    const messages = [
      {
        role: "system",
        content: this.buildSystemPrompt(botContext, { agent: true, model }),
      },
      ...this.chatHistory.slice(-6),
      { role: "user", content: `${sender}: ${message}` },
    ];

    try {
      let finalText = "";
      for (let round = 0; round < maxRounds; round++) {
        let res;
        try {
          res = await httpJsonRequest(`${this.host}/api/chat`, {
            method: "POST",
            timeout: 90000,
            body: this.chatBody(model, messages, {
              tools,
              options: {
                temperature: 0.3,
                num_predict: round === 0 ? 300 : 160,
                num_ctx: 8192,
              },
            }),
          });
        } catch (err) {
          if (/does not support tools/i.test(err.message || "")) {
            this.noToolsModels.add(model);
            this.isGenerating = false;
            const fallback = await this.generateChatReply({
              sender,
              message,
              botContext,
              bypassCooldown,
            });
            return {
              ...fallback,
              note: `${model} cannot run actions. Pick a model tagged Actions for the agent.`,
            };
          }
          throw err;
        }

        const msg = res?.message || {};
        let calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
        let content = String(msg.content || "");
        if (!calls.length) {
          calls = parseTextToolCalls(
            cleanModelText(content),
            toolNames,
            resolveTool,
          );
          if (calls.length) content = "";
        }
        if (!calls.length) {
          const text = cleanModelText(content);
          // "think I should check..." written as text instead of a call.
          const thinking = text.match(
            /^\s*(?:\*\*)?(?:think(?:ing)?|thoughts?|plan|reasoning|note to self)(?:\*\*)?\s*[:\-]?\s+([\s\S]+)$/i,
          );
          if (thinking && round < maxRounds - 1) {
            thoughts.push(thinking[1].trim().slice(0, 400));
            messages.push({ role: "assistant", content });
            messages.push({
              role: "user",
              content:
                "[private] Noted. Now act with a tool, or answer if nothing needs doing.",
            });
            continue;
          }
          finalText = content;
          break;
        }

        messages.push({ role: "assistant", content, tool_calls: calls });
        // Words next to tool calls are the model thinking, never chat.
        const spoken = cleanModelText(content);
        if (spoken) thoughts.push(spoken.slice(0, 400));
        const needsFollowUp = await runCalls(calls);
        if (!needsFollowUp) break;
      }

      // Private self-check: did that do what the player wanted? Retry once
      // with a corrected command if not, then write the chat reply.
      let review = await this.reviewAgentWork({
        model,
        sender,
        message,
        actions,
        draft: finalText,
        botContext,
      });
      if (review?.thought) thoughts.push(`check: ${review.thought}`);
      if (review && review.ok === false && review.retry) {
        // The retry may come back as a plain command or in tool syntax
        // ("follow_player(ancymon)", "stop_script aiagent"); run either.
        const asCalls = parseTextToolCalls(
          review.retry,
          toolNames,
          resolveTool,
        ).slice(0, 2);
        const retryCalls = asCalls.length
          ? asCalls.map((c) => ({
              name: c.function.name,
              args: c.function.arguments || {},
            }))
          : [{ name: "run_commands", args: { commands: review.retry } }];
        for (const call of retryCalls) {
          let result;
          try {
            result = String(
              await executeTool(call.name, call.args, { sender }),
            );
          } catch (err) {
            result = `Error: ${err.message || err}`;
          }
          actions.push({
            name: call.name,
            args: call.args,
            result,
            failed: /^error/i.test(result),
          });
        }
        const second = await this.reviewAgentWork({
          model,
          sender,
          message,
          actions,
          draft: "",
          botContext,
          noRetry: true,
        });
        if (second?.thought) thoughts.push(`check: ${second.thought}`);
        if (second) review = second;
      }
      if (review && typeof review.reply === "string") {
        finalText = review.reply;
      } else if (actions.length) {
        // No usable review: never fall back to the model's raw text after
        // it used tools, that's where the thinking out loud lives.
        finalText = "";
      }

      // Small models start replies with "<player>: ".
      const senderPrefix = new RegExp(
        `^\\s*<?@?${String(sender).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>?\\s*[:,]\\s*`,
        "i",
      );
      finalText = String(finalText || "").replace(senderPrefix, "");
      // Thinking out loud (tool talk, error text, syntax lessons) stays
      // in the console as a thought instead of going to chat.
      if (isThinkingOutLoud(finalText)) {
        thoughts.push(cleanModelText(finalText).slice(0, 400));
        finalText = "";
      }
      let { reply, parts } = this.finalizeReply(finalText, botContext);
      const realActions = actions.filter((a) => a.name !== "think");
      if (!reply && realActions.length) {
        const last = realActions[realActions.length - 1];
        reply = last.failed ? "hmm can't do that rn" : "on it";
        parts = [reply];
      }
      for (const a of actions) {
        const th = String(a.args?.thought || "").trim();
        if (
          a.name === "think" &&
          th &&
          th !== "noted" &&
          !thoughts.includes(th)
        )
          thoughts.unshift(th);
      }
      if (!reply) {
        return finalText.length && !finalText.trim()
          ? { ok: false, silent: true, model, actions, thoughts }
          : {
              ok: false,
              error: "Model returned an empty response.",
              thoughts,
              model,
              actions,
            };
      }

      if (!bypassCooldown) this.markReplied();
      if (remember) this.rememberExchange(sender, message, reply);
      return {
        ok: true,
        reply,
        parts,
        model,
        actions,
        thoughts,
        latencyMs: Date.now() - startMs,
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message || "Failed to query Ollama API",
        model,
        actions,
      };
    } finally {
      this.isGenerating = false;
    }
  }

  resolveScriptModel(installed = []) {
    if (this.config.scriptModel) return this.config.scriptModel;
    const names = installed.map((m) => m.name);
    const coder = names.find((n) => /coder/i.test(n));
    return (
      coder ||
      this.config.model ||
      this.cachedHardware?.recommendedCodeModel ||
      "qwen2.5-coder:3b"
    );
  }

  // Streams a full answer for script generation; onToken gets the text so far.
  streamChat({ model, messages, options = {}, onToken = () => {}, signal }) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (val) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };
      try {
        const u = new URL(`${this.host}/api/chat`);
        const lib = u.protocol === "https:" ? https : http;
        const body = {
          model,
          messages,
          stream: true,
          keep_alive: "30m",
          options,
        };
        if (isThinkingModel(model)) body.think = false;
        const payload = JSON.stringify(body);
        const req = lib.request(
          {
            hostname: u.hostname,
            port: u.port || 11434,
            path: u.pathname,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            },
          },
          (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              let errText = "";
              res.on("data", (c) => (errText += c));
              res.on("end", () =>
                finish({
                  ok: false,
                  error: `HTTP ${res.statusCode}: ${errText.slice(0, 160)}`,
                }),
              );
              return;
            }
            let buffer = "";
            let text = "";
            let streamError = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              buffer += chunk;
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                if (!line.trim()) continue;
                try {
                  const evt = JSON.parse(line);
                  if (evt.error) streamError = evt.error;
                  const piece = evt?.message?.content || "";
                  if (piece) {
                    text += piece;
                    onToken(text);
                  }
                } catch (_) {}
              }
            });
            res.on("end", () =>
              finish(
                streamError
                  ? { ok: false, error: streamError, text }
                  : { ok: true, text },
              ),
            );
            res.on("error", (err) => finish({ ok: false, error: err.message }));
          },
        );
        req.setTimeout(300000, () => req.destroy(new Error("Timed out")));
        req.on("error", (err) =>
          finish({
            ok: false,
            error: signal?.aborted ? "Cancelled" : err.message,
          }),
        );
        if (signal) {
          signal.addEventListener("abort", () =>
            req.destroy(new Error("Cancelled")),
          );
        }
        req.write(payload);
        req.end();
      } catch (err) {
        finish({ ok: false, error: err.message });
      }
    });
  }
}

module.exports = {
  OllamaManager,
  ollamaManager: new OllamaManager(),
  RECOMMENDED_MODELS,
  splitIntoMessages,
  cleanModelText,
  parseTextToolCalls,
  isThinkingOutLoud,
  downloadFile,
  extractArchive,
  supportsTools,
};
