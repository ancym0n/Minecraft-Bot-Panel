// Multi-Bot Swarm & Proxy Botting Manager for MCBP ("Botting" Tab).
// Connects and coordinates multiple Mineflayer bots (with optional rotating proxies & AI self-healing)
// and gives them synchronized swarm functions (Follow, Circle/Come, Guard, KillAura, Anti-AFK, Chat/Command, Drop All, Stop).

const { loadLibraries } = require("./runtime");
const {
  configureSmartMovements,
  attachSubServerChatFix,
  equipBestWeapon,
  equipBestArmor,
  performPvpAttack,
  isHostile,
  isLikelyNpcOrFakePlayer,
  attachViaVersionAdapter,
  resolveSupportedVersion,
} = require("./botUtils");
const { proxyManager } = require("./proxyManager");
const { aiBrain } = require("./aiBrain");

class BottingManager {
  constructor() {
    this.bots = new Map(); // id -> entry
    this.nextId = 1;
    this.spawning = false;
    this.cancelSpawn = false;
    this.listeners = new Set();
    this.tickTimer = null;
  }

  onUpdate(fn) {
    if (typeof fn === "function") this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emitUpdate() {
    const status = this.getStatus();
    for (const fn of this.listeners) {
      try {
        fn(status);
      } catch (_) {}
    }
  }

  ensureTickLoop() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      if (this.bots.size === 0) {
        clearInterval(this.tickTimer);
        this.tickTimer = null;
        return;
      }
      this.tickSwarm();
    }, 550);
  }

  async tickSwarm() {
    for (const entry of this.bots.values()) {
      const b = entry.bot;
      if (!b || !b.entity || entry.state !== "connected") continue;
      try {
        if (entry.mode === "killaura" || entry.mode === "guard") {
          await this.tickBotCombat(entry);
        }
        if (entry.antiAfk) {
          this.tickBotAntiAfk(entry);
        }
      } catch (_) {}
    }
    this.emitUpdate();
  }

  async tickBotCombat(entry) {
    const b = entry.bot;
    if (!b || !b.entity || !b.entities) return;
    const pos = b.entity.position;
    let anchorPos = pos;
    if (entry.mode === "guard" && entry.targetName) {
      const guarded = Object.values(b.players || {}).find(
        (p) =>
          p?.username &&
          p.username.toLowerCase() === entry.targetName.toLowerCase(),
      )?.entity;
      if (guarded && guarded.position) {
        anchorPos = guarded.position;
        if (guarded.position.distanceTo(pos) > 4.5 && b.pathfinder) {
          const { goals } = loadLibraries();
          b.pathfinder.setGoal(new goals.GoalFollow(guarded, 2.5), true);
        }
      }
    }

    let nearest = null;
    let bestDist = Infinity;
    for (const e of Object.values(b.entities)) {
      if (!e || e === b.entity || !e.position) continue;
      const d = e.position.distanceTo(pos);
      if (d > (entry.mode === "guard" ? 10 : 4.3)) continue;
      const isTargetPlayer =
        entry.targetName &&
        entry.mode === "attack" &&
        e.type === "player" &&
        String(e.username || "").toLowerCase() ===
          entry.targetName.toLowerCase();
      const hostileMob = isHostile(e);
      if (!isTargetPlayer && !hostileMob) continue;
      if (e.type === "player" && isLikelyNpcOrFakePlayer(b, e)) continue;
      if (d < bestDist) {
        bestDist = d;
        nearest = e;
      }
    }

    if (!nearest) return;
    await equipBestWeapon(b, { saveLowDurability: true }).catch(() => {});
    if (bestDist > 3.6 && b.pathfinder) {
      const { goals } = loadLibraries();
      b.pathfinder.setGoal(new goals.GoalFollow(nearest, 1.8), true);
    }
    if (bestDist <= 4.1) {
      await performPvpAttack(b, nearest, {
        useCrits: true,
        maxRange: 4.2,
      }).catch(() => {});
    }
  }

  tickBotAntiAfk(entry) {
    const b = entry.bot;
    if (!b || !b.entity) return;
    const now = Date.now();
    if (now - (entry.lastAfkAt || 0) < 3200) return;
    entry.lastAfkAt = now;
    try {
      b.setControlState("jump", true);
      setTimeout(() => {
        try {
          b.setControlState("jump", false);
        } catch (_) {}
      }, 280);
      const yaw = (b.entity.yaw || 0) + (Math.random() - 0.5) * 0.9;
      const pitch = (Math.random() - 0.5) * 0.3;
      b.look(yaw, pitch, false).catch(() => {});
    } catch (_) {}
  }

  async spawnSwarm({
    host = "localhost",
    port = 25565,
    version = "",
    prefix = "MCBP_Bot",
    count = 3,
    delayMs = 1200,
    proxyMode = "direct", // "direct" | "auto" | proxyId
    autoHeal = true,
    log = () => {},
  } = {}) {
    if (this.spawning) {
      return { ok: false, error: "Swarm launch is already in progress" };
    }
    const cleanHost = String(host || "localhost").trim();
    const cleanPort = Number(port) || 25565;
    const botCount = Math.max(1, Math.min(25, parseInt(count, 10) || 1));
    const staggerMs = Math.max(250, Math.min(15000, parseInt(delayMs, 10) || 1200));

    // Support comma-separated custom names or prefix_N numbering
    const rawNames = String(prefix || "MCBP_Bot")
      .split(",")
      .map((s) => s.trim().replace(/[^A-Za-z0-9_]/g, ""))
      .filter(Boolean);

    const names = [];
    if (rawNames.length > 1) {
      for (let i = 0; i < Math.min(25, rawNames.length); i++) {
        names.push(rawNames[i].slice(0, 16));
      }
    } else {
      const base = (rawNames[0] || "MCBP_Bot").slice(0, 12);
      const existingNames = new Set(
        Array.from(this.bots.values()).map((e) => e.username.toLowerCase()),
      );
      let idx = 1;
      while (names.length < botCount) {
        const candidate =
          botCount === 1 && !existingNames.has(base.toLowerCase())
            ? base
            : `${base}_${idx}`;
        idx++;
        if (!existingNames.has(candidate.toLowerCase())) {
          names.push(candidate.slice(0, 16));
          existingNames.add(candidate.toLowerCase());
        }
      }
    }

    this.spawning = true;
    this.cancelSpawn = false;
    this.emitUpdate();

    try {
      if (proxyMode !== "direct" && proxyManager.getWorkingProxies().length === 0) {
        log(`Botting: Preparing & testing proxies before launching ${names.length} bot(s)...`);
        if (proxyManager.proxies.size === 0) {
          await proxyManager.fetchFreeProxies({ maxCount: 80 }).catch(() => {});
        }
        await proxyManager
          .testAllProxies({
            targetHost: cleanHost,
            targetPort: cleanPort,
            maxToTest: 40,
            pruneDead: true,
          })
          .catch(() => {});
      }

      const usedProxyIds = new Set();
      for (let i = 0; i < names.length; i++) {
        if (this.cancelSpawn) break;
        const username = names[i];
        let proxyEntry = null;
        if (proxyMode !== "direct") {
          if (proxyMode !== "auto" && proxyManager.proxies.has(proxyMode)) {
            proxyEntry = proxyManager.proxies.get(proxyMode);
          } else {
            proxyEntry =
              proxyManager.pickBestProxy(usedProxyIds) ||
              proxyManager.pickBestProxy();
            if (proxyEntry) usedProxyIds.add(proxyEntry.id);
          }
        }
        await this.spawnSingleBot({
          username,
          host: cleanHost,
          port: cleanPort,
          version,
          proxy: proxyEntry,
          proxyMode,
          autoHeal,
          log,
        });
        if (i < names.length - 1 && !this.cancelSpawn) {
          await new Promise((r) => setTimeout(r, staggerMs));
        }
      }
      return { ok: true, spawned: names.length, status: this.getStatus() };
    } finally {
      this.spawning = false;
      this.emitUpdate();
    }
  }

  async spawnSingleBot({
    id = null,
    username,
    host,
    port = 25565,
    version = "",
    proxy = null,
    proxyMode = "direct",
    autoHeal = true,
    healAttempts = 0,
    log = () => {},
  }) {
    const libs = loadLibraries();
    const { mineflayer, mcData, pathfinder, Movements, goals } = libs;
    const botId = id || `bot-${this.nextId++}`;

    const prev = this.bots.get(botId);
    if (prev?.bot) {
      try {
        prev.bot.end();
      } catch (_) {}
    }

    const entry = {
      id: botId,
      username,
      host,
      port,
      version,
      proxy: proxy
        ? {
            id: proxy.id,
            label: proxy.label,
            protocol: proxy.protocol,
            latencyMs: proxy.latencyMs,
          }
        : null,
      proxyMode,
      autoHeal,
      healAttempts,
      state: "connecting",
      mode: "idle",
      targetName: "",
      antiAfk: false,
      health: 20,
      food: 20,
      position: null,
      bot: null,
      error: "",
    };
    this.bots.set(botId, entry);
    this.emitUpdate();

    const normalizedVersion = resolveSupportedVersion(version, mcData);
    const botOptions = {
      host,
      port,
      username,
      auth: "offline",
      version: normalizedVersion,
    };

    if (proxy) {
      botOptions.connect = proxyManager.createConnectHook(proxy, host, port, {
        onFail: (err) => {
          entry.error = err.message || String(err);
        },
      });
    }

    log(
      `Botting: Connecting ${username} to ${host}:${port}${proxy ? ` via ${proxy.protocol.toUpperCase()} ${proxy.label}` : " (Direct)"}...`,
    );

    let instance;
    try {
      instance = mineflayer.createBot(botOptions);
    } catch (err) {
      entry.state = "error";
      entry.error = err.message || String(err);
      this.emitUpdate();
      return entry;
    }

    entry.bot = instance;
    instance.loadPlugin(pathfinder);
    instance.mcData = mcData;
    instance.Movements = Movements;
    instance.pathfinderGoals = goals;
    attachViaVersionAdapter(instance);
    attachSubServerChatFix(instance);

    instance.once("spawn", () => {
      if (entry.bot !== instance) return;
      entry.state = "connected";
      entry.error = "";
      entry.health = Math.round(instance.health ?? 20);
      entry.food = Math.round(instance.food ?? 20);
      if (instance.entity?.position) {
        const p = instance.entity.position;
        entry.position = {
          x: Math.floor(p.x),
          y: Math.floor(p.y),
          z: Math.floor(p.z),
        };
      }
      configureSmartMovements(instance, mcData, Movements, { canDig: false });
      equipBestArmor(instance).catch(() => {});
      log(
        `Botting: ${username} spawned (${instance.version})${entry.proxy ? ` [${entry.proxy.label}]` : ""}`,
      );
      this.ensureTickLoop();
      this.emitUpdate();
    });

    instance.on("health", () => {
      if (entry.bot !== instance) return;
      entry.health = Math.round(instance.health ?? 20);
      entry.food = Math.round(instance.food ?? 20);
      this.emitUpdate();
    });

    instance.on("move", () => {
      if (entry.bot !== instance || !instance.entity?.position) return;
      const p = instance.entity.position;
      entry.position = {
        x: Math.floor(p.x),
        y: Math.floor(p.y),
        z: Math.floor(p.z),
      };
    });

    const handleFailure = async (reasonText) => {
      if (entry.bot !== instance) return;
      const wasConnected = entry.state === "connected";
      entry.state = "disconnected";
      entry.error = reasonText;
      this.emitUpdate();

      // AI Self-Healing for proxy or connection-throttle failures
      const isProxyOrThrottleError =
        Boolean(proxy) ||
        /proxy|socks|connect|timed out|throttle|too fast|wait before|reset|refused/i.test(
          reasonText,
        );
      if (
        !wasConnected &&
        entry.autoHeal &&
        entry.healAttempts < 2 &&
        isProxyOrThrottleError &&
        entry.proxyMode !== "direct"
      ) {
        const healRes = await proxyManager.healProxyFailure(proxy, {
          targetHost: host,
          targetPort: port,
          log,
          onAiHeal: (msg) => {
            aiBrain.recordThought(`Botting AI-Heal (${username}): ${msg}`);
          },
        });
        if (!this.bots.has(botId)) return;
        await new Promise((r) => setTimeout(r, 800));
        await this.spawnSingleBot({
          id: botId,
          username,
          host,
          port,
          version,
          proxy: healRes.proxy,
          proxyMode: healRes.proxy ? entry.proxyMode : "direct",
          autoHeal,
          healAttempts: entry.healAttempts + 1,
          log,
        });
      }
    };

    instance.on("kicked", (reason) => {
      const text =
        typeof reason === "string" ? reason : JSON.stringify(reason || "");
      log(`Botting: ${username} kicked (${text.slice(0, 100)})`);
      handleFailure(`Kicked: ${text.slice(0, 80)}`);
    });

    instance.on("error", (err) => {
      const msg = err?.message || String(err);
      handleFailure(msg);
    });

    instance.on("end", () => {
      if (entry.bot !== instance) return;
      if (entry.state === "connected") {
        entry.state = "disconnected";
        this.emitUpdate();
      }
    });

    return entry;
  }

  disconnectBot(botId, { remove = true } = {}) {
    const entry = this.bots.get(botId);
    if (!entry) return this.getStatus();
    entry.autoHeal = false;
    entry.state = "disconnected";
    if (entry.bot) {
      try {
        entry.bot.end();
      } catch (_) {}
      entry.bot = null;
    }
    if (remove) this.bots.delete(botId);
    this.emitUpdate();
    return this.getStatus();
  }

  stopAll({ log = () => {} } = {}) {
    this.cancelSpawn = true;
    const count = this.bots.size;
    for (const id of Array.from(this.bots.keys())) {
      this.disconnectBot(id, { remove: true });
    }
    if (count > 0) log(`Botting: Disconnected all ${count} swarm bot(s)`);
    this.emitUpdate();
    return this.getStatus();
  }

  async runSwarmAction({
    action = "",
    target = "",
    text = "",
    botId = "",
    mainBotName = "",
    log = () => {},
  } = {}) {
    const { goals } = loadLibraries();
    const list = botId
      ? [this.bots.get(botId)].filter(Boolean)
      : Array.from(this.bots.values());
    const active = list.filter((e) => e.bot && e.bot.entity && e.state === "connected");
    if (active.length === 0 && action !== "reconnect") {
      return { ok: false, error: "No connected swarm bots to run action" };
    }

    const wantedTarget = String(target || mainBotName || "").trim();

    if (action === "reconnect" && botId) {
      const entry = this.bots.get(botId);
      if (entry) {
        await this.spawnSingleBot({
          id: entry.id,
          username: entry.username,
          host: entry.host,
          port: entry.port,
          version: entry.version,
          proxy:
            entry.proxyMode !== "direct" ? proxyManager.pickBestProxy() : null,
          proxyMode: entry.proxyMode,
          autoHeal: true,
          log,
        });
      }
      return { ok: true, status: this.getStatus() };
    }

    if (action === "chat") {
      const msg = String(text || "").trim();
      if (!msg) return { ok: false, error: "Enter a message or /command" };
      active.forEach((entry, idx) => {
        setTimeout(() => {
          try {
            entry.bot?.chat(msg);
          } catch (_) {}
        }, idx * 260);
      });
      log(`Botting: Sent "${msg}" from ${active.length} bot(s)`);
      return { ok: true, status: this.getStatus() };
    }

    if (action === "follow" || action === "come") {
      active.forEach((entry, idx) => {
        const b = entry.bot;
        const playerObj =
          (wantedTarget &&
            Object.values(b.players || {}).find(
              (p) =>
                p?.username &&
                p.username.toLowerCase() === wantedTarget.toLowerCase(),
            )) ||
          Object.values(b.players || {}).find(
            (p) =>
              p?.username &&
              p.username !== b.username &&
              p.entity &&
              !isLikelyNpcOrFakePlayer(b, p.entity),
          );
        if (!playerObj?.entity) return;
        entry.mode = action;
        entry.targetName = playerObj.username;
        if (action === "follow") {
          b.pathfinder?.setGoal(
            new goals.GoalFollow(playerObj.entity, 2 + (idx % 3)),
            true,
          );
        } else {
          // Spread in a circle around the target player
          const angle = (2 * Math.PI * idx) / Math.max(1, active.length);
          const radius = 2.2;
          const tx = Math.floor(playerObj.entity.position.x + Math.cos(angle) * radius);
          const ty = Math.floor(playerObj.entity.position.y);
          const tz = Math.floor(playerObj.entity.position.z + Math.sin(angle) * radius);
          b.pathfinder?.setGoal(new goals.GoalNear(tx, ty, tz, 1), false);
        }
      });
      log(
        `Botting: ${active.length} bot(s) ${action === "follow" ? "following" : "circling"} ${wantedTarget || "nearest player"}`,
      );
      this.emitUpdate();
      return { ok: true, status: this.getStatus() };
    }

    if (action === "guard" || action === "killaura" || action === "attack") {
      active.forEach((entry) => {
        const nextMode = entry.mode === action && !botId ? "idle" : action;
        entry.mode = nextMode;
        entry.targetName = wantedTarget;
        if (nextMode === "idle") {
          entry.bot.pathfinder?.setGoal(null);
        }
      });
      this.ensureTickLoop();
      log(`Botting: Set combat mode '${action}' on ${active.length} bot(s)`);
      this.emitUpdate();
      return { ok: true, status: this.getStatus() };
    }

    if (action === "antiafk") {
      const turnOn = !active.every((e) => e.antiAfk);
      active.forEach((entry) => {
        entry.antiAfk = turnOn;
      });
      this.ensureTickLoop();
      log(`Botting: Anti-AFK ${turnOn ? "ON" : "OFF"} for ${active.length} bot(s)`);
      this.emitUpdate();
      return { ok: true, status: this.getStatus() };
    }

    if (action === "jump") {
      active.forEach((entry) => {
        try {
          entry.bot.setControlState("jump", true);
          setTimeout(() => {
            try {
              entry.bot?.setControlState("jump", false);
            } catch (_) {}
          }, 350);
        } catch (_) {}
      });
      return { ok: true, status: this.getStatus() };
    }

    if (action === "sneak") {
      active.forEach((entry) => {
        try {
          const next = !entry.bot.getControlState("sneak");
          entry.bot.setControlState("sneak", next);
        } catch (_) {}
      });
      return { ok: true, status: this.getStatus() };
    }

    if (action === "dropall") {
      for (const entry of active) {
        const items = entry.bot.inventory?.items?.() || [];
        for (const it of items) {
          await entry.bot.tossStack(it).catch(() => {});
        }
      }
      log(`Botting: Dropped inventory items from ${active.length} bot(s)`);
      return { ok: true, status: this.getStatus() };
    }

    if (action === "stop") {
      active.forEach((entry) => {
        entry.mode = "idle";
        entry.antiAfk = false;
        try {
          entry.bot.pathfinder?.setGoal(null);
          entry.bot.clearControlStates?.();
        } catch (_) {}
      });
      log(`Botting: Stopped movement/tasks on ${active.length} bot(s)`);
      this.emitUpdate();
      return { ok: true, status: this.getStatus() };
    }

    return { ok: false, error: `Unknown swarm action "${action}"` };
  }

  getStatus() {
    const list = Array.from(this.bots.values()).map((e) => ({
      id: e.id,
      username: e.username,
      host: e.host,
      port: e.port,
      state: e.state,
      mode: e.mode,
      targetName: e.targetName,
      antiAfk: e.antiAfk,
      health: e.health,
      food: e.food,
      position: e.position,
      proxy: e.proxy,
      error: e.error,
    }));
    const onlineCount = list.filter((b) => b.state === "connected").length;
    return {
      spawning: this.spawning,
      totalCount: list.length,
      onlineCount,
      bots: list,
      proxyStatus: proxyManager.getStatus(),
    };
  }
}

const bottingManager = new BottingManager();

module.exports = {
  BottingManager,
  bottingManager,
};
