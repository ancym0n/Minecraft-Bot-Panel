let onlineMode = false;
let accountEmail = "";
let accountMcName = "";
let accountUsername = "";
let currentAppVersion = "";
let currentMsaData = null;

let keyboardControlEnabled = false;
const pressedKeys = new Set();
let latestTelemetry = null;
let latestInventory = null;
let selectedInvSlot = null;

const CATEGORY_ICONS = {
  sword: "⚔",
  mace: "🔨",
  trident: "🔱",
  axe: "🪓",
  pickaxe: "⛏",
  shovel: "⛏",
  hoe: "🌾",
  fishing: "🎣",
  tool: "🛠",
  ranged: "🏹",
  ammo: "➳",
  armor: "🛡",
  helmet: "🪖",
  chestplate: "🛡",
  leggings: "👖",
  boots: "🥾",
  elytra: "🪽",
  totem: "✦",
  shield: "🛡",
  gapple: "🍎",
  food: "🍖",
  potion: "🧪",
  bucket: "🪣",
  utility: "🧪",
  compass: "🧭",
  pearl: "🟣",
  book: "📖",
  bed: "🛏",
  key: "🗝",
  disc: "💿",
  skull: "💀",
  explosive: "🧨",
  container: "📦",
  boat: "🛶",
  minecart: "🚋",
  ore: "🪨",
  gem: "💎",
  mineral: "◆",
  redstone: "⚙",
  workstation: "⚒",
  light: "🕯",
  sign: "🪧",
  door: "🚪",
  crop: "🌱",
  plant: "🌸",
  egg: "🥚",
  material: "❖",
  wood: "🪵",
  glass: "🪟",
  decor: "🎨",
  block: "■",
  empty: "",
};

function resolveItemTier(item) {
  if (!item) return "";
  if (item.tier) return item.tier;
  const n = String(item.name || item.displayName || "")
    .toLowerCase()
    .replace(/\s+/g, "_");
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

function resolveItemIcon(item) {
  if (!item) return "";
  const n = String(item.name || item.displayName || "")
    .toLowerCase()
    .replace(/^minecraft:/, "")
    .replace(/\s+/g, "_");

  // Exact & specific pattern icons first
  if (n === "mace") return "🔨";
  if (n === "trident") return "🔱";
  if (n.endsWith("_sword")) return "⚔";
  if (n.endsWith("_axe")) return "🪓";
  if (n.endsWith("_pickaxe")) return "⛏";
  if (n.endsWith("_shovel")) return "⛏";
  if (n.endsWith("_hoe")) return "🌾";
  if (n.includes("fishing_rod")) return "🎣";
  if (n === "shears") return "✂";
  if (n === "flint_and_steel" || n === "fire_charge") return "🔥";
  if (n === "spyglass") return "🔭";
  if (n === "brush") return "🖌";
  if (n === "lead" || n === "name_tag") return "🏷";
  if (n === "saddle" || n.endsWith("_horse_armor")) return "🐎";
  if (n === "goat_horn") return "📯";
  if (n === "bow" || n === "crossbow") return "🏹";
  if (n === "arrow" || n.endsWith("_arrow")) return "➳";
  if (n === "firework_rocket" || n === "firework_star") return "🎆";
  if (n === "wind_charge" || n === "breeze_rod") return "🌪";

  if (n === "totem_of_undying") return "✦";
  if (n === "shield") return "🛡";
  if (n === "elytra") return "🪽";
  if (n.endsWith("_helmet") || n === "turtle_helmet") return "🪖";
  if (n === "carved_pumpkin" || n === "jack_o_lantern") return "🎃";
  if (n.endsWith("_chestplate") || n === "wolf_armor") return "🛡";
  if (n.endsWith("_leggings")) return "👖";
  if (n.endsWith("_boots")) return "🥾";

  if (n.includes("apple")) return "🍎";
  if (n.includes("carrot")) return "🥕";
  if (n.includes("potato")) return "🥔";
  if (n === "bread") return "🍞";
  if (n.includes("melon")) return "🍉";
  if (n.includes("berries") || n === "chorus_fruit") return "🍒";
  if (n === "cookie") return "🍪";
  if (n === "cake" || n.endsWith("_pie")) return "🍰";
  if (n.includes("stew") || n.includes("soup")) return "🥣";
  if (
    n.includes("cod") ||
    n.includes("salmon") ||
    n === "tropical_fish" ||
    n === "pufferfish"
  ) {
    return n.endsWith("_bucket") ? "💧" : "🐟";
  }
  if (
    n.includes("beef") ||
    n.includes("steak") ||
    n.includes("porkchop") ||
    n.includes("mutton") ||
    n.includes("chicken") ||
    n.includes("rabbit") ||
    n === "rotten_flesh"
  ) {
    return "🍖";
  }

  if (
    n === "water_bucket" ||
    (n.endsWith("_bucket") &&
      n !== "lava_bucket" &&
      n !== "milk_bucket" &&
      n !== "powder_snow_bucket")
  )
    return "💧";
  if (n === "lava_bucket" || n === "blaze_rod" || n === "blaze_powder")
    return "🔥";
  if (n === "powder_snow_bucket" || n.includes("snow") || n.includes("ice"))
    return "❄";
  if (n === "milk_bucket" || n === "honey_bottle") return "🍼";
  if (n === "bucket") return "🪣";
  if (
    n.includes("potion") ||
    n === "dragon_breath" ||
    n === "experience_bottle" ||
    n === "ominous_bottle" ||
    n === "glass_bottle"
  ) {
    return "🧪";
  }

  if (n.includes("compass")) return "🧭";
  if (n === "clock") return "🕓";
  if (n.includes("map")) return "🗺";
  if (n === "ender_pearl") return "🟣";
  if (n === "ender_eye") return "👁";
  if (n === "nether_star") return "★";
  if (n === "beacon") return "🚨";
  if (n.includes("book") || n === "paper") return "📖";
  if (n.endsWith("_bed")) return "🛏";
  if (n.includes("key")) return "🗝";
  if (n.includes("music_disc") || n.startsWith("disc_fragment")) return "💿";
  if (n.endsWith("_head") || n.endsWith("_skull")) return "💀";
  if (
    n === "tnt" ||
    n === "tnt_minecart" ||
    n === "end_crystal" ||
    n === "gunpowder"
  )
    return "🧨";

  if (n === "diamond") return "💎";
  if (n === "emerald") return "❖";
  if (n === "gold_ingot" || n === "gold_nugget" || n === "raw_gold")
    return "🪙";
  if (n === "iron_ingot" || n === "iron_nugget" || n === "raw_iron") return "⚙";
  if (n === "copper_ingot" || n === "raw_copper") return "🧱";
  if (
    n === "netherite_ingot" ||
    n === "netherite_scrap" ||
    n === "ancient_debris"
  )
    return "◈";
  if (n === "coal" || n === "charcoal") return "⚫";
  if (n === "redstone") return "✦";
  if (n === "lapis_lazuli") return "🔷";
  if (
    n === "quartz" ||
    n === "amethyst_shard" ||
    n === "echo_shard" ||
    n.startsWith("prismarine_")
  ) {
    return "◇";
  }
  if (n.endsWith("_ore")) return "🪨";

  if (
    n.includes("chest") ||
    n.includes("shulker_box") ||
    n === "barrel" ||
    n.includes("bundle")
  ) {
    return "📦";
  }
  if (n.endsWith("_boat") || n.endsWith("_raft")) return "🛶";
  if (n.includes("minecart")) return "🚋";

  if (
    n.includes("torch") ||
    n.includes("lantern") ||
    n === "glowstone" ||
    n.includes("candle") ||
    n.includes("campfire")
  )
    return "🕯";
  if (n.includes("sign")) return "🪧";
  if (n.endsWith("_banner")) return "🚩";
  if (n.endsWith("_door") || n.endsWith("_trapdoor") || n.endsWith("_gate"))
    return "🚪";
  if (n === "bell") return "🔔";
  if (n === "ladder" || n === "scaffolding") return "🪜";
  if (
    n === "crafting_table" ||
    n === "crafter" ||
    n.includes("furnace") ||
    n === "smoker" ||
    n.includes("anvil") ||
    n === "grindstone" ||
    n === "smithing_table" ||
    n === "stonecutter" ||
    n === "brewing_stand" ||
    n === "enchanting_table"
  ) {
    return "⚒";
  }

  if (n === "bone" || n === "bone_meal") return "🦴";
  if (n === "feather") return "🪶";
  if (n === "string" || n === "cobweb") return "🕸";
  if (n.includes("spider_eye")) return "🕷";
  if (n === "slime_ball" || n === "magma_cream") return "🟢";
  if (
    n === "shulker_shell" ||
    n === "nautilus_shell" ||
    n === "heart_of_the_sea"
  )
    return "🐚";
  if (n.endsWith("_spawn_egg") || n.endsWith("_egg") || n === "egg")
    return "🥚";
  if (
    n.includes("seeds") ||
    n === "wheat" ||
    n === "sugar_cane" ||
    n === "bamboo" ||
    n.endsWith("_sapling") ||
    n === "propagule"
  ) {
    return "🌱";
  }
  if (
    n.includes("flower") ||
    n.includes("tulip") ||
    n === "dandelion" ||
    n === "poppy" ||
    n === "rose_bush" ||
    n === "sunflower" ||
    n.includes("mushroom") ||
    n.includes("fungus")
  ) {
    return "🌸";
  }
  if (
    n.endsWith("_leaves") ||
    n.includes("vine") ||
    n.includes("moss") ||
    n.includes("fern")
  )
    return "🌿";

  if (
    n.endsWith("_log") ||
    n.endsWith("_wood") ||
    n.endsWith("_stem") ||
    n.endsWith("_hyphae") ||
    n.endsWith("_planks") ||
    n === "stick"
  ) {
    return "🪵";
  }
  if (n.includes("glass")) return "🪟";
  if (n.endsWith("_wool") || n.endsWith("_carpet") || n.endsWith("_dye"))
    return "🎨";
  if (
    n.includes("stone") ||
    n.includes("deepslate") ||
    n.includes("brick") ||
    n.includes("granite") ||
    n.includes("diorite") ||
    n.includes("andesite") ||
    n.includes("tuff") ||
    n.includes("basalt") ||
    n.includes("obsidian")
  ) {
    return "🧱";
  }

  return CATEGORY_ICONS[item.category] || "■";
}

function resolveEntityVisual(entity) {
  const n = String(entity?.name || entity?.displayName || "")
    .toLowerCase()
    .replace(/^minecraft:/, "")
    .replace(/\s+/g, "_");
  const cat = entity?.category || (entity?.hostile ? "hostile" : "passive");

  let icon = "🐾";
  if (n === "ender_dragon") icon = "🐉";
  else if (n === "wither" || n === "wither_skeleton") icon = "💀";
  else if (n === "warden") icon = "👁";
  else if (n === "elder_guardian" || n === "guardian") icon = "🐡";
  else if (
    n === "zombie" ||
    n === "zombie_villager" ||
    n === "husk" ||
    n === "drowned"
  )
    icon = "🧟";
  else if (n === "skeleton" || n === "stray" || n === "bogged") icon = "🏹";
  else if (n === "creeper") icon = "🧨";
  else if (n === "spider" || n === "cave_spider") icon = "🕷";
  else if (n === "enderman" || n === "endermite" || n === "shulker")
    icon = "🟣";
  else if (n === "witch" || n === "evoker" || n === "illusioner") icon = "🧙";
  else if (n === "blaze") icon = "🔥";
  else if (n === "breeze") icon = "🌪";
  else if (n === "ghast" || n === "phantom" || n === "vex" || n === "allay")
    icon = "👻";
  else if (n === "slime" || n === "magma_cube") icon = "🟢";
  else if (
    n === "piglin" ||
    n === "piglin_brute" ||
    n === "zombified_piglin" ||
    n === "hoglin" ||
    n === "zoglin"
  )
    icon = "🐗";
  else if (n === "pillager" || n === "vindicator" || n === "ravager")
    icon = "🪓";
  else if (n === "silverfish" || n === "creaking") icon = "🪲";
  else if (n === "wolf") icon = "🐺";
  else if (n === "iron_golem" || n === "snow_golem") icon = "🤖";
  else if (n === "bee") icon = "🐝";
  else if (n === "polar_bear" || n === "panda") icon = "🐻";
  else if (
    n === "villager" ||
    n === "wandering_trader" ||
    n === "npc" ||
    n === "armor_stand"
  )
    icon = "🧑";
  else if (n === "cow" || n === "mooshroom") icon = "🐄";
  else if (n === "pig" || n === "strider") icon = "🐷";
  else if (n === "sheep" || n === "goat") icon = "🐑";
  else if (n === "chicken" || n === "parrot" || n === "bat") icon = "🐔";
  else if (
    n === "horse" ||
    n === "donkey" ||
    n === "mule" ||
    n === "camel" ||
    n === "llama" ||
    n === "trader_llama" ||
    n === "skeleton_horse" ||
    n === "zombie_horse"
  )
    icon = "🐎";
  else if (n === "cat" || n === "ocelot" || n === "fox") icon = "🐱";
  else if (n === "rabbit" || n === "armadillo" || n === "sniffer") icon = "🐇";
  else if (n === "frog" || n === "tadpole" || n === "axolotl") icon = "🐸";
  else if (n === "turtle") icon = "🐢";
  else if (
    n === "cod" ||
    n === "salmon" ||
    n === "tropical_fish" ||
    n === "pufferfish" ||
    n === "dolphin" ||
    n === "squid" ||
    n === "glow_squid"
  )
    icon = "🐟";
  else if (n.includes("boat") || n.includes("raft")) icon = "🛶";
  else if (n.includes("minecart")) icon = "🚋";
  else if (n === "end_crystal") icon = "💎";
  else if (cat === "boss") icon = "👑";
  else if (cat === "hostile") icon = "⚔";
  else if (cat === "neutral") icon = "🛡";
  else if (cat === "npc") icon = "🧑";
  else if (cat === "vehicle") icon = "🛶";

  const tagMap = {
    boss: { cls: "radar-tag-boss", label: "Boss" },
    hostile: { cls: "radar-tag-hostile", label: "Hostile" },
    neutral: { cls: "radar-tag-neutral", label: "Neutral" },
    npc: { cls: "radar-tag-npc", label: "NPC" },
    vehicle: { cls: "radar-tag-vehicle", label: "Vehicle" },
    passive: { cls: "radar-tag-passive", label: "Passive" },
  };
  const tag = tagMap[cat] || tagMap.passive;
  return { icon, tagClass: tag.cls, tagLabel: tag.label };
}

document.querySelectorAll("form").forEach((form) => {
  form.addEventListener("submit", (event) => event.preventDefault());
});

function formatTime() {
  const now = new Date();
  const pad = (n) => (n < 10 ? "0" + n : String(n));
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortItemLabel(item) {
  if (!item) return "";
  const raw = String(item.displayName || item.name || "")
    .replace(/^minecraft:/i, "")
    .replace(/_/g, " ");
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 7);
  return words
    .slice(-2)
    .map((w) => w.slice(0, 4))
    .join(" ");
}

function checkbox(id) {
  const cb = document.getElementById(id);
  if (!cb) return;
  if (cb.value === "off") {
    cb.setAttribute("value", "on");
  } else {
    cb.setAttribute("value", "off");
  }
}

window.checkbox = checkbox;

function updateActiveScriptsBadge() {
  const activeCount = document.querySelectorAll(".script-name-active").length;
  const badge = document.getElementById("active-scripts-badge");
  if (!badge) return;
  if (activeCount > 0) {
    badge.hidden = false;
    badge.textContent = String(activeCount);
  } else {
    badge.hidden = true;
    badge.textContent = "0";
  }
}

function updateTitle() {
  const modeText = onlineMode ? "Microsoft" : "Offline";
  if (currentAppVersion) {
    document.title = `MCBP v${currentAppVersion} > Login > ${modeText} > Panel`;
  }
}

// --- Workspace Tabs ---
document.querySelectorAll(".workspace-tab").forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    const targetTab = tabBtn.getAttribute("data-tab");
    document.querySelectorAll(".workspace-tab").forEach((b) => {
      b.classList.toggle("active", b === tabBtn);
    });
    document.querySelectorAll(".workspace-pane").forEach((pane) => {
      const isMatch = pane.id === `tab-${targetTab}`;
      pane.classList.toggle("active", isMatch);
      pane.hidden = !isMatch;
    });
    if (window.api?.recordUiEvent) {
      window.api.recordUiEvent({
        category: "UI Click",
        event: `Switched workspace tab to ${targetTab}`,
      });
    }
    if (targetTab === "inventory") {
      window.api.inventoryAction({ action: "refresh" });
    } else if (targetTab === "ai" && typeof refreshOllamaUi === "function") {
      refreshOllamaUi();
    }
  });
});

// --- Account & Connection Status ---
window.api.onSetUsername((username) => {
  onlineMode = false;
  accountUsername = username;
  const badge = document.getElementById("account-badge");
  if (badge) badge.textContent = `Offline · ${username}`;
  updateTitle();
});

window.api.onSetAccount((email, mcName) => {
  onlineMode = true;
  accountEmail = email;
  accountMcName = mcName || email;
  const badge = document.getElementById("account-badge");
  if (badge) badge.textContent = `Microsoft · ${accountMcName}`;
  updateTitle();
});

window.api.onSetVersion((version) => {
  currentAppVersion = String(version || "").replace(/^v/i, "");
  updateTitle();
  if (typeof applyFooterVersion === "function") {
    applyFooterVersion(currentAppVersion);
  }
});

window.api.onRuntimeInfo((info) => {
  if (!info) return;
  const runtimeEl = document.getElementById("runtime-status");
  if (runtimeEl) {
    runtimeEl.textContent = `Mineflayer v${info.mineflayerVersion} · MC ${info.versionRange}`;
  }
  const datalist = document.getElementById("mc-versions-list");
  if (datalist && Array.isArray(info.supportedVersions)) {
    datalist.innerHTML =
      '<option value="Auto">Auto-detect server version</option>' +
      info.supportedVersions
        .map((v) => `<option value="${escapeHtml(v)}"></option>`)
        .join("");
  }
});

// --- Panel Microsoft Device Code Banner ---
const panelMsaBanner = document.getElementById("panel-msa-banner");
const panelMsaCode = document.getElementById("panel-msa-code");
const panelMsaPopupBtn = document.getElementById("panel-msa-popup");
const panelMsaBrowserBtn = document.getElementById("panel-msa-browser");

if (window.api && typeof window.api.onMsaCode === "function") {
  window.api.onMsaCode((data) => {
    currentMsaData = data;
    if (!panelMsaBanner) return;
    if (!data || !data.userCode) {
      panelMsaBanner.hidden = true;
      return;
    }
    panelMsaBanner.hidden = false;
    if (panelMsaCode) panelMsaCode.textContent = data.userCode;
  });
}

if (panelMsaCode) {
  panelMsaCode.addEventListener("click", () => {
    if (currentMsaData?.userCode) {
      window.api.copyText(currentMsaData.userCode);
    }
  });
}

if (panelMsaPopupBtn) {
  panelMsaPopupBtn.addEventListener("click", () => {
    if (!currentMsaData) return;
    window.api.msaOpenPopup({
      verificationUri: currentMsaData.verificationUri,
      userCode: currentMsaData.userCode,
    });
  });
}

if (panelMsaBrowserBtn) {
  panelMsaBrowserBtn.addEventListener("click", () => {
    if (!currentMsaData) return;
    if (currentMsaData.userCode) window.api.copyText(currentMsaData.userCode);
    window.api.openExternal(
      currentMsaData.verificationUri || "https://www.microsoft.com/link",
    );
  });
}

window.api.onConnectionState((stateInfo) => {
  const statusBadge = document.getElementById("status-badge");
  if (!statusBadge || !stateInfo) return;
  statusBadge.classList.remove(
    "status-connected",
    "status-connecting",
    "status-disconnected",
  );
  document.body.dataset.conn = ["connected", "connecting"].includes(
    stateInfo.state,
  )
    ? stateInfo.state
    : "disconnected";

  if (stateInfo.state === "connected") {
    statusBadge.classList.add("status-connected");
    statusBadge.textContent = stateInfo.version
      ? `Connected · ${stateInfo.version}`
      : "Connected";
    if (panelMsaBanner) panelMsaBanner.hidden = true;
  } else if (stateInfo.state === "connecting") {
    statusBadge.classList.add("status-connecting");
    statusBadge.textContent = "Connecting…";
  } else {
    statusBadge.classList.add("status-disconnected");
    statusBadge.textContent = "Disconnected";
    if (panelMsaBanner) panelMsaBanner.hidden = true;
    document
      .querySelectorAll(".script-name-active")
      .forEach((el) => el.classList.remove("script-name-active"));
    updateActiveScriptsBadge();
  }
});

// --- Logs & Chat (with full Minecraft color & style formatting) ---
const preLogsEl = document.querySelector(".pre-logs");
const preChatEl = document.querySelector(".pre-chat");
const logFilterInput = document.getElementById("log-filter");
const chatFilterInput = document.getElementById("chat-filter");
const MAX_LOG_LINES = 320;
const MAX_CHAT_LINES = 320;
const chatHistory = [];
let chatHistoryIndex = -1;

const MC_CODE_COLORS = {
  0: "#4a4a5e",
  1: "#4b7bff",
  2: "#2bd968",
  3: "#2bc7d9",
  4: "#d93b3b",
  5: "#b845ff",
  6: "#ffaa00",
  7: "#b5b3c2",
  8: "#757287",
  9: "#6b8cff",
  a: "#55ff55",
  b: "#55ffff",
  c: "#ff5555",
  d: "#ff55ff",
  e: "#ffff55",
  f: "#ffffff",
};

const MC_NAMED_COLORS = {
  black: "#4a4a5e",
  dark_blue: "#4b7bff",
  dark_green: "#2bd968",
  dark_aqua: "#2bc7d9",
  dark_red: "#d93b3b",
  dark_purple: "#b845ff",
  gold: "#ffaa00",
  gray: "#b5b3c2",
  dark_gray: "#757287",
  blue: "#6b8cff",
  green: "#55ff55",
  aqua: "#55ffff",
  red: "#ff5555",
  light_purple: "#ff55ff",
  yellow: "#ffff55",
  white: "#ffffff",
};

function resolveMcColor(colorVal) {
  if (!colorVal) return null;
  const c = String(colorVal).trim().toLowerCase();
  if (MC_NAMED_COLORS[c]) return MC_NAMED_COLORS[c];
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  return null;
}

function buildStyledSpan(text, state) {
  if (!text) return "";
  const classes = ["mc-seg"];
  if (state.bold) classes.push("mc-bold");
  if (state.italic) classes.push("mc-italic");
  if (state.underlined) classes.push("mc-underline");
  if (state.strikethrough) classes.push("mc-strike");
  if (state.obfuscated) classes.push("mc-obf");

  const styleAttr = state.color
    ? ` style="color:${escapeHtml(state.color)}"`
    : "";
  return `<span class="${classes.join(" ")}"${styleAttr}>${escapeHtml(text)}</span>`;
}

function parseLegacySectionString(rawStr, baseState = {}) {
  const str = String(rawStr || "").replace(
    /§x§([0-9a-fA-F])§([0-9a-fA-F])§([0-9a-fA-F])§([0-9a-fA-F])§([0-9a-fA-F])§([0-9a-fA-F])/g,
    "§#$1$2$3$4$5$6",
  );
  let state = {
    color: baseState.color || null,
    bold: Boolean(baseState.bold),
    italic: Boolean(baseState.italic),
    underlined: Boolean(baseState.underlined),
    strikethrough: Boolean(baseState.strikethrough),
    obfuscated: Boolean(baseState.obfuscated),
  };

  let html = "";
  let buf = "";
  let i = 0;

  const flush = () => {
    if (buf) {
      html += buildStyledSpan(buf, state);
      buf = "";
    }
  };

  while (i < str.length) {
    if (str[i] === "§" && i + 1 < str.length) {
      if (
        str[i + 1] === "#" &&
        /^[0-9a-fA-F]{6}/.test(str.slice(i + 2, i + 8))
      ) {
        flush();
        state = {
          color: `#${str.slice(i + 2, i + 8)}`,
          bold: false,
          italic: false,
          underlined: false,
          strikethrough: false,
          obfuscated: false,
        };
        i += 8;
        continue;
      }
      const code = str[i + 1].toLowerCase();
      if (Object.prototype.hasOwnProperty.call(MC_CODE_COLORS, code)) {
        flush();
        state = {
          color: MC_CODE_COLORS[code],
          bold: false,
          italic: false,
          underlined: false,
          strikethrough: false,
          obfuscated: false,
        };
        i += 2;
        continue;
      }
      if (code === "l") {
        flush();
        state.bold = true;
        i += 2;
        continue;
      }
      if (code === "o") {
        flush();
        state.italic = true;
        i += 2;
        continue;
      }
      if (code === "n") {
        flush();
        state.underlined = true;
        i += 2;
        continue;
      }
      if (code === "m") {
        flush();
        state.strikethrough = true;
        i += 2;
        continue;
      }
      if (code === "k") {
        flush();
        state.obfuscated = true;
        i += 2;
        continue;
      }
      if (code === "r") {
        flush();
        state = {
          color: null,
          bold: false,
          italic: false,
          underlined: false,
          strikethrough: false,
          obfuscated: false,
        };
        i += 2;
        continue;
      }
    }
    buf += str[i];
    i++;
  }
  flush();
  return html;
}

function renderMinecraftFormatted(payload) {
  if (!payload) return "";
  if (typeof payload === "string") {
    return parseLegacySectionString(payload, {});
  }
  if (Array.isArray(payload.segments) && payload.segments.length > 0) {
    return payload.segments
      .map((seg) =>
        parseLegacySectionString(seg.text || "", {
          color: resolveMcColor(seg.color),
          bold: seg.bold,
          italic: seg.italic,
          underlined: seg.underlined,
          strikethrough: seg.strikethrough,
          obfuscated: seg.obfuscated,
        }),
      )
      .join("");
  }
  return parseLegacySectionString(payload.motd || payload.text || "", {});
}

function classifyLogMessage(rawText) {
  const text = String(rawText || "");
  const colonIdx = text.indexOf(":");
  if (colonIdx > 0 && colonIdx <= 20) {
    const prefix = text.slice(0, colonIdx).trim();
    const rest = text.slice(colonIdx + 1).trim();
    const low = prefix.toLowerCase();
    let tagClass = "tag-info";
    if (low.includes("error") || low.includes("fail") || low.includes("kick")) {
      tagClass = "tag-error";
    } else if (
      low.includes("guard") ||
      low.includes("hunt") ||
      low.includes("killaura") ||
      low.includes("survival")
    ) {
      tagClass = "tag-combat";
    } else if (
      low.includes("autotool") ||
      low.includes("autoarmor") ||
      low.includes("autoeat") ||
      low.includes("autototem") ||
      low.includes("gearup") ||
      low.includes("mine")
    ) {
      tagClass = "tag-auto";
    } else if (low.includes("console") || low.includes("control")) {
      tagClass = "tag-console";
    }
    return { tag: prefix, body: rest || text, tagClass };
  }
  if (/^(Toggled on|Connected as)/i.test(text)) {
    return { tag: "System", body: text, tagClass: "tag-auto" };
  }
  if (/^(Toggled off|Bot disconnected)/i.test(text)) {
    return { tag: "System", body: text, tagClass: "tag-info" };
  }
  return { tag: "", body: text, tagClass: "tag-info" };
}

function isNearBottom(el) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
}

function applyLogFilterToLine(lineEl) {
  if (!logFilterInput || !lineEl) return;
  const q = logFilterInput.value.trim().toLowerCase();
  if (!q) {
    lineEl.style.display = "";
    return;
  }
  const raw = (lineEl.getAttribute("data-raw") || "").toLowerCase();
  lineEl.style.display = raw.includes(q) ? "" : "none";
}

function applyChatFilterToLine(lineEl) {
  if (!chatFilterInput || !lineEl) return;
  const q = chatFilterInput.value.trim().toLowerCase();
  if (!q) {
    lineEl.style.display = "";
    return;
  }
  const raw = (lineEl.getAttribute("data-raw") || "").toLowerCase();
  lineEl.style.display = raw.includes(q) ? "" : "none";
}

if (logFilterInput) {
  logFilterInput.addEventListener("input", () => {
    if (!preLogsEl) return;
    preLogsEl.querySelectorAll(".log-line").forEach(applyLogFilterToLine);
  });
}

if (chatFilterInput) {
  chatFilterInput.addEventListener("input", () => {
    if (!preChatEl) return;
    preChatEl.querySelectorAll(".chat-line").forEach(applyChatFilterToLine);
  });
}

window.api.onLog((text) => {
  if (!preLogsEl) return;
  const raw = String(text || "");
  const shouldScroll = isNearBottom(preLogsEl);
  const { tag, body, tagClass } = classifyLogMessage(raw);

  const row = document.createElement("div");
  row.className = "log-line";
  row.setAttribute("data-raw", raw);
  const tagHtml = tag
    ? `<span class="log-tag ${tagClass}">${escapeHtml(tag)}</span>`
    : "";
  row.innerHTML = `<time>${formatTime()}</time>${tagHtml}<span class="log-msg">${renderMinecraftFormatted(body)}</span>`;
  applyLogFilterToLine(row);
  preLogsEl.appendChild(row);

  while (preLogsEl.children.length > MAX_LOG_LINES) {
    preLogsEl.removeChild(preLogsEl.firstElementChild);
  }

  if (shouldScroll) {
    preLogsEl.scrollTo(0, preLogsEl.scrollHeight);
  }
});

window.api.onClearLog((text) => {
  if (!preLogsEl) return;
  const needle = String(text || "");
  if (!needle) return;
  preLogsEl.querySelectorAll(".log-line").forEach((row) => {
    const raw = row.getAttribute("data-raw") || "";
    if (raw.includes(needle)) {
      row.remove();
    }
  });
});

// --- Console tabs (logs / chat) ---
let activeConsoleTab = "logs";
const chatUnreadDot = document.getElementById("chat-unread");

function showConsoleTab(name) {
  activeConsoleTab = name;
  document.querySelectorAll(".console-tab").forEach((tab) => {
    tab.classList.toggle(
      "active",
      tab.getAttribute("data-console-tab") === name,
    );
  });
  document.querySelectorAll(".console-pane").forEach((pane) => {
    const match = pane.id === `console-${name}`;
    pane.classList.toggle("active", match);
    pane.hidden = !match;
  });
  const scroller = name === "chat" ? preChatEl : preLogsEl;
  if (scroller) scroller.scrollTo(0, scroller.scrollHeight);
  if (name === "chat" && chatUnreadDot) chatUnreadDot.hidden = true;
}

document.querySelectorAll(".console-tab").forEach((tab) => {
  tab.addEventListener("click", () =>
    showConsoleTab(tab.getAttribute("data-console-tab")),
  );
});

window.api.onChat((payload) => {
  if (!preChatEl) return;
  const shouldScroll = isNearBottom(preChatEl);
  const plainText =
    typeof payload === "string"
      ? payload
      : String(payload?.text || payload?.motd || "");
  if (!plainText.trim()) return;

  const row = document.createElement("div");
  row.className = "chat-line";
  row.setAttribute("data-raw", plainText);
  row.innerHTML = `<time>${formatTime()}</time><span class="chat-msg">${renderMinecraftFormatted(payload)}</span>`;
  applyChatFilterToLine(row);
  preChatEl.appendChild(row);

  while (preChatEl.children.length > MAX_CHAT_LINES) {
    preChatEl.removeChild(preChatEl.firstElementChild);
  }

  if (shouldScroll) {
    preChatEl.scrollTo(0, preChatEl.scrollHeight);
  }
  if (activeConsoleTab !== "chat" && chatUnreadDot) {
    chatUnreadDot.hidden = false;
  }
});

document.getElementById("clear-console-btn").addEventListener("click", () => {
  if (activeConsoleTab === "chat") {
    if (preChatEl) preChatEl.innerHTML = "";
  } else if (preLogsEl) {
    preLogsEl.innerHTML = "";
  }
});

const chatInputEl = document.getElementById("chat-message");

function sendChatMessageFunction() {
  if (!chatInputEl || !chatInputEl.value.trim()) return;
  const val = chatInputEl.value.trim();
  if (chatHistory[0] !== val) {
    chatHistory.unshift(val);
    if (chatHistory.length > 50) chatHistory.pop();
  }
  chatHistoryIndex = -1;
  window.api.sendChatMessage(val);
  chatInputEl.value = "";
}

if (chatInputEl) {
  chatInputEl.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") {
      if (chatHistory.length === 0) return;
      event.preventDefault();
      chatHistoryIndex = Math.min(chatHistory.length - 1, chatHistoryIndex + 1);
      chatInputEl.value = chatHistory[chatHistoryIndex] || "";
    } else if (event.key === "ArrowDown") {
      if (chatHistory.length === 0) return;
      event.preventDefault();
      chatHistoryIndex = Math.max(-1, chatHistoryIndex - 1);
      chatInputEl.value =
        chatHistoryIndex >= 0 ? chatHistory[chatHistoryIndex] : "";
    }
  });
}

document
  .querySelector(".form-chat-message")
  .addEventListener("submit", () => sendChatMessageFunction());
document
  .querySelector("#send")
  .addEventListener("click", () => sendChatMessageFunction());

function connectToServer() {
  const ip = document.getElementById("ip").value.trim();
  const version = document.getElementById("version").value.trim();
  if (onlineMode) {
    window.api.serverConnect({
      ip,
      version,
      username: accountEmail || accountMcName,
      auth: "microsoft",
    });
  } else {
    window.api.serverConnect({
      ip,
      version,
      username: accountUsername,
      auth: "offline",
    });
  }
}

document
  .getElementById("server")
  .addEventListener("submit", () => connectToServer());
document
  .getElementById("connect")
  .addEventListener("click", () => connectToServer());

document.getElementById("leave").addEventListener("click", () => {
  window.api.serverDisconnect();
});

document.getElementById("switch-account").addEventListener("click", () => {
  window.api.backToWelcome();
});

document.getElementById("sync-mineflayer").addEventListener("click", () => {
  window.api.syncMineflayer();
});

document.getElementById("open-custom-scripts").addEventListener("click", () => {
  window.api.openCustomFolder();
});

// --- Scripts Grid, Search, Persistent Options & Stop All ---
const actionsContainer = document.querySelector(".div-actions");
const scriptSearchInput = document.getElementById("script-search");
const stopAllScriptsBtn = document.getElementById("stop-all-scripts");
const SCRIPT_OPTS_STORAGE_KEY = "mcbp-script-options-v1";

const DEFAULT_SCRIPT_OPTIONS = {
  "hostiles-Guard": "on",
  "autoweapon-Guard": "on",
  "radius-Guard": "12",
  "tools-GearUp": "on",
  "armor-GearUp": "on",
  "shield-GearUp": "on",
  "tier-GearUp": "diamond",
  "autoweapon-Hunt": "on",
  "sprintjump-Hunt": "on",
  "crits-Hunt": "on",
  "sprintjump-Follow": "on",
  "hostiles-KillAura": "on",
  "autoweapon-KillAura": "on",
  "crits-KillAura": "on",
  "range-KillAura": "4.2",
  "minetool-AutoTool": "on",
  "weapon-AutoTool": "on",
  "savedur-AutoTool": "on",
  "defend-Survival": "on",
  "survival-Survival": "on",
  "collect-Survival": "on",
  "look-Survival": "on",
  "offhand-AutoArmor": "on",
  "repeat-AutoArmor": "on",
  "repeat-AutoEat": "on",
  "lowhp-AutoEat": "on",
  "minfood-AutoEat": "16",
  "minhp-AutoTotem": "6",
  "autotool-Mine": "on",
  "jump-AntiAFK": "on",
  "rotate-AntiAFK": "on",
  "resumescripts-AutoReconnect": "on",
  "delay-AutoReconnect": "5",
  "returnback-AutoRespawn": "on",
  "steal-ChestStealer": "on",
  "dropjunk-InvManager": "on",
  "sortgear-InvManager": "on",
  "freeslots-InvManager": "6",
  "tunnel-Excavator": "on",
  "autotool-Excavator": "on",
  "size-Excavator": "3",
  "depth-Excavator": "12",
  "replant-AutoFarm": "on",
  "bonemeal-AutoFarm": "on",
  "collect-AutoFarm": "on",
  "radius-AutoFarm": "12",
  "autorod-AutoFish": "on",
  "antiafk-AutoFish": "on",
  "template-AutoBuild": "platform",
  "size-AutoBuild": "5",
  "edges-SafeWalk": "on",
  "hazards-SafeWalk": "on",
};

function loadSavedScriptOptions() {
  try {
    const raw = localStorage.getItem(SCRIPT_OPTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SCRIPT_OPTIONS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SCRIPT_OPTIONS, ...(parsed || {}) };
  } catch (_) {
    return { ...DEFAULT_SCRIPT_OPTIONS };
  }
}

function saveScriptOptionValue(fieldId, val) {
  try {
    const current = loadSavedScriptOptions();
    current[fieldId] = val;
    localStorage.setItem(SCRIPT_OPTS_STORAGE_KEY, JSON.stringify(current));
  } catch (_) {}
}

if (scriptSearchInput) {
  scriptSearchInput.addEventListener("input", () => {
    const q = scriptSearchInput.value.trim().toLowerCase();
    document.querySelectorAll(".script-container").forEach((card) => {
      const name = (card.getAttribute("data-script") || "").toLowerCase();
      card.style.display = !q || name.includes(q) ? "" : "none";
    });
  });
}

if (stopAllScriptsBtn) {
  stopAllScriptsBtn.addEventListener("click", () => {
    document.querySelectorAll(".script-name-active").forEach((el) => {
      const scriptName = el.getAttribute("data-script");
      if (scriptName) {
        window.api.onScriptToggleOff(scriptName);
      }
      el.classList.remove("script-name-active");
    });
    updateActiveScriptsBadge();
  });
}

window.api.onClearScripts(() => {
  if (actionsContainer) actionsContainer.innerHTML = "";
  updateActiveScriptsBadge();
});

if (window.api && typeof window.api.onScriptState === "function") {
  window.api.onScriptState((scriptId, active) => {
    const card = document.querySelector(
      `.script-container[data-script="${CSS.escape(String(scriptId))}"] .script-name`,
    );
    if (card) {
      card.classList.toggle("script-name-active", Boolean(active));
      updateActiveScriptsBadge();
    }
  });
}

window.api.onScript((html, scriptId) => {
  if (!actionsContainer) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html.trim();
  const card = wrapper.firstElementChild;
  if (!card) return;

  card.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", (event) => event.preventDefault());
  });

  const savedOpts = loadSavedScriptOptions();
  card.querySelectorAll("input").forEach((inp) => {
    const fid = inp.id;
    if (!fid) return;
    if (inp.type === "checkbox") {
      if (savedOpts[fid] === "on") {
        inp.checked = true;
        inp.setAttribute("value", "on");
      }
      inp.addEventListener("change", () => {
        const v = inp.checked ? "on" : "off";
        inp.setAttribute("value", v);
        saveScriptOptionValue(fid, v);
      });
    } else {
      if (savedOpts[fid] !== undefined) {
        inp.value = savedOpts[fid];
      }
      inp.addEventListener("input", () => {
        saveScriptOptionValue(fid, inp.value);
      });
    }
  });

  const scriptName = String(scriptId);
  const toggleEl = card.querySelector(".script-name");

  // Options stay tucked away until the user opens them with the arrow.
  if (card.querySelector(".script-options")?.children.length) {
    const gear = document.createElement("button");
    gear.type = "button";
    gear.className = "script-gear";
    gear.title = "Options";
    gear.textContent = "▾";
    gear.addEventListener("click", (event) => {
      event.stopPropagation();
      card.classList.toggle("open");
    });
    card.appendChild(gear);
  }

  if (toggleEl) {
    toggleEl.addEventListener("click", () => {
      if (toggleEl.classList.contains("script-name-active")) {
        window.api.onScriptToggleOff(scriptName);
        toggleEl.classList.remove("script-name-active");
      } else {
        window.api.onScriptToggleOn(scriptName);
        toggleEl.classList.add("script-name-active");
      }
      updateActiveScriptsBadge();
    });
  }

  actionsContainer.appendChild(card);
});

// --- Live Telemetry, Radar & Interactive Controls ---
const teleHpText = document.getElementById("tele-hp-text");
const teleHpFill = document.getElementById("tele-hp-fill");
const teleFoodText = document.getElementById("tele-food-text");
const teleFoodFill = document.getElementById("tele-food-fill");
const telePos = document.getElementById("tele-pos");
const teleHand = document.getElementById("tele-hand");
const controlCoordsReadout = document.getElementById("control-coords-readout");
const radarPlayersCount = document.getElementById("radar-players-count");
const radarPlayersList = document.getElementById("radar-players-list");
const radarEntitiesCount = document.getElementById("radar-entities-count");
const radarEntitiesList = document.getElementById("radar-entities-list");
const radarSignsCount = document.getElementById("radar-signs-count");
const radarSignsList = document.getElementById("radar-signs-list");

function renderRadar(telemetry) {
  if (!radarPlayersList || !radarEntitiesList) return;

  const players = Array.isArray(telemetry?.nearbyPlayers)
    ? telemetry.nearbyPlayers
    : [];
  const entities = Array.isArray(telemetry?.nearbyEntities)
    ? telemetry.nearbyEntities
    : [];
  const signs = Array.isArray(telemetry?.nearbySigns)
    ? telemetry.nearbySigns
    : [];

  if (radarPlayersCount) radarPlayersCount.textContent = String(players.length);
  if (radarEntitiesCount) {
    radarEntitiesCount.textContent = String(entities.length);
  }
  if (radarSignsCount) {
    radarSignsCount.textContent = String(signs.length);
  }

  const radarTarget = telemetry?.radarTarget || {};

  if (!telemetry?.connected || players.length === 0) {
    radarPlayersList.innerHTML = `<p class="radar-empty">${telemetry?.connected ? "No other players online" : "Connect a bot to scan players"}</p>`;
  } else {
    radarPlayersList.innerHTML = players
      .map((p) => {
        const uname = escapeHtml(p.username);
        const isGuarding =
          radarTarget.subAction === "guard" &&
          radarTarget.username === p.username;
        const isHunting =
          radarTarget.subAction === "hunt" &&
          radarTarget.username === p.username;
        const isFollowing =
          radarTarget.subAction === "follow" &&
          radarTarget.username === p.username;
        const distBadge =
          p.inRange && p.distance !== null
            ? `<span class="radar-dist">${p.distance}m</span>`
            : `<span class="radar-dist radar-dist-far">far</span>`;
        return `
          <div class="radar-item">
            <div class="radar-item-info">
              <span class="radar-entity-icon" aria-hidden="true">👤</span>
              <span class="radar-item-name">${uname}</span>
              ${distBadge}
            </div>
            <div class="radar-item-actions">
              <button type="button" class="radar-btn radar-btn-guard ${isGuarding ? "radar-btn-active" : ""}" data-player="${uname}" data-sub="guard" title="Toggle Guard on ${uname}">Guard</button>
              <button type="button" class="radar-btn radar-btn-danger ${isHunting ? "radar-btn-active-danger" : ""}" data-player="${uname}" data-sub="hunt" title="Toggle Hunt on ${uname}">Hunt</button>
              <button type="button" class="radar-btn ${isFollowing ? "radar-btn-active" : ""}" data-player="${uname}" data-sub="follow" title="Toggle Follow on ${uname}">Follow</button>
              <button type="button" class="radar-btn" data-player="${uname}" data-sub="attack" title="Single hit on ${uname}">Hit</button>
            </div>
          </div>
        `;
      })
      .join("");

    radarPlayersList.querySelectorAll(".radar-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const username = btn.getAttribute("data-player");
        const subAction = btn.getAttribute("data-sub");
        window.api.botControl({
          action: "entity-action",
          username,
          subAction,
        });
      });
    });
  }

  if (!telemetry?.connected || entities.length === 0) {
    radarEntitiesList.innerHTML = `<p class="radar-empty">${telemetry?.connected ? "No mobs within 32m" : "Connect a bot to scan mobs"}</p>`;
  } else {
    radarEntitiesList.innerHTML = entities
      .map((e) => {
        const label = escapeHtml(e.displayName || e.name);
        const { icon, tagClass, tagLabel } = resolveEntityVisual(e);
        const isGoing =
          radarTarget.subAction === "goto" && radarTarget.entityId === e.id;
        return `
          <div class="radar-item">
            <div class="radar-item-info">
              <span class="radar-tag ${tagClass}" title="${tagLabel}"></span>
              <span class="radar-entity-icon" title="${tagLabel}">${icon}</span>
              <span class="radar-item-name">${label}</span>
              <span class="radar-dist">${e.distance}m</span>
            </div>
            <div class="radar-item-actions">
              <button type="button" class="radar-btn radar-btn-danger" data-eid="${e.id}" data-sub="attack" title="Attack ${label}">Hit</button>
              <button type="button" class="radar-btn ${isGoing ? "radar-btn-active" : ""}" data-eid="${e.id}" data-sub="goto" title="Toggle walk to ${label}">Go</button>
            </div>
          </div>
        `;
      })
      .join("");

    radarEntitiesList.querySelectorAll(".radar-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entityId = Number(btn.getAttribute("data-eid"));
        const subAction = btn.getAttribute("data-sub");
        window.api.botControl({
          action: "entity-action",
          entityId,
          subAction,
        });
      });
    });
  }

  if (radarSignsList) {
    if (!telemetry?.connected || signs.length === 0) {
      radarSignsList.innerHTML = `<p class="radar-empty">${telemetry?.connected ? "No signs within 24m" : "Connect a bot to scan signs"}</p>`;
    } else {
      radarSignsList.innerHTML = signs
        .map((s) => {
          const cleanLines = Array.isArray(s.lines)
            ? s.lines
                .map((l) =>
                  typeof l === "string"
                    ? l.replace(/\[object Object\]/g, "").trim()
                    : "",
                )
                .filter(Boolean)
            : [];
          const cleanSummary =
            typeof s.summary === "string"
              ? s.summary.replace(/\[object Object\]/g, "").trim()
              : typeof s.text === "string"
                ? s.text.replace(/\[object Object\]/g, "").trim()
                : "";
          const coordTitle = `${s.x}, ${s.y}, ${s.z}`;
          const linesHtml =
            cleanLines.length > 0
              ? cleanLines.map((l) => renderMinecraftFormatted(l)).join(" · ")
              : cleanSummary
                ? renderMinecraftFormatted(cleanSummary)
                : `<span class="muted-text">${escapeHtml((s.name || "sign").replace(/_/g, " "))} (${coordTitle})</span>`;
          return `
            <div class="radar-item radar-sign-item" title="Sign at (${coordTitle})">
              <div class="radar-item-info">
                <span class="radar-entity-icon" aria-hidden="true">🪧</span>
                <span class="radar-item-name radar-sign-text">${linesHtml}</span>
                <span class="radar-dist">${s.distance}m</span>
              </div>
              <div class="radar-item-actions">
                <button type="button" class="radar-btn radar-btn-guard" data-sx="${s.x}" data-sy="${s.y}" data-sz="${s.z}" data-sub="interact" title="Right-click sign (join minigame / interact)">Click</button>
                <button type="button" class="radar-btn" data-sx="${s.x}" data-sy="${s.y}" data-sz="${s.z}" data-sub="punch" title="Left-click / punch sign">Hit</button>
                <button type="button" class="radar-btn" data-sx="${s.x}" data-sy="${s.y}" data-sz="${s.z}" data-sub="goto" title="Walk to sign">Go</button>
              </div>
            </div>
          `;
        })
        .join("");

      radarSignsList.querySelectorAll(".radar-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const x = Number(btn.getAttribute("data-sx"));
          const y = Number(btn.getAttribute("data-sy"));
          const z = Number(btn.getAttribute("data-sz"));
          const subAction = btn.getAttribute("data-sub");
          window.api.botControl({
            action: "sign-action",
            subAction,
            x,
            y,
            z,
          });
        });
      });
    }
  }
}

if (window.api && typeof window.api.onBotTelemetry === "function") {
  window.api.onBotTelemetry((data) => {
    latestTelemetry = data;
    if (!data || !data.connected) {
      if (teleHpText) teleHpText.textContent = "— / 20";
      if (teleHpFill) teleHpFill.style.width = "0%";
      if (teleFoodText) teleFoodText.textContent = "— / 20";
      if (teleFoodFill) teleFoodFill.style.width = "0%";
      if (telePos) telePos.textContent = "—";
      if (teleHand) teleHand.textContent = "Empty hand";
      const strip = document.getElementById("telemetry-strip");
      if (strip) strip.title = "";
      if (controlCoordsReadout) {
        controlCoordsReadout.textContent = "";
      }
      document
        .querySelectorAll("[data-hold-control], [data-toggle-control]")
        .forEach((el) => {
          el.classList.remove("ctrl-active");
        });
      renderRadar(data);
      return;
    }

    const hpPct = Math.max(0, Math.min(100, (data.health / 20) * 100));
    const foodPct = Math.max(0, Math.min(100, (data.food / 20) * 100));

    if (teleHpText) teleHpText.textContent = `${data.health} / 20`;
    if (teleHpFill) teleHpFill.style.width = `${hpPct}%`;
    if (teleFoodText) teleFoodText.textContent = `${data.food} / 20`;
    if (teleFoodFill) teleFoodFill.style.width = `${foodPct}%`;

    if (telePos && data.position) {
      telePos.textContent = `${data.position.x}, ${data.position.y}, ${data.position.z}`;
    }
    const vitalsStrip = document.getElementById("telemetry-strip");
    if (vitalsStrip) {
      vitalsStrip.title = `Level ${data.xpLevel} · ${data.ping} ms · ${data.gameMode} · ${data.dimension}`;
    }
    if (teleHand) {
      teleHand.textContent = data.heldItem
        ? `${resolveItemIcon(data.heldItem)} ${data.heldItem.displayName} ×${data.heldItem.count}`
        : "Empty hand";
    }
    if (controlCoordsReadout && data.position) {
      controlCoordsReadout.textContent = `${data.yaw}° / ${data.pitch}°`;
    }

    if (data.controls) {
      document.querySelectorAll("[data-hold-control]").forEach((btn) => {
        const c = btn.getAttribute("data-hold-control");
        btn.classList.toggle("ctrl-active", Boolean(data.controls[c]));
      });
      document.querySelectorAll("[data-toggle-control]").forEach((btn) => {
        const c = btn.getAttribute("data-toggle-control");
        btn.classList.toggle("ctrl-active", Boolean(data.controls[c]));
      });
    }

    renderRadar(data);
  });
}

// --- On-Screen Toggle Bot Controls ---
const OPPOSITE_CONTROL = {
  forward: "back",
  back: "forward",
  left: "right",
  right: "left",
};

let autoHitTimer = null;
const autoHitBtn = document.getElementById("ctrl-auto-hit");

function stopAutoHit() {
  if (autoHitTimer) {
    clearInterval(autoHitTimer);
    autoHitTimer = null;
  }
  if (autoHitBtn) autoHitBtn.classList.remove("ctrl-active");
}

if (autoHitBtn) {
  autoHitBtn.addEventListener("click", () => {
    if (autoHitTimer) {
      stopAutoHit();
    } else {
      autoHitBtn.classList.add("ctrl-active");
      window.api.botControl({ action: "attack" });
      autoHitTimer = setInterval(() => {
        window.api.botControl({ action: "attack" });
      }, 620);
    }
  });
}

document.querySelectorAll("[data-toggle-control]").forEach((btn) => {
  const control = btn.getAttribute("data-toggle-control");
  btn.addEventListener("click", () => {
    const nextState = !btn.classList.contains("ctrl-active");
    btn.classList.toggle("ctrl-active", nextState);
    if (nextState && OPPOSITE_CONTROL[control]) {
      const oppBtn = document.querySelector(
        `[data-toggle-control="${OPPOSITE_CONTROL[control]}"]`,
      );
      if (oppBtn) oppBtn.classList.remove("ctrl-active");
    }
    window.api.botControl({ action: "move", control, state: nextState });
  });
});

document
  .querySelectorAll("[data-look-yaw], [data-look-pitch]")
  .forEach((btn) => {
    const yawDelta = Number(btn.getAttribute("data-look-yaw")) || 0;
    const pitchDelta = Number(btn.getAttribute("data-look-pitch")) || 0;
    let holdTimer = null;

    const stepLook = () => {
      window.api.botControl({ action: "look", yawDelta, pitchDelta });
    };

    const stopHoldLook = () => {
      if (holdTimer) {
        clearInterval(holdTimer);
        holdTimer = null;
      }
      btn.classList.remove("ctrl-active");
    };

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      btn.classList.add("ctrl-active");
      stepLook();
      holdTimer = setInterval(stepLook, 110);
    });
    btn.addEventListener("pointerup", stopHoldLook);
    btn.addEventListener("pointerleave", stopHoldLook);
    btn.addEventListener("pointercancel", stopHoldLook);
  });

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const action = btn.getAttribute("data-action");
    window.api.botControl({ action });
  });
});

const stopBotBtn = document.getElementById("ctrl-stop-all");
if (stopBotBtn) {
  stopBotBtn.addEventListener("click", () => {
    stopAutoHit();
    document.querySelectorAll("[data-toggle-control]").forEach((el) => {
      el.classList.remove("ctrl-active");
    });
    window.api.botControl({ action: "stop-all" });
  });
}

// --- Keyboard WASD Capture Mode ---
const kbToggleBtn = document.getElementById("kb-mode-toggle");

function releaseAllKeyboardKeys() {
  for (const control of pressedKeys) {
    window.api.botControl({ action: "move", control, state: false });
  }
  pressedKeys.clear();
}

if (kbToggleBtn) {
  kbToggleBtn.addEventListener("click", () => {
    keyboardControlEnabled = !keyboardControlEnabled;
    kbToggleBtn.classList.toggle("kb-toggle-active", keyboardControlEnabled);
    kbToggleBtn.textContent = keyboardControlEnabled
      ? "Keyboard: on"
      : "Keyboard: off";
    if (!keyboardControlEnabled) {
      releaseAllKeyboardKeys();
    }
  });
}

const KEY_TO_CONTROL = {
  KeyW: "forward",
  KeyS: "back",
  KeyA: "left",
  KeyD: "right",
  Space: "jump",
  ShiftLeft: "sneak",
  ShiftRight: "sneak",
  ControlLeft: "sprint",
  ControlRight: "sprint",
  KeyR: "sprint",
};

window.addEventListener("keydown", (event) => {
  if (!keyboardControlEnabled) return;
  const tag = (event.target?.tagName || "").toLowerCase();
  if (
    tag === "input" ||
    tag === "textarea" ||
    event.target?.isContentEditable
  ) {
    return;
  }

  const moveControl = KEY_TO_CONTROL[event.code];
  if (moveControl) {
    event.preventDefault();
    if (!pressedKeys.has(moveControl)) {
      pressedKeys.add(moveControl);
      window.api.botControl({
        action: "move",
        control: moveControl,
        state: true,
      });
    }
    return;
  }

  if (event.code === "ArrowUp") {
    event.preventDefault();
    window.api.botControl({ action: "look", yawDelta: 0, pitchDelta: 10 });
  } else if (event.code === "ArrowDown") {
    event.preventDefault();
    window.api.botControl({ action: "look", yawDelta: 0, pitchDelta: -10 });
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    window.api.botControl({ action: "look", yawDelta: 18, pitchDelta: 0 });
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    window.api.botControl({ action: "look", yawDelta: -18, pitchDelta: 0 });
  } else if (event.code === "KeyF") {
    event.preventDefault();
    window.api.botControl({ action: "attack" });
  } else if (event.code === "KeyE") {
    event.preventDefault();
    window.api.botControl({ action: "use-item" });
  } else if (event.code === "KeyQ") {
    event.preventDefault();
    window.api.botControl({ action: "drop-held", stack: event.ctrlKey });
  } else if (/^Digit[1-9]$/.test(event.code)) {
    event.preventDefault();
    const idx = Number(event.code.replace("Digit", "")) - 1;
    window.api.botControl({ action: "set-hotbar", index: idx });
  }
});

window.addEventListener("keyup", (event) => {
  if (!keyboardControlEnabled) return;
  const moveControl = KEY_TO_CONTROL[event.code];
  if (moveControl && pressedKeys.has(moveControl)) {
    event.preventDefault();
    pressedKeys.delete(moveControl);
    window.api.botControl({
      action: "move",
      control: moveControl,
      state: false,
    });
  }
});

window.addEventListener("blur", () => {
  if (pressedKeys.size > 0) {
    releaseAllKeyboardKeys();
  }
});

// --- Live Bot Inventory Grid, Opened Container & Inspector ---
const invCountBadge = document.getElementById("inv-count-badge");
const invGuiBadge = document.getElementById("inv-gui-badge");
const invContainerBox = document.getElementById("inv-container-box");
const invContainerTitle = document.getElementById("inv-container-title");
const invContainerGrid = document.getElementById("inv-container-grid");
const invContainerCloseBtn = document.getElementById("inv-container-close");
const invMainGrid = document.getElementById("inv-main-grid");
const invHotbarGrid = document.getElementById("inv-hotbar-grid");
const invSelectedName = document.getElementById("inv-selected-name");
const invSelectedMeta = document.getElementById("inv-selected-meta");
const invBtnEquip = document.getElementById("inv-btn-equip");
const invBtnOffhand = document.getElementById("inv-btn-offhand");
const invBtnUse = document.getElementById("inv-btn-use");
const invBtnDrop1 = document.getElementById("inv-btn-drop1");
const invBtnDropStack = document.getElementById("inv-btn-dropstack");
const invAutoGearBtn = document.getElementById("inv-auto-gear");
const invDropAllBtn = document.getElementById("inv-drop-all");
let selectedContainerSlot = null;

function getItemAtSlot(inv, slotNum) {
  if (!inv || typeof slotNum !== "number") return null;
  if (slotNum === 5) return inv.armor?.head || null;
  if (slotNum === 6) return inv.armor?.torso || null;
  if (slotNum === 7) return inv.armor?.legs || null;
  if (slotNum === 8) return inv.armor?.feet || null;
  if (slotNum === 45) return inv.armor?.offhand || null;
  const mainMatch = inv.main?.find((s) => s.slot === slotNum);
  if (mainMatch) return mainMatch.item;
  const hotbarMatch = inv.hotbar?.find((s) => s.slot === slotNum);
  if (hotbarMatch) return hotbarMatch.item;
  return null;
}

function getContainerItemAtSlot(inv, cSlot) {
  if (!inv?.container || typeof cSlot !== "number") return null;
  const entry = inv.container.slots?.find((s) => s.slot === cSlot);
  return entry?.item || null;
}

function updateInspector() {
  if (selectedContainerSlot !== null && latestInventory?.container) {
    const cItem = getContainerItemAtSlot(
      latestInventory,
      selectedContainerSlot,
    );
    const hasCItem = Boolean(cItem && latestInventory?.connected);

    [
      invBtnEquip,
      invBtnOffhand,
      invBtnUse,
      invBtnDrop1,
      invBtnDropStack,
    ].forEach((btn) => {
      if (btn) btn.disabled = false;
    });

    const inspectorEl = document.getElementById("inv-inspector");
    if (inspectorEl) inspectorEl.classList.remove("is-idle");

    if (invBtnEquip) invBtnEquip.textContent = "Click";
    if (invBtnOffhand) invBtnOffhand.textContent = "Right-click";
    if (invBtnUse) invBtnUse.textContent = "Shift-click";
    if (invBtnDrop1) invBtnDrop1.textContent = "Drop";
    if (invBtnDropStack) invBtnDropStack.textContent = "Close";

    if (!hasCItem) {
      if (invSelectedName) {
        invSelectedName.textContent = `Container Slot #${selectedContainerSlot} (Empty)`;
      }
      if (invSelectedMeta) {
        invSelectedMeta.textContent =
          "Left-click slot to interact · Right-click for secondary · Shift-click to transfer";
      }
      return;
    }

    if (invSelectedName) {
      invSelectedName.innerHTML = `${escapeHtml(resolveItemIcon(cItem))} ${renderMinecraftFormatted(cItem.customName || cItem.displayName)} ×${cItem.count}`;
    }
    if (invSelectedMeta) {
      const loreStr =
        Array.isArray(cItem.lore) && cItem.lore.length > 0
          ? ` — ${cItem.lore.map((l) => renderMinecraftFormatted(l)).join(" · ")}`
          : "";
      invSelectedMeta.innerHTML = `<span>Slot #${selectedContainerSlot} (${escapeHtml(cItem.name)})</span>${loreStr}`;
    }
    return;
  }

  if (invBtnOffhand) invBtnOffhand.textContent = "Offhand";
  if (invBtnUse) invBtnUse.textContent = "Use";
  if (invBtnDrop1) invBtnDrop1.textContent = "Drop 1";
  if (invBtnDropStack) invBtnDropStack.textContent = "Drop all";

  const item = getItemAtSlot(latestInventory, selectedInvSlot);
  const hasItem = Boolean(item && latestInventory?.connected);

  [invBtnEquip, invBtnOffhand, invBtnUse, invBtnDrop1, invBtnDropStack].forEach(
    (btn) => {
      if (btn) btn.disabled = !hasItem;
    },
  );

  const inspectorEl = document.getElementById("inv-inspector");
  if (inspectorEl) inspectorEl.classList.toggle("is-idle", !hasItem);

  if (!hasItem) {
    if (invSelectedName) {
      invSelectedName.textContent =
        selectedInvSlot !== null ? "Empty slot" : "Select a slot";
    }
    if (invSelectedMeta) {
      invSelectedMeta.textContent = "Double-click an item to equip it";
    }
    if (invBtnEquip) invBtnEquip.textContent = "Equip";
    return;
  }

  const isEquipSlot = [5, 6, 7, 8, 45].includes(selectedInvSlot);
  if (invBtnEquip) {
    invBtnEquip.textContent = isEquipSlot ? "Unequip" : "Equip";
  }

  if (invSelectedName) {
    invSelectedName.innerHTML = `${escapeHtml(resolveItemIcon(item))} ${renderMinecraftFormatted(item.customName || item.displayName)} ×${item.count}`;
  }
  if (invSelectedMeta) {
    const durText =
      item.maxDurability > 0
        ? ` · ${item.durabilityLeft}/${item.maxDurability} durability`
        : "";
    invSelectedMeta.textContent = `${item.name}${durText}`;
  }
}

function renderSlotInner(item, badgeLabel = "", emptyDefaultIcon = "") {
  const badgeHtml = badgeLabel
    ? `<span class="inv-slot-tag">${escapeHtml(badgeLabel)}</span>`
    : "";
  if (!item) {
    const ghostHtml = emptyDefaultIcon
      ? `<span class="inv-item-icon inv-slot-ghost-icon" aria-hidden="true">${emptyDefaultIcon}</span>`
      : "";
    return `${badgeHtml}${ghostHtml}`;
  }
  const icon = resolveItemIcon(item);
  const tier = resolveItemTier(item);
  const tierClass = tier ? `tier-${escapeHtml(tier)}` : "";
  const label = escapeHtml(shortItemLabel(item));
  const countHtml =
    item.count > 1 ? `<span class="inv-slot-count">${item.count}</span>` : "";
  let durHtml = "";
  if (typeof item.durabilityPct === "number") {
    const durColor =
      item.durabilityPct > 55
        ? "#7bffd0"
        : item.durabilityPct > 25
          ? "#ffd678"
          : "#ff8585";
    durHtml = `<span class="inv-dur-bar"><span class="inv-dur-fill" style="width:${item.durabilityPct}%;background:${durColor}"></span></span>`;
  }
  return `
    ${badgeHtml}
    <span class="inv-item-icon cat-${escapeHtml(item.category || "block")} ${tierClass}">${icon}</span>
    <span class="inv-item-label">${label}</span>
    ${countHtml}
    ${durHtml}
  `;
}

function bindSlotEvents(slotEl, slotNum, hotbarIndex = null, equipDest = null) {
  slotEl.addEventListener("click", () => {
    selectedContainerSlot = null;
    selectedInvSlot = slotNum;
    document.querySelectorAll(".inv-slot").forEach((el) => {
      el.classList.toggle(
        "inv-slot-selected",
        !el.hasAttribute("data-container-slot") &&
          Number(el.getAttribute("data-slot")) === selectedInvSlot,
      );
    });
    if (hotbarIndex !== null) {
      window.api.inventoryAction({
        action: "select-hotbar",
        index: hotbarIndex,
      });
    }
    updateInspector();
  });

  slotEl.addEventListener("dblclick", () => {
    const item = getItemAtSlot(latestInventory, slotNum);
    if (!item) return;
    if (equipDest) {
      window.api.inventoryAction({
        action: "unequip",
        destination: equipDest,
      });
    } else {
      window.api.inventoryAction({
        action: "equip",
        slot: slotNum,
      });
    }
  });
}

function renderInventory(inv) {
  latestInventory = inv;
  if (invCountBadge) {
    invCountBadge.textContent = `${inv?.occupiedCount ?? 0}/36`;
  }

  const hasContainer = Boolean(inv?.connected && inv?.container);
  if (invGuiBadge) {
    invGuiBadge.hidden = !hasContainer;
  }
  if (invContainerBox) {
    invContainerBox.hidden = !hasContainer;
    if (!hasContainer) {
      selectedContainerSlot = null;
    } else {
      const c = inv.container;
      if (invContainerTitle) {
        invContainerTitle.innerHTML = `${renderMinecraftFormatted(c.title)} <span class="muted-text">(${c.slotCount} slots)</span>`;
      }
      if (invContainerGrid) {
        invContainerGrid.innerHTML = (c.slots || [])
          .map(({ slot, item }) => {
            const selected =
              selectedContainerSlot === slot ? "inv-slot-selected" : "";
            const hasItem = item ? "has-item" : "";
            const lorePlain =
              Array.isArray(item?.lore) && item.lore.length > 0
                ? `\n${item.lore.map((l) => l.replace(/§#[0-9a-fA-F]{6}|§[0-9a-fk-or]/gi, "")).join("\n")}`
                : "";
            const title = item
              ? `${escapeHtml(item.displayName)} (x${item.count}) — Container Slot #${slot}${escapeHtml(lorePlain)}`
              : `Container Slot #${slot} (Empty) — Click to interact`;
            return `<div class="inv-slot ${hasItem} ${selected}" data-container-slot="${slot}" title="${title}">${renderSlotInner(item, String(slot))}</div>`;
          })
          .join("");

        invContainerGrid.querySelectorAll(".inv-slot").forEach((el) => {
          const cSlot = Number(el.getAttribute("data-container-slot"));
          el.addEventListener("click", (event) => {
            selectedInvSlot = null;
            selectedContainerSlot = cSlot;
            document.querySelectorAll(".inv-slot").forEach((node) => {
              node.classList.toggle("inv-slot-selected", node === el);
            });
            updateInspector();
            window.api.inventoryAction({
              action: "container-click",
              slot: cSlot,
              mouseButton: 0,
              mode: event.shiftKey ? 1 : 0,
            });
          });
          el.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            selectedInvSlot = null;
            selectedContainerSlot = cSlot;
            document.querySelectorAll(".inv-slot").forEach((node) => {
              node.classList.toggle("inv-slot-selected", node === el);
            });
            updateInspector();
            window.api.inventoryAction({
              action: "container-click",
              slot: cSlot,
              mouseButton: 1,
              mode: 0,
            });
          });
        });
      }
    }
  }

  const equipLabels = {
    5: "Head",
    6: "Chest",
    7: "Legs",
    8: "Feet",
    45: "Offhand",
  };
  const equipDefaultIcons = {
    5: "🪖",
    6: "🛡",
    7: "👖",
    8: "🥾",
    45: "🛡",
  };
  document.querySelectorAll(".inv-equip-slot").forEach((el) => {
    const slotNum = Number(el.getAttribute("data-slot"));
    const dest = el.getAttribute("data-equip-dest");
    const item = getItemAtSlot(inv, slotNum);
    el.classList.toggle("has-item", Boolean(item));
    el.classList.toggle("inv-slot-selected", selectedInvSlot === slotNum);
    el.title = item
      ? `${equipLabels[slotNum]}: ${item.displayName} (x${item.count})`
      : `${equipLabels[slotNum]} (Empty)`;
    el.innerHTML = renderSlotInner(
      item,
      equipLabels[slotNum],
      equipDefaultIcons[slotNum],
    );
    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      bindSlotEvents(el, slotNum, null, dest);
    }
  });

  if (invMainGrid) {
    const mainSlots = inv?.main || [];
    invMainGrid.innerHTML = mainSlots
      .map(({ slot, item }) => {
        const selected = selectedInvSlot === slot ? "inv-slot-selected" : "";
        const hasItem = item ? "has-item" : "";
        const title = item
          ? `${escapeHtml(item.displayName)} (x${item.count}) — Slot #${slot}`
          : `Empty Slot #${slot}`;
        return `<div class="inv-slot ${hasItem} ${selected}" data-slot="${slot}" title="${title}">${renderSlotInner(item)}</div>`;
      })
      .join("");

    invMainGrid.querySelectorAll(".inv-slot").forEach((el) => {
      const slotNum = Number(el.getAttribute("data-slot"));
      bindSlotEvents(el, slotNum, null, null);
    });
  }

  if (invHotbarGrid) {
    const hotbarSlots = inv?.hotbar || [];
    const activeQuick = inv?.quickBarSlot ?? 0;
    invHotbarGrid.innerHTML = hotbarSlots
      .map(({ slot, hotbarIndex, item }) => {
        const selected = selectedInvSlot === slot ? "inv-slot-selected" : "";
        const active =
          hotbarIndex === activeQuick ? "inv-slot-active-hand" : "";
        const hasItem = item ? "has-item" : "";
        const title = item
          ? `Hotbar #${hotbarIndex + 1}: ${escapeHtml(item.displayName)} (x${item.count})`
          : `Hotbar #${hotbarIndex + 1} (Empty)`;
        return `<div class="inv-slot ${hasItem} ${selected} ${active}" data-slot="${slot}" data-hotbar="${hotbarIndex}" title="${title}">${renderSlotInner(item, String(hotbarIndex + 1))}</div>`;
      })
      .join("");

    invHotbarGrid.querySelectorAll(".inv-slot").forEach((el) => {
      const slotNum = Number(el.getAttribute("data-slot"));
      const hbIdx = Number(el.getAttribute("data-hotbar"));
      bindSlotEvents(el, slotNum, hbIdx, null);
    });
  }

  updateInspector();
}

if (window.api && typeof window.api.onBotInventory === "function") {
  window.api.onBotInventory((inv) => {
    renderInventory(inv);
  });
}

if (invContainerCloseBtn) {
  invContainerCloseBtn.addEventListener("click", () => {
    selectedContainerSlot = null;
    window.api.inventoryAction({ action: "container-close" });
  });
}

if (invBtnEquip) {
  invBtnEquip.addEventListener("click", () => {
    if (selectedContainerSlot !== null && latestInventory?.container) {
      window.api.inventoryAction({
        action: "container-click",
        slot: selectedContainerSlot,
        mouseButton: 0,
        mode: 0,
      });
      return;
    }
    if (selectedInvSlot === null) return;
    const destMap = {
      5: "head",
      6: "torso",
      7: "legs",
      8: "feet",
      45: "off-hand",
    };
    if (destMap[selectedInvSlot]) {
      window.api.inventoryAction({
        action: "unequip",
        destination: destMap[selectedInvSlot],
      });
    } else {
      window.api.inventoryAction({
        action: "equip",
        slot: selectedInvSlot,
      });
    }
  });
}

if (invBtnOffhand) {
  invBtnOffhand.addEventListener("click", () => {
    if (selectedContainerSlot !== null && latestInventory?.container) {
      window.api.inventoryAction({
        action: "container-click",
        slot: selectedContainerSlot,
        mouseButton: 1,
        mode: 0,
      });
      return;
    }
    if (selectedInvSlot === null) return;
    window.api.inventoryAction({
      action: "equip-offhand",
      slot: selectedInvSlot,
    });
  });
}

if (invBtnUse) {
  invBtnUse.addEventListener("click", () => {
    if (selectedContainerSlot !== null && latestInventory?.container) {
      window.api.inventoryAction({
        action: "container-click",
        slot: selectedContainerSlot,
        mouseButton: 0,
        mode: 1,
      });
      return;
    }
    if (selectedInvSlot === null) return;
    window.api.inventoryAction({
      action: "use",
      slot: selectedInvSlot,
    });
  });
}

if (invBtnDrop1) {
  invBtnDrop1.addEventListener("click", () => {
    if (selectedContainerSlot !== null && latestInventory?.container) {
      window.api.inventoryAction({
        action: "container-click",
        slot: selectedContainerSlot,
        mouseButton: 0,
        mode: 4,
      });
      return;
    }
    if (selectedInvSlot === null) return;
    window.api.inventoryAction({
      action: "drop-one",
      slot: selectedInvSlot,
    });
  });
}

if (invBtnDropStack) {
  invBtnDropStack.addEventListener("click", () => {
    if (selectedContainerSlot !== null && latestInventory?.container) {
      selectedContainerSlot = null;
      window.api.inventoryAction({ action: "container-close" });
      return;
    }
    if (selectedInvSlot === null) return;
    window.api.inventoryAction({
      action: "drop-stack",
      slot: selectedInvSlot,
    });
  });
}

if (invAutoGearBtn) {
  invAutoGearBtn.addEventListener("click", () => {
    window.api.inventoryAction({ action: "auto-gear" });
  });
}

if (invDropAllBtn) {
  invDropAllBtn.addEventListener("click", () => {
    window.api.inventoryAction({ action: "drop-all" });
  });
}

// --- Session Markdown (.md) Logger UI ---
const openSessionMdBtn = document.getElementById("open-session-md-btn");
const openLogsDirBtn = document.getElementById("open-logs-dir-btn");
const sessionLogCountBadge = document.getElementById("session-log-count");

function applySessionLogStatus(st) {
  if (!st) return;
  if (sessionLogCountBadge) {
    sessionLogCountBadge.textContent = String(st.eventCount ?? 0);
  }
  if (openSessionMdBtn && st.currentFileName) {
    openSessionMdBtn.title = `Open ${st.currentFileName} (${st.eventCount} events, ${st.clickCount} clicks, ${st.collectedTypes} item types collected)`;
  }
}

if (openSessionMdBtn) {
  openSessionMdBtn.addEventListener("click", () => {
    if (window.api?.recordUiEvent) {
      window.api.recordUiEvent({
        category: "UI Click",
        event: "Opened active Session .md log",
      });
    }
    if (window.api?.openSessionLog) {
      window.api.openSessionLog("");
    }
  });
}

if (openLogsDirBtn) {
  openLogsDirBtn.addEventListener("click", () => {
    if (window.api?.recordUiEvent) {
      window.api.recordUiEvent({
        category: "UI Click",
        event: "Opened Session Logs folder",
      });
    }
    if (window.api?.openLogsFolder) {
      window.api.openLogsFolder();
    }
  });
}

if (window.api?.onSessionLogStatus) {
  window.api.onSessionLogStatus((st) => applySessionLogStatus(st));
}
if (window.api?.sessionLogGetStatus) {
  window.api
    .sessionLogGetStatus()
    .then((st) => applySessionLogStatus(st))
    .catch(() => {});
}

// --- Ollama Chat AI Module UI ---
const aiTabDot = document.getElementById("ai-tab-dot");
const aiServiceBadge = document.getElementById("ai-service-badge");
const aiHwSummary = document.getElementById("ai-hw-summary");
const aiAutoSetupBtn = document.getElementById("ai-auto-setup-btn");
const aiRefreshBtn = document.getElementById("ai-refresh-btn");
const aiProgressBox = document.getElementById("ai-progress-box");
const aiProgressText = document.getElementById("ai-progress-text");
const aiProgressPct = document.getElementById("ai-progress-pct");
const aiProgressFill = document.getElementById("ai-progress-fill");
const aiRecBadge = document.getElementById("ai-rec-badge");
const aiToggleEnabledBtn = document.getElementById("ai-toggle-enabled");
const aiModelSelect = document.getElementById("ai-model-select");
const aiTriggerSelect = document.getElementById("ai-trigger-select");
const aiCooldownInput = document.getElementById("ai-cooldown-input");
const aiPersonaInput = document.getElementById("ai-persona-input");
const aiContextCb = document.getElementById("ai-context-cb");
const aiModelsCount = document.getElementById("ai-models-count");
const aiModelsList = document.getElementById("ai-models-list");
const aiCustomModelInput = document.getElementById("ai-custom-model-input");
const aiPullCustomBtn = document.getElementById("ai-pull-custom-btn");
const aiTestInput = document.getElementById("ai-test-input");
const aiTestBtn = document.getElementById("ai-test-btn");
const aiTestOutput = document.getElementById("ai-test-output");

let latestOllamaStatus = null;

function renderOllamaStatus(st) {
  if (!st || typeof st !== "object" || Array.isArray(st) || !st.hardware)
    return;
  latestOllamaStatus = st;
  const hw = st.hardware || {};
  const cfg = st.config || {};
  const installed = Array.isArray(st.installedModels) ? st.installedModels : [];
  const installedSet = new Set(installed.map((m) => m.name));

  if (aiServiceBadge) {
    aiServiceBadge.classList.remove(
      "status-connected",
      "status-connecting",
      "status-disconnected",
    );
    if (st.serverRunning) {
      aiServiceBadge.classList.add("status-connected");
      aiServiceBadge.textContent = st.version
        ? `Ollama · v${st.version}`
        : "Ollama · Online";
    } else if (st.installed) {
      aiServiceBadge.classList.add("status-connecting");
      aiServiceBadge.textContent = "Ollama · Stopped";
    } else {
      aiServiceBadge.classList.add("status-disconnected");
      aiServiceBadge.textContent = "Ollama · Not Installed";
    }
  }

  if (aiHwSummary && hw.recommendReason) {
    aiHwSummary.textContent = hw.recommendReason;
  }

  if (aiRecBadge && hw.recommendedModel) {
    aiRecBadge.textContent = `Recommended: ${hw.recommendedModel}`;
  }

  const isEnabled = Boolean(cfg.enabled);
  if (aiTabDot) {
    aiTabDot.hidden = !isEnabled;
  }
  if (aiToggleEnabledBtn) {
    aiToggleEnabledBtn.classList.toggle("kb-toggle-active", isEnabled);
    aiToggleEnabledBtn.textContent = isEnabled
      ? "Auto-Reply: on"
      : "Auto-Reply: off";
  }

  // Populate model dropdown combining installed + catalog models
  if (aiModelSelect) {
    const catalog = Array.isArray(hw.catalog) ? hw.catalog : [];
    const allNames = [];
    const seen = new Set();
    for (const m of installed) {
      if (!seen.has(m.name)) {
        seen.add(m.name);
        allNames.push({
          name: m.name,
          label: `${m.name} (Installed · ${m.sizeLabel})`,
        });
      }
    }
    for (const c of catalog) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        allNames.push({
          name: c.name,
          label: `${c.name}${c.isRecommended ? " ★ Recommended" : ""} (${c.sizeLabel})`,
        });
      }
    }
    if (cfg.model && !seen.has(cfg.model)) {
      allNames.unshift({ name: cfg.model, label: cfg.model });
    }
    const activeVal = cfg.model || hw.recommendedModel || "qwen2.5:1.5b";
    aiModelSelect.innerHTML = allNames
      .map(
        (m) =>
          `<option value="${escapeHtml(m.name)}" ${m.name === activeVal ? "selected" : ""}>${escapeHtml(m.label)}</option>`,
      )
      .join("");
  }

  if (aiTriggerSelect && cfg.triggerMode) {
    aiTriggerSelect.value = cfg.triggerMode;
  }
  if (
    aiCooldownInput &&
    document.activeElement !== aiCooldownInput &&
    cfg.cooldownSec
  ) {
    aiCooldownInput.value = String(cfg.cooldownSec);
  }
  if (
    aiPersonaInput &&
    document.activeElement !== aiPersonaInput &&
    cfg.systemPrompt
  ) {
    aiPersonaInput.value = cfg.systemPrompt;
  }
  if (aiContextCb) {
    const ctxOn = cfg.includeBotContext !== false;
    aiContextCb.checked = ctxOn;
    aiContextCb.setAttribute("value", ctxOn ? "on" : "off");
  }

  // Render models list
  if (aiModelsList) {
    const catalog = Array.isArray(hw.catalog) ? hw.catalog : [];
    const merged = [];
    const seen = new Set();

    for (const c of catalog) {
      seen.add(c.name);
      merged.push({
        name: c.name,
        desc: c.desc,
        sizeLabel: c.sizeLabel,
        isRecommended: Boolean(c.isRecommended),
        isInstalled:
          installedSet.has(c.name) || installedSet.has(`${c.name}:latest`),
      });
    }
    for (const inst of installed) {
      if (!seen.has(inst.name)) {
        merged.push({
          name: inst.name,
          desc: "Installed local Ollama model",
          sizeLabel: inst.sizeLabel,
          isRecommended: inst.name === hw.recommendedModel,
          isInstalled: true,
        });
      }
    }

    if (aiModelsCount) {
      aiModelsCount.textContent = `${installed.length} installed`;
    }

    const activeModel = cfg.model || hw.recommendedModel;
    aiModelsList.innerHTML = merged
      .map((m) => {
        const isCurrent = m.name === activeModel;
        const recPill = m.isRecommended
          ? `<span class="ai-model-badge is-rec">Recommended</span>`
          : "";
        const instPill = m.isInstalled
          ? `<span class="ai-model-badge is-installed">Installed</span>`
          : `<span class="ai-model-badge">${escapeHtml(m.sizeLabel)}</span>`;
        return `
          <div class="radar-item">
            <div class="radar-item-info">
              <span class="radar-entity-icon">🤖</span>
              <span class="radar-item-name" title="${escapeHtml(m.desc)}">${escapeHtml(m.name)}</span>
              ${recPill}
              ${instPill}
            </div>
            <div class="radar-item-actions">
              <button type="button" class="radar-btn ${isCurrent ? "radar-btn-active" : ""}" data-ai-use="${escapeHtml(m.name)}">${isCurrent ? "Active" : "Use"}</button>
              <button type="button" class="radar-btn" data-ai-pull="${escapeHtml(m.name)}">${m.isInstalled ? "Update" : "Pull"}</button>
            </div>
          </div>
        `;
      })
      .join("");

    aiModelsList.querySelectorAll("[data-ai-use]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const model = btn.getAttribute("data-ai-use");
        if (window.api?.ollamaSaveConfig) {
          const updated = await window.api.ollamaSaveConfig({ model });
          renderOllamaStatus(updated);
        }
      });
    });

    aiModelsList.querySelectorAll("[data-ai-pull]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const model = btn.getAttribute("data-ai-pull");
        if (!model || !window.api?.ollamaPullModel) return;
        btn.disabled = true;
        btn.textContent = "Pulling…";
        await window.api.ollamaPullModel(model);
      });
    });
  }
}

async function refreshOllamaUi() {
  if (!window.api?.ollamaGetStatus) return;
  try {
    const st = await window.api.ollamaGetStatus();
    renderOllamaStatus(st);
  } catch (_) {}
}

function saveAiFormChanges(extra = {}) {
  if (!window.api?.ollamaSaveConfig) return;
  const payload = {
    model: aiModelSelect ? aiModelSelect.value : undefined,
    triggerMode: aiTriggerSelect ? aiTriggerSelect.value : undefined,
    cooldownSec: aiCooldownInput ? Number(aiCooldownInput.value) || 4 : 4,
    systemPrompt: aiPersonaInput ? aiPersonaInput.value.trim() : undefined,
    includeBotContext: aiContextCb ? aiContextCb.checked : true,
    ...extra,
  };
  window.api
    .ollamaSaveConfig(payload)
    .then((st) => renderOllamaStatus(st))
    .catch(() => {});
}

if (aiToggleEnabledBtn) {
  aiToggleEnabledBtn.addEventListener("click", () => {
    const nextEnabled = !(latestOllamaStatus?.config?.enabled ?? false);
    saveAiFormChanges({ enabled: nextEnabled });
  });
}

if (aiModelSelect) {
  aiModelSelect.addEventListener("change", () => saveAiFormChanges());
}
if (aiTriggerSelect) {
  aiTriggerSelect.addEventListener("change", () => saveAiFormChanges());
}
if (aiCooldownInput) {
  aiCooldownInput.addEventListener("change", () => saveAiFormChanges());
}
if (aiPersonaInput) {
  aiPersonaInput.addEventListener("change", () => saveAiFormChanges());
}
if (aiContextCb) {
  aiContextCb.addEventListener("change", () => saveAiFormChanges());
}

if (aiAutoSetupBtn) {
  aiAutoSetupBtn.addEventListener("click", async () => {
    if (!window.api?.ollamaAutoSetup) return;
    aiAutoSetupBtn.disabled = true;
    aiAutoSetupBtn.textContent = "Setting up…";
    if (aiProgressBox) aiProgressBox.hidden = false;
    try {
      const targetModel = aiModelSelect ? aiModelSelect.value : "";
      const res = await window.api.ollamaAutoSetup({ model: targetModel });
      if (res?.status) renderOllamaStatus(res.status);
      if (aiTestOutput) {
        aiTestOutput.textContent = res?.ok
          ? `Ready! Local Ollama is running with ${res.model}.`
          : `Setup note: ${res?.error || "Check Ollama installation"}`;
      }
    } finally {
      aiAutoSetupBtn.disabled = false;
      aiAutoSetupBtn.textContent = "Auto-Setup";
      setTimeout(() => {
        if (aiProgressBox) aiProgressBox.hidden = true;
      }, 1800);
    }
  });
}

if (aiRefreshBtn) {
  aiRefreshBtn.addEventListener("click", () => refreshOllamaUi());
}

if (aiPullCustomBtn && aiCustomModelInput) {
  aiPullCustomBtn.addEventListener("click", async () => {
    const tag = aiCustomModelInput.value.trim();
    if (!tag || !window.api?.ollamaPullModel) return;
    aiPullCustomBtn.disabled = true;
    aiPullCustomBtn.textContent = "Pulling…";
    if (aiProgressBox) aiProgressBox.hidden = false;
    try {
      const res = await window.api.ollamaPullModel(tag);
      if (res?.status) renderOllamaStatus(res.status);
      if (res?.ok) aiCustomModelInput.value = "";
    } finally {
      aiPullCustomBtn.disabled = false;
      aiPullCustomBtn.textContent = "Pull";
      setTimeout(() => {
        if (aiProgressBox) aiProgressBox.hidden = true;
      }, 1800);
    }
  });
}

if (aiTestBtn && aiTestInput && aiTestOutput) {
  const runAiTest = async () => {
    if (!window.api?.ollamaTestPrompt) return;
    const prompt =
      aiTestInput.value.trim() || "hey Steve, what are you working on?";
    const model = aiModelSelect ? aiModelSelect.value : "";
    aiTestBtn.disabled = true;
    aiTestBtn.textContent = "Thinking…";
    aiTestOutput.textContent = `Generating reply with ${model || "Ollama"}…`;
    try {
      const res = await window.api.ollamaTestPrompt({
        prompt,
        model,
        sender: "Alex",
      });
      if (res?.ok) {
        aiTestOutput.textContent = `[${res.model} · ${res.latencyMs}ms] "${res.reply}"`;
      } else {
        aiTestOutput.textContent = `Error: ${res?.error || "Could not reach Ollama. Click Auto-Setup first."}`;
      }
    } finally {
      aiTestBtn.disabled = false;
      aiTestBtn.textContent = "Test AI";
    }
  };
  aiTestBtn.addEventListener("click", runAiTest);
  aiTestInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runAiTest();
    }
  });
}

if (window.api?.onOllamaStatus) {
  window.api.onOllamaStatus((st) => renderOllamaStatus(st));
}

if (window.api?.onOllamaProgress) {
  window.api.onOllamaProgress((prog) => {
    if (!prog || !aiProgressBox) return;
    aiProgressBox.hidden = false;
    if (aiProgressText && prog.message) {
      aiProgressText.textContent = prog.message;
    }
    const pct =
      typeof prog.percent === "number"
        ? Math.max(0, Math.min(100, prog.percent))
        : 20;
    if (aiProgressPct) aiProgressPct.textContent = `${pct}%`;
    if (aiProgressFill) aiProgressFill.style.width = `${pct}%`;
  });
}

refreshOllamaUi();
