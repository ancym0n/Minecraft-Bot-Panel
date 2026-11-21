// Built-in Proxy Manager for MCBP:
// - Pure Node.js SOCKS5, SOCKS4/4a, and HTTP CONNECT tunnel client (zero external npm dependencies)
// - Built-in Free Proxy Finder (scrapes public SOCKS5/SOCKS4/HTTP proxy feeds)
// - Concurrent Proxy Auto-Tester (verifies real handshake & measures latency in ms)
// - AI Self-Healing (automatically blacklists dead proxies, rotates to verified ones, or re-scrapes)

const net = require("net");
const dns = require("dns");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const FREE_PROXY_SOURCES = [
  {
    protocol: "socks5",
    url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=3500&country=all",
  },
  {
    protocol: "socks4",
    url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=3500&country=all",
  },
  {
    protocol: "socks5",
    url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt",
  },
  {
    protocol: "socks4",
    url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt",
  },
  {
    protocol: "socks5",
    url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
  },
  {
    protocol: "http",
    url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3500&country=all",
  },
];

function parseProxyUrl(raw) {
  const str = String(raw || "").trim();
  if (!str) return null;
  let protocol = "socks5";
  let rest = str;
  const protoMatch = str.match(/^(socks5|socks4|http|https):\/\/(.+)$/i);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    if (protocol === "https") protocol = "http";
    rest = protoMatch[2].trim();
  }
  let username = "";
  let password = "";
  if (rest.includes("@")) {
    const [authPart, hostPart] = rest.split("@");
    rest = hostPart;
    const [u, p] = authPart.split(":");
    username = u || "";
    password = p || "";
  }
  const parts = rest.split(":");
  if (parts.length < 2) return null;
  const host = parts[0].trim();
  const port = parseInt(parts[1].trim(), 10);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
    return null;
  }
  const id = `${protocol}://${host}:${port}`;
  return {
    id,
    protocol,
    host,
    port,
    username,
    password,
    label: `${host}:${port}`,
  };
}

function fetchTextUrl(urlStr, timeout = 6500) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.get(
        urlStr,
        {
          timeout,
          headers: { "User-Agent": "MCBP-ProxyFinder/1.0" },
        },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            resolve(
              fetchTextUrl(
                new URL(res.headers.location, urlStr).toString(),
                timeout,
              ),
            );
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => {
            if (body.length < 512 * 1024) body += c;
          });
          res.on("end", () => resolve(body));
        },
      );
      req.on("timeout", () => req.destroy(new Error("Timed out")));
      req.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}

// Opens a tunneled TCP socket through a SOCKS5, SOCKS4/4a, or HTTP CONNECT proxy.
function openProxyTunnel(
  proxy,
  targetHost,
  targetPort,
  { timeoutMs = 5000 } = {},
) {
  return new Promise((resolve, reject) => {
    const parsed = typeof proxy === "string" ? parseProxyUrl(proxy) : proxy;
    if (!parsed || !parsed.host || !parsed.port) {
      reject(new Error("Invalid proxy configuration"));
      return;
    }

    const sock = net.connect({ host: parsed.host, port: parsed.port });
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error(`Proxy timeout (${parsed.host}:${parsed.port})`));
    }, timeoutMs);

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch (_) {}
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.removeListener("error", onHandshakeError);
      sock.removeListener("close", onEarlyClose);
      resolve(sock);
    };

    const onHandshakeError = (err) => fail(err);
    const onEarlyClose = () =>
      fail(new Error("Proxy closed connection during handshake"));

    sock.once("error", onHandshakeError);
    sock.once("close", onEarlyClose);

    sock.once("connect", () => {
      const proto = String(parsed.protocol || "socks5").toLowerCase();
      if (proto === "http") {
        const authHeader = parsed.username
          ? `Proxy-Authorization: Basic ${Buffer.from(`${parsed.username}:${parsed.password || ""}`).toString("base64")}\r\n`
          : "";
        const reqStr =
          `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
          `Host: ${targetHost}:${targetPort}\r\n` +
          authHeader +
          `Connection: keep-alive\r\n\r\n`;
        let respBuf = Buffer.alloc(0);
        const onData = (chunk) => {
          respBuf = Buffer.concat([respBuf, chunk]);
          const str = respBuf.toString("latin1");
          const endIdx = str.indexOf("\r\n\r\n");
          if (endIdx !== -1) {
            sock.removeListener("data", onData);
            const firstLine = str.slice(0, str.indexOf("\r\n"));
            if (!/^HTTP\/1\.[01]\s+200\b/i.test(firstLine)) {
              fail(new Error(`HTTP proxy rejected: ${firstLine}`));
              return;
            }
            const leftover = respBuf.slice(endIdx + 4);
            if (leftover.length > 0) sock.unshift(leftover);
            succeed();
          } else if (respBuf.length > 8192) {
            sock.removeListener("data", onData);
            fail(new Error("Invalid HTTP proxy response"));
          }
        };
        sock.on("data", onData);
        sock.write(reqStr);
        return;
      }

      if (proto === "socks4") {
        // SOCKS4 / SOCKS4a connect request
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(targetPort, 0);
        const isIpv4 = net.isIP(targetHost) === 4;
        let reqBuf;
        if (isIpv4) {
          const ipBytes = targetHost.split(".").map((n) => parseInt(n, 10));
          reqBuf = Buffer.from([
            0x04,
            0x01,
            portBuf[0],
            portBuf[1],
            ipBytes[0],
            ipBytes[1],
            ipBytes[2],
            ipBytes[3],
            0x00,
          ]);
        } else {
          // SOCKS4a: IP 0.0.0.1 + null-terminated user + null-terminated hostname
          const hostBuf = Buffer.from(`${targetHost}\0`, "utf8");
          reqBuf = Buffer.concat([
            Buffer.from([
              0x04,
              0x01,
              portBuf[0],
              portBuf[1],
              0x00,
              0x00,
              0x00,
              0x01,
              0x00,
            ]),
            hostBuf,
          ]);
        }
        let respBuf = Buffer.alloc(0);
        const onData = (chunk) => {
          respBuf = Buffer.concat([respBuf, chunk]);
          if (respBuf.length >= 8) {
            sock.removeListener("data", onData);
            if (respBuf[1] !== 0x5a) {
              fail(
                new Error(`SOCKS4 rejected connection (code 0x${respBuf[1].toString(16)})`),
              );
              return;
            }
            const leftover = respBuf.slice(8);
            if (leftover.length > 0) sock.unshift(leftover);
            succeed();
          }
        };
        sock.on("data", onData);
        sock.write(reqBuf);
        return;
      }

      // Default: SOCKS5
      const hasAuth = Boolean(parsed.username);
      const greeting = hasAuth
        ? Buffer.from([0x05, 0x02, 0x00, 0x02])
        : Buffer.from([0x05, 0x01, 0x00]);
      let stage = "greeting";
      let respBuf = Buffer.alloc(0);

      const sendConnectCmd = () => {
        stage = "connect";
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(targetPort, 0);
        let addrBuf;
        if (net.isIP(targetHost) === 4) {
          const ipBytes = targetHost.split(".").map((n) => parseInt(n, 10));
          addrBuf = Buffer.from([0x01, ...ipBytes]);
        } else {
          const domainBytes = Buffer.from(targetHost, "utf8");
          addrBuf = Buffer.concat([
            Buffer.from([0x03, domainBytes.length]),
            domainBytes,
          ]);
        }
        const cmdBuf = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00]),
          addrBuf,
          portBuf,
        ]);
        sock.write(cmdBuf);
      };

      const onData = (chunk) => {
        respBuf = Buffer.concat([respBuf, chunk]);
        if (stage === "greeting") {
          if (respBuf.length < 2) return;
          if (respBuf[0] !== 0x05) {
            sock.removeListener("data", onData);
            fail(new Error("Not a valid SOCKS5 proxy"));
            return;
          }
          const method = respBuf[1];
          respBuf = respBuf.slice(2);
          if (method === 0x00) {
            sendConnectCmd();
          } else if (method === 0x02 && hasAuth) {
            stage = "auth";
            const uBuf = Buffer.from(parsed.username, "utf8");
            const pBuf = Buffer.from(parsed.password || "", "utf8");
            sock.write(
              Buffer.concat([
                Buffer.from([0x01, uBuf.length]),
                uBuf,
                Buffer.from([pBuf.length]),
                pBuf,
              ]),
            );
          } else {
            sock.removeListener("data", onData);
            fail(new Error("SOCKS5 proxy requires unsupported authentication"));
          }
          return;
        }
        if (stage === "auth") {
          if (respBuf.length < 2) return;
          const status = respBuf[1];
          respBuf = respBuf.slice(2);
          if (status !== 0x00) {
            sock.removeListener("data", onData);
            fail(new Error("SOCKS5 authentication failed"));
            return;
          }
          sendConnectCmd();
          return;
        }
        if (stage === "connect") {
          if (respBuf.length < 4) return;
          if (respBuf[1] !== 0x00) {
            sock.removeListener("data", onData);
            fail(
              new Error(`SOCKS5 connect failed (code 0x${respBuf[1].toString(16)})`),
            );
            return;
          }
          const atyp = respBuf[3];
          let needed = 4 + 2;
          if (atyp === 0x01) needed += 4;
          else if (atyp === 0x04) needed += 16;
          else if (atyp === 0x03) {
            if (respBuf.length < 5) return;
            needed += 1 + respBuf[4];
          }
          if (respBuf.length < needed) return;
          sock.removeListener("data", onData);
          const leftover = respBuf.slice(needed);
          if (leftover.length > 0) sock.unshift(leftover);
          succeed();
        }
      };

      sock.on("data", onData);
      sock.write(greeting);
    });
  });
}

function resolveMinecraftSrv(host, port) {
  return new Promise((resolve) => {
    if (
      port !== 25565 ||
      net.isIP(host) !== 0 ||
      host === "localhost" ||
      host === "127.0.0.1"
    ) {
      resolve({ host, port });
      return;
    }
    dns.resolveSrv(`_minecraft._tcp.${host}`, (err, addresses) => {
      if (!err && Array.isArray(addresses) && addresses.length > 0) {
        resolve({ host: addresses[0].name, port: addresses[0].port });
      } else {
        resolve({ host, port });
      }
    });
  });
}

class ProxyManager {
  constructor() {
    this.userDataDir = "";
    this.storagePath = "";
    this.proxies = new Map(); // id -> { id, protocol, host, port, username, password, label, status, latencyMs, failCount, lastCheckedAt }
    this.config = {
      enabled: false, // Whether main bot uses proxy
      selectedProxyId: "auto", // "auto" | proxy.id
      autoHeal: true, // AI + ProxyManager auto-heals dead proxies
    };
    this.isFetching = false;
    this.isTesting = false;
  }

  init(userDataDir) {
    this.userDataDir = userDataDir || "";
    if (this.userDataDir) {
      this.storagePath = path.join(this.userDataDir, "proxies-config.json");
      this.load();
    }
  }

  load() {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.storagePath, "utf8"));
      if (raw?.config && typeof raw.config === "object") {
        this.config = { ...this.config, ...raw.config };
      }
      if (Array.isArray(raw?.proxies)) {
        for (const p of raw.proxies) {
          const parsed = parseProxyUrl(
            p.id || `${p.protocol || "socks5"}://${p.host}:${p.port}`,
          );
          if (parsed) {
            this.proxies.set(parsed.id, {
              ...parsed,
              status: p.status || "untested",
              latencyMs: typeof p.latencyMs === "number" ? p.latencyMs : null,
              failCount: p.failCount || 0,
              lastCheckedAt: p.lastCheckedAt || 0,
            });
          }
        }
      }
    } catch (_) {}
  }

  save() {
    if (!this.storagePath) return;
    try {
      fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      const data = {
        config: this.config,
        proxies: Array.from(this.proxies.values()).slice(0, 250),
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), "utf8");
    } catch (_) {}
  }

  saveConfig(partial = {}) {
    if (typeof partial.enabled === "boolean")
      this.config.enabled = partial.enabled;
    if (typeof partial.selectedProxyId === "string")
      this.config.selectedProxyId = partial.selectedProxyId;
    if (typeof partial.autoHeal === "boolean")
      this.config.autoHeal = partial.autoHeal;
    this.save();
    return this.getStatus();
  }

  addProxy(rawInput) {
    const lines = String(rawInput || "")
      .split(/[\r\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    let added = 0;
    for (const line of lines) {
      const parsed = parseProxyUrl(line);
      if (!parsed) continue;
      if (!this.proxies.has(parsed.id)) {
        this.proxies.set(parsed.id, {
          ...parsed,
          status: "untested",
          latencyMs: null,
          failCount: 0,
          lastCheckedAt: 0,
        });
        added++;
      }
    }
    if (added > 0) this.save();
    return { ok: added > 0, added, status: this.getStatus() };
  }

  removeProxy(id) {
    const deleted = this.proxies.delete(String(id || ""));
    if (deleted) this.save();
    return this.getStatus();
  }

  clearDeadProxies() {
    for (const [id, p] of this.proxies.entries()) {
      if (p.status === "dead") this.proxies.delete(id);
    }
    this.save();
    return this.getStatus();
  }

  clearAllProxies() {
    this.proxies.clear();
    this.save();
    return this.getStatus();
  }

  getWorkingProxies() {
    return Array.from(this.proxies.values())
      .filter((p) => p.status === "working")
      .sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999));
  }

  pickBestProxy(excludeIds = new Set()) {
    const working = this.getWorkingProxies().filter(
      (p) => !excludeIds.has(p.id),
    );
    if (this.config.selectedProxyId && this.config.selectedProxyId !== "auto") {
      const chosen = this.proxies.get(this.config.selectedProxyId);
      if (chosen && chosen.status !== "dead" && !excludeIds.has(chosen.id)) {
        return chosen;
      }
    }
    if (working.length > 0) return working[0];
    // Fallback to any untested proxy if none tested yet
    const untested = Array.from(this.proxies.values()).find(
      (p) => p.status === "untested" && !excludeIds.has(p.id),
    );
    return untested || null;
  }

  async fetchFreeProxies({ maxCount = 120, onProgress = () => {} } = {}) {
    if (this.isFetching) return { ok: false, error: "Already fetching proxies" };
    this.isFetching = true;
    let added = 0;
    try {
      onProgress({ message: "Scraping free public SOCKS5/SOCKS4/HTTP proxies..." });
      const results = await Promise.allSettled(
        FREE_PROXY_SOURCES.map(async (src) => {
          const text = await fetchTextUrl(src.url, 6000);
          return { protocol: src.protocol, text };
        }),
      );
      for (const res of results) {
        if (res.status !== "fulfilled" || !res.value?.text) continue;
        const { protocol, text } = res.value;
        const lines = text.split(/\r?\n/);
        for (const rawLine of lines) {
          if (this.proxies.size >= maxCount && added >= 60) break;
          const clean = rawLine.trim();
          if (!/^\d{1,3}(?:\.\d{1,3}){3}:\d{2,5}$/.test(clean)) continue;
          const parsed = parseProxyUrl(`${protocol}://${clean}`);
          if (parsed && !this.proxies.has(parsed.id)) {
            this.proxies.set(parsed.id, {
              ...parsed,
              status: "untested",
              latencyMs: null,
              failCount: 0,
              lastCheckedAt: 0,
            });
            added++;
          }
        }
      }
      this.save();
      return { ok: true, added, total: this.proxies.size, status: this.getStatus() };
    } finally {
      this.isFetching = false;
    }
  }

  async testSingleProxy(proxyEntry, { targetHost = "", targetPort = 25565, timeoutMs = 3200 } = {}) {
    const p =
      typeof proxyEntry === "string"
        ? this.proxies.get(proxyEntry) || parseProxyUrl(proxyEntry)
        : proxyEntry;
    if (!p) return { ok: false, error: "Unknown proxy" };

    const start = Date.now();
    // Test either full tunnel to target Minecraft server (if non-local) or fast TCP + protocol greeting check
    const isLocalTarget =
      !targetHost ||
      targetHost === "localhost" ||
      targetHost === "127.0.0.1" ||
      targetHost.startsWith("192.168.") ||
      targetHost.startsWith("10.");

    try {
      if (!isLocalTarget) {
        const srv = await resolveMinecraftSrv(targetHost, targetPort);
        const sock = await openProxyTunnel(p, srv.host, srv.port, {
          timeoutMs,
        });
        sock.destroy();
      } else {
        // Verify proxy handshake against a reliable public DNS/HTTP IP (1.1.1.1:80) or SOCKS greeting
        const sock = await openProxyTunnel(p, "1.1.1.1", 80, { timeoutMs });
        sock.destroy();
      }
      const latencyMs = Date.now() - start;
      p.status = "working";
      p.latencyMs = latencyMs;
      p.failCount = 0;
      p.lastCheckedAt = Date.now();
      this.proxies.set(p.id, p);
      return { ok: true, proxy: p, latencyMs };
    } catch (err) {
      p.status = "dead";
      p.latencyMs = null;
      p.failCount = (p.failCount || 0) + 1;
      p.lastCheckedAt = Date.now();
      this.proxies.set(p.id, p);
      return { ok: false, proxy: p, error: err.message };
    }
  }

  async testAllProxies({
    targetHost = "",
    targetPort = 25565,
    concurrency = 18,
    maxToTest = 90,
    pruneDead = true,
    onProgress = () => {},
  } = {}) {
    if (this.isTesting) return { ok: false, error: "Proxy test already running" };
    this.isTesting = true;
    try {
      const list = Array.from(this.proxies.values()).slice(0, maxToTest);
      if (list.length === 0) {
        return { ok: false, working: 0, tested: 0, status: this.getStatus() };
      }
      let tested = 0;
      let working = 0;
      let idx = 0;

      const worker = async () => {
        while (idx < list.length) {
          const item = list[idx++];
          const res = await this.testSingleProxy(item, {
            targetHost,
            targetPort,
            timeoutMs: 2800,
          });
          tested++;
          if (res.ok) working++;
          if (tested % 5 === 0 || tested === list.length) {
            onProgress({
              tested,
              total: list.length,
              working,
              message: `Testing proxies: ${tested}/${list.length} (${working} working)...`,
            });
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, list.length) }, () =>
          worker(),
        ),
      );

      if (pruneDead) {
        for (const [id, p] of this.proxies.entries()) {
          if (p.status === "dead") this.proxies.delete(id);
        }
      }
      this.save();
      return {
        ok: true,
        tested,
        working,
        status: this.getStatus(),
      };
    } finally {
      this.isTesting = false;
    }
  }

  // AI Self-Healing: called when a proxy connection fails or gets throttled.
  async healProxyFailure(
    failedProxy,
    { targetHost = "", targetPort = 25565, log = () => {}, onAiHeal = null } = {},
  ) {
    if (failedProxy && failedProxy.id) {
      const existing = this.proxies.get(failedProxy.id);
      if (existing) {
        existing.status = "dead";
        existing.failCount = (existing.failCount || 0) + 1;
        this.proxies.delete(failedProxy.id);
      }
    }
    this.save();

    let nextProxy = this.pickBestProxy(
      new Set(failedProxy?.id ? [failedProxy.id] : []),
    );

    if (!nextProxy || nextProxy.status !== "working") {
      log(
        `Proxy AI-Heal: Pool low on verified proxies - auto-fetching & testing free proxies...`,
      );
      if (this.proxies.size < 15) {
        await this.fetchFreeProxies({ maxCount: 80 }).catch(() => {});
      }
      await this.testAllProxies({
        targetHost,
        targetPort,
        maxToTest: 45,
        pruneDead: true,
      }).catch(() => {});
      nextProxy = this.pickBestProxy(
        new Set(failedProxy?.id ? [failedProxy.id] : []),
      );
    }

    if (nextProxy) {
      const msg = `Switched from dead proxy ${failedProxy?.label || "previous"} to verified ${nextProxy.protocol.toUpperCase()} proxy ${nextProxy.label} (${nextProxy.latencyMs ?? "?"}ms)`;
      log(`Proxy AI-Heal: ${msg}`);
      if (typeof onAiHeal === "function") onAiHeal(msg, nextProxy);
      return { ok: true, proxy: nextProxy, message: msg };
    }

    const fallbackMsg = `No working free proxies responded - falling back to direct connection`;
    log(`Proxy AI-Heal: ${fallbackMsg}`);
    if (typeof onAiHeal === "function") onAiHeal(fallbackMsg, null);
    return { ok: false, proxy: null, message: fallbackMsg };
  }

  // Creates a custom `connect(client)` function for mineflayer.createBot(botOptions)
  createConnectHook(proxyEntry, targetHost, targetPort, { onFail = null } = {}) {
    return (client) => {
      resolveMinecraftSrv(targetHost, targetPort)
        .then((srv) =>
          openProxyTunnel(proxyEntry, srv.host, srv.port, { timeoutMs: 6500 }),
        )
        .then((sock) => {
          client.setSocket(sock);
          client.emit("connect");
        })
        .catch((err) => {
          if (typeof onFail === "function") {
            onFail(err, proxyEntry);
          }
          client.emit("error", err);
        });
    };
  }

  getStatus() {
    const all = Array.from(this.proxies.values());
    const working = all
      .filter((p) => p.status === "working")
      .sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999));
    const untested = all.filter((p) => p.status === "untested");
    return {
      config: { ...this.config },
      isFetching: this.isFetching,
      isTesting: this.isTesting,
      totalCount: all.length,
      workingCount: working.length,
      untestedCount: untested.length,
      proxies: [
        ...working,
        ...untested,
        ...all.filter((p) => p.status === "dead"),
      ].slice(0, 120),
    };
  }
}

const proxyManager = new ProxyManager();

module.exports = {
  ProxyManager,
  proxyManager,
  parseProxyUrl,
  openProxyTunnel,
  resolveMinecraftSrv,
};
