// Local ViaProxy Auto-Bridge for Minecraft 26.2 (protocol 776), 26.3 (protocol 777),
// and newer servers beyond Mineflayer's native wire protocol (26.1 / protocol 775).
// Uses official ViaVersion/ViaProxy in headless CLI mode on 127.0.0.1:<ephemeralPort>
// when Java 17+ is available, and falls back gracefully to the native JS protocol shim otherwise.

const { execFile, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const os = require("os");
const path = require("path");

const VIAPROXY_RELEASES_API =
  "https://api.github.com/repos/ViaVersion/ViaProxy/releases/latest";
const USER_AGENT = "minecraft-bot-panel-viaproxy";
// ViaProxy plugin that hands online-mode session joins back to the panel.
const AUTH_PLUGIN_JAR = path.join(
  __dirname,
  "..",
  "viaproxy-plugin",
  "mcbp-auth-bridge.jar",
);
const MOJANG_JOIN_URL =
  "https://sessionserver.mojang.com/session/minecraft/join";
const MIN_JAVA_MAJOR = 17;
const MIN_JAR_BYTES = 1024 * 1024; // 1 MB sanity threshold

const activeBridges = new Set();

function resolveDefaultCacheDir() {
  try {
    if (process.versions.electron) {
      const { app } = require("electron");
      if (app && typeof app.getPath === "function") {
        return path.join(app.getPath("userData"), "viaproxy");
      }
    }
  } catch (_) {}
  return path.join(os.tmpdir(), "mcbp-viaproxy");
}

function parseJavaMajorVersion(output) {
  const text = String(output || "");
  // Matches: openjdk version "21.0.13", java version "17.0.9", java version "1.8.0_401"
  const m = text.match(/version\s+"(\d+)(?:\.(\d+))?/i);
  if (!m) return null;
  const first = parseInt(m[1], 10);
  const second = m[2] ? parseInt(m[2], 10) : 0;
  if (first === 1 && second > 0) return second;
  return Number.isFinite(first) ? first : null;
}

function findJavaBinary() {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, "bin", exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return exe;
}

function checkJavaVersion({ timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    const bin = findJavaBinary();
    execFile(
      bin,
      ["-version"],
      { timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          return resolve({
            available: false,
            major: null,
            bin,
            raw: String(stderr || stdout || err.message || "").trim(),
          });
        }
        const raw = String(stderr || stdout || "").trim();
        const major = parseJavaMajorVersion(raw);
        resolve({
          available: Number.isFinite(major) && major >= MIN_JAVA_MAJOR,
          major,
          bin,
          raw: raw.split(/\r?\n/)[0] || raw,
        });
      },
    );
  });
}

function findFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((closeErr) => {
        if (closeErr || !port) {
          return reject(closeErr || new Error("Failed to allocate free port"));
        }
        resolve(port);
      });
    });
  });
}

function normalizeViaProxyTargetVersion(ver) {
  const clean = String(ver || "").trim();
  if (!clean) return "26.3";
  // Strip server brand prefixes like "Purpur 26.3" -> "26.3"
  const m = clean.match(/(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : clean;
}

function buildViaProxyConfig({
  bindHost = "127.0.0.1",
  bindPort,
  targetHost,
  targetPort = 25565,
  targetVersion = "26.3",
  authMethod = "NONE",
} = {}) {
  const cleanTargetVer = normalizeViaProxyTargetVersion(targetVersion);
  const lines = [
    `bind-address: ${bindHost}:${bindPort}`,
    `target-address: ${targetHost}:${Number(targetPort) || 25565}`,
    `target-version: ${cleanTargetVer}`,
    `auth-method: ${String(authMethod || "NONE").toUpperCase()}`,
    `wildcard-domain-handling: NONE`,
    `allow-beta-pinging: true`,
    `ignore-protocol-translation-errors: true`,
    `proxy-online-mode: false`,
    `compression-threshold: 256`,
  ];
  return `${lines.join("\n")}\n`;
}

function httpsRequest(url, { timeoutMs = 15000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      return reject(new Error("Too many HTTP redirects"));
    }
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/vnd.github+json, application/octet-stream, */*",
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          return resolve(
            httpsRequest(nextUrl, {
              timeoutMs,
              maxRedirects: maxRedirects - 1,
            }),
          );
        }
        resolve(res);
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("HTTP request timed out"));
    });
    req.on("error", reject);
  });
}

async function fetchLatestViaProxyRelease({ timeoutMs = 12000 } = {}) {
  const res = await httpsRequest(VIAPROXY_RELEASES_API, { timeoutMs });
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`GitHub API returned HTTP ${res.statusCode}`);
  }
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const jarAssets = assets.filter(
    (a) =>
      typeof a?.name === "string" &&
      /^ViaProxy.*\.jar$/i.test(a.name) &&
      !/sources|javadoc|dev/i.test(a.name) &&
      a.browser_download_url,
  );
  // Prefer the regular build; the "+java8" one is bytecode-downgraded.
  const jarAsset =
    jarAssets.find((a) => !/java8/i.test(a.name)) || jarAssets[0];
  if (!jarAsset) {
    throw new Error("Could not find ViaProxy .jar asset in latest release");
  }
  return {
    tag: String(json.tag_name || "latest"),
    name: jarAsset.name,
    url: jarAsset.browser_download_url,
    size: Number(jarAsset.size) || 0,
  };
}

async function ensureViaProxyJar({
  cacheDir = resolveDefaultCacheDir(),
  log = null,
  timeoutMs = 60000,
} = {}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const jarPath = path.join(cacheDir, "ViaProxy.jar");
  // Sidecar with the release asset name. Caches without it (or holding the
  // "+java8" build, whose downgraded log4j crashes on startup under Java 21)
  // are downloaded again once.
  const assetPath = `${jarPath}.asset`;
  try {
    const asset = fs.existsSync(assetPath)
      ? fs.readFileSync(assetPath, "utf8").trim()
      : "";
    if (
      asset &&
      !/java8/i.test(asset) &&
      fs.existsSync(jarPath) &&
      fs.statSync(jarPath).size >= MIN_JAR_BYTES
    ) {
      return { ok: true, jarPath, cached: true };
    }
  } catch (_) {}

  if (log) {
    log("ViaVersion: Downloading official ViaProxy.jar (one-time setup)...");
  }
  const release = await fetchLatestViaProxyRelease({ timeoutMs: 12000 });
  const res = await httpsRequest(release.url, { timeoutMs });
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`ViaProxy download failed (HTTP ${res.statusCode})`);
  }

  const tmpPath = `${jarPath}.tmp-${process.pid}-${Date.now()}`;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    res.pipe(out);
    res.on("error", reject);
    out.on("error", reject);
    out.on("finish", () => out.close(resolve));
  });

  const stat = fs.statSync(tmpPath);
  if (stat.size < MIN_JAR_BYTES) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {}
    throw new Error("Downloaded ViaProxy.jar is unexpectedly small");
  }

  fs.renameSync(tmpPath, jarPath);
  try {
    fs.writeFileSync(assetPath, release.name, "utf8");
  } catch (_) {}
  if (log) {
    log(
      `ViaVersion: ViaProxy ${release.tag} cached (${Math.round(stat.size / (1024 * 1024))} MB)`,
    );
  }
  return { ok: true, jarPath, cached: false, tag: release.tag };
}

function waitForTcpListen(
  host,
  port,
  { timeoutMs = 15000, child = null } = {},
) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let done = false;
    let pollTimer = null;

    const finish = (err) => {
      if (done) return;
      done = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (err) reject(err);
      else resolve();
    };

    if (child) {
      child.once("exit", (code, signal) => {
        finish(
          new Error(
            `ViaProxy exited before listening (code=${code}, signal=${signal})`,
          ),
        );
      });
      child.once("error", (err) => finish(err));
    }

    const attempt = () => {
      if (done) return;
      if (Date.now() - started >= timeoutMs) {
        return finish(new Error(`ViaProxy startup timed out (${timeoutMs}ms)`));
      }
      const sock = net.connect({ host, port });
      sock.setTimeout(600);
      sock.once("connect", () => {
        sock.destroy();
        finish(null);
      });
      sock.once("error", () => {
        sock.destroy();
        pollTimer = setTimeout(attempt, 250);
      });
      sock.once("timeout", () => {
        sock.destroy();
        pollTimer = setTimeout(attempt, 250);
      });
    };

    pollTimer = setTimeout(attempt, 350);
  });
}

async function startBridge({
  targetHost,
  targetPort = 25565,
  targetVersion = "26.3",
  authMethod = "NONE",
  cacheDir = resolveDefaultCacheDir(),
  log = null,
  readyTimeoutMs = 18000,
  joinServer = null,
} = {}) {
  const javaInfo = await checkJavaVersion();
  if (!javaInfo.available) {
    return {
      ok: false,
      reason: "no-java",
      error: javaInfo.major
        ? `Java ${MIN_JAVA_MAJOR}+ required for ViaProxy (found Java ${javaInfo.major})`
        : `Java ${MIN_JAVA_MAJOR}+ not found`,
    };
  }

  let jarPath;
  try {
    const jarRes = await ensureViaProxyJar({ cacheDir, log });
    jarPath = jarRes.jarPath;
  } catch (err) {
    return {
      ok: false,
      reason: "download-failed",
      error: err?.message || String(err),
    };
  }

  const bindHost = "127.0.0.1";
  const bindPort = await findFreePort(bindHost);
  const cleanTargetVer = normalizeViaProxyTargetVersion(targetVersion);
  const sessionDir = path.join(
    cacheDir,
    "sessions",
    `vp-${process.pid}-${Date.now()}-${bindPort}`,
  );
  fs.mkdirSync(sessionDir, { recursive: true });
  const configPath = path.join(sessionDir, "viaproxy.yml");
  fs.writeFileSync(
    configPath,
    buildViaProxyConfig({
      bindHost,
      bindPort,
      targetHost,
      targetPort,
      targetVersion: cleanTargetVer,
      authMethod,
    }),
    "utf8",
  );

  // Online-mode servers: ViaProxy fires JoinServerRequestEvent, our plugin
  // forwards the server id hash here and the panel joins with the bot's own
  // session (the token never leaves this process).
  let authServer = null;
  const javaProps = [];
  if (typeof joinServer === "function" && fs.existsSync(AUTH_PLUGIN_JAR)) {
    try {
      const auth = await startAuthEndpoint(joinServer, log);
      authServer = auth.server;
      const pluginsDir = path.join(sessionDir, "plugins");
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.copyFileSync(
        AUTH_PLUGIN_JAR,
        path.join(pluginsDir, "mcbp-auth-bridge.jar"),
      );
      javaProps.push(
        `-Dmcbp.auth.url=${auth.url}`,
        `-Dmcbp.auth.secret=${auth.secret}`,
      );
    } catch (err) {
      if (log)
        log(`ViaVersion: Online-mode auth bridge unavailable (${err.message})`);
    }
  }

  const child = spawn(
    javaInfo.bin,
    [
      "-Djava.awt.headless=true",
      "-DskipUpdateCheck",
      "-Xmx256m",
      ...javaProps,
      "-jar",
      jarPath,
      "config",
      configPath,
    ],
    {
      cwd: sessionDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let recentOutput = "";
  const collectOut = (buf) => {
    recentOutput = (recentOutput + String(buf || "")).slice(-1200);
  };
  child.stdout?.on("data", collectOut);
  child.stderr?.on("data", collectOut);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    activeBridges.delete(bridge);
    if (authServer) {
      try {
        authServer.close();
      } catch (_) {}
    }
    try {
      if (!child.killed) child.kill("SIGTERM");
    } catch (_) {}
    setTimeout(() => {
      try {
        if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
      } catch (_) {}
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (_) {}
    }, 800).unref();
  };

  const bridge = {
    ok: true,
    host: bindHost,
    port: bindPort,
    targetHost,
    targetPort: Number(targetPort) || 25565,
    targetVersion: cleanTargetVer,
    clientVersion: "26.1",
    onlineAuth: Boolean(authServer),
    pid: child.pid,
    stop,
  };
  activeBridges.add(bridge);
  child.once("exit", () => {
    activeBridges.delete(bridge);
  });

  try {
    await waitForTcpListen(bindHost, bindPort, {
      timeoutMs: readyTimeoutMs,
      child,
    });
    return bridge;
  } catch (err) {
    stop();
    const hint = recentOutput
      .split(/\r?\n/)
      .filter((l) => /error|exception|unsupported|failed/i.test(l))
      .slice(-2)
      .join(" | ");
    return {
      ok: false,
      reason: "start-failed",
      error: hint ? `${err.message} (${hint})` : err.message,
    };
  }
}

// Loopback-only endpoint the ViaProxy plugin calls with the server id hash.
function startAuthEndpoint(joinServer, log = null) {
  const secret = crypto.randomBytes(24).toString("hex");
  const server = http.createServer((req, res) => {
    const reply = (code, text = "") => {
      res.writeHead(code, { "Content-Type": "text/plain" });
      res.end(text);
    };
    if (req.method !== "POST" || req.url !== "/join") return reply(404);
    const given = String(req.headers["x-mcbp-secret"] || "");
    if (
      given.length !== secret.length ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))
    ) {
      return reply(403);
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      body += c;
      if (body.length > 200) req.destroy();
    });
    req.on("end", async () => {
      const serverIdHash = body.trim();
      if (!/^-?[0-9a-f]{1,64}$/i.test(serverIdHash)) return reply(400);
      try {
        await joinServer(serverIdHash);
        reply(204);
      } catch (err) {
        if (log)
          log(
            `ViaVersion: Online-mode session join failed: ${err.message || err}`,
          );
        reply(502, String(err.message || err).slice(0, 200));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      const { port } = server.address();
      resolve({ server, secret, url: `http://127.0.0.1:${port}/join` });
    });
  });
}

// Mojang session join (what the vanilla client does on an encryption request).
// Retries once on HTTP 429 (session server rate limit after quick reconnects).
async function mojangJoinServer(opts) {
  try {
    return await mojangJoinServerOnce(opts);
  } catch (err) {
    if (!/HTTP 429/.test(String(err.message))) throw err;
    await new Promise((r) => setTimeout(r, 2500));
    return mojangJoinServerOnce(opts);
  }
}

function mojangJoinServerOnce({
  accessToken,
  profileId,
  serverIdHash,
  timeoutMs = 15000,
}) {
  return new Promise((resolve, reject) => {
    if (!accessToken || !profileId) {
      return reject(new Error("bot has no Microsoft session yet"));
    }
    const body = JSON.stringify({
      accessToken,
      selectedProfile: String(profileId).replace(/-/g, ""),
      serverId: serverIdHash,
    });
    const req = https.request(
      MOJANG_JOIN_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": USER_AGENT,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          if (res.statusCode === 204 || res.statusCode === 200)
            return resolve();
          const detail = /^\s*</.test(text) ? "" : ` ${text.slice(0, 160)}`;
          reject(
            new Error(`Mojang session server HTTP ${res.statusCode}${detail}`),
          );
        });
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("Mojang session server timed out")),
    );
    req.on("error", reject);
    req.end(body);
  });
}

function stopAllBridges() {
  for (const bridge of Array.from(activeBridges)) {
    try {
      bridge.stop();
    } catch (_) {}
  }
  activeBridges.clear();
}

module.exports = {
  MIN_JAVA_MAJOR,
  parseJavaMajorVersion,
  checkJavaVersion,
  findFreePort,
  normalizeViaProxyTargetVersion,
  buildViaProxyConfig,
  ensureViaProxyJar,
  startBridge,
  stopAllBridges,
  mojangJoinServer,
  startAuthEndpoint,
  AUTH_PLUGIN_JAR,
};
