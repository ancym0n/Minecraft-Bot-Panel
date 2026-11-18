const bufferModule = require("buffer");
if (!bufferModule.SlowBuffer) {
  bufferModule.SlowBuffer = bufferModule.Buffer;
}

const { app, BrowserWindow, ipcMain, shell, clipboard } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const {
  loadLibraries,
  ensureMineflayer,
  syncLatestMineflayer,
  getRuntimeInfo,
} = require("./src/js/runtime");
const {
  equipBestWeapon,
  equipBestArmor,
  equipBestToolForBlock,
  consumeFoodSafely,
  performPvpAttack,
  setDynamicFollowGoal,
  clearPathfinderGoal,
  configureSmartMovements,
  scanNearbySigns,
  refreshChatSession,
  attachSubServerChatFix,
  attachSmartMovement,
  isHostile,
  extractCoordsFromText,
  escapeHazardsAndObstructions,
  attachRealTimeSelfPreservation,
  isLikelyNpcOrFakePlayer,
  isRealPlayerName,
  attachViaVersionAdapter,
  resolveSupportedVersion,
  resolveVersionFromKickOrError,
} = require("./src/js/botUtils");
const {
  needsViaProxyBridge,
  pingServerProtocol,
} = require("./src/js/viaAdapter");
const viaProxyBridge = require("./src/js/viaProxyBridge");
const { ollamaManager } = require("./src/js/ollamaManager");
const { aiBrain } = require("./src/js/aiBrain");
const { proxyManager } = require("./src/js/proxyManager");
const { bottingManager } = require("./src/js/bottingManager");
const { ChatQueue } = require("./src/js/chatQueue");
const { createAiTools } = require("./src/js/aiTools");
const { attachStuckWatchdog } = require("./src/js/stuckWatchdog");
const scriptStudio = require("./src/js/scriptStudio");
const { sessionLogger } = require("./src/js/sessionLogger");
const updater = require("./src/js/updater");

if (process.platform === "linux" && process.env.APPDIR) {
  const schemaDir = `${process.env.APPDIR}/usr/share/glib-2.0/schemas`;
  if (
    process.env.GSETTINGS_SCHEMA_DIR &&
    !fs.existsSync(path.join(schemaDir, "gschemas.compiled"))
  ) {
    const cleaned = process.env.GSETTINGS_SCHEMA_DIR.split(path.delimiter)
      .filter((p) => p && p !== schemaDir)
      .join(path.delimiter);
    if (cleaned) process.env.GSETTINGS_SCHEMA_DIR = cleaned;
    else delete process.env.GSETTINGS_SCHEMA_DIR;
  }
}

const ICON_PNG = path.join(__dirname, "src", "img", "logo.png");
const ICON_ICO = path.join(__dirname, "build", "logo.ico");

const ARMOR_TIERS = {
  head: [
    "netherite_helmet",
    "diamond_helmet",
    "turtle_helmet",
    "iron_helmet",
    "chainmail_helmet",
    "golden_helmet",
    "leather_helmet",
  ],
  torso: [
    "netherite_chestplate",
    "diamond_chestplate",
    "iron_chestplate",
    "chainmail_chestplate",
    "golden_chestplate",
    "leather_chestplate",
    "elytra",
  ],
  legs: [
    "netherite_leggings",
    "diamond_leggings",
    "iron_leggings",
    "chainmail_leggings",
    "golden_leggings",
    "leather_leggings",
  ],
  feet: [
    "netherite_boots",
    "diamond_boots",
    "iron_boots",
    "chainmail_boots",
    "golden_boots",
    "leather_boots",
  ],
};

const WEAPON_TIERS = [
  "netherite_sword",
  "diamond_sword",
  "iron_sword",
  "netherite_axe",
  "diamond_axe",
  "stone_sword",
  "golden_sword",
  "iron_axe",
  "wooden_sword",
  "trident",
  "mace",
];

function parseServerAddress(rawAddress) {
  const cleaned = String(rawAddress || "").trim();
  if (!cleaned) return { ip: "", port: 25565 };
  const parts = cleaned.split(":");
  const ip = parts[0].trim();
  const parsedPort = parts[1] ? parseInt(parts[1].trim(), 10) : 25565;
  return {
    ip,
    port:
      Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535
        ? parsedPort
        : 25565,
  };
}

function isDirWritable(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return false;
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function seedCustomDir(srcDir, destDir) {
  try {
    fs.mkdirSync(path.join(destDir, "scripts"), { recursive: true });
    const readmeSrc = path.join(srcDir, "scripts", "readme");
    const readmeDest = path.join(destDir, "scripts", "readme");
    if (fs.existsSync(readmeSrc) && !fs.existsSync(readmeDest)) {
      fs.copyFileSync(readmeSrc, readmeDest);
    }
    const themeSrc = path.join(srcDir, "theme.css");
    const themeDest = path.join(destDir, "theme.css");
    if (!fs.existsSync(themeDest)) {
      if (fs.existsSync(themeSrc)) {
        fs.copyFileSync(themeSrc, themeDest);
      } else {
        fs.writeFileSync(themeDest, "");
      }
    }
  } catch (_) {}
}

function resolveCustomPath(...segments) {
  if (!app.isPackaged) {
    return path.join(__dirname, "custom", ...segments);
  }

  const extraRes = path.join(process.resourcesPath || "", "custom");
  const unpacked = path.join(
    process.resourcesPath || "",
    "app.asar.unpacked",
    "custom",
  );
  const bundledCustom = fs.existsSync(extraRes)
    ? extraRes
    : fs.existsSync(unpacked)
      ? unpacked
      : extraRes;

  if (!process.env.APPIMAGE && isDirWritable(bundledCustom)) {
    return path.join(bundledCustom, ...segments);
  }

  const userCustom = path.join(app.getPath("userData"), "custom");
  seedCustomDir(bundledCustom, userCustom);
  return path.join(userCustom, ...segments);
}

function openWithCleanEnv(target) {
  if (process.platform === "linux" && process.env.APPDIR) {
    const cleanEnv = { ...process.env };
    delete cleanEnv.LD_LIBRARY_PATH;
    delete cleanEnv.GSETTINGS_SCHEMA_DIR;
    try {
      const child = spawn("xdg-open", [target], {
        detached: true,
        stdio: "ignore",
        env: cleanEnv,
      });
      child.on("error", () => {
        if (/^https?:\/\//.test(target)) shell.openExternal(target);
        else shell.openPath(target);
      });
      child.unref();
      return;
    } catch (_) {}
  }
  if (/^https?:\/\//.test(target)) {
    shell.openExternal(target);
  } else {
    shell.openPath(target);
  }
}

function escapeAttr(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatKickReason(reason) {
  if (!reason) return "Unknown reason";
  if (typeof reason === "string") {
    try {
      const parsed = JSON.parse(reason);
      if (parsed && typeof parsed === "object") {
        return parsed.text || parsed.translate || JSON.stringify(parsed);
      }
    } catch (_) {}
    return reason;
  }
  if (typeof reason === "object") {
    if (typeof reason.toMotd === "function") return reason.toMotd();
    if (typeof reason.text === "string" && reason.text) return reason.text;
    if (Array.isArray(reason.extra)) {
      return reason.extra.map((e) => e.text || "").join("");
    }
    return JSON.stringify(reason);
  }
  return String(reason);
}

function extractChatPayload(jsonMsg) {
  if (!jsonMsg) return { text: "", motd: "", segments: [] };
  if (typeof jsonMsg === "string") {
    return { text: jsonMsg, motd: jsonMsg, segments: [] };
  }

  const text =
    typeof jsonMsg.toString === "function"
      ? jsonMsg.toString()
      : String(jsonMsg.text || "");
  const motd = typeof jsonMsg.toMotd === "function" ? jsonMsg.toMotd() : text;
  const segments = [];

  function walk(node, inherited = {}) {
    if (!node) return;
    if (typeof node === "string") {
      if (node) segments.push({ text: node, ...inherited });
      return;
    }

    const currentStyle = {
      color: node.color || inherited.color || null,
      bold:
        typeof node.bold === "boolean" ? node.bold : Boolean(inherited.bold),
      italic:
        typeof node.italic === "boolean"
          ? node.italic
          : Boolean(inherited.italic),
      underlined:
        typeof node.underlined === "boolean"
          ? node.underlined
          : Boolean(inherited.underlined),
      strikethrough:
        typeof node.strikethrough === "boolean"
          ? node.strikethrough
          : Boolean(inherited.strikethrough),
      obfuscated:
        typeof node.obfuscated === "boolean"
          ? node.obfuscated
          : Boolean(inherited.obfuscated),
    };

    if (typeof node.text === "string" && node.text.length > 0) {
      segments.push({ text: node.text, ...currentStyle });
    }

    if (Array.isArray(node.extra)) {
      for (const child of node.extra) {
        walk(child, currentStyle);
      }
    }
    if (Array.isArray(node.unsigned)) {
      for (const child of node.unsigned) {
        walk(child, currentStyle);
      }
    }
  }

  try {
    walk(jsonMsg.json || jsonMsg, {});
  } catch (_) {}

  return { text, motd, segments };
}

// --- Microsoft Account Storage & Auth Helpers ---
function getMsaProfilesDir() {
  const dir = path.join(app.getPath("userData"), "msa-profiles");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

function getMsaAccountsPath() {
  return path.join(app.getPath("userData"), "msa-accounts.json");
}

function loadSavedMsaAccounts() {
  try {
    const p = getMsaAccountsPath();
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveMsaAccount(entry) {
  if (!entry || !entry.id) return loadSavedMsaAccounts();
  const accounts = loadSavedMsaAccounts();
  const cleanId = String(entry.id).trim();
  const mcName = String(entry.mcName || cleanId).trim();
  const uuid = String(entry.uuid || "").trim();
  const idx = accounts.findIndex(
    (a) =>
      a.id.toLowerCase() === cleanId.toLowerCase() || (uuid && a.uuid === uuid),
  );
  const record = {
    id: cleanId,
    mcName,
    uuid,
    lastUsed: Date.now(),
  };
  if (idx !== -1) {
    accounts[idx] = { ...accounts[idx], ...record };
  } else {
    accounts.unshift(record);
  }
  accounts.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  try {
    fs.writeFileSync(getMsaAccountsPath(), JSON.stringify(accounts, null, 2));
  } catch (_) {}
  return accounts;
}

function removeMsaAccount(accountId) {
  const cleanId = String(accountId || "").trim();
  const accounts = loadSavedMsaAccounts().filter(
    (a) => a.id.toLowerCase() !== cleanId.toLowerCase(),
  );
  try {
    fs.writeFileSync(getMsaAccountsPath(), JSON.stringify(accounts, null, 2));
  } catch (_) {}

  try {
    const hash = crypto
      .createHash("sha1")
      .update(cleanId, "binary")
      .digest("hex")
      .substr(0, 6);
    const profilesDir = getMsaProfilesDir();
    if (fs.existsSync(profilesDir)) {
      for (const f of fs.readdirSync(profilesDir)) {
        if (f.startsWith(`${hash}_`)) {
          fs.rmSync(path.join(profilesDir, f), { force: true });
        }
      }
    }
  } catch (_) {}
  return accounts;
}

let mainWindow = null;
let msaPopupWindow = null;
let activeMsaRunId = 0;
let bot = null;
let telemetryTimer = null;
let reconnectTimer = null;
let lastConnectServer = null;
let manualDisconnect = false;
let cachedSigns = [];
let lastSignsScanTime = 0;
let lastTelemetryJson = "";
let lastInventoryJson = "";

const scriptFunctions = new Map();
const activeScripts = new Set();
// Option definitions per script, for the AI Agent.
const scriptOptionDefs = new Map();

// Recent console lines and chat the AI Agent can read with read_logs.
const recentLogs = [];
// Same line with only numbers changed (status updates).
const logShape = (t) => String(t).replace(/-?\d+(\.\d+)?/g, "#");
const lastShapeAt = new Map();

function rememberLog(line) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const text = String(line)
    .replace(/§#[0-9a-fA-F]{6}|§[0-9a-fk-or]/gi, "")
    .trim();
  if (!text) return;
  // Status spam ("Hunt status: Hunting X (3.2m)" 3x a second): keep only
  // the newest copy so the AI sees real events.
  const shape = logShape(text);
  for (
    let i = recentLogs.length - 1;
    i >= Math.max(0, recentLogs.length - 6);
    i--
  ) {
    if (logShape(recentLogs[i].slice(9)) === shape) {
      recentLogs.splice(i, 1);
      break;
    }
  }
  recentLogs.push(
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${text}`,
  );
  if (recentLogs.length > 300) recentLogs.splice(0, recentLogs.length - 300);
}

function setOptionValue(option, scriptName, value) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(false);
  return mainWindow.webContents
    .executeJavaScript(
      `window.api.setOptionValue(${JSON.stringify(String(option))}, ${JSON.stringify(String(scriptName))}, ${JSON.stringify(String(value))})`,
    )
    .catch(() => false);
}

// Code execution needs the opt-in AND an explicit allowed-players list.
function aiCanRunCode(sender) {
  return (
    Boolean(ollamaManager.config.agentAllowCode) &&
    String(ollamaManager.config.agentAllowedPlayers || "").trim() !== "" &&
    ollamaManager.canCommand(sender)
  );
}

const aiChatQueue = new ChatQueue({
  getBot: () => bot,
  getConfig: () => ollamaManager.config,
  log: (text) => log(text),
});

const aiTools = createAiTools({
  getBot: () => bot,
  loadLibraries,
  log: (text) => log(text),
  onTaskDone: (evt) => handleAiTaskDone(evt),
  canRunCode: (sender) => aiCanRunCode(sender),
  getLogs: () => recentLogs.slice(),
  scripts: {
    list: () => Array.from(scriptFunctions.keys()),
    active: () => Array.from(activeScripts),
    start: (name) => startScriptByName(name),
    stop: (name) => stopScriptByName(name),
    // [{ id, label, type, choices, value }] with the panel's current values.
    options: async (name) => {
      const defs = scriptOptionDefs.get(name) || [];
      return Promise.all(
        defs.map(async (o) => ({
          id: String(o.id),
          label: String(o.label || o.id),
          type: o.type,
          choices: o.choices || [],
          value: String((await getOption(o.id, name)) ?? ""),
        })),
      );
    },
    setOption: (name, id, value) => setOptionValue(id, name, value),
  },
});
const activeControlStates = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  sneak: false,
};
let activeRadarTarget = {
  subAction: "",
  username: "",
  entityId: null,
};

let sessionState = {
  onlineMode: false,
  username: "",
  email: "",
  mcName: "",
  uuid: "",
};

function closeMsaPopup() {
  if (msaPopupWindow && !msaPopupWindow.isDestroyed()) {
    try {
      msaPopupWindow.close();
    } catch (_) {}
  }
  msaPopupWindow = null;
}

function openMsaLoginPopup(verificationUri, userCode) {
  const url = String(verificationUri || "https://www.microsoft.com/link");
  const code = String(userCode || "").trim();
  if (code) {
    try {
      clipboard.writeText(code);
    } catch (_) {}
  }

  if (msaPopupWindow && !msaPopupWindow.isDestroyed()) {
    msaPopupWindow.focus();
    msaPopupWindow.loadURL(url).catch(() => {});
    return;
  }

  const iconPath =
    process.platform === "win32" && fs.existsSync(ICON_ICO)
      ? ICON_ICO
      : ICON_PNG;

  msaPopupWindow = new BrowserWindow({
    width: 520,
    height: 680,
    minWidth: 380,
    minHeight: 500,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    autoHideMenuBar: true,
    backgroundColor: "#16131f",
    icon: iconPath,
    title: code
      ? `Microsoft Sign-In — Code: ${code} (Copied to Clipboard)`
      : "Microsoft Sign-In",
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  msaPopupWindow.setMenuBarVisibility(false);
  msaPopupWindow.loadURL(url).catch(() => {});

  if (code) {
    msaPopupWindow.webContents.on("did-finish-load", () => {
      if (!msaPopupWindow || msaPopupWindow.isDestroyed()) return;
      const safeCode = JSON.stringify(code);
      msaPopupWindow.webContents
        .executeJavaScript(
          `(() => {
            try {
              const input = document.querySelector('input[name="otc"], input#otc, input[type="tel"], input[maxlength="8"]');
              if (input && !input.value) {
                input.focus();
                input.value = ${safeCode};
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            } catch (_) {}
          })()`,
        )
        .catch(() => {});
    });
  }

  msaPopupWindow.on("closed", () => {
    msaPopupWindow = null;
  });
}

function resolveLogsDir() {
  if (!app.isPackaged && !process.env.APPIMAGE) {
    const localLogs = path.join(__dirname, "logs");
    try {
      fs.mkdirSync(localLogs, { recursive: true });
      if (isDirWritable(localLogs)) return localLogs;
    } catch (_) {}
  }
  const userLogs = path.join(app.getPath("userData"), "logs");
  try {
    fs.mkdirSync(userLogs, { recursive: true });
  } catch (_) {}
  return userLogs;
}

let lastSessionLogText = "";
let lastSessionLogTime = 0;

function pushSessionLogStatus() {
  sendToRenderer("session-log-status", sessionLogger.getStatus());
}

const SYSTEM_CHAT_RE =
  /^[A-Za-z0-9_.\-]{2,24}\s+(joined the game|left the game|lost connection|was (slain|shot|killed|blown up|pummeled|fireballed|impaled|squashed|pricked|stung|obliterated|burnt|frozen|roasted)|froze to death|fell (from|out of|off|into|too far)|drowned|burned to death|went up in flames|tried to swim in lava|suffocated in a wall|starved to death|withered away|hit the ground too hard|experienced kinetic energy|blew up|has made the advancement|has completed the challenge|has reached the goal)\b/i;

function parseChatSenderAndMessage(plainText) {
  const text = String(plainText || "")
    .replace(/§#[0-9a-fA-F]{6}|§[0-9a-fk-or]/gi, "")
    .trim();
  if (!text || SYSTEM_CHAT_RE.test(text)) return null;

  // 1. Vanilla <Player> message
  const vanillaMatch = text.match(/^<([A-Za-z0-9_.\-]{2,24})>\s+(.+)$/);
  if (vanillaMatch) {
    return { sender: vanillaMatch[1], content: vanillaMatch[2].trim() };
  }

  // 2. Whispers: "Player whispers to you: msg", "[Player -> me] msg", "From Player: msg"
  const whisperMatch =
    text.match(
      /^([A-Za-z0-9_.\-]{2,24})\s+whispers(?:\s+to\s+you)?:\s+(.+)$/i,
    ) ||
    text.match(
      /^\[?\s*(?:From\s+)?([A-Za-z0-9_.\-]{2,24})\s*(?:->|→|to)\s*(?:me|you|[A-Za-z0-9_.\-]{2,24})\s*\]?\s*:?\s+(.+)$/i,
    );
  if (whisperMatch) {
    return { sender: whisperMatch[1], content: whisperMatch[2].trim() };
  }

  // 3. Server formatted: [Rank] Player: message OR Player » message
  const sepMatch = text.match(/^([^:»>•]{2,48}?)\s*(?::|»|›|->)\s+(.+)$/);
  if (sepMatch) {
    const rawLeft = sepMatch[1]
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .trim();
    const tokens = rawLeft.split(/\s+/).filter(Boolean);
    const candidate = tokens[tokens.length - 1] || "";
    if (
      /^[A-Za-z0-9_.\-]{2,24}$/.test(candidate) &&
      ![
        "server",
        "system",
        "info",
        "queue",
        "warning",
        "console",
        "tip",
        "broadcast",
        "announcement",
      ].includes(candidate.toLowerCase())
    ) {
      return { sender: candidate, content: sepMatch[2].trim() };
    }
  }

  return null;
}

function buildLiveBotAiContext() {
  if (!bot || !bot.entity) return null;
  const pos = bot.entity.position;
  const nearbyPlayers = [];
  const knownPlayerCoords = [];
  if (bot.players) {
    for (const p of Object.values(bot.players)) {
      if (!p?.username || p.username === bot.username) continue;
      if (p.entity && isLikelyNpcOrFakePlayer(bot, p.entity)) continue;
      if (!isRealPlayerName(bot, p.username)) continue;
      if (p.entity && p.entity.position && pos) {
        const d = Math.round(p.entity.position.distanceTo(pos));
        nearbyPlayers.push(`${p.username} (${d}m)`);
        ollamaManager.updatePlayerLocation(p.username, p.entity.position);
      } else {
        const seen = bot._mcbpLastSeenPlayers?.get(p.username.toLowerCase());
        if (seen?.position) {
          knownPlayerCoords.push(
            `${p.username} (at ${Math.floor(seen.position.x)}, ${Math.floor(seen.position.y)}, ${Math.floor(seen.position.z)})`,
          );
        }
      }
    }
  }

  // Inventory & armor summary so the AI always knows what it has
  let inventorySummary = "empty";
  let armorSummary = "";
  if (bot.inventory) {
    const counts = {};
    for (const it of bot.inventory.items()) {
      counts[it.name] = (counts[it.name] || 0) + it.count;
    }
    const topItems = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([n, c]) => `${n} x${c}`);
    if (topItems.length) inventorySummary = topItems.join(", ");
    const worn = [5, 6, 7, 8, 45]
      .map((s) => bot.inventory.slots?.[s]?.name)
      .filter(Boolean);
    if (worn.length) armorSummary = worn.join(", ");
  }

  // Nearby hostile threats
  const nearbyThreats = [];
  if (bot.entities && pos) {
    for (const e of Object.values(bot.entities)) {
      if (!e || e === bot.entity || !e.position) continue;
      if (!isHostile(e)) continue;
      const d = Math.round(e.position.distanceTo(pos));
      if (d <= 18) nearbyThreats.push(`${e.name} (${d}m)`);
    }
  }

  // Time of day & weather
  let timeOfDay = "";
  const tod = bot.time?.timeOfDay;
  if (typeof tod === "number") {
    const t = tod % 24000;
    timeOfDay =
      t < 12000
        ? "day"
        : t < 13800
          ? "sunset"
          : t < 22200
            ? "night"
            : "sunrise";
  }
  const weather =
    bot.thunderState > 0 ? "thunder" : bot.isRaining ? "rain" : "clear";

  // Active background task, plan queue, or latest GearUp/module status
  let activeAiTask = aiTools?.getQueueStatus?.() || "";
  if (!activeAiTask) {
    const latestStatus = recentLogs
      .slice(-8)
      .reverse()
      .find((l) =>
        /\b(GearUp:|AIAgent Plan|AIAgent: .* started|Walking to|Following)\b/.test(
          l,
        ),
      );
    if (latestStatus) {
      activeAiTask = latestStatus.slice(9, 100);
    } else if (bot.pathfinder?.isMoving()) {
      activeAiTask = "moving to target";
    }
  }

  let lastDeath = "";
  if (bot._mcbpLastDeath && Date.now() - bot._mcbpLastDeath.at < 300000) {
    const dp = bot._mcbpLastDeath.position;
    const sec = Math.max(
      1,
      Math.round((Date.now() - bot._mcbpLastDeath.at) / 1000),
    );
    lastDeath = `at (${Math.floor(dp.x)}, ${Math.floor(dp.y)}, ${Math.floor(dp.z)}) ${sec}s ago${bot._mcbpLastDeath.cause ? ` (${bot._mcbpLastDeath.cause})` : ""}`;
  }

  return {
    username: bot.username,
    health: Math.round(bot.health ?? 20),
    food: Math.round(bot.food ?? 20),
    xpLevel: bot.experience?.level ?? 0,
    position: pos
      ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }
      : null,
    dimension: String(bot.game?.dimension || "overworld").replace(
      /^minecraft:/,
      "",
    ),
    timeOfDay,
    weather,
    heldItem: bot.heldItem
      ? `${bot.heldItem.displayName || bot.heldItem.name} x${bot.heldItem.count}`
      : "Empty hand",
    armor: armorSummary,
    inventorySummary,
    nearbyPlayers: nearbyPlayers.slice(0, 6),
    knownPlayerCoords: knownPlayerCoords.slice(0, 4),
    nearbyThreats: nearbyThreats.slice(0, 5),
    activeScripts: Array.from(activeScripts),
    activeAiTask,
    lastDeath,
  };
}

// Chat reply, or a tool-using agent run when AIAgent is on and the
// sender is allowed to give commands.
const DIRECT_REPLIES = ["ok", "on it", "sure", "okay", "got it"];

function pickDirectReply(message, result) {
  const m = String(message || "").toLowerCase();
  const r = String(result || "").toLowerCase();
  if (r.includes("walking to") || r.includes("walking toward")) {
    return ["omw", "coming", "on my way"][Math.floor(Math.random() * 3)];
  }
  if (r.includes("already next to") || r.includes("already at")) {
    return "im right here";
  }
  if (r.includes("following")) {
    return ["following u", "right behind u", "got u"][
      Math.floor(Math.random() * 3)
    ];
  }
  if (r.includes("stopped")) {
    return "stopped";
  }
  if (r.includes("queued") && r.includes("step")) {
    return "queued it up for right after this";
  }
  if (r.includes("created & started") && r.includes("plan:")) {
    return [
      "on it, starting the plan step by step",
      "bet, making it step by step",
    ][Math.floor(Math.random() * 2)];
  }
  if (r.includes("gearup") || m.includes("gear up")) {
    return ["on it, gearing up", "gearing up now", "bet, gearing up"][
      Math.floor(Math.random() * 3)
    ];
  }
  if (r.includes("mine_block") || r.includes("mined")) {
    return ["mining it now", "on it, mining"][Math.floor(Math.random() * 2)];
  }
  if (r.includes("craft_item") || r.includes("crafted")) {
    return ["crafting it rn", "making it now"][Math.floor(Math.random() * 2)];
  }
  if (r.includes("smelt_item") || r.includes("smelted")) {
    return ["smelting it now", "on it, smelting"][
      Math.floor(Math.random() * 2)
    ];
  }
  return DIRECT_REPLIES[Math.floor(Math.random() * DIRECT_REPLIES.length)];
}

async function runAiReply({
  sender,
  message,
  overrideModel = "",
  bypassCooldown = false,
  forceAgent = null,
}) {
  const useAgent = forceAgent ?? Boolean(ollamaManager.config.agentEnabled);
  const botContext = buildLiveBotAiContext();
  if (useAgent && bot && bot.entity && ollamaManager.canCommand(sender)) {
    // Clear commands run straight away, so even tiny models never get
    // them wrong. Anything else (or a failed run) goes to the model.
    const started = Date.now();
    let note = "";
    try {
      const direct = await aiTools.tryDirect(message, sender);
      if (direct?.ok) {
        const reply = pickDirectReply(message, direct.result);
        const actionItem = {
          name: "run_commands",
          args: { commands: message },
          result: direct.result,
        };
        ollamaManager.rememberExchange(sender, message, reply, [actionItem]);
        ollamaManager.recordWorldEvent(
          `Ran "${message}" for ${sender} -> ${String(direct.result).slice(0, 80)}`,
        );
        return {
          ok: true,
          reply,
          parts: [reply],
          model: "direct",
          actions: [actionItem],
          latencyMs: Date.now() - started,
        };
      }
      if (direct) note = direct.result;
    } catch (err) {
      note = `Error: ${err.message || err}`;
    }
    return ollamaManager.runAgent({
      sender,
      message: note
        ? `${message}\n[Tried running this directly and got: ${note.slice(0, 300)}. Fix it with tools or tell ${sender} briefly.]`
        : message,
      botContext,
      tools: aiTools.schemasFor(sender),
      executeTool: aiTools.executeTool,
      resolveTool: aiTools.resolveTool,
      overrideModel,
      bypassCooldown,
    });
  }
  return ollamaManager.generateChatReply({
    sender,
    message,
    botContext,
    overrideModel,
    bypassCooldown,
  });
}

// The model's private thinking goes to the console only, never to chat.
function logAiThoughts(res) {
  for (const t of res?.thoughts || []) {
    log(`AIAgent (thinking): ${String(t).replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

function logAiResult(res, target) {
  const tag = res.actions?.length ? "AIAgent" : "AIChat";
  const parts = res.parts?.length || 1;
  log(
    `${tag}: [${res.model} · ${res.latencyMs}ms${parts > 1 ? ` · ${parts} msgs` : ""}] ➙ ${target}: ${res.reply}`,
  );
  if (res.note) log(`${tag}: ${res.note}`);
  logAiThoughts(res);
  sessionLogger.record(
    "AI Reply",
    `Replied to ${target} (${res.model})`,
    `Reply: "${res.reply}"${res.actions?.length ? ` · Actions: ${res.actions.map((a) => a.name).join(", ")}` : ""} (${res.latencyMs}ms)`,
  );
  pushSessionLogStatus();
}

// When a background task fails (stuck, no path, mob survived...), let the
// agent try to fix it, at most twice per player within 90 seconds.
const aiFixAttempts = new Map();

async function handleAiTaskDone(evt) {
  if (!evt) return;
  ollamaManager.recordWorldEvent(
    `${evt.name} ${evt.ok ? "finished" : "failed"}: ${String(evt.result || "").slice(0, 90)}`,
  );
  if (evt.ok || !ollamaManager.config.agentEnabled) return;
  const currentBot = bot;
  if (!currentBot || !currentBot.entity) return;
  const sender = evt.sender || "Player";

  // Fast deterministic recovery for physical stuck/obstruction failures
  if (
    /\b(stuck|no path|interrupted|could not reach)\b/i.test(
      String(evt.result || ""),
    )
  ) {
    await escapeHazardsAndObstructions(currentBot, { log }).catch(() => {});
  }

  const now = Date.now();
  const prev = aiFixAttempts.get(sender);
  const count = prev && now - prev.at < 90000 ? prev.count : 0;
  if (count >= 2) {
    log(`AIAgent: Giving up on ${evt.name} for ${sender}`);
    return;
  }
  aiFixAttempts.set(sender, { count: count + 1, at: now });

  for (let i = 0; i < 60 && ollamaManager.isGenerating; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (bot !== currentBot) return;
  const lastTry = count + 1 >= 2;
  log(
    `AIAgent: ${evt.name} failed, ${lastTry ? "telling" : "trying to fix it for"} ${sender}`,
  );
  const res = await ollamaManager.runAgent({
    sender,
    message: `[Task report, not a chat message] Your ${evt.name} task failed: ${evt.result}. ${
      lastTry
        ? `Do not retry. Tell ${sender} in a few casual words, like a player would, that it didn't work (no technical details, no commands, no error text).`
        : `Fix it now with a different approach (e.g. unstuck, craft missing tool, another target or position${aiCanRunCode(sender) ? ", or run_code" : ""}). Never repeat the same call with the same arguments. If it is impossible, tell ${sender} briefly.`
    }`,
    botContext: buildLiveBotAiContext(),
    tools: aiTools.schemasFor(sender),
    executeTool: aiTools.executeTool,
    resolveTool: aiTools.resolveTool,
    bypassCooldown: true,
    remember: false,
  });
  if (bot !== currentBot || !res.ok) return;
  logAiResult(res, sender);
  aiChatQueue.send(res.parts?.length ? res.parts : [res.reply]);
}

// Ads, server broadcasts and long promo lines are not conversation.
const AD_RE =
  /\/visit\b|\[ad\]|discord\.gg|https?:\/\/|www\.|\.(com|net|org|gg)\b|\bstore\b|\bshop\b|\bvote\b|\bgiveaway\b|\bper hour\b|\/hr\b|\bbuying\b|\bselling\b/i;

async function handleAiChat(currentBot, text, senderUuid, position) {
  const cleanRaw = String(text || "").trim();
  if (position === "game_info") return;
  if (SYSTEM_CHAT_RE.test(cleanRaw)) {
    // Record notable system events (deaths, joins) in world memory without replying in chat
    if (
      currentBot.username &&
      cleanRaw.toLowerCase().startsWith(currentBot.username.toLowerCase())
    ) {
      ollamaManager.recordWorldEvent(cleanRaw);
      if (currentBot._mcbpLastDeath && !currentBot._mcbpLastDeath.cause) {
        currentBot._mcbpLastDeath.cause = cleanRaw;
      }
    }
    return;
  }
  const selfUuid = currentBot.player?.uuid || currentBot.entity?.uuid;
  if (senderUuid && selfUuid && senderUuid === selfUuid) return;
  let parsed = parseChatSenderAndMessage(text, currentBot.username);
  // Servers that hide the name in chat still send who wrote it.
  const byUuid = senderUuid
    ? Object.values(currentBot.players || {}).find(
        (p) => p.uuid && p.uuid === senderUuid,
      )?.username
    : null;
  if (byUuid) {
    if (!parsed) parsed = { sender: byUuid, content: String(text).trim() };
    else if (parsed.sender === "Player") parsed.sender = byUuid;
  }
  if (!parsed) return;
  const me = String(currentBot.username || "").toLowerCase();
  if (parsed.sender.toLowerCase() === me) return;
  // Only real players (in the tab list, not NPCs or fake players) get answers
  const tab = Object.keys(currentBot.players || {});
  if (tab.length) {
    const real = tab.find(
      (u) => u.toLowerCase() === parsed.sender.toLowerCase(),
    );
    if (!real || !isRealPlayerName(currentBot, real)) return;
    parsed.sender = real;
  }

  // Always observe real player chat and extract any mentioned coordinates into memory
  const coords = extractCoordsFromText(parsed.content);
  ollamaManager.observePlayerChat(parsed.sender, parsed.content, { coords });
  if (coords && currentBot.entity?.position) {
    try {
      const { Vec3 } = loadLibraries();
      if (!currentBot._mcbpLastSeenPlayers)
        currentBot._mcbpLastSeenPlayers = new Map();
      currentBot._mcbpLastSeenPlayers.set(parsed.sender.toLowerCase(), {
        username: parsed.sender,
        position: new Vec3(
          coords.x,
          coords.y ?? Math.floor(currentBot.entity.position.y),
          coords.z,
        ),
        at: Date.now(),
      });
    } catch (_) {}
  }

  if (aiChatQueue.isBusy()) return;
  const addressed =
    Boolean(me) &&
    new RegExp(
      `(^|[^a-z0-9_])@?${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`,
      "i",
    ).test(parsed.content);
  const nick = me.length >= 5 ? me.slice(0, 4) : "";
  const byNick =
    Boolean(nick) &&
    new RegExp(
      `(^|[^a-z0-9_])${nick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z0-9_]*`,
      "i",
    ).test(parsed.content);
  const trusted = String(ollamaManager.config.agentAllowedPlayers || "")
    .toLowerCase()
    .split(/[,\s]+/)
    .includes(parsed.sender.toLowerCase());
  const talkingToMe = addressed || byNick || trusted;
  if (!talkingToMe && AD_RE.test(parsed.content)) return;
  const canCommandSender =
    Boolean(ollamaManager.config.agentEnabled) &&
    ollamaManager.canCommand(parsed.sender);
  const liveCtx = buildLiveBotAiContext();
  if (
    !canCommandSender &&
    !ollamaManager.shouldRespondToChat({
      sender: parsed.sender,
      message: parsed.content,
      botUsername: currentBot.username,
      botContext: liveCtx,
    })
  ) {
    return;
  }
  // In "reply to all" mode, only messages that talk to the bot can make it
  // do things; everything else is just conversation.
  const allMode = ollamaManager.config.triggerMode === "all";
  const res = await runAiReply({
    sender: parsed.sender,
    message: parsed.content,
    forceAgent: allMode && !talkingToMe ? false : null,
  });
  if (bot !== currentBot) return;
  if (!res.ok) {
    logAiThoughts(res);
    if (res.error && !res.silent) log(`AIChat error: ${res.error}`);
    return;
  }
  logAiResult(res, parsed.sender);
  await aiChatQueue.send(res.parts?.length ? res.parts : [res.reply]);
}

// Server replies that matter to the bot: protected areas and chat checks.
const DENIAL_RE =
  /(can'?t|cannot|not allowed to|aren'?t allowed to|no permission to|don'?t have permission to)\s+(break|place|build|pvp|attack|hit|harm|hurt|damage|use|interact|open|mine|dig)\b|you can'?t (do that|pvp|break that block) here|spawn protection/i;
const PVP_DENIAL_RE =
  /(can'?t|cannot|not allowed to|aren'?t allowed to|no permission to)\s+(pvp|attack|hit|harm|hurt|damage|fight)\b|pvp is (disabled|off)|you can'?t pvp here|in a no[- ]pvp/i;
const BUILD_DENIAL_RE =
  /(can'?t|cannot|not allowed to|aren'?t allowed to|no permission to|don'?t have permission to)\s+(break|place|build|mine|dig|destroy)\b|you can'?t break that block here|spawn protection/i;
const MOVE_TO_CHAT_RE =
  /move before (using )?chat|cannot chat until you move|must move before|move to (be able to )?chat/i;
const MISSING_CHAT_KEY_RE =
  /missing profile public key|chat disabled due to missing|chat session not initialized/i;

function handleServerNotice(currentBot, rawText) {
  const text = String(rawText || "");
  const now = Date.now();
  if (MISSING_CHAT_KEY_RE.test(text)) {
    if (now - (currentBot._mcbpLastKeyRefreshAt || 0) > 3000) {
      currentBot._mcbpLastKeyRefreshAt = now;
      const refreshed = refreshChatSession(currentBot, { log: (t) => log(t) });
      if (refreshed) {
        setTimeout(() => {
          if (bot === currentBot) aiChatQueue.resendLast();
        }, 250);
      }
    }
  }
  if (DENIAL_RE.test(text)) {
    currentBot._mcbpDenied = { text: text.slice(0, 160), at: now };
  }
  if (PVP_DENIAL_RE.test(text)) {
    currentBot._mcbpNoPvpUntil = now + 12000;
    currentBot._mcbpNoPvpPos = currentBot.entity?.position?.clone() || null;
    if (now - (currentBot._mcbpLastNoPvpLogAt || 0) > 8000) {
      currentBot._mcbpLastNoPvpLogAt = now;
      const p = currentBot.entity?.position;
      const coords = p
        ? `at (${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`
        : "";
      log(`Protection: Server blocked PvP ${coords} — pausing PvP attacks`);
      sessionLogger.record(
        "Movement",
        "No-PvP Zone Detected",
        `${text.slice(0, 120)} ${coords}`.trim(),
      );
      pushSessionLogStatus();
    }
  }
  if (BUILD_DENIAL_RE.test(text)) {
    currentBot._mcbpProtectedZoneUntil = now + 30000;
    currentBot._mcbpProtectedZonePos =
      currentBot.entity?.position?.clone() || null;
    if (currentBot.pathfinder?.movements) {
      currentBot.pathfinder.movements.canDig = false;
      currentBot.pathfinder.movements.allow1by1towers = false;
    }
    if (now - (currentBot._mcbpLastBuildDenyLogAt || 0) > 8000) {
      currentBot._mcbpLastBuildDenyLogAt = now;
      const p = currentBot.entity?.position;
      const coords = p
        ? `at (${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`
        : "";
      log(
        `Protection: Server blocked block breaking/building ${coords} — disabling pathfinder digging`,
      );
      sessionLogger.record(
        "Movement",
        "Protected Area (No Break/Build)",
        `${text.slice(0, 120)} ${coords}`.trim(),
      );
      pushSessionLogStatus();
    }
  }
  if (MOVE_TO_CHAT_RE.test(text)) {
    // Step a little so the anti-bot check passes, then resend.
    try {
      currentBot.setControlState("forward", true);
      currentBot.setControlState("jump", true);
      setTimeout(() => {
        try {
          currentBot.setControlState("forward", false);
          currentBot.setControlState("jump", false);
        } catch (_) {}
        if (bot === currentBot) aiChatQueue.resendLast();
      }, 450);
    } catch (_) {}
  }
}

// When the stuck watchdog gives up for a while, let the AI look at it.
// Its thinking and actions go to the console only.
async function askAiAboutStuck(currentBot, { target }) {
  if (bot !== currentBot) return;
  await escapeHazardsAndObstructions(currentBot, { log }).catch(() => {});
  if (!ollamaManager.config.agentEnabled) return;
  if (ollamaManager.isGenerating) return;
  const owner =
    String(ollamaManager.config.agentAllowedPlayers || "")
      .split(/[,\s]+/)
      .filter(Boolean)[0] ||
    sessionState.mcName ||
    "owner";
  log(`AIAgent: Bot is stuck going to ${target}, thinking about it`);
  const res = await ollamaManager
    .runAgent({
      sender: owner,
      message: `[Stuck report, not chat] You have been stuck for a while trying to reach ${target}. Recent console:\n${recentLogs.slice(-10).join("\n").slice(-1200)}\nGet unstuck with tools (unstuck, jump, walk a direction, mine the block in the way, go around, or stop if it's unreachable). Never invent coordinates. Do not chat.`,
      botContext: buildLiveBotAiContext(),
      tools: aiTools.schemasFor(owner),
      executeTool: aiTools.executeTool,
      resolveTool: aiTools.resolveTool,
      bypassCooldown: true,
      remember: false,
    })
    .catch((err) => ({ ok: false, error: err.message }));
  if (bot !== currentBot) return;
  logAiThoughts(res);
  log(`AIAgent unstuck: ${res.reply || res.error || "no idea"}`);
}

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function log(text) {
  const str = String(text);
  sendToRenderer("log", str);
  rememberLog(str);
  const now = Date.now();
  const shape = logShape(str);
  // Session log: one copy of a repeating status line per 15s.
  if (now - (lastShapeAt.get(shape) || 0) < 15000) return;
  lastShapeAt.set(shape, now);
  if (lastShapeAt.size > 500) lastShapeAt.clear();
  if (str !== lastSessionLogText || now - lastSessionLogTime > 2000) {
    lastSessionLogText = str;
    lastSessionLogTime = now;
    sessionLogger.record("Console", "Log Entry", str);
    pushSessionLogStatus();
  }
}

function clearLog(text) {
  sendToRenderer("clear-log", String(text));
}

function applyCustomTheme() {
  try {
    const themePath = resolveCustomPath("theme.css");
    if (fs.existsSync(themePath)) {
      const css = fs.readFileSync(themePath, "utf8").trim();
      if (css) {
        sendToRenderer("custom-theme", css);
      }
    }
  } catch (_) {}
}

function getOption(option, scriptName) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve("");
  }
  const safeOpt = JSON.stringify(String(option));
  const safeScript = JSON.stringify(String(scriptName));
  return mainWindow.webContents
    .executeJavaScript(`window.api.getOptionValue(${safeOpt}, ${safeScript})`)
    .catch(() => "");
}

// --- Live Telemetry & Inventory Snapshot Helpers ---
function detectItemTier(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("netherite")) return "netherite";
  if (n.includes("diamond")) return "diamond";
  if (n.includes("emerald")) return "emerald";
  if (n.includes("gold") || n.includes("golden")) return "gold";
  if (n.includes("iron") || n.includes("chainmail")) return "iron";
  if (n.includes("copper")) return "copper";
  if (n.includes("amethyst") || n.includes("ender") || n.includes("chorus"))
    return "amethyst";
  if (n.includes("redstone")) return "redstone";
  if (n.includes("lapis")) return "lapis";
  if (n.includes("stone") || n.includes("cobble") || n.includes("deepslate"))
    return "stone";
  if (
    n.includes("wood") ||
    n.includes("oak") ||
    n.includes("spruce") ||
    n.includes("birch") ||
    n.includes("jungle") ||
    n.includes("acacia") ||
    n.includes("cherry") ||
    n.includes("mangrove") ||
    n.includes("bamboo") ||
    n.includes("leather")
  ) {
    return "wood";
  }
  return "";
}

function categorizeItem(name) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/^minecraft:/, "");
  if (!n) return "empty";

  // Weapons & Ranged
  if (n === "mace") return "mace";
  if (n === "trident") return "trident";
  if (n.endsWith("_sword")) return "sword";
  if (n.endsWith("_axe")) return "axe";
  if (n === "bow" || n === "crossbow") return "ranged";
  if (
    n === "arrow" ||
    n.endsWith("_arrow") ||
    n === "firework_rocket" ||
    n === "wind_charge"
  ) {
    return "ammo";
  }

  // Tools
  if (n.endsWith("_pickaxe")) return "pickaxe";
  if (n.endsWith("_shovel")) return "shovel";
  if (n.endsWith("_hoe")) return "hoe";
  if (n.includes("fishing_rod")) return "fishing";
  if (
    n === "shears" ||
    n === "flint_and_steel" ||
    n === "brush" ||
    n === "spyglass" ||
    n === "lead" ||
    n === "name_tag" ||
    n === "saddle" ||
    n === "goat_horn"
  ) {
    return "tool";
  }

  // Armor & Offhand
  if (n === "totem_of_undying") return "totem";
  if (n === "shield") return "shield";
  if (n === "elytra") return "elytra";
  if (
    n.endsWith("_helmet") ||
    n === "turtle_helmet" ||
    n === "carved_pumpkin"
  ) {
    return "helmet";
  }
  if (
    n.endsWith("_chestplate") ||
    n.endsWith("_horse_armor") ||
    n === "wolf_armor"
  ) {
    return "chestplate";
  }
  if (n.endsWith("_leggings")) return "leggings";
  if (n.endsWith("_boots")) return "boots";

  // Potions, Bottles & Brews
  if (
    n.includes("potion") ||
    n === "dragon_breath" ||
    n === "experience_bottle" ||
    n === "honey_bottle" ||
    n === "ominous_bottle" ||
    n === "glass_bottle"
  ) {
    return "potion";
  }

  // Buckets
  if (n.endsWith("_bucket") || n === "bucket") return "bucket";

  // Food & Consumables
  if (n.includes("golden_apple") || n === "enchanted_golden_apple") {
    return "gapple";
  }
  if (
    n.includes("apple") ||
    n.includes("cooked") ||
    n.includes("bread") ||
    n.includes("carrot") ||
    n.includes("potato") ||
    n.includes("stew") ||
    n.includes("soup") ||
    n.includes("steak") ||
    n.includes("beef") ||
    n.includes("porkchop") ||
    n.includes("mutton") ||
    n.includes("chicken") ||
    n.includes("rabbit") ||
    n.includes("cod") ||
    n.includes("salmon") ||
    n.includes("tropical_fish") ||
    n.includes("pufferfish") ||
    n.includes("pie") ||
    n.includes("berries") ||
    n.includes("melon") ||
    n.includes("cookie") ||
    n.includes("cake") ||
    n === "dried_kelp" ||
    n === "chorus_fruit" ||
    n === "rotten_flesh"
  ) {
    return "food";
  }

  // Navigation, Teleport & Server GUI Selectors
  if (n.includes("compass") || n === "clock" || n.includes("map")) {
    return "compass";
  }
  if (
    n === "ender_pearl" ||
    n === "ender_eye" ||
    n === "nether_star" ||
    n === "heart_of_the_sea" ||
    n === "beacon"
  ) {
    return "pearl";
  }
  if (n.includes("book") || n === "paper" || n.endsWith("_banner_pattern")) {
    return "book";
  }
  if (n.endsWith("_bed")) return "bed";
  if (n.includes("key")) return "key";
  if (n.includes("music_disc") || n.startsWith("disc_fragment")) return "disc";
  if (n.endsWith("_head") || n.endsWith("_skull")) return "skull";

  // Explosives & Fire
  if (
    n === "tnt" ||
    n === "tnt_minecart" ||
    n === "end_crystal" ||
    n === "fire_charge" ||
    n === "gunpowder" ||
    n === "blaze_rod" ||
    n === "blaze_powder" ||
    n === "breeze_rod"
  ) {
    return "explosive";
  }

  // Containers, Boats & Minecarts
  if (
    n.includes("chest") ||
    n.includes("shulker_box") ||
    n === "barrel" ||
    n.includes("bundle")
  ) {
    return "container";
  }
  if (n.endsWith("_boat") || n.endsWith("_raft")) return "boat";
  if (n.includes("minecart")) return "minecart";

  // Minerals, Gems & Ingots
  if (n.endsWith("_ore") || n === "ancient_debris" || n.startsWith("raw_")) {
    return "ore";
  }
  if (
    n === "diamond" ||
    n === "emerald" ||
    n === "amethyst_shard" ||
    n === "quartz" ||
    n === "prismarine_shard" ||
    n === "prismarine_crystals" ||
    n === "echo_shard"
  ) {
    return "gem";
  }
  if (
    n.endsWith("_ingot") ||
    n.endsWith("_nugget") ||
    n === "netherite_scrap" ||
    n === "coal" ||
    n === "charcoal" ||
    n === "lapis_lazuli" ||
    n === "redstone" ||
    n === "glowstone_dust"
  ) {
    return "mineral";
  }

  // Redstone & Mechanisms
  if (
    n.includes("piston") ||
    n === "observer" ||
    n === "dispenser" ||
    n === "dropper" ||
    n === "hopper" ||
    n === "repeater" ||
    n === "comparator" ||
    n === "lever" ||
    n.endsWith("_button") ||
    n.endsWith("_pressure_plate") ||
    n === "target" ||
    n === "daylight_detector" ||
    n === "redstone_lamp" ||
    n === "redstone_torch" ||
    n.includes("rail")
  ) {
    return "redstone";
  }

  // Workstations & Utility Blocks
  if (
    n === "crafting_table" ||
    n === "crafter" ||
    n.includes("furnace") ||
    n === "smoker" ||
    n.includes("anvil") ||
    n === "grindstone" ||
    n === "smithing_table" ||
    n === "stonecutter" ||
    n === "loom" ||
    n === "cartography_table" ||
    n === "fletching_table" ||
    n === "brewing_stand" ||
    n === "enchanting_table" ||
    n === "cauldron" ||
    n === "lectern" ||
    n === "jukebox" ||
    n === "note_block" ||
    n === "bell" ||
    n === "respawn_anchor" ||
    n === "lodestone"
  ) {
    return "workstation";
  }

  // Lighting, Signs, Doors
  if (
    n.includes("torch") ||
    n.includes("lantern") ||
    n === "glowstone" ||
    n === "shroomlight" ||
    n.endsWith("_froglight") ||
    n.endsWith("_candle") ||
    n === "candle" ||
    n === "end_rod" ||
    n.includes("campfire")
  ) {
    return "light";
  }
  if (n.includes("sign") || n.endsWith("_banner")) return "sign";
  if (n.endsWith("_door") || n.endsWith("_trapdoor") || n.endsWith("_gate")) {
    return "door";
  }

  // Crops, Seeds, Plants & Nature
  if (
    n.includes("seeds") ||
    n === "wheat" ||
    n === "sugar_cane" ||
    n === "bamboo" ||
    n === "cocoa_beans" ||
    n === "nether_wart" ||
    n === "kelp" ||
    n === "cactus" ||
    n.endsWith("_sapling") ||
    n === "propagule" ||
    n === "bone_meal" ||
    n === "bone"
  ) {
    return "crop";
  }
  if (
    n.endsWith("_leaves") ||
    n.includes("flower") ||
    n.includes("tulip") ||
    n === "dandelion" ||
    n === "poppy" ||
    n === "blue_orchid" ||
    n === "allium" ||
    n === "azure_bluet" ||
    n === "oxeye_daisy" ||
    n === "cornflower" ||
    n === "lily_of_the_valley" ||
    n === "wither_rose" ||
    n === "sunflower" ||
    n === "lilac" ||
    n === "rose_bush" ||
    n === "peony" ||
    n === "torchflower" ||
    n === "pitcher_plant" ||
    n.includes("mushroom") ||
    n.includes("fungus") ||
    n.includes("fern") ||
    n.includes("azalea") ||
    n.includes("vine") ||
    n.includes("moss") ||
    n === "lily_pad"
  ) {
    return "plant";
  }

  // Mob Drops, Spawn Eggs & Misc Items
  if (
    n.endsWith("_spawn_egg") ||
    n === "egg" ||
    n === "turtle_egg" ||
    n === "sniffer_egg"
  ) {
    return "egg";
  }
  if (
    n === "stick" ||
    n === "string" ||
    n === "feather" ||
    n === "leather" ||
    n === "rabbit_hide" ||
    n === "slime_ball" ||
    n === "magma_cream" ||
    n === "ghast_tear" ||
    n === "phantom_membrane" ||
    n === "spider_eye" ||
    n === "fermented_spider_eye" ||
    n === "ender_EYE" ||
    n === "shulker_shell" ||
    n === "nautilus_shell" ||
    n.includes("scute") ||
    n === "ink_sac" ||
    n === "glow_ink_sac" ||
    n.endsWith("_dye") ||
    n === "clay_ball" ||
    n === "brick" ||
    n === "nether_brick" ||
    n === "resin_brick" ||
    n === "flint" ||
    n === "bowl" ||
    n === "sugar" ||
    n.endsWith("_pottery_sherd") ||
    n.endsWith("_smithing_template")
  ) {
    return "material";
  }

  // Wood, Logs & Planks
  if (
    n.endsWith("_log") ||
    n.endsWith("_wood") ||
    n.endsWith("_stem") ||
    n.endsWith("_hyphae") ||
    n.endsWith("_planks") ||
    n === "bamboo_block"
  ) {
    return "wood";
  }

  // Glass, Wool & Decorative Blocks
  if (n.includes("glass")) return "glass";
  if (
    n.endsWith("_wool") ||
    n.endsWith("_carpet") ||
    n.endsWith("_concrete") ||
    n.endsWith("_concrete_powder") ||
    n.endsWith("_terracotta")
  ) {
    return "decor";
  }

  return "block";
}

function parseRichComponentText(raw) {
  if (!raw) return "";
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      try {
        return parseRichComponentText(JSON.parse(trimmed));
      } catch (_) {}
    }
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw.map(parseRichComponentText).join("");
  }
  if (typeof raw === "object") {
    if (typeof raw.toMotd === "function") return raw.toMotd();
    if ("value" in raw && Object.keys(raw).length <= 2 && "type" in raw) {
      return parseRichComponentText(raw.value);
    }
    const colorMap = {
      black: "§0",
      dark_blue: "§1",
      dark_green: "§2",
      dark_aqua: "§3",
      dark_red: "§4",
      dark_purple: "§5",
      gold: "§6",
      gray: "§7",
      dark_gray: "§8",
      blue: "§9",
      green: "§a",
      aqua: "§b",
      red: "§c",
      light_purple: "§d",
      yellow: "§e",
      white: "§f",
    };
    let prefix = "";
    const c = raw.color?.value || raw.color;
    if (typeof c === "string") {
      if (colorMap[c.toLowerCase()]) prefix += colorMap[c.toLowerCase()];
      else if (/^#[0-9a-f]{6}$/i.test(c)) prefix += `§${c}`;
    }
    if (raw.bold === true || raw.bold?.value === 1) prefix += "§l";
    if (raw.italic === true || raw.italic?.value === 1) prefix += "§o";
    if (raw.underlined === true || raw.underlined?.value === 1) prefix += "§n";
    if (raw.strikethrough === true || raw.strikethrough?.value === 1) {
      prefix += "§m";
    }
    let body = "";
    if (typeof raw.text === "string") body += raw.text;
    else if (typeof raw.text?.value === "string") body += raw.text.value;
    else if (typeof raw.translate === "string") body += raw.translate;
    let extraStr = "";
    const extraArr = Array.isArray(raw.extra)
      ? raw.extra
      : Array.isArray(raw.extra?.value?.value)
        ? raw.extra.value.value
        : null;
    if (extraArr) {
      extraStr = extraArr.map(parseRichComponentText).join("");
    }
    return `${prefix}${body}${extraStr}`;
  }
  return String(raw);
}

function extractItemCustomMeta(item) {
  if (!item) return { customName: "", lore: [] };
  let customName = "";
  const lore = [];

  try {
    if (item.customName) {
      customName = parseRichComponentText(item.customName);
    } else if (item.nbt?.value?.display?.value?.Name?.value) {
      customName = parseRichComponentText(
        item.nbt.value.display.value.Name.value,
      );
    }
  } catch (_) {}

  try {
    const rawLore =
      item.customLore || item.nbt?.value?.display?.value?.Lore?.value?.value;
    if (Array.isArray(rawLore)) {
      for (const line of rawLore) {
        const parsed = parseRichComponentText(line).trim();
        if (parsed) lore.push(parsed);
      }
    }
  } catch (_) {}

  return { customName, lore };
}

function serializeItem(item, fallbackSlot = null) {
  if (!item) return null;
  const maxDurability = item.maxDurability || 0;
  const durabilityUsed = item.durabilityUsed || 0;
  const durabilityLeft =
    maxDurability > 0 ? Math.max(0, maxDurability - durabilityUsed) : null;
  const durabilityPct =
    maxDurability > 0
      ? Math.max(
          0,
          Math.min(100, Math.round((durabilityLeft / maxDurability) * 100)),
        )
      : null;

  const { customName, lore } = extractItemCustomMeta(item);
  const plainCustom = customName
    .replace(/§#[0-9a-fA-F]{6}|§[0-9a-fk-or]/gi, "")
    .trim();

  return {
    slot: typeof item.slot === "number" ? item.slot : fallbackSlot,
    name: item.name,
    displayName: plainCustom || item.displayName || item.name,
    customName: customName || item.displayName || item.name,
    lore,
    count: item.count || 1,
    type: item.type,
    category: categorizeItem(item.name),
    tier: detectItemTier(item.name),
    maxDurability,
    durabilityLeft,
    durabilityPct,
  };
}

const BOSS_ENTITIES = new Set([
  "ender_dragon",
  "wither",
  "warden",
  "elder_guardian",
]);

const HOSTILE_ENTITIES = new Set([
  "zombie",
  "zombie_villager",
  "husk",
  "drowned",
  "skeleton",
  "stray",
  "bogged",
  "wither_skeleton",
  "creeper",
  "witch",
  "slime",
  "magma_cube",
  "phantom",
  "blaze",
  "ghast",
  "hoglin",
  "zoglin",
  "piglin_brute",
  "pillager",
  "vindicator",
  "evoker",
  "ravager",
  "vex",
  "illusioner",
  "guardian",
  "shulker",
  "silverfish",
  "endermite",
  "breeze",
  "creaking",
]);

const NEUTRAL_ENTITIES = new Set([
  "enderman",
  "spider",
  "cave_spider",
  "piglin",
  "zombified_piglin",
  "zombie_pigman",
  "wolf",
  "iron_golem",
  "snow_golem",
  "bee",
  "polar_bear",
  "panda",
  "llama",
  "trader_llama",
  "goat",
  "dolphin",
  "pufferfish",
]);

const NPC_ENTITIES = new Set(["villager", "wandering_trader", "npc", "allay"]);

const VEHICLE_ENTITIES = new Set([
  "boat",
  "chest_boat",
  "oak_boat",
  "spruce_boat",
  "birch_boat",
  "jungle_boat",
  "acacia_boat",
  "cherry_boat",
  "dark_oak_boat",
  "mangrove_boat",
  "bamboo_raft",
  "oak_chest_boat",
  "spruce_chest_boat",
  "birch_chest_boat",
  "jungle_chest_boat",
  "acacia_chest_boat",
  "cherry_chest_boat",
  "dark_oak_chest_boat",
  "mangrove_chest_boat",
  "bamboo_chest_raft",
  "minecart",
  "chest_minecart",
  "hopper_minecart",
  "tnt_minecart",
  "furnace_minecart",
  "command_block_minecart",
  "end_crystal",
]);

const IGNORED_OBJECT_ENTITIES = new Set([
  "item",
  "experience_orb",
  "xp_orb",
  "arrow",
  "spectral_arrow",
  "trident",
  "snowball",
  "egg",
  "ender_pearl",
  "eye_of_ender",
  "potion",
  "experience_bottle",
  "fishing_bobber",
  "fireball",
  "small_fireball",
  "dragon_fireball",
  "wither_skull",
  "wind_charge",
  "breeze_wind_charge",
  "shulker_bullet",
  "llama_spit",
  "evoker_fangs",
  "area_effect_cloud",
  "lightning_bolt",
  "falling_block",
  "tnt",
  "firework_rocket",
  "leash_knot",
  "item_frame",
  "glow_item_frame",
  "painting",
  "marker",
  "interaction",
  "text_display",
  "block_display",
  "item_display",
]);

function humanizeEntityName(rawName) {
  const clean = String(rawName || "entity")
    .replace(/^minecraft:/i, "")
    .replace(/_/g, " ")
    .trim();
  if (!clean) return "Entity";
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
}

function classifyEntity(e) {
  const name = String(e.name || e.username || "")
    .toLowerCase()
    .replace(/^minecraft:/, "");
  const kind = String(e.kind || "").toLowerCase();
  const type = String(e.type || "").toLowerCase();

  if (type === "player") {
    if (bot && e !== bot.entity && isLikelyNpcOrFakePlayer(bot, e)) {
      const cleanNpcName = String(e.username || e.name || "NPC")
        .replace(/§[0-9a-fk-or]/gi, "")
        .trim();
      return {
        category: "npc",
        hostile: false,
        displayName: `[NPC] ${cleanNpcName || "FakePlayer"}`,
      };
    }
    return null;
  }

  if (type === "orb" || IGNORED_OBJECT_ENTITIES.has(name)) {
    return null;
  }

  let customLabel = "";
  if (typeof e.customName === "string" && e.customName.trim()) {
    customLabel = parseRichComponentText(e.customName)
      .replace(/§#[0-9a-fA-F]{6}|§[0-9a-fk-or]/gi, "")
      .trim();
  } else if (Array.isArray(e.metadata)) {
    const rawMetaName = e.metadata[2];
    if (rawMetaName && typeof rawMetaName === "string") {
      customLabel = parseRichComponentText(rawMetaName)
        .replace(/§#[0-9a-fA-F]{6}|§[0-9a-fk-or]/gi, "")
        .trim();
    }
  }

  if (name === "armor_stand") {
    if (!customLabel) return null;
    return {
      category: "npc",
      hostile: false,
      displayName: customLabel,
    };
  }

  if (
    VEHICLE_ENTITIES.has(name) ||
    name.endsWith("_boat") ||
    name.endsWith("_raft") ||
    name.endsWith("_minecart")
  ) {
    return {
      category: "vehicle",
      hostile: false,
      displayName: customLabel || humanizeEntityName(name),
    };
  }

  if (
    type === "object" &&
    !HOSTILE_ENTITIES.has(name) &&
    !BOSS_ENTITIES.has(name)
  ) {
    return null;
  }

  let category = "passive";
  let hostile = false;

  if (BOSS_ENTITIES.has(name)) {
    category = "boss";
    hostile = true;
  } else if (HOSTILE_ENTITIES.has(name) || kind.includes("hostile")) {
    category = "hostile";
    hostile = true;
  } else if (NEUTRAL_ENTITIES.has(name)) {
    category = "neutral";
    hostile = false;
  } else if (NPC_ENTITIES.has(name) || type === "villager") {
    category = "npc";
    hostile = false;
  }

  const rawDisp =
    e.displayName &&
    !["mob", "object", "other", "living", "animal", "hostile"].includes(
      String(e.displayName).toLowerCase(),
    )
      ? e.displayName
      : humanizeEntityName(name);

  return {
    category,
    hostile,
    displayName: customLabel ? `${customLabel} (${rawDisp})` : rawDisp,
  };
}

function buildInventorySnapshot() {
  if (!bot || !bot.inventory || !Array.isArray(bot.inventory.slots)) {
    return {
      connected: false,
      container: null,
      armor: {
        head: null,
        torso: null,
        legs: null,
        feet: null,
        offhand: null,
      },
      main: Array.from({ length: 27 }, (_, i) => ({
        slot: i + 9,
        item: null,
      })),
      hotbar: Array.from({ length: 9 }, (_, i) => ({
        slot: i + 36,
        hotbarIndex: i,
        item: null,
      })),
      quickBarSlot: 0,
      heldItem: null,
      occupiedCount: 0,
    };
  }

  let container = null;
  if (bot.currentWindow && Array.isArray(bot.currentWindow.slots)) {
    const win = bot.currentWindow;
    const invStart =
      typeof win.inventoryStart === "number"
        ? win.inventoryStart
        : Math.max(0, win.slots.length - 36);
    const slotCount = Math.max(0, Math.min(invStart, win.slots.length));
    const titleStr =
      parseRichComponentText(win.title).trim() ||
      String(win.type || "Container");
    const containerSlots = [];
    for (let s = 0; s < slotCount; s++) {
      containerSlots.push({
        slot: s,
        item: serializeItem(win.slots[s], s),
      });
    }
    container = {
      id: win.id,
      type: String(win.type || "container"),
      title: titleStr,
      slotCount,
      slots: containerSlots,
    };
  }

  const slots = bot.inventory.slots;
  const main = [];
  let occupiedCount = 0;

  for (let s = 9; s <= 35; s++) {
    const serialized = serializeItem(slots[s], s);
    if (serialized) occupiedCount++;
    main.push({ slot: s, item: serialized });
  }

  const hotbar = [];
  for (let s = 36; s <= 44; s++) {
    const serialized = serializeItem(slots[s], s);
    if (serialized) occupiedCount++;
    hotbar.push({
      slot: s,
      hotbarIndex: s - 36,
      item: serialized,
    });
  }

  return {
    connected: true,
    container,
    armor: {
      head: serializeItem(slots[5], 5),
      torso: serializeItem(slots[6], 6),
      legs: serializeItem(slots[7], 7),
      feet: serializeItem(slots[8], 8),
      offhand: serializeItem(slots[45], 45),
    },
    main,
    hotbar,
    quickBarSlot: bot.quickBarSlot ?? 0,
    heldItem: serializeItem(bot.heldItem),
    occupiedCount,
  };
}

function buildTelemetrySnapshot() {
  if (!bot || !bot.entity) {
    return {
      connected: false,
      username: sessionState.mcName || sessionState.username || "",
      health: 0,
      food: 0,
      saturation: 0,
      xpLevel: 0,
      xpProgress: 0,
      position: null,
      yaw: 0,
      pitch: 0,
      dimension: "—",
      gameMode: "—",
      ping: 0,
      quickBarSlot: 0,
      heldItem: null,
      controls: { ...activeControlStates },
      radarTarget: { ...activeRadarTarget },
      nearbyPlayers: [],
      nearbyEntities: [],
      nearbySigns: [],
    };
  }

  const now = Date.now();
  if (now - lastSignsScanTime > 1200) {
    lastSignsScanTime = now;
    cachedSigns = scanNearbySigns(bot, { maxDistance: 24, maxCount: 16 });
  }

  const pos = bot.entity.position;
  const nearbyPlayers = [];
  if (bot.players) {
    for (const p of Object.values(bot.players)) {
      if (!p || !p.username || p.username === bot.username) continue;
      if (p.entity && isLikelyNpcOrFakePlayer(bot, p.entity)) continue;
      if (!isRealPlayerName(bot, p.username)) continue;
      const ent = p.entity;
      const dist =
        ent && ent.position
          ? Math.round(ent.position.distanceTo(pos) * 10) / 10
          : null;
      nearbyPlayers.push({
        username: p.username,
        ping: p.ping ?? 0,
        inRange: Boolean(ent),
        distance: dist,
        position:
          ent && ent.position
            ? {
                x: Math.floor(ent.position.x),
                y: Math.floor(ent.position.y),
                z: Math.floor(ent.position.z),
              }
            : null,
      });
    }
    nearbyPlayers.sort((a, b) => {
      if (a.inRange !== b.inRange) return a.inRange ? -1 : 1;
      if (a.distance !== null && b.distance !== null) {
        return a.distance - b.distance;
      }
      return a.username.localeCompare(b.username);
    });
  }

  const nearbyEntities = [];
  if (bot.entities) {
    for (const e of Object.values(bot.entities)) {
      if (!e || e === bot.entity || !e.position) continue;
      const dist = Math.round(e.position.distanceTo(pos) * 10) / 10;
      if (dist > 32) continue;
      const info = classifyEntity(e);
      if (!info) continue;
      nearbyEntities.push({
        id: e.id,
        name: e.name || "entity",
        displayName: info.displayName,
        category: info.category,
        hostile: info.hostile,
        distance: dist,
        position: {
          x: Math.floor(e.position.x),
          y: Math.floor(e.position.y),
          z: Math.floor(e.position.z),
        },
      });
    }
    nearbyEntities.sort((a, b) => a.distance - b.distance);
  }

  return {
    connected: true,
    username: bot.username || "",
    health: Math.round((bot.health ?? 20) * 10) / 10,
    food: Math.round((bot.food ?? 20) * 10) / 10,
    saturation: Math.round((bot.foodSaturation ?? 0) * 10) / 10,
    xpLevel: bot.experience?.level ?? 0,
    xpProgress: Math.round((bot.experience?.progress ?? 0) * 100),
    position: {
      x: Math.floor(pos.x),
      y: Math.floor(pos.y),
      z: Math.floor(pos.z),
    },
    yaw: Math.round(((bot.entity.yaw * 180) / Math.PI) % 360),
    pitch: Math.round((bot.entity.pitch * 180) / Math.PI),
    dimension: String(bot.game?.dimension || "overworld").replace(
      /^minecraft:/,
      "",
    ),
    gameMode: String(bot.game?.gameMode || "survival"),
    ping: bot.player?.ping ?? 0,
    quickBarSlot: bot.quickBarSlot ?? 0,
    heldItem: serializeItem(bot.heldItem),
    controls: { ...activeControlStates },
    radarTarget: { ...activeRadarTarget },
    nearbyPlayers: nearbyPlayers.slice(0, 14),
    nearbyEntities: nearbyEntities.slice(0, 14),
    nearbySigns: cachedSigns.slice(0, 14),
  };
}

function pushBotTelemetry(force = false) {
  const snapshot = buildTelemetrySnapshot();
  const json = JSON.stringify(snapshot);
  if (force || json !== lastTelemetryJson) {
    lastTelemetryJson = json;
    sendToRenderer("bot-telemetry", snapshot);
  }
}

function pushBotInventory(force = false) {
  const snapshot = buildInventorySnapshot();
  const json = JSON.stringify(snapshot);
  if (force || json !== lastInventoryJson) {
    lastInventoryJson = json;
    sendToRenderer("bot-inventory", snapshot);
  }
}

let lastSpontaneousChatAt = 0;

async function maybeSpontaneousChat() {
  if (!bot || !bot.entity || !ollamaManager.config.enabled) return;
  if (ollamaManager.isGenerating || aiChatQueue.isBusy()) return;
  const now = Date.now();
  if (now - lastSpontaneousChatAt < 210000) return;
  if (now - (ollamaManager.lastReplyTime || 0) < 120000) return;

  const ctx = buildLiveBotAiContext();
  if (!ctx || !Array.isArray(ctx.nearbyPlayers) || ctx.nearbyPlayers.length === 0) {
    return;
  }
  const nearestPlayer = String(ctx.nearbyPlayers[0] || "")
    .split(" ")[0]
    .trim();
  if (!nearestPlayer) return;

  lastSpontaneousChatAt = now;
  const res = await ollamaManager
    .generateChatReply({
      sender: nearestPlayer,
      message: `[Spontaneous chat moment — ${nearestPlayer} is nearby (${ctx.nearbyPlayers[0]}). Say one short, natural, casual gamer remark about what you're doing right now, the time of day, or ask ${nearestPlayer} what they're up to. Keep it under 65 chars.]`,
      botContext: ctx,
      bypassCooldown: false,
    })
    .catch(() => null);
  if (res && res.ok && res.reply && bot && bot.entity) {
    logAiResult(res, nearestPlayer);
    aiChatQueue.send(res.parts?.length ? res.parts : [res.reply]);
  }
}

function startTelemetryLoop() {
  stopTelemetryLoop();
  pushBotTelemetry(true);
  pushBotInventory(true);
  lastSpontaneousChatAt = Date.now();
  telemetryTimer = setInterval(() => {
    pushBotTelemetry(false);
    pushBotInventory(false);
    if (Math.random() < 0.015) {
      maybeSpontaneousChat().catch(() => {});
    }
  }, 350);
}

function stopTelemetryLoop() {
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
  }
  Object.keys(activeControlStates).forEach((k) => {
    activeControlStates[k] = false;
  });
  activeRadarTarget = { subAction: "", username: "", entityId: null };
  pushBotTelemetry(true);
  pushBotInventory(true);
}

// Scripts whose on/off state mirrors a flag in the AI config.
const AI_SCRIPT_FLAGS = { AIChat: "enabled", AIAgent: "agentEnabled" };
const SCRIPT_NAME_ALIASES = { ChatAI: "AIChat", chatai: "AIChat" };
function resolveScriptName(id) {
  return SCRIPT_NAME_ALIASES[id] || id;
}
const scriptSources = new Map();
const scriptRunIds = new Map();

function setAiScriptFlag(scriptName, on) {
  const flag = AI_SCRIPT_FLAGS[scriptName];
  if (!flag || Boolean(ollamaManager.config[flag]) === on) return;
  ollamaManager.saveConfig({ [flag]: on });
  if (on) {
    // Automatically enable AI Fixes Errors on GearUp when AI is activated so AI monitors & resolves GearUp issues
    setOptionValue("aifix", "GearUp", "on").catch(() => {});
  }
  if (!ollamaManager.isActive()) aiChatQueue.clear();
  ollamaManager
    .getStatus()
    .then((st) => sendToRenderer("ollama-status", st))
    .catch(() => {});
}

function renderScriptOptionHtml(option, scriptName) {
  const fieldId = `${escapeAttr(option.id)}-${escapeAttr(scriptName)}`;
  const label = escapeAttr(option.label);
  const optType = String(option.type || "input").toLowerCase();
  if (optType === "checkbox" || optType === "boolean" || optType === "bool") {
    return `<label class="script-checkbox-row${option.aiOnly ? " script-ai-only" : ""}" for="${fieldId}"${option.aiOnly ? ' title="When this module reports a problem, the local AI looks at the logs and tries to fix it"' : ""}><input type="checkbox" id="${fieldId}" value="off" onclick="checkbox('${fieldId}')"/><span>${label}</span></label>`;
  }
  if (optType === "select") {
    const choices = Array.isArray(option.choices) ? option.choices : [];
    const opts = choices
      .map((c) => {
        const value = typeof c === "object" ? c.value : c;
        const text = typeof c === "object" ? c.label || c.value : c;
        return `<option value="${escapeAttr(value)}">${escapeAttr(text)}</option>`;
      })
      .join("");
    return `<div class="script-input-group"><label for="${fieldId}">${label}</label><select id="${fieldId}" class="script-select">${opts}</select></div>`;
  }
  if (
    optType === "input" ||
    optType === "number" ||
    optType === "text" ||
    optType === "string"
  ) {
    return `<div class="script-input-group"><label for="${fieldId}">${label}</label><input type="text" id="${fieldId}" class="script-text-input" spellcheck="false"${option.placeholder ? ` placeholder="${escapeAttr(option.placeholder)}"` : ""}/></div>`;
  }
  return "";
}

function registerScriptFile(fullPath, type) {
  delete require.cache[require.resolve(fullPath)];
  const scriptDetails = require(fullPath);
  if (!scriptDetails || !scriptDetails.info || !scriptDetails.info.name) {
    return null;
  }
  if (typeof scriptDetails.script !== "function") {
    throw new Error("missing exported script() function");
  }

  const scriptName = String(scriptDetails.info.name);
  const options = Array.isArray(scriptDetails.info.options)
    ? [...scriptDetails.info.options]
    : [];
  // Every module except the AI ones gets "AI Fixes Errors" (shown once
  // the local AI is set up).
  if (!AI_SELF_SCRIPTS.has(scriptName.toLowerCase())) {
    options.push({
      type: "checkbox",
      label: "AI Fixes Errors",
      id: "aifix",
      aiOnly: true,
    });
  }
  // Module log lines go through here so problems can be handed to the AI.
  const scriptLog = (text) => {
    log(text);
    maybeAiFixModule(scriptName, String(text));
  };

  let formattedHTML = `<div class="${escapeAttr(scriptName)}-script script-container" data-script="${escapeAttr(scriptName)}" data-type="${escapeAttr(type)}"><p class="${escapeAttr(scriptName)}-name script-name" data-script="${escapeAttr(scriptName)}">${escapeAttr(scriptName)}</p><form class="script-options">`;
  for (const option of options) {
    formattedHTML += renderScriptOptionHtml(option, scriptName);
  }
  formattedHTML += "</form></div>";

  scriptSources.set(scriptName, { type, fullPath });
  scriptOptionDefs.set(
    scriptName,
    options.filter((o) => o && o.id && o.type !== "label"),
  );
  sendToRenderer("on-script", formattedHTML, scriptName, {
    name: scriptName,
    type,
    options,
    aiSync: Boolean(scriptDetails.info.aiSync),
  });

  scriptFunctions.set(scriptName, () => {
    const rawLibs = loadLibraries();
    // Wrap libs.mcData so local AI scripts that access `mcData.blocksByName`, `mcData.itemsByName`,
    // `mcData.blocks[name]`, or `mcData.items[name]` directly without calling `mcData(bot.version)`
    // transparently resolve from `bot.registry`!
    const wrappedMcData = new Proxy(rawLibs.mcData, {
      get(target, prop) {
        const reg = bot?.registry;
        if (reg) {
          if (prop === "blocks" || prop === "blocksByName") {
            return reg.blocksByName;
          }
          if (prop === "items" || prop === "itemsByName") {
            return reg.itemsByName;
          }
          if (prop in reg) return reg[prop];
        }
        return target[prop];
      },
    });
    const libs = { ...rawLibs, mcData: wrappedMcData };
    const runId = (scriptRunIds.get(scriptName) || 0) + 1;
    scriptRunIds.set(scriptName, runId);
    return Promise.resolve()
      .then(() =>
        scriptDetails.script(
          bot,
          scriptLog,
          clearLog,
          getOption,
          (func, intervalNum) => {
            const safeInterval =
              Number.isFinite(Number(intervalNum)) && Number(intervalNum) >= 50
                ? Number(intervalNum)
                : 1000;
            return new Promise((resolve) => {
              const timer = setInterval(async () => {
                if (!activeScripts.has(scriptName)) {
                  clearInterval(timer);
                  resolve(true);
                } else {
                  try {
                    await func();
                  } catch (err) {
                    scriptLog(`Error in ${scriptName}: ${err.message}`);
                  }
                }
              }, safeInterval);
            });
          },
          libs,
        ),
      )
      .catch((err) => {
        scriptLog(`Error in ${scriptName}: ${err.message || err}`);
      })
      .finally(() => {
        // A newer run (quick off/on toggle) owns the state now.
        if (scriptRunIds.get(scriptName) !== runId) return;
        activeScripts.delete(scriptName);
        setAiScriptFlag(scriptName, false);
        sendToRenderer("script-state", scriptName, false);
      });
  });
  return scriptName;
}

function loadScriptsFromDir(fullDirectory, type) {
  let files = [];
  try {
    files = fs.existsSync(fullDirectory)
      ? fs
          .readdirSync(fullDirectory)
          .filter((f) => f.endsWith(".js"))
          .sort()
      : [];
  } catch (_) {}

  let scriptAmount = 0;
  for (const file of files) {
    try {
      if (registerScriptFile(path.join(fullDirectory, file), type)) {
        scriptAmount += 1;
      }
    } catch (err) {
      log(`Failed to load ${file}: ${err.message}`);
    }
  }

  log(`Loaded ${type} (${scriptAmount}) scripts`);
}

const AI_SELF_SCRIPTS = new Set(["aiagent", "aichat", "chatai"]);
const MODULE_PROBLEM_RE =
  /\b(error|stuck|fail(?:ed|ing)?|couldn'?t|could not|can'?t|cannot|no path|unable|not found|timed out|gave up|giving up|missing|no target|enter a|is required|are required|out of|no \w+ found|denied|skipping unreachable|searching for|scanning for|step warning)\b/i;
const aiFixState = new Map();

// "AI Fixes Errors": when a module logs a problem, the agent looks at the
// logs and tries to fix it with its tools. Its thinking and result go to
// the console only, never to server chat.
async function maybeAiFixModule(scriptName, text) {
  if (!MODULE_PROBLEM_RE.test(text) || /^AIAgent/.test(text)) return;
  const currentBot = bot;
  if (!currentBot || !currentBot.entity) return;
  const st = aiFixState.get(scriptName) || { busy: false, last: 0, tries: [] };
  aiFixState.set(scriptName, st);
  const now = Date.now();
  st.tries = st.tries.filter((t) => now - t < 5 * 60 * 1000);
  if (st.busy || now - st.last < 30000 || st.tries.length >= 3) return;
  const aifixOpt = await getOption("aifix", scriptName);
  const autoAssistGearUp =
    scriptName === "GearUp" &&
    aifixOpt !== "off" &&
    Boolean(
      ollamaManager.config.agentEnabled ||
        activeScripts.has("AIAgent") ||
        activeScripts.has("AIChat"),
    );
  if (aifixOpt !== "on" && !autoAssistGearUp) return;
  if (st.busy) return;
  st.busy = true;
  st.last = now;
  st.tries.push(now);
  aiBrain.recordAction(scriptName, {}, text, true, currentBot);
  const allowed = String(ollamaManager.config.agentAllowedPlayers || "")
    .split(/[,\s]+/)
    .filter(Boolean);
  const owner =
    allowed[0] || sessionState.mcName || sessionState.username || "owner";
  log(`AIAgent: Looking into ${scriptName}: ${text.slice(0, 120)}`);
  try {
    const opts = await aiTools.executeTool(
      "list_scripts",
      {},
      { sender: owner },
    );
    const line = String(opts)
      .split("\n")
      .find((l) => l.startsWith(`${scriptName} `));
    const res = await ollamaManager.runAgent({
      sender: owner,
      message: [
        `[Module problem report, not a chat message] The ${scriptName} module said: "${text.slice(0, 300)}".`,
        line ? `Its current state: ${line}` : "",
        `Recent console:\n${recentLogs.slice(-12).join("\n").slice(-1500)}`,
        `Work out why with think and read_logs, then fix it with tools: change ${scriptName}'s options with set_script_option, restart it, move somewhere better, or turn on a helper module. Never invent coordinates, only use ones from the console or get_status. If it can never work here (no materials, protected lobby, server denies it), turn ${scriptName} off with stop_script. Do not chat. Reply with one short line saying what you changed, or "no fix".`,
      ]
        .filter(Boolean)
        .join("\n"),
      botContext: buildLiveBotAiContext(),
      tools: aiTools.schemasFor(owner),
      executeTool: aiTools.executeTool,
      resolveTool: aiTools.resolveTool,
      bypassCooldown: true,
      remember: false,
    });
    if (bot !== currentBot) return;
    logAiThoughts(res);
    const did = (res.actions || [])
      .filter((a) => a.name !== "think")
      .map(
        (a) => `${a.name} → ${String(a.result).split("\n")[0].slice(0, 80)}`,
      );
    const summary =
      res.reply ||
      (did.length ? "applied fix" : "") ||
      (res.thoughts?.length
        ? String(res.thoughts[res.thoughts.length - 1]).replace(
            /^check:\s*/i,
            "",
          )
        : "") ||
      res.error ||
      "no reply";
    log(
      `AIAgent fix (${scriptName}): ${summary}${did.length ? ` [${did.join(" | ")}]` : ""}`,
    );
  } catch (err) {
    log(`AIAgent fix (${scriptName}) failed: ${err.message || err}`);
  } finally {
    st.busy = false;
  }
}

function startScriptByName(rawId) {
  const id = resolveScriptName(rawId);
  const runner = scriptFunctions.get(id);
  if (!runner || activeScripts.has(id)) return false;
  activeScripts.add(id);
  setAiScriptFlag(id, true);
  sendToRenderer("script-state", id, true);
  runner();
  return true;
}

function stopScriptByName(rawId) {
  const id = resolveScriptName(rawId);
  if (!activeScripts.has(id)) return false;
  activeScripts.delete(id);
  setAiScriptFlag(id, false);
  sendToRenderer("script-state", id, false);
  return true;
}

function loadAllScripts() {
  scriptFunctions.clear();
  scriptSources.clear();
  scriptOptionDefs.clear();
  activeScripts.clear();
  Object.keys(AI_SCRIPT_FLAGS).forEach((id) => setAiScriptFlag(id, false));
  sendToRenderer("clear-scripts");

  const defaultLoading = "Loading default scripts...";
  const customLoading = "Loading custom scripts...";

  log(defaultLoading);
  loadScriptsFromDir(path.join(__dirname, "src", "js", "scripts"), "default");
  clearLog(defaultLoading);

  log(customLoading);
  loadScriptsFromDir(resolveCustomPath("scripts"), "custom");
  clearLog(customLoading);
}

let activeViaBridge = null;

function stopActiveViaBridge() {
  if (!activeViaBridge) return;
  try {
    activeViaBridge.stop();
  } catch (_) {}
  activeViaBridge = null;
}

function disconnectBot(isManual = true) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (isManual) {
    manualDisconnect = true;
    activeScripts.clear();
  }
  cachedSigns = [];
  aiChatQueue.clear();
  aiTools.stopAll();
  if (bot) {
    try {
      bot.end();
    } catch (_) {}
    bot = null;
  }
  stopActiveViaBridge();
  stopTelemetryLoop();
  sendToRenderer("connection-state", { state: "disconnected" });
}

function enterPanelWithSession() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow
    .loadFile(path.join(__dirname, "src", "views", "panel.html"))
    .then(() => {
      const runtimeInfo = getRuntimeInfo();
      log(
        sessionState.onlineMode
          ? `Welcome to MCBP! (Microsoft · ${sessionState.mcName || sessionState.email})`
          : "Welcome to MCBP!",
      );
      log(
        `Mineflayer v${runtimeInfo.mineflayerVersion} (${runtimeInfo.versionRange})`,
      );
      if (sessionState.onlineMode) {
        sendToRenderer(
          "set-account",
          sessionState.email,
          sessionState.mcName || sessionState.email,
        );
      } else {
        sendToRenderer("set-username", sessionState.username);
      }
      sendToRenderer("set-version", app.getVersion());
      sendToRenderer("runtime-info", runtimeInfo);
      applyCustomTheme();
      loadAllScripts();
      pushBotTelemetry(true);
      pushBotInventory(true);
      pushSessionLogStatus();
      ollamaManager
        .getStatus()
        .then((st) => sendToRenderer("ollama-status", st))
        .catch(() => {});
      try {
        scriptStudio.setBaseDirs([loadLibraries().baseDir, __dirname]);
      } catch (_) {}
      // Keep Mineflayer docs fresh for the Studio tab in the background.
      scriptStudio
        .downloadDocs()
        .then((res) => sendToRenderer("studio-docs-status", res.status))
        .catch(() => {});
      syncLatestMineflayer({
        onLog: log,
        onUpdated: (updated) => sendToRenderer("runtime-info", updated),
      });
    })
    .catch(() => {});
}

function createWindow() {
  const iconPath =
    process.platform === "win32" && fs.existsSync(ICON_ICO)
      ? ICON_ICO
      : ICON_PNG;

  mainWindow = new BrowserWindow({
    title: `MCBP v${app.getVersion()}`,
    width: 1100,
    height: 740,
    minWidth: 420,
    minHeight: 520,
    resizable: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: "#16131f",
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "src", "js", "preload.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      devTools: false,
    },
  });

  mainWindow
    .loadFile(path.join(__dirname, "src", "views", "welcomeScreen.html"))
    .then(() => {
      sendToRenderer("set-version", app.getVersion());
      applyCustomTheme();
    })
    .catch(() => {});

  return mainWindow;
}

function resolveArmorDest(itemName) {
  const n = String(itemName || "").toLowerCase();
  if (
    n.endsWith("_helmet") ||
    n === "turtle_helmet" ||
    n === "carved_pumpkin"
  ) {
    return "head";
  }
  if (n.endsWith("_chestplate") || n === "elytra") return "torso";
  if (n.endsWith("_leggings")) return "legs";
  if (n.endsWith("_boots")) return "feet";
  if (n === "totem_of_undying" || n === "shield") return "off-hand";
  return "hand";
}

async function handleInventoryAction(payload = {}) {
  if (!bot || !bot.inventory) {
    log("Inventory: Connect a bot first");
    return;
  }

  const action = String(payload.action || "");
  const slot = typeof payload.slot === "number" ? payload.slot : -1;
  if (action !== "refresh") {
    sessionLogger.record(
      "UI Click",
      `Inventory: ${action}`,
      slot >= 0 ? `Slot #${slot}` : JSON.stringify(payload),
    );
    pushSessionLogStatus();
  }

  try {
    if (action === "container-click") {
      if (!bot.currentWindow) {
        log("Container: No open container to click");
        return;
      }
      const mouseButton = Number(payload.mouseButton) === 1 ? 1 : 0;
      const mode = Number.isFinite(Number(payload.mode))
        ? Number(payload.mode)
        : 0;
      const clickedItem = bot.currentWindow.slots?.[slot];
      const itemLabel = clickedItem
        ? clickedItem.displayName || clickedItem.name
        : `slot #${slot}`;
      await bot.clickWindow(slot, mouseButton, mode).catch(() => {});
      log(
        `Container: Clicked ${itemLabel} (slot #${slot}${mode === 1 ? ", shift" : mouseButton === 1 ? ", right-click" : ""})`,
      );
    } else if (action === "container-close") {
      if (bot.currentWindow) {
        bot.closeWindow(bot.currentWindow);
        log("Container: Closed opened container");
      }
    } else if (action === "select-hotbar") {
      const idx = Number(payload.index);
      if (Number.isFinite(idx) && idx >= 0 && idx <= 8) {
        bot.setQuickBarSlot(idx);
      }
    } else if (action === "equip" || action === "equip-offhand") {
      const item = bot.inventory.slots[slot];
      if (!item) return;
      const dest =
        action === "equip-offhand" ? "off-hand" : resolveArmorDest(item.name);
      await bot.equip(item, dest);
      log(`Inventory: Equipped ${item.displayName || item.name} (${dest})`);
    } else if (action === "unequip") {
      const dest = String(payload.destination || "");
      if (dest) {
        await bot.unequip(dest);
        log(`Inventory: Unequipped ${dest}`);
      }
    } else if (action === "use") {
      const item = slot >= 0 ? bot.inventory.slots[slot] : bot.heldItem;
      if (!item) return;
      if (!bot.heldItem || bot.heldItem.slot !== item.slot) {
        await bot.equip(item, "hand");
      }
      const cat = categorizeItem(item.name);
      if (cat === "food" || item.name.includes("potion")) {
        log(`Inventory: Consuming ${item.displayName || item.name}...`);
        await consumeFoodSafely(bot, item);
      } else {
        bot.activateItem();
        setTimeout(() => {
          if (bot) bot.deactivateItem();
        }, 250);
      }
    } else if (action === "drop-one") {
      const item = slot >= 0 ? bot.inventory.slots[slot] : bot.heldItem;
      if (!item) return;
      await bot.toss(item.type, item.metadata, 1);
      log(`Inventory: Dropped 1x ${item.displayName || item.name}`);
    } else if (action === "drop-stack") {
      const item = slot >= 0 ? bot.inventory.slots[slot] : bot.heldItem;
      if (!item) return;
      await bot.tossStack(item);
      log(`Inventory: Dropped ${item.count}x ${item.displayName || item.name}`);
    } else if (action === "auto-gear") {
      await equipBestArmor(bot, { includeOffhand: true });
      await equipBestWeapon(bot, { saveLowDurability: true });
      log("Inventory: Equipped best armor, weapon & off-hand gear");
    } else if (action === "drop-all") {
      const items = bot.inventory.items();
      for (const item of items) {
        if (!bot) break;
        await bot.tossStack(item).catch(() => {});
      }
      log(`Inventory: Dropped ${items.length} stack(s)`);
    }
  } catch (err) {
    log(`Inventory error: ${err.message || err}`);
  } finally {
    pushBotInventory(true);
    pushBotTelemetry(true);
  }
}

async function handleBotControl(payload = {}) {
  if (!bot || !bot.entity) return;

  const action = String(payload.action || "");
  if (action !== "look") {
    sessionLogger.record(
      "UI Click",
      `Control: ${action}`,
      payload.subAction
        ? `${payload.subAction} (${payload.username || payload.entityId || `${payload.x},${payload.y},${payload.z}`})`
        : payload.control
          ? `${payload.control}=${payload.state}`
          : "",
    );
    pushSessionLogStatus();
  }
  try {
    if (action === "move") {
      const control = String(payload.control || "");
      const state = Boolean(payload.state);
      if (Object.prototype.hasOwnProperty.call(activeControlStates, control)) {
        const opposites = {
          forward: "back",
          back: "forward",
          left: "right",
          right: "left",
        };
        if (
          state &&
          ["forward", "back", "left", "right", "jump"].includes(control)
        ) {
          clearPathfinderGoal(bot);
          if (
            activeRadarTarget.subAction === "follow" ||
            activeRadarTarget.subAction === "goto"
          ) {
            activeRadarTarget = { subAction: "", username: "", entityId: null };
          }
        }
        if (state && opposites[control]) {
          const opp = opposites[control];
          activeControlStates[opp] = false;
          bot.setControlState(opp, false);
        }
        activeControlStates[control] = state;
        bot.setControlState(control, state);
      }
    } else if (action === "stop-all") {
      Object.keys(activeControlStates).forEach((k) => {
        activeControlStates[k] = false;
      });
      activeRadarTarget = { subAction: "", username: "", entityId: null };
      bot.clearControlStates();
      clearPathfinderGoal(bot);
      log("Control: Stopped all movement & pathfinding");
    } else if (action === "look") {
      const yawDeltaDeg = Number(payload.yawDelta) || 0;
      const pitchDeltaDeg = Number(payload.pitchDelta) || 0;
      const newYaw = bot.entity.yaw + (yawDeltaDeg * Math.PI) / 180;
      const rawPitch = bot.entity.pitch + (pitchDeltaDeg * Math.PI) / 180;
      const clampedPitch = Math.max(
        -Math.PI / 2 + 0.05,
        Math.min(Math.PI / 2 - 0.05, rawPitch),
      );
      await bot.look(newYaw, clampedPitch, true);
    } else if (action === "attack") {
      let target = null;
      if (payload.entityId && bot.entities[payload.entityId]) {
        target = bot.entities[payload.entityId];
      } else {
        let bestDist = 4.6;
        for (const e of Object.values(bot.entities)) {
          if (!e || e === bot.entity || !e.position) continue;
          if (e.type === "object" || e.type === "orb") continue;
          const d = e.position.distanceTo(bot.entity.position);
          if (d < bestDist) {
            bestDist = d;
            target = e;
          }
        }
      }
      if (target) {
        await performPvpAttack(bot, target, { useCrits: true, maxRange: 4.6 });
      } else {
        bot.swingArm();
      }
    } else if (action === "swing") {
      bot.swingArm();
    } else if (action === "use-item") {
      if (bot.heldItem) {
        const cat = categorizeItem(bot.heldItem.name);
        if (cat === "food" || bot.heldItem.name.includes("potion")) {
          await consumeFoodSafely(bot, bot.heldItem);
        } else {
          bot.activateItem();
          setTimeout(() => {
            if (bot) bot.deactivateItem();
          }, 300);
        }
      } else {
        bot.activateItem();
      }
    } else if (action === "sign-action") {
      const subAction = String(payload.subAction || "interact");
      const x = Number(payload.x);
      const y = Number(payload.y);
      const z = Number(payload.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return;
      }
      const { Vec3, goals } = loadLibraries();
      const signPos = new Vec3(x, y, z);
      const dist = bot.entity.position.distanceTo(signPos);

      if (subAction === "goto") {
        if (bot.pathfinder) {
          bot._mcbpSprintJump = true;
          bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2));
          log(`Sign: Walking to sign at (${x}, ${y}, ${z})`);
        }
        return;
      }

      if (dist > 3.8 && bot.pathfinder) {
        log(`Sign: Walking to sign at (${x}, ${y}, ${z})...`);
        await bot.pathfinder
          .goto(new goals.GoalNear(x, y, z, 2.5))
          .catch(() => {});
      }

      const signBlock = bot.blockAt(signPos);
      if (!signBlock) {
        log(`Sign: Block at (${x}, ${y}, ${z}) is not loaded`);
        return;
      }

      await bot.lookAt(signPos.offset(0.5, 0.5, 0.5), true);
      if (subAction === "punch") {
        if (bot._client && typeof bot._client.write === "function") {
          bot._client.write("block_dig", {
            status: 0,
            location: signBlock.position,
            face: 1,
          });
          bot.swingArm();
        } else {
          await bot.dig(signBlock, true).catch(() => {});
        }
        log(`Sign: Left-clicked sign at (${x}, ${y}, ${z})`);
      } else {
        await bot.activateBlock(signBlock);
        log(`Sign: Right-clicked sign at (${x}, ${y}, ${z})`);
      }
    } else if (action === "drop-held") {
      if (bot.heldItem) {
        if (payload.stack) {
          await bot.tossStack(bot.heldItem);
        } else {
          await bot.toss(bot.heldItem.type, bot.heldItem.metadata, 1);
        }
      }
    } else if (action === "swap-offhand") {
      const held = bot.heldItem;
      const offhand = bot.inventory?.slots?.[45];
      if (held) {
        await bot.equip(held, "off-hand");
      } else if (offhand) {
        await bot.equip(offhand, "hand");
      }
    } else if (action === "respawn") {
      bot.respawn();
      log("Control: Sent respawn request");
    } else if (action === "set-hotbar") {
      const idx = Number(payload.index);
      if (Number.isFinite(idx) && idx >= 0 && idx <= 8) {
        bot.setQuickBarSlot(idx);
      }
    } else if (action === "entity-action") {
      const subAction = String(payload.subAction || "");
      const username = String(payload.username || "");
      const entityId = payload.entityId;
      const { goals } = loadLibraries();

      let targetEntity = null;
      if (username && bot.players?.[username]?.entity) {
        targetEntity = bot.players[username].entity;
      } else if (entityId && bot.entities?.[entityId]) {
        targetEntity = bot.entities[entityId];
      }

      if (subAction === "guard" && username) {
        const isAlreadyGuarding =
          activeScripts.has("Guard") &&
          activeRadarTarget.subAction === "guard" &&
          activeRadarTarget.username === username;

        if (isAlreadyGuarding) {
          activeScripts.delete("Guard");
          activeRadarTarget = { subAction: "", username: "", entityId: null };
          clearPathfinderGoal(bot);
          sendToRenderer("script-state", "Guard", false);
          log(`Guard: Stopped protecting ${username}`);
          return;
        }

        if (activeScripts.has("Hunt")) {
          activeScripts.delete("Hunt");
          sendToRenderer("script-state", "Hunt", false);
        }

        activeRadarTarget = { subAction: "guard", username, entityId: null };
        if (mainWindow && !mainWindow.isDestroyed()) {
          await mainWindow.webContents
            .executeJavaScript(
              `(() => {
                const inp = document.getElementById("playername-Guard");
                if (inp) {
                  inp.value = ${JSON.stringify(username)};
                  inp.dispatchEvent(new Event("input", { bubbles: true }));
                }
              })()`,
            )
            .catch(() => {});
        }
        if (!activeScripts.has("Guard")) {
          const runner = scriptFunctions.get("Guard");
          if (runner) {
            activeScripts.add("Guard");
            sendToRenderer("script-state", "Guard", true);
            runner();
          }
        }
        log(`Guard: Assigned to protect ${username}`);
        return;
      }

      if (subAction === "hunt" && username) {
        const isAlreadyHunting =
          activeScripts.has("Hunt") &&
          activeRadarTarget.subAction === "hunt" &&
          activeRadarTarget.username === username;

        if (isAlreadyHunting) {
          activeScripts.delete("Hunt");
          activeRadarTarget = { subAction: "", username: "", entityId: null };
          clearPathfinderGoal(bot);
          sendToRenderer("script-state", "Hunt", false);
          log(`Hunt: Stopped hunting ${username}`);
          return;
        }

        if (activeScripts.has("Guard")) {
          activeScripts.delete("Guard");
          sendToRenderer("script-state", "Guard", false);
        }

        activeRadarTarget = { subAction: "hunt", username, entityId: null };
        if (mainWindow && !mainWindow.isDestroyed()) {
          await mainWindow.webContents
            .executeJavaScript(
              `(() => {
                const inp = document.getElementById("playername-Hunt");
                if (inp) {
                  inp.value = ${JSON.stringify(username)};
                  inp.dispatchEvent(new Event("input", { bubbles: true }));
                }
              })()`,
            )
            .catch(() => {});
        }
        if (!activeScripts.has("Hunt")) {
          const runner = scriptFunctions.get("Hunt");
          if (runner) {
            activeScripts.add("Hunt");
            sendToRenderer("script-state", "Hunt", true);
            runner();
          }
        }
        log(`Hunt: Pursuing ${username}`);
        return;
      }

      if (!targetEntity || !targetEntity.position) {
        log(`Target ${username || "entity"} is not within loaded chunk range`);
        return;
      }

      if (subAction === "look") {
        await bot.lookAt(
          targetEntity.position.offset(
            0,
            (targetEntity.height || 1.6) * 0.85,
            0,
          ),
          true,
        );
      } else if (subAction === "follow") {
        if (bot.pathfinder) {
          if (
            activeRadarTarget.subAction === "follow" &&
            activeRadarTarget.username === username
          ) {
            clearPathfinderGoal(bot);
            activeRadarTarget = { subAction: "", username: "", entityId: null };
            log(`Control: Stopped following ${username}`);
          } else {
            activeRadarTarget = {
              subAction: "follow",
              username,
              entityId: null,
            };
            bot._mcbpSprintJump = true;
            setDynamicFollowGoal(bot, goals, targetEntity, 2);
            log(
              `Control: Following ${username || targetEntity.displayName || targetEntity.name}`,
            );
          }
        }
      } else if (subAction === "goto") {
        if (bot.pathfinder) {
          if (
            activeRadarTarget.subAction === "goto" &&
            activeRadarTarget.entityId === entityId
          ) {
            clearPathfinderGoal(bot);
            activeRadarTarget = { subAction: "", username: "", entityId: null };
            log("Control: Stopped pathing to mob");
          } else {
            const p = targetEntity.position;
            activeRadarTarget = {
              subAction: "goto",
              username: "",
              entityId,
            };
            bot._mcbpSprintJump = true;
            bot.pathfinder.setGoal(new goals.GoalNear(p.x, p.y, p.z, 2));
            log(
              `Control: Pathing to (${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`,
            );
          }
        }
      } else if (subAction === "attack") {
        const dist = targetEntity.position.distanceTo(bot.entity.position);
        if (dist > 3.5 && bot.pathfinder) {
          bot.pathfinder.setGoal(
            new goals.GoalFollow(targetEntity, 2.2),
            false,
          );
        }
        await bot.lookAt(
          targetEntity.position.offset(
            0,
            (targetEntity.height || 1.6) * 0.85,
            0,
          ),
          true,
        );
        bot.attack(targetEntity);
      }
    }
  } catch (_) {
  } finally {
    pushBotTelemetry(false);
    pushBotInventory(false);
  }
}

function registerIpcHandlers() {
  ipcMain.handle("msa-get-accounts", () => loadSavedMsaAccounts());

  ipcMain.handle("msa-remove-account", (_event, accountId) =>
    removeMsaAccount(accountId),
  );

  ipcMain.on("copy-text", (_event, text) => {
    try {
      clipboard.writeText(String(text || ""));
    } catch (_) {}
  });

  ipcMain.on("msa-open-popup", (_event, payload = {}) => {
    openMsaLoginPopup(payload.verificationUri, payload.userCode);
  });

  ipcMain.on("msa-cancel-login", () => {
    activeMsaRunId += 1;
    closeMsaPopup();
    sendToRenderer("msa-status", {
      state: "idle",
      message: "Sign-in cancelled",
    });
  });

  ipcMain.on("msa-start-login", async (_event, payload = {}) => {
    const runId = ++activeMsaRunId;
    const rawAccount = String(payload.accountId || "").trim();
    const accountKey = rawAccount || `Microsoft_${Date.now()}`;
    const openPopup = payload.openPopup !== false;

    sendToRenderer("msa-status", {
      state: "authenticating",
      message: "Checking cached Microsoft credentials...",
    });

    try {
      const libs = await ensureMineflayer(ICON_PNG, log);
      const { Authflow, Titles } = libs;
      if (!Authflow || !Titles) {
        throw new Error("prismarine-auth is not available in runtime");
      }

      const profilesDir = getMsaProfilesDir();
      const authflow = new Authflow(
        accountKey,
        profilesDir,
        {
          authTitle: Titles.MinecraftNintendoSwitch,
          deviceType: "Nintendo",
          flow: "live",
        },
        (msaData) => {
          if (runId !== activeMsaRunId) return;
          const uri =
            msaData.verification_uri || "https://www.microsoft.com/link";
          const code = msaData.user_code || "";
          if (code) {
            try {
              clipboard.writeText(code);
            } catch (_) {}
          }
          sendToRenderer("msa-code", {
            userCode: code,
            verificationUri: uri,
            accountKey,
            message: msaData.message || `Open ${uri} and enter code ${code}`,
          });
          if (openPopup) {
            openMsaLoginPopup(uri, code);
          }
        },
      );

      const result = await authflow.getMinecraftJavaToken({
        fetchProfile: true,
      });

      if (runId !== activeMsaRunId) return;
      closeMsaPopup();

      const profile = result?.profile || {};
      const mcName = profile.name || rawAccount || "MinecraftPlayer";
      const uuid = profile.id || "";

      saveMsaAccount({
        id: accountKey,
        mcName,
        uuid,
      });

      sessionState = {
        onlineMode: true,
        username: mcName,
        email: accountKey,
        mcName,
        uuid,
      };

      sendToRenderer("msa-status", {
        state: "success",
        mcName,
        uuid,
        accountKey,
      });

      enterPanelWithSession();
    } catch (err) {
      if (runId !== activeMsaRunId) return;
      closeMsaPopup();
      sendToRenderer("msa-status", {
        state: "error",
        message: String(err.message || err),
      });
    }
  });

  ["microsoft", "offline"].forEach((mode) => {
    ipcMain.on("login" + mode, () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow
        .loadFile(path.join(__dirname, "src", "views", `${mode}.html`))
        .then(() => {
          sendToRenderer("set-version", app.getVersion());
          applyCustomTheme();
        })
        .catch(() => {});
    });
  });

  ipcMain.on("back-to-welcome", () => {
    activeMsaRunId += 1;
    closeMsaPopup();
    disconnectBot();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow
      .loadFile(path.join(__dirname, "src", "views", "welcomeScreen.html"))
      .then(() => {
        sendToRenderer("set-version", app.getVersion());
        applyCustomTheme();
      })
      .catch(() => {});
  });

  ipcMain.on("form-submission", (_event, data = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (data.username && !data.email) {
      sessionState = {
        onlineMode: false,
        username: String(data.username).trim(),
        email: "",
        mcName: "",
        uuid: "",
      };
      enterPanelWithSession();
    } else if (data.email) {
      const accountKey = String(data.email).trim();
      const mcName = String(data.mcName || accountKey).trim();
      saveMsaAccount({
        id: accountKey,
        mcName,
        uuid: data.uuid || "",
      });
      sessionState = {
        onlineMode: true,
        username: mcName,
        email: accountKey,
        mcName,
        uuid: data.uuid || "",
      };
      enterPanelWithSession();
    }
  });

  async function connectToServerInternal(server = {}, restoredScripts = null) {
    const address = parseServerAddress(server.ip);
    if (!address.ip) {
      log("Enter a valid server address first");
      return;
    }

    lastConnectServer = { ...server };
    manualDisconnect = false;
    disconnectBot(false);

    try {
      sendToRenderer("connection-state", {
        state: "connecting",
        host: `${address.ip}:${address.port}`,
      });
      log(`Connecting to ${address.ip}:${address.port}...`);

      const libs = await ensureMineflayer(ICON_PNG, log);
      const { mineflayer, mcData, pathfinder, Movements, goals } = libs;

      const rawVersion = String(server.version || "").trim();
      let normalizedVersion = resolveSupportedVersion(rawVersion, mcData);

      const isMicrosoft = server.auth === "microsoft";
      const useProxy =
        typeof server.useProxy === "boolean"
          ? server.useProxy
          : Boolean(proxyManager.config.enabled);

      // Detect MC 26.2 (776) / 26.3 (777) servers even when version is set to Auto,
      // and bridge through ViaProxy when available (with seamless fallback to native JS shim).
      let viaTarget = needsViaProxyBridge(rawVersion);
      if (!viaTarget.needed && !normalizedVersion && !useProxy) {
        const pingRes = await pingServerProtocol(address.ip, address.port, {
          timeoutMs: 2500,
          scopedRequire: libs.scopedRequire,
        });
        if (pingRes.ok) {
          viaTarget = needsViaProxyBridge(
            pingRes.protocol || pingRes.versionName,
          );
          if (viaTarget.needed && !normalizedVersion) {
            normalizedVersion = resolveSupportedVersion(
              viaTarget.targetVersion,
              mcData,
            );
          }
        }
      }

      let connectHost = address.ip;
      let connectPort = address.port;
      if (
        viaTarget.needed &&
        !isMicrosoft &&
        !useProxy &&
        !server._skipViaProxy
      ) {
        log(
          `ViaVersion: MC ${viaTarget.targetVersion} detected — starting local ViaProxy bridge (26.1 ⇄ ${viaTarget.targetVersion})...`,
        );
        const bridge = await viaProxyBridge.startBridge({
          targetHost: address.ip,
          targetPort: address.port,
          targetVersion: viaTarget.targetVersion,
          cacheDir: path.join(app.getPath("userData"), "viaproxy"),
          log: (t) => log(t),
        });
        if (bridge.ok) {
          activeViaBridge = bridge;
          connectHost = bridge.host;
          connectPort = bridge.port;
          normalizedVersion = bridge.clientVersion;
          log(
            `ViaVersion: ViaProxy bridge ready on ${bridge.host}:${bridge.port} (MC ${bridge.clientVersion} ⇄ MC ${bridge.targetVersion})`,
          );
        } else {
          log(
            `ViaVersion: ViaProxy unavailable (${bridge.error}) — using built-in MC ${viaTarget.targetVersion} protocol shim`,
          );
          normalizedVersion = resolveSupportedVersion(
            viaTarget.targetVersion,
            mcData,
          );
        }
      }

      const botOptions = {
        host: connectHost,
        port: connectPort,
        version: normalizedVersion,
        username: isMicrosoft
          ? sessionState.email || server.username || "MCBP_Account"
          : server.username || sessionState.username || "MCBP_Bot",
        auth: isMicrosoft ? "microsoft" : "offline",
      };

      let activeProxy = null;
      if (useProxy) {
        activeProxy = proxyManager.pickBestProxy();
        if (activeProxy) {
          log(
            `Proxy: Tunneling via ${activeProxy.protocol.toUpperCase()} ${activeProxy.label}${activeProxy.latencyMs ? ` (${activeProxy.latencyMs}ms)` : ""}`,
          );
          botOptions.connect = proxyManager.createConnectHook(
            activeProxy,
            address.ip,
            address.port,
          );
        }
      }

      if (isMicrosoft) {
        botOptions.profilesFolder = getMsaProfilesDir();
        botOptions.onMsaCode = (msaData) => {
          const uri =
            msaData.verification_uri || "https://www.microsoft.com/link";
          const code = msaData.user_code || "";
          if (code) {
            try {
              clipboard.writeText(code);
            } catch (_) {}
          }
          log(
            `Microsoft Auth: Code ${code} (copied to clipboard!) — Open ${uri}`,
          );
          sendToRenderer("msa-code", {
            userCode: code,
            verificationUri: uri,
            accountKey: botOptions.username,
            message: `Enter code ${code} at ${uri}`,
          });
        };
      }

      const currentBot = mineflayer.createBot(botOptions);
      bot = currentBot;
      currentBot.loadPlugin(pathfinder);
      currentBot.mcData = mcData;
      currentBot.Movements = Movements;
      currentBot.pathfinderGoals = goals;
      attachViaVersionAdapter(currentBot, { log: (t) => log(t) });
      attachSubServerChatFix(currentBot, { log: (t) => log(t) });

      currentBot.once("spawn", () => {
        if (bot !== currentBot) return;
        currentBot._mcbpHasSpawned = true;
        closeMsaPopup();
        sendToRenderer("msa-code", null);

        if (currentBot.entity?.position) {
          aiBrain.recordLandmark(
            "spawn",
            currentBot.entity.position,
            "Spawn",
            currentBot,
          );
        }

        configureSmartMovements(currentBot, mcData, Movements);
        attachSmartMovement(currentBot, activeControlStates);
        attachRealTimeSelfPreservation(currentBot, {
          log: (t) => log(t),
          onEvent: (evtText) => ollamaManager.recordWorldEvent(evtText),
        });
        attachStuckWatchdog(currentBot, {
          log: (t) => log(t),
          loadLibraries,
          onStuck: (info) => askAiAboutStuck(currentBot, info),
          onLogMovement: (action, details) => {
            sessionLogger.record("Movement", action, details);
            ollamaManager.recordWorldEvent(`${action}: ${details}`);
            pushSessionLogStatus();
          },
        });

        if (isMicrosoft && currentBot.username) {
          sessionState.mcName = currentBot.username;
          saveMsaAccount({
            id: sessionState.email || currentBot.username,
            mcName: currentBot.username,
            uuid: currentBot.player?.uuid || "",
          });
          sendToRenderer(
            "set-account",
            sessionState.email || currentBot.username,
            currentBot.username,
          );
        }

        log(`Connected as ${currentBot.username} (MC ${currentBot.version})`);
        sessionLogger.record(
          "Game Event",
          "Spawned on server",
          `${currentBot.username} on ${address.ip}:${address.port} (MC ${currentBot.version})`,
        );
        sendToRenderer("connection-state", {
          state: "connected",
          username: currentBot.username,
          host: `${address.ip}:${address.port}`,
          version: currentBot.version,
        });

        // Track item collection & inventory additions for session log
        const getInvTotals = () => {
          const totals = new Map();
          if (!currentBot.inventory?.slots) return totals;
          for (const it of currentBot.inventory.slots) {
            if (!it || !it.name) continue;
            const prev = totals.get(it.name) || {
              count: 0,
              displayName: it.displayName || it.name,
            };
            prev.count += it.count || 1;
            totals.set(it.name, prev);
          }
          return totals;
        };
        let prevInvTotals = getInvTotals();
        let invDiffTimer = null;

        if (
          currentBot.inventory &&
          typeof currentBot.inventory.on === "function"
        ) {
          currentBot.inventory.on("updateSlot", () => {
            if (bot !== currentBot) return;
            if (invDiffTimer) clearTimeout(invDiffTimer);
            invDiffTimer = setTimeout(() => {
              if (bot !== currentBot) return;
              const nextTotals = getInvTotals();
              for (const [name, info] of nextTotals.entries()) {
                const oldCount = prevInvTotals.get(name)?.count || 0;
                if (info.count > oldCount) {
                  sessionLogger.recordCollected(
                    name,
                    info.displayName,
                    info.count - oldCount,
                    currentBot.entity?.position,
                  );
                  ollamaManager.recordWorldEvent(
                    `Collected +${info.count - oldCount}x ${name} (total ${info.count})`,
                  );
                  pushSessionLogStatus();
                }
              }
              prevInvTotals = nextTotals;
            }, 180);
          });
        }

        startTelemetryLoop();

        if (restoredScripts && restoredScripts.size > 0) {
          for (const scriptId of restoredScripts) {
            startScriptByName(scriptId);
          }
          log(
            `AutoReconnect: Restored ${restoredScripts.size} active script(s)`,
          );
        } else if (
          Array.isArray(server.rememberedModules) &&
          server.rememberedModules.length > 0
        ) {
          let restoredCount = 0;
          for (const scriptId of server.rememberedModules) {
            if (startScriptByName(scriptId)) restoredCount++;
          }
          if (restoredCount > 0) {
            log(
              `Server Profile: Restored ${restoredCount} remembered module(s) for ${address.ip}`,
            );
          }
        }
      });

      currentBot.on("windowOpen", (win) => {
        if (bot !== currentBot) return;
        const title =
          parseRichComponentText(win?.title).trim() ||
          String(win?.type || "Container");
        log(`Container opened: ${title}`);
        if (win && typeof win.on === "function") {
          win.on("updateSlot", () => {
            if (bot === currentBot) pushBotInventory(false);
          });
        }
        pushBotInventory(true);
      });

      currentBot.on("windowClose", (win) => {
        if (bot !== currentBot) return;
        const title =
          parseRichComponentText(win?.title).trim() ||
          String(win?.type || "Container");
        sessionLogger.record("Container", "Closed container", title);
        pushBotInventory(true);
      });

      currentBot.on("death", () => {
        if (bot !== currentBot) return;
        const p = currentBot.entity?.position;
        if (p) {
          currentBot._mcbpLastDeath = {
            position: p.clone(),
            dimension: String(
              currentBot.game?.dimension || "overworld",
            ).replace(/^minecraft:/, ""),
            at: Date.now(),
            cause: currentBot._mcbpLastDeath?.cause || "",
          };
          aiBrain.recordLandmark("last_death", p, "Last Death", currentBot);
        }
        ollamaManager.recordWorldEvent(
          p
            ? `Died at (${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`
            : "Died",
        );
        sessionLogger.record(
          "Game Event",
          "Bot died",
          p
            ? `At (${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`
            : "Died",
        );
        pushSessionLogStatus();
      });

      currentBot.on("diggingCompleted", (block) => {
        if (bot !== currentBot || !block) return;
        if (
          !block.name ||
          block.name === "air" ||
          block.name === "cave_air" ||
          block.name === "void_air"
        ) {
          return;
        }
        if (
          currentBot._mcbpDenied &&
          Date.now() - currentBot._mcbpDenied.at < 500
        ) {
          return;
        }
        const bp = block.position;
        ollamaManager.recordWorldEvent(
          bp
            ? `Mined ${block.name} at (${bp.x}, ${bp.y}, ${bp.z})`
            : `Mined ${block.name}`,
        );
        sessionLogger.record(
          "Mine",
          `Mined ${block.displayName || block.name}`,
          bp
            ? `Block \`${block.name}\` at (${bp.x}, ${bp.y}, ${bp.z})`
            : block.name,
        );
        pushSessionLogStatus();
      });

      currentBot.on("health", () => {
        if (bot !== currentBot) return;
        pushBotTelemetry(false);
      });

      currentBot.on("heldItemChanged", () => {
        if (bot !== currentBot) return;
        pushBotInventory(false);
        pushBotTelemetry(false);
      });

      currentBot.on("playerCollect", () => {
        if (bot !== currentBot) return;
        setTimeout(() => {
          if (bot === currentBot) pushBotInventory(false);
        }, 120);
      });

      currentBot.on("message", async (jsonMsg, _position, senderUuid) => {
        if (bot !== currentBot) return;
        const payload = extractChatPayload(jsonMsg);
        if (payload.text || payload.motd) {
          sendToRenderer("chat", payload);
          rememberLog(`[chat] ${payload.text || payload.motd}`);
          handleServerNotice(currentBot, payload.text || payload.motd);
          sessionLogger.record(
            "Chat",
            "Server Message",
            payload.text || payload.motd,
          );
          pushSessionLogStatus();

          if (ollamaManager.isActive()) {
            handleAiChat(
              currentBot,
              payload.text || payload.motd,
              senderUuid,
              _position,
            );
          }
        }
      });

      currentBot.on("kicked", (reason) => {
        if (bot !== currentBot) return;
        const kickText = formatKickReason(reason);
        log(`Kicked: ${kickText}`);
        if (
          !currentBot._mcbpHasSpawned &&
          !server._viaRetried &&
          /outdated|unsupported protocol|please use|incompatible|version/i.test(
            kickText,
          )
        ) {
          const fallbackVer = resolveVersionFromKickOrError(kickText, mcData);
          if (fallbackVer && fallbackVer !== normalizedVersion) {
            log(
              `ViaVersion: Server requested MC ${fallbackVer} — auto-retrying connection...`,
            );
            setTimeout(() => {
              if (!manualDisconnect) {
                connectToServerInternal(
                  { ...server, version: fallbackVer, _viaRetried: true },
                  restoredScripts,
                );
              }
            }, 600);
          }
        }
      });

      currentBot.on("error", async (err) => {
        if (bot !== currentBot) return;
        const errText = err?.message || String(err);
        log(`Bot error: ${errText}`);
        if (
          !currentBot._mcbpHasSpawned &&
          activeProxy &&
          proxyManager.config.autoHeal &&
          (server._proxyHealTries || 0) < 2
        ) {
          const healRes = await proxyManager.healProxyFailure(activeProxy, {
            targetHost: address.ip,
            targetPort: address.port,
            log: (t) => log(t),
            onAiHeal: (msg) => aiBrain.recordThought(`Proxy AI-Heal: ${msg}`),
          });
          sendToRenderer("proxy-status", proxyManager.getStatus());
          if (!manualDisconnect) {
            connectToServerInternal(
              {
                ...server,
                useProxy: Boolean(healRes.proxy),
                _proxyHealTries: (server._proxyHealTries || 0) + 1,
              },
              restoredScripts,
            );
          }
        }
      });

      currentBot.on("end", () => {
        if (bot !== currentBot) return;
        const autoRecCfg = currentBot._mcbpAutoReconnect;
        const shouldAutoReconnect =
          !manualDisconnect &&
          lastConnectServer &&
          (activeScripts.has("AutoReconnect") || autoRecCfg?.enabled);
        const scriptsToRestore =
          shouldAutoReconnect && autoRecCfg?.resumeScripts !== false
            ? new Set(activeScripts)
            : shouldAutoReconnect
              ? new Set(["AutoReconnect"])
              : null;
        const delayMs = autoRecCfg?.delayMs || 5000;

        bot = null;
        activeScripts.clear();
        stopTelemetryLoop();
        sendToRenderer("connection-state", { state: "disconnected" });
        log("Bot disconnected");

        if (shouldAutoReconnect) {
          log(
            `AutoReconnect: Rejoining ${lastConnectServer.ip} in ${Math.round(delayMs / 1000)}s...`,
          );
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (!manualDisconnect && lastConnectServer) {
              connectToServerInternal(lastConnectServer, scriptsToRestore);
            }
          }, delayMs);
        }
      });
    } catch (err) {
      bot = null;
      stopTelemetryLoop();
      sendToRenderer("connection-state", { state: "disconnected" });
      log(`Failed to connect: ${err.message || err}`);
    }
  }

  ipcMain.on("connect", async (_event, server = {}) => {
    sessionLogger.record(
      "UI Click",
      "Clicked Connect",
      `Server: ${server.ip || ""} (Version: ${server.version || "Auto"}, Mode: ${server.auth || "offline"})`,
    );
    pushSessionLogStatus();
    await connectToServerInternal(server, null);
  });

  ipcMain.on("disconnect", () => {
    sessionLogger.record("UI Click", "Clicked Leave / Disconnect", "");
    pushSessionLogStatus();
    disconnectBot(true);
  });

  ipcMain.on("bot-control", (_event, payload) => {
    handleBotControl(payload);
  });

  ipcMain.on("inventory-action", (_event, payload) => {
    handleInventoryAction(payload);
  });

  ipcMain.on("send-chat-message", async (_event, chatMessage) => {
    const msg = String(chatMessage || "").trim();
    if (!msg) return;

    sessionLogger.record(
      "UI Click",
      msg.startsWith("!") ? "Console Command" : "Outgoing Chat",
      msg,
    );
    pushSessionLogStatus();

    // Local console commands starting with "!"
    if (msg.startsWith("!")) {
      const parts = msg.slice(1).trim().split(/\s+/);
      const cmd = (parts[0] || "").toLowerCase();
      const args = parts.slice(1);

      if (cmd === "help") {
        log(
          "Console: !do <commands>, !pos, !hp, !gear, !gearup [wood|stone|iron|diamond], !signs, !sign <text>, !ai <msg>, !logs, !close, !weapon, !tool <block>, !goto <x> <y> <z>, !follow <player>, !guard <player>, !hunt <player>, !stop, !dropall, !respawn",
        );
        return;
      }
      if (cmd === "logs" || cmd === "session") {
        const st = sessionLogger.getStatus();
        log(`Session Log: ${st.currentFilePath} (${st.eventCount} events)`);
        if (st.currentFilePath) openWithCleanEnv(st.currentFilePath);
        return;
      }
      if (cmd === "ai") {
        const promptText = args.join(" ").trim();
        if (!promptText) {
          const st = await ollamaManager.getStatus();
          log(
            `AIChat: ${st.serverRunning ? "Online" : "Offline"} | Model: ${st.config.model || st.hardware.recommendedModel} | Auto-reply: ${st.config.enabled ? "ON" : "OFF"} | Agent: ${st.config.agentEnabled ? "ON" : "OFF"}`,
          );
          return;
        }
        log(`AIChat: Generating reply for "${promptText}"...`);
        const aiRes = await runAiReply({
          sender: sessionState.mcName || sessionState.username || "User",
          message: promptText,
          bypassCooldown: true,
        });
        if (aiRes.ok) {
          logAiResult(aiRes, "Server");
          if (bot && typeof bot.chat === "function") {
            aiChatQueue.send(aiRes.parts?.length ? aiRes.parts : [aiRes.reply]);
          }
        } else {
          log(
            aiRes.silent
              ? "AIChat: Model chose not to reply"
              : `AIChat error: ${aiRes.error}`,
          );
        }
        return;
      }
      if (!bot || !bot.entity) {
        log(`Console (!${cmd}): Connect a bot first`);
        return;
      }
      // Plain commands through the translator, e.g. !do walk to Steve; say hi
      if (cmd === "do" || cmd === "run") {
        const text = msg.replace(/^!\s*\S+\s*/, "");
        if (!text) {
          log(
            "Console: !do walk to Steve; mine 5 oak_log; turn on KillAura range=4",
          );
          return;
        }
        try {
          const out = await aiTools.runCommands(
            text,
            sessionState.mcName || sessionState.username || "",
          );
          log(`Console (!do): ${out}`);
        } catch (err) {
          log(`Console (!do) error: ${err.message || err}`);
        }
        return;
      }
      if (cmd === "pos" || cmd === "xyz") {
        const p = bot.entity.position;
        log(
          `Console: XYZ (${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}) in ${bot.game?.dimension || "overworld"}`,
        );
      } else if (cmd === "hp" || cmd === "status") {
        log(
          `Console: HP ${(bot.health ?? 0).toFixed(1)}/20 | Food ${bot.food ?? 0}/20 | Lv ${bot.experience?.level ?? 0} | Ping ${bot.player?.ping ?? 0}ms`,
        );
      } else if (cmd === "signs" || cmd === "sign") {
        const signs = scanNearbySigns(bot, { maxDistance: 24, maxCount: 16 });
        cachedSigns = signs;
        if (signs.length === 0) {
          log("Console: No signs detected within 24 blocks");
          return;
        }
        const query = args.join(" ").trim().toLowerCase();
        if (!query) {
          for (const s of signs) {
            const label = s.text || `(${s.name} — empty)`;
            log(`Sign (${s.x}, ${s.y}, ${s.z}) [${s.distance}m]: ${label}`);
          }
        } else {
          const match = signs.find(
            (s) =>
              s.text.toLowerCase().includes(query) ||
              `${s.x} ${s.y} ${s.z}` === query,
          );
          if (!match) {
            log(`Console: No nearby sign matching "${query}"`);
          } else {
            await handleBotControl({
              action: "sign-action",
              subAction: "interact",
              x: match.x,
              y: match.y,
              z: match.z,
            });
          }
        }
      } else if (cmd === "close") {
        await handleInventoryAction({ action: "container-close" });
      } else if (cmd === "gear") {
        await handleInventoryAction({ action: "auto-gear" });
      } else if (cmd === "gearup") {
        const rawTierArg = (args[0] || "diamond").toLowerCase();
        const tierArg =
          rawTierArg === "wooden"
            ? "wood"
            : rawTierArg === "golden"
              ? "gold"
              : rawTierArg;
        await setOptionValue("tier", "GearUp", tierArg);
        if (!activeScripts.has("GearUp")) {
          const runner = scriptFunctions.get("GearUp");
          if (runner) {
            activeScripts.add("GearUp");
            sendToRenderer("script-state", "GearUp", true);
            runner();
          }
        }
        log(`GearUp: Started progression to ${tierArg} tier`);
      } else if (cmd === "weapon") {
        const w = await equipBestWeapon(bot, { saveLowDurability: true });
        log(w ? `Console: Equipped ${w.name}` : "Console: No weapon found");
      } else if (cmd === "tool" && args[0]) {
        const bName = args[0].toLowerCase().replace(/^minecraft:/, "");
        const bType = bot.registry?.blocksByName?.[bName];
        if (bType) {
          const fakeBlock = { name: bName, material: bType.material };
          const t = await equipBestToolForBlock(bot, fakeBlock);
          log(
            t
              ? `Console: Equipped ${t.name} for ${bName}`
              : `Console: No tool found for ${bName}`,
          );
        } else {
          log(`Console: Unknown block "${bName}"`);
        }
      } else if (cmd === "goto" && args.length >= 2) {
        const { goals } = loadLibraries();
        const x = Number(args[0]);
        const y =
          args.length >= 3
            ? Number(args[1])
            : Math.floor(bot.entity.position.y);
        const z = args.length >= 3 ? Number(args[2]) : Number(args[1]);
        if (
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          Number.isFinite(z) &&
          bot.pathfinder
        ) {
          bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
          log(`Console: Pathing to (${x}, ${y}, ${z})`);
        }
      } else if (cmd === "follow" && args[0]) {
        await handleBotControl({
          action: "entity-action",
          username: args[0],
          subAction: "follow",
        });
      } else if (cmd === "guard" && args[0]) {
        await handleBotControl({
          action: "entity-action",
          username: args[0],
          subAction: "guard",
        });
      } else if (cmd === "hunt" && args[0]) {
        await handleBotControl({
          action: "entity-action",
          username: args[0],
          subAction: "hunt",
        });
      } else if (cmd === "stop") {
        await handleBotControl({ action: "stop-all" });
      } else if (cmd === "dropall") {
        await handleInventoryAction({ action: "drop-all" });
      } else if (cmd === "respawn") {
        await handleBotControl({ action: "respawn" });
      } else {
        log(`Console: Unknown command "!${cmd}". Type !help for commands.`);
      }
      return;
    }

    if (!bot || typeof bot.chat !== "function") {
      log("Cannot send chat: Bot is not connected");
      return;
    }
    bot.chat(msg);
  });

  ipcMain.on("on-script-toggle-on", (_event, scriptId) => {
    const id = String(scriptId || "");
    if (!scriptFunctions.has(id)) return;
    sessionLogger.record("UI Click", `Toggled ON script: ${id}`, "");
    pushSessionLogStatus();
    const tempLogText = "Toggled on ";
    clearLog(tempLogText);
    log(tempLogText + id);
    if (!startScriptByName(id)) sendToRenderer("script-state", id, true);
  });

  ipcMain.on("on-script-toggle-off", (_event, scriptId) => {
    const id = String(scriptId || "");
    if (!stopScriptByName(id)) return;
    sessionLogger.record("UI Click", `Toggled OFF script: ${id}`, "");
    pushSessionLogStatus();
    if (
      (id === "Guard" && activeRadarTarget.subAction === "guard") ||
      (id === "Hunt" && activeRadarTarget.subAction === "hunt")
    ) {
      activeRadarTarget = { subAction: "", username: "", entityId: null };
    }
    const tempLogText = "Toggled off ";
    clearLog(tempLogText);
    log(tempLogText + id);
  });

  // --- Ollama Chat AI IPC Handlers ---
  ipcMain.handle("ollama-get-status", async () => {
    const st = await ollamaManager.getStatus();
    return st;
  });

  ipcMain.handle("ollama-save-config", async (_event, partial = {}) => {
    const flagChanges = {};
    const rest = { ...(partial || {}) };
    for (const [scriptId, flag] of Object.entries(AI_SCRIPT_FLAGS)) {
      if (typeof rest[flag] === "boolean") {
        flagChanges[scriptId] = rest[flag];
        delete rest[flag];
      }
    }
    const updated = ollamaManager.saveConfig(rest);
    // Preload a newly chosen model so the next reply is fast.
    if (ollamaManager.isActive() && ("model" in rest || "agentModel" in rest)) {
      if (updated.enabled) ollamaManager.warmUp(ollamaManager.resolveModel());
      if (updated.agentEnabled)
        ollamaManager.warmUp(ollamaManager.resolveAgentModel());
    }
    sessionLogger.record(
      "UI Click",
      "Updated AIChat Config",
      `Model: ${updated.model}, Trigger: ${updated.triggerMode}, Split: ${updated.splitMessages}`,
    );
    pushSessionLogStatus();
    for (const [scriptId, on] of Object.entries(flagChanges)) {
      if (on && !startScriptByName(scriptId)) {
        // Script file missing: still honour the flag.
        if (!scriptFunctions.has(scriptId)) setAiScriptFlag(scriptId, true);
      } else if (!on) {
        stopScriptByName(scriptId);
        setAiScriptFlag(scriptId, false);
      }
    }
    const st = await ollamaManager.getStatus();
    sendToRenderer("ollama-status", st);
    return st;
  });

  ipcMain.handle("ollama-auto-setup", async (_event, payload = {}) => {
    const preferredModel = String(payload?.model || "").trim();
    sessionLogger.record(
      "UI Click",
      "Clicked Ollama Auto-Setup",
      preferredModel || "Recommended model",
    );
    pushSessionLogStatus();
    log(
      `AIChat: Starting Auto-Setup (${preferredModel || "recommended model"})...`,
    );
    const res = await ollamaManager.autoSetup({
      preferredModel,
      onProgress: (prog) => {
        sendToRenderer("ollama-progress", prog);
      },
    });
    const st = await ollamaManager.getStatus();
    sendToRenderer("ollama-status", st);
    if (res.ok) {
      log(`AIChat: Auto-Setup complete — ${res.model} is ready!`);
      sessionLogger.record(
        "AI Setup",
        "Ollama Auto-Setup Complete",
        `Model ready: ${res.model}`,
      );
    } else {
      log(`AIChat setup error: ${res.error}`);
      sessionLogger.record("AI Setup", "Ollama Auto-Setup Error", res.error);
    }
    pushSessionLogStatus();
    return { ...res, status: st };
  });

  ipcMain.handle("ollama-pull-model", async (_event, modelName) => {
    const clean = String(modelName || "").trim();
    sessionLogger.record("UI Click", `Pulling Ollama model: ${clean}`, "");
    pushSessionLogStatus();
    const startRes = await ollamaManager.ensureServerRunning((prog) =>
      sendToRenderer("ollama-progress", prog),
    );
    if (!startRes.ok) {
      return {
        ok: false,
        error: startRes.error,
        status: await ollamaManager.getStatus(),
      };
    }
    const res = await ollamaManager.pullModel(
      clean,
      (prog) => sendToRenderer("ollama-progress", prog),
      { makeActive: true },
    );
    const st = await ollamaManager.getStatus();
    sendToRenderer("ollama-status", st);
    if (res.ok) {
      log(`AIChat: Pulled model ${clean}`);
    } else {
      log(`AIChat pull error: ${res.error}`);
    }
    return { ...res, status: st };
  });

  ipcMain.handle("ollama-test-prompt", async (_event, payload = {}) => {
    const prompt = String(payload?.prompt || "hey, what are you doing?").trim();
    const model = String(payload?.model || "").trim();
    sessionLogger.record(
      "UI Click",
      "Tested AIChat Prompt",
      `Model: ${model || ollamaManager.config.model} | Prompt: "${prompt}"`,
    );
    pushSessionLogStatus();

    await ollamaManager.ensureServerRunning((prog) =>
      sendToRenderer("ollama-progress", prog),
    );
    const res = await runAiReply({
      sender:
        payload?.sender ||
        sessionState.mcName ||
        sessionState.username ||
        "Player",
      message: prompt,
      overrideModel: model,
      bypassCooldown: true,
      forceAgent: Boolean(payload?.agent),
    });
    if (res.ok) {
      sessionLogger.record(
        "AI Reply",
        `Test Reply (${res.model})`,
        `"${res.reply}" (${res.latencyMs}ms)`,
      );
      if (payload?.sendToServer && bot && typeof bot.chat === "function") {
        aiChatQueue.send(res.parts?.length ? res.parts : [res.reply]);
        log(`AIChat ➙ Server: ${res.reply}`);
      }
    }
    pushSessionLogStatus();
    return res;
  });

  // --- Script Studio IPC Handlers ---
  let studioAbort = null;

  ipcMain.handle("studio-get-init", () => ({
    templates: scriptStudio.listTemplates(),
    docs: scriptStudio.getDocsStatus(),
    customScripts: scriptStudio.listCustomScripts(resolveCustomPath("scripts")),
    builtinScripts: Array.from(scriptSources.entries())
      .filter(([, src]) => src.type === "default")
      .map(([name]) => name),
  }));

  ipcMain.handle("studio-docs-download", async (_event, payload = {}) => {
    sendToRenderer("studio-docs-status", {
      ...scriptStudio.getDocsStatus(),
      downloading: true,
    });
    const res = await scriptStudio.downloadDocs({
      force: Boolean(payload.force),
    });
    sendToRenderer("studio-docs-status", res.status);
    if (!res.ok) log(`Studio: Docs download failed (${res.error})`);
    else if (!res.skipped) log(`Studio: Mineflayer docs updated`);
    return res;
  });

  ipcMain.handle("studio-docs-search", (_event, query) =>
    scriptStudio.searchDocs(String(query || ""), 60),
  );

  ipcMain.handle("studio-docs-section", (_event, id) =>
    scriptStudio.getSection(String(id || "")),
  );

  ipcMain.handle("studio-validate", (_event, code) =>
    scriptStudio.dryRunScript(String(code || "")),
  );

  ipcMain.handle("studio-open-script", (_event, file) =>
    scriptStudio.readCustomScript(resolveCustomPath("scripts"), file),
  );

  ipcMain.handle("studio-save", async (_event, payload = {}) => {
    const code = scriptStudio.autoFixGeneratedScript(
      String(payload.code || ""),
    );
    const check = await scriptStudio.dryRunScript(code);
    if (!check.ok && /^Syntax|^Runtime/.test(check.error || "")) {
      return { ok: false, ...check };
    }
    const name = check.name;
    if (!name) {
      return {
        ok: false,
        error: 'Add a name, e.g. info = { name: "MyScript" }',
      };
    }

    const existing = scriptSources.get(name);
    if (existing && existing.type === "default") {
      return {
        ok: false,
        error: `"${name}" is a built-in script name, pick another`,
      };
    }

    const dir = resolveCustomPath("scripts");
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${scriptStudio.slugify(payload.file || name)}.js`;
    const fullPath = path.join(dir, fileName);
    if (fs.existsSync(fullPath) && !payload.overwrite) {
      return {
        ok: false,
        exists: true,
        file: fileName,
        error: `${fileName} already exists`,
      };
    }
    if (existing && existing.fullPath !== fullPath) {
      return {
        ok: false,
        error: `${path.basename(existing.fullPath)} already uses the name "${name}"`,
      };
    }

    // Same file previously registered under another name: drop the old card.
    for (const [oldName, src] of Array.from(scriptSources.entries())) {
      if (src.fullPath === fullPath && oldName !== name) {
        stopScriptByName(oldName);
        scriptFunctions.delete(oldName);
        scriptSources.delete(oldName);
        sendToRenderer("remove-script", oldName);
      }
    }
    stopScriptByName(name);
    fs.writeFileSync(fullPath, code, "utf8");
    sessionLogger.record("Studio", `Saved script ${fileName}`, name);
    pushSessionLogStatus();
    try {
      registerScriptFile(fullPath, "custom");
    } catch (err) {
      return {
        ok: false,
        saved: true,
        file: fileName,
        error: `Saved, but it failed to load: ${err.message}`,
      };
    }
    log(`Studio: Saved ${fileName} → ${name} is in the Scripts tab`);
    return {
      ok: true,
      file: fileName,
      name,
      warnings: check.problems,
      customScripts: scriptStudio.listCustomScripts(dir),
    };
  });

  ipcMain.handle("studio-generate", async (_event, payload = {}) => {
    const request = String(payload.prompt || "").trim();
    if (!request)
      return { ok: false, error: "Describe what the script should do" };
    if (studioAbort) studioAbort.abort();
    const ctrl = new AbortController();
    studioAbort = ctrl;
    const progress = (p) => sendToRenderer("studio-gen-progress", p);

    try {
      progress({ stage: "starting", message: "Checking local Ollama..." });
      let st = await ollamaManager.getStatus();
      if (!st.installed) {
        const inst = await ollamaManager.installOllamaBinary(progress);
        if (!inst.ok) return { ok: false, error: inst.error };
      }
      const started = await ollamaManager.ensureServerRunning(progress);
      if (!started.ok) return { ok: false, error: started.error };
      st = await ollamaManager.getStatus();

      const model = String(
        payload.model || ollamaManager.resolveScriptModel(st.installedModels),
      ).trim();
      const installed = st.installedModels.some(
        (m) => m.name === model || m.name === `${model}:latest`,
      );
      if (!installed) {
        const pulled = await ollamaManager.pullModel(model, progress);
        sendToRenderer("ollama-status", await ollamaManager.getStatus());
        if (!pulled.ok) return { ok: false, error: pulled.error, model };
      }
      if (ctrl.signal.aborted) return { ok: false, error: "Cancelled" };

      // Stage 1: Give the AI time to think and design a structured technical plan
      progress({
        stage: "planning",
        message: `Thinking & planning architecture with ${model}...`,
      });
      sessionLogger.record("Studio", "Generate script", `${model}: ${request}`);
      const planMessages = scriptStudio.buildPlanMessages({
        request,
        currentCode: payload.currentCode || "",
      });
      let planText = "";
      let lastSent = 0;
      const planRes = await ollamaManager.streamChat({
        model,
        messages: planMessages,
        signal: ctrl.signal,
        options: { temperature: 0.25, num_predict: 900, num_ctx: 8192 },
        onToken: (text) => {
          const now = Date.now();
          if (now - lastSent > 120) {
            lastSent = now;
            const snippet = String(text || "")
              .replace(/<think>[\s\S]*?<\/think>/gi, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(-110);
            progress({
              stage: "planning",
              message: `Planning with ${model}: ${snippet || "analyzing requirements..."}`,
            });
          }
        },
      });
      if (ctrl.signal.aborted) return { ok: false, error: "Cancelled" };
      if (planRes.ok && planRes.text) {
        planText = String(planRes.text)
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .trim();
        aiBrain.recordThought(`Studio Plan (${model}): ${planText.slice(0, 220)}`);
      }

      // Stage 2: Write the complete script from the plan + Mineflayer docs
      progress({
        stage: "writing",
        message: `Writing script from plan with ${model}...`,
        text: "",
      });
      const messages = scriptStudio.buildGenerationMessages({
        request,
        currentCode: payload.currentCode || "",
        plan: planText,
        attempt: 1,
      });
      const res = await ollamaManager.streamChat({
        model,
        messages,
        signal: ctrl.signal,
        options: { temperature: 0.2, num_predict: 2560, num_ctx: 8192 },
        onToken: (text) => {
          const now = Date.now();
          if (now - lastSent > 100) {
            lastSent = now;
            progress({
              stage: "writing",
              message: `Writing script with ${model}...`,
              text,
            });
          }
        },
      });
      if (!res.ok) return { ok: false, error: res.error, model };
      let code = scriptStudio.extractCode(res.text);

      // Stage 3: Recheck (static + sandboxed runtime dry-run) and self-heal up to 3 passes
      progress({
        stage: "verifying",
        message: "Rechecking syntax, contract & dry-running in sandbox...",
        text: code,
      });
      let validation = await scriptStudio.dryRunScript(code);

      const MAX_REPAIR_ATTEMPTS = 3;
      for (
        let attempt = 1;
        attempt <= MAX_REPAIR_ATTEMPTS &&
        !validation.ok &&
        !ctrl.signal.aborted &&
        validation.error;
        attempt++
      ) {
        const isRebuild = attempt === MAX_REPAIR_ATTEMPTS;
        progress({
          stage: "repairing",
          message: isRebuild
            ? `Attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}: Rebuilding clean script from scratch (${validation.error})...`
            : `Attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}: Fixing "${validation.error}" with ${model}...`,
          text: code,
        });
        const fixMessages = scriptStudio.buildGenerationMessages({
          request,
          currentCode: code,
          plan: planText,
          fixError: validation.error,
          attempt: attempt + 1,
        });
        const fixRes = await ollamaManager.streamChat({
          model,
          messages: fixMessages,
          signal: ctrl.signal,
          options: {
            temperature: isRebuild ? 0.25 : 0.12,
            num_predict: 2560,
            num_ctx: 8192,
          },
          onToken: (text) => {
            const now = Date.now();
            if (now - lastSent > 100) {
              lastSent = now;
              progress({
                stage: "repairing",
                message: isRebuild
                  ? `Rebuilding clean script with ${model}...`
                  : `Fixing script (${attempt}/${MAX_REPAIR_ATTEMPTS}) with ${model}...`,
                text,
              });
            }
          },
        });
        if (!fixRes.ok || !fixRes.text) break;
        const candidate = scriptStudio.extractCode(fixRes.text);
        progress({
          stage: "verifying",
          message: `Rechecking repaired script (pass ${attempt}/${MAX_REPAIR_ATTEMPTS})...`,
          text: candidate,
        });
        const candidateCheck = await scriptStudio.dryRunScript(candidate);
        if (
          candidateCheck.ok ||
          !/^Syntax/.test(candidateCheck.error || "")
        ) {
          code = candidate;
          validation = candidateCheck;
        }
      }

      return {
        ok: true,
        code,
        plan: planText,
        model,
        validation,
      };
    } finally {
      if (studioAbort === ctrl) studioAbort = null;
    }
  });

  ipcMain.on("studio-generate-cancel", () => {
    if (studioAbort) studioAbort.abort();
  });

  // --- Session Markdown Logger IPC Handlers ---
  ipcMain.handle("session-log-get-status", () => sessionLogger.getStatus());

  ipcMain.handle("session-log-read-history", (_event, payload = {}) =>
    sessionLogger.readHistoricalEntries(payload),
  );

  ipcMain.on("open-session-log", (_event, filePath) => {
    const target = filePath || sessionLogger.currentFilePath;
    sessionLogger.flush();
    if (target && fs.existsSync(target)) {
      openWithCleanEnv(target);
    } else if (sessionLogger.logsDir) {
      openWithCleanEnv(sessionLogger.logsDir);
    }
  });

  ipcMain.on("open-logs-folder", () => {
    sessionLogger.flush();
    const dir = sessionLogger.logsDir || resolveLogsDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      openWithCleanEnv(dir);
    } catch (_) {}
  });

  ipcMain.on("record-ui-event", (_event, payload = {}) => {
    if (!payload || !payload.event) return;
    sessionLogger.record(
      payload.category || "UI Click",
      payload.event,
      payload.details || "",
    );
    pushSessionLogStatus();
  });

  ipcMain.on("sync-mineflayer", async () => {
    log("Checking npm for latest Mineflayer & minecraft-data...");
    const info = await syncLatestMineflayer({
      onLog: log,
      onUpdated: (updated) => sendToRenderer("runtime-info", updated),
    });
    sendToRenderer("runtime-info", info);
    log(
      `Mineflayer v${info.mineflayerVersion} is up to date (MC ${info.versionRange})`,
    );
  });

  ipcMain.on("open-custom-folder", () => {
    const scriptsDir = resolveCustomPath("scripts");
    try {
      fs.mkdirSync(scriptsDir, { recursive: true });
      openWithCleanEnv(scriptsDir);
    } catch (_) {}
  });

  ipcMain.on("open-external", (_event, url) => {
    if (!/^https?:\/\//.test(String(url || ""))) {
      console.error("URL must include http:// or https://");
      return;
    }
    openWithCleanEnv(String(url));
  });

  ipcMain.on("update-install", async () => {
    const send = (pct) => sendToRenderer("update-progress", pct);
    const result = await updater.installUpdate(send);
    sendToRenderer("update-done", result);
  });

  // --- AI Brain IPC Handlers ---
  ipcMain.handle("ai-brain-get-status", () => aiBrain.getSnapshot(bot));

  // --- Proxy Manager IPC Handlers ---
  ipcMain.handle("proxy-get-status", () => proxyManager.getStatus());

  ipcMain.handle("proxy-save-config", (_event, cfg = {}) => {
    const st = proxyManager.saveConfig(cfg);
    sendToRenderer("proxy-status", st);
    return st;
  });

  ipcMain.handle("proxy-add", (_event, raw) => {
    const res = proxyManager.addProxy(raw);
    if (res.added > 0) {
      log(`Proxy: Added ${res.added} proxy entry/entries`);
    }
    sendToRenderer("proxy-status", res.status);
    return res;
  });

  ipcMain.handle("proxy-remove", (_event, id) => {
    const st = proxyManager.removeProxy(id);
    sendToRenderer("proxy-status", st);
    return st;
  });

  ipcMain.handle("proxy-clear-dead", () => {
    const st = proxyManager.clearDeadProxies();
    sendToRenderer("proxy-status", st);
    return st;
  });

  ipcMain.handle("proxy-fetch-free", async () => {
    log("Proxy: Searching for free public SOCKS5/SOCKS4/HTTP proxies...");
    const res = await proxyManager.fetchFreeProxies({
      maxCount: 120,
      onProgress: (p) => sendToRenderer("proxy-progress", p),
    });
    if (res.ok) {
      log(`Proxy: Found +${res.added} free proxies (pool: ${res.total})`);
    } else if (res.error) {
      log(`Proxy error: ${res.error}`);
    }
    sendToRenderer("proxy-status", proxyManager.getStatus());
    return res;
  });

  ipcMain.handle("proxy-test-all", async (_event, payload = {}) => {
    const targetAddr = parseServerAddress(
      payload?.serverIp || lastConnectServer?.ip || "",
    );
    log(
      `Proxy: Testing proxy pool${targetAddr.ip ? ` against ${targetAddr.ip}:${targetAddr.port}` : ""}...`,
    );
    const res = await proxyManager.testAllProxies({
      targetHost: targetAddr.ip,
      targetPort: targetAddr.port,
      pruneDead: payload?.pruneDead !== false,
      onProgress: (p) => sendToRenderer("proxy-progress", p),
    });
    if (res.ok) {
      log(
        `Proxy: Tested ${res.tested} proxies — ${res.working} verified working`,
      );
    }
    sendToRenderer("proxy-status", proxyManager.getStatus());
    return res;
  });

  // --- Botting Swarm Manager IPC Handlers ---
  ipcMain.handle("botting-get-status", () => bottingManager.getStatus());

  ipcMain.handle("botting-spawn", async (_event, payload = {}) => {
    const addr = parseServerAddress(
      payload?.ip || lastConnectServer?.ip || "localhost",
    );
    return bottingManager.spawnSwarm({
      host: addr.ip || "localhost",
      port: addr.port || 25565,
      version: payload?.version || lastConnectServer?.version || "",
      prefix: payload?.prefix || "MCBP_Bot",
      count: payload?.count || 3,
      delayMs: payload?.delayMs || 1200,
      proxyMode: payload?.proxyMode || "direct",
      autoHeal: payload?.autoHeal !== false,
      log: (t) => log(t),
    });
  });

  ipcMain.handle("botting-stop-all", () =>
    bottingManager.stopAll({ log: (t) => log(t) }),
  );

  ipcMain.handle("botting-disconnect-one", (_event, botId) =>
    bottingManager.disconnectBot(botId),
  );

  ipcMain.handle("botting-action", (_event, payload = {}) =>
    bottingManager.runSwarmAction({
      ...payload,
      mainBotName:
        bot?.username || sessionState.mcName || sessionState.username || "",
      log: (t) => log(t),
    }),
  );
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on("second-instance", () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

if (gotLock) {
  app.whenReady().then(() => {
    process.env.MCBP_VERSION = app.getVersion();
    ollamaManager.init(app.getPath("userData"));
    proxyManager.init(app.getPath("userData"));
    scriptStudio.init({
      userDataDir: app.getPath("userData"),
      baseDirs: [__dirname],
    });
    sessionLogger.init(resolveLogsDir(), { appVersion: app.getVersion() });
    aiBrain.onUpdate((snap) => sendToRenderer("ai-brain-status", snap));
    bottingManager.onUpdate((st) => sendToRenderer("botting-status", st));
    registerIpcHandlers();
    createWindow();

    updater.start((info) => {
      sendToRenderer("update-available", info);
    });

    app.on("activate", () => {
      if (process.platform === "darwin") {
        app.dock.setIcon(ICON_PNG);
      }
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("before-quit", () => {
  stopActiveViaBridge();
  viaProxyBridge.stopAllBridges();
  sessionLogger.finalize();
});

app.on("window-all-closed", () => {
  sessionLogger.finalize();
  closeMsaPopup();
  disconnectBot();
  viaProxyBridge.stopAllBridges();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
