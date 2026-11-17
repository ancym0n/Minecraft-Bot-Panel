const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");

const DEFAULT_HOST = "http://127.0.0.1:11434";

const RECOMMENDED_MODELS = [
  {
    name: "llama3.2:1b",
    label: "Llama 3.2 1B",
    sizeLabel: "1.3 GB",
    minRamGb: 4,
    tier: "light",
    desc: "Ultra-fast responses, minimal CPU/RAM usage",
  },
  {
    name: "qwen2.5:1.5b",
    label: "Qwen 2.5 1.5B",
    sizeLabel: "1.0 GB",
    minRamGb: 4,
    tier: "light",
    desc: "Fast multilingual chat (English, Polish & more)",
  },
  {
    name: "gemma2:2b",
    label: "Gemma 2 2B",
    sizeLabel: "1.6 GB",
    minRamGb: 6,
    tier: "balanced",
    desc: "Clean, natural short player replies",
  },
  {
    name: "llama3.2:3b",
    label: "Llama 3.2 3B",
    sizeLabel: "2.0 GB",
    minRamGb: 8,
    tier: "balanced",
    desc: "Great balance of speed and game awareness",
  },
  {
    name: "qwen2.5:3b",
    label: "Qwen 2.5 3B",
    sizeLabel: "1.9 GB",
    minRamGb: 8,
    tier: "balanced",
    desc: "Smart multilingual conversationalist for servers",
  },
  {
    name: "llama3.1:8b",
    label: "Llama 3.1 8B",
    sizeLabel: "4.7 GB",
    minRamGb: 15,
    tier: "heavy",
    desc: "High-intelligence model for 16GB+ RAM or GPU",
  },
  {
    name: "qwen2.5:7b",
    label: "Qwen 2.5 7B",
    sizeLabel: "4.7 GB",
    minRamGb: 15,
    tier: "heavy",
    desc: "Deep context & multilingual roleplay for GPU systems",
  },
];

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

    this.config = {
      enabled: false,
      model: "",
      triggerMode: "mention", // "mention" | "all"
      cooldownSec: 4,
      maxTokens: 70,
      includeBotContext: true,
      ignoreSelf: true,
      customTriggers: "",
      systemPrompt:
        "You are a friendly, real human Minecraft player chatting on a multiplayer server. Reply naturally in 1 short sentence (under 140 characters). Never use markdown, bullet points, or assistant phrases. Reply in the same language the player used (e.g. Polish or English).",
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
        this.config = { ...this.config, ...raw };
      }
    } catch (_) {}
    return this.config;
  }

  saveConfig(partial = {}) {
    this.config = { ...this.config, ...partial };
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
            path.join(os.homedir(), ".local", "bin", "ollama"),
            this.userDataDir
              ? path.join(this.userDataDir, "ollama", "bin", "ollama")
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

    let recommended = "qwen2.5:1.5b";
    let reason = `${totalRamGb} GB RAM · ${cpuCores} threads`;

    if (vramGb >= 6 || totalRamGb >= 20) {
      recommended = "qwen2.5:3b";
      reason = gpuName
        ? `${gpuName}${vramGb ? ` (${vramGb} GB VRAM)` : ""} · ${totalRamGb} GB RAM`
        : `${totalRamGb} GB RAM · ${cpuCores} threads`;
    } else if (totalRamGb >= 10) {
      recommended = "llama3.2:3b";
      reason = `${totalRamGb} GB RAM · ${cpuCores} threads`;
    } else if (totalRamGb >= 7) {
      recommended = "qwen2.5:1.5b";
      reason = `Fastest for ${totalRamGb} GB RAM`;
    } else {
      recommended = "llama3.2:1b";
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
      recommendReason: reason,
      catalog: RECOMMENDED_MODELS.map((m) => ({
        ...m,
        isRecommended: m.name === recommended,
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

    if (process.platform === "linux") {
      onProgress({
        stage: "installing",
        message: "Downloading Ollama for Linux (user-local)...",
        percent: 10,
      });
      const arch = os.arch() === "arm64" ? "arm64" : "amd64";
      const targetDir = path.join(this.userDataDir || os.tmpdir(), "ollama");
      fs.mkdirSync(targetDir, { recursive: true });
      const tgzPath = path.join(targetDir, `ollama-linux-${arch}.tgz`);
      const downloadUrl = `https://ollama.com/download/ollama-linux-${arch}.tgz`;

      const dl = await execFilePromise(
        "curl",
        ["-fL", "--max-time", "300", "-o", tgzPath, downloadUrl],
        { timeout: 310000 },
      );
      if (dl.ok && fs.existsSync(tgzPath)) {
        onProgress({
          stage: "extracting",
          message: "Extracting Ollama binary...",
          percent: 65,
        });
        const untar = await execFilePromise(
          "tar",
          ["-xzf", tgzPath, "-C", targetDir],
          { timeout: 60000 },
        );
        try {
          fs.rmSync(tgzPath, { force: true });
        } catch (_) {}
        const binCandidate = path.join(targetDir, "bin", "ollama");
        if (untar.ok && fs.existsSync(binCandidate)) {
          try {
            fs.chmodSync(binCandidate, 0o755);
          } catch (_) {}
          return { ok: true, binPath: binCandidate };
        }
      }
      return {
        ok: false,
        error:
          "Could not download Ollama automatically. Run 'curl -fsSL https://ollama.com/install.sh | sh' or install package 'ollama'.",
      };
    }

    return {
      ok: false,
      error: "Automatic binary installation is not supported on this OS.",
    };
  }

  pullModel(modelName, onProgress = () => {}) {
    const cleanModel = String(modelName || "").trim();
    if (!cleanModel) {
      return Promise.resolve({ ok: false, error: "No model name specified." });
    }

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
              this.saveConfig({ model: cleanModel });
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

  async autoSetup({ preferredModel = "", onProgress = () => {} } = {}) {
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
      (m) =>
        m.name === targetModel ||
        m.name.split(":")[0] === targetModel.split(":")[0],
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

    this.saveConfig({ model: targetModel });
    const finalStatus = await this.getStatus();
    return {
      ok: true,
      model: targetModel,
      status: finalStatus,
    };
  }

  shouldRespondToChat({ sender, message, botUsername }) {
    if (!this.config.enabled) return false;
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

    // Ignore server command echoes or system announcements without a sender
    if (cleanMsg.startsWith("/")) return false;

    const now = Date.now();
    const cooldownMs = Math.max(1, Number(this.config.cooldownSec) || 4) * 1000;
    if (now - this.lastReplyTime < cooldownMs || this.isGenerating) {
      return false;
    }

    if (this.config.triggerMode === "all") {
      return Boolean(cleanSender && cleanSender !== "Server");
    }

    // "mention" mode: respond when bot username or custom trigger words appear in message
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

  async generateChatReply({
    sender = "Player",
    message = "",
    botContext = null,
    overrideModel = "",
    bypassCooldown = false,
  } = {}) {
    const model = String(
      overrideModel ||
        this.config.model ||
        this.cachedHardware?.recommendedModel ||
        "qwen2.5:1.5b",
    ).trim();

    if (!message || !String(message).trim()) {
      return { ok: false, error: "Empty message." };
    }

    if (!bypassCooldown && this.isGenerating) {
      return { ok: false, error: "Already generating a reply." };
    }

    this.isGenerating = true;
    const startMs = Date.now();

    try {
      let sysPrompt = String(
        this.config.systemPrompt ||
          "You are a friendly Minecraft player chatting on a server. Reply naturally in 1 short sentence under 140 characters.",
      ).trim();

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
        if (botContext.heldItem)
          ctxParts.push(`Holding: ${botContext.heldItem}`);
        if (
          Array.isArray(botContext.nearbyPlayers) &&
          botContext.nearbyPlayers.length > 0
        )
          ctxParts.push(
            `Nearby players: ${botContext.nearbyPlayers.join(", ")}`,
          );
        if (
          Array.isArray(botContext.activeScripts) &&
          botContext.activeScripts.length > 0
        )
          ctxParts.push(
            `Current tasks: ${botContext.activeScripts.join(", ")}`,
          );
        if (ctxParts.length > 0) {
          sysPrompt += `\n[Game State: ${ctxParts.join(" | ")}]`;
        }
      }

      const messages = [
        { role: "system", content: sysPrompt },
        ...this.chatHistory.slice(-6),
        { role: "user", content: `${sender}: ${message}` },
      ];

      const res = await httpJsonRequest(`${this.host}/api/chat`, {
        method: "POST",
        timeout: 25000,
        body: {
          model,
          messages,
          stream: false,
          keep_alive: "10m",
          options: {
            temperature: 0.7,
            num_predict: Math.max(
              20,
              Math.min(120, Number(this.config.maxTokens) || 70),
            ),
          },
        },
      });

      let reply = String(res?.message?.content || "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/\r?\n+/g, " ")
        .replace(/^["']|["']$/g, "")
        .trim();

      // Strip accidental self-prefix if the model wrote "BotName: hello"
      if (botContext?.username) {
        const prefixRe = new RegExp(`^<?${botContext.username}>?:\\s*`, "i");
        reply = reply.replace(prefixRe, "").trim();
      }

      if (reply.length > 220) {
        reply = `${reply.slice(0, 217)}...`;
      }

      if (!reply) {
        return { ok: false, error: "Model returned an empty response." };
      }

      this.lastReplyTime = Date.now();
      this.chatHistory.push(
        { role: "user", content: `${sender}: ${message}` },
        { role: "assistant", content: reply },
      );
      if (this.chatHistory.length > 12) {
        this.chatHistory.splice(0, this.chatHistory.length - 12);
      }

      return {
        ok: true,
        reply,
        model,
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
}

module.exports = {
  OllamaManager,
  ollamaManager: new OllamaManager(),
  RECOMMENDED_MODELS,
};
