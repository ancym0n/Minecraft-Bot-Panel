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

// --- Version picker (themed combo instead of a native datalist) ---
const versionInput = document.getElementById("version");
const versionCombo = window.mcbpDropdown?.attachCombo(versionInput, {
  items: [{ value: "Auto", label: "Auto", hint: "detect" }],
  emptyValue: "Auto",
});
const VERSION_STORAGE_KEY = "mcbp-last-version";
if (versionInput) {
  versionInput.value = localStorage.getItem(VERSION_STORAGE_KEY) || "";
  versionInput.addEventListener("change", () => {
    const v = versionInput.value.trim();
    if (/^auto$/i.test(v)) versionInput.value = "";
    localStorage.setItem(VERSION_STORAGE_KEY, versionInput.value.trim());
  });
}

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
  if (versionCombo && Array.isArray(info.supportedVersions)) {
    const sorted = [...info.supportedVersions].sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    );
    versionCombo.setItems([
      { value: "Auto", label: "Auto", hint: "detect" },
      ...sorted.map((v, i) => ({
        value: v,
        label: v,
        hint: i === 0 ? "latest" : "",
      })),
    ]);
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

if (window.api?.onRemoveScript) {
  window.api.onRemoveScript((scriptId) => {
    document
      .querySelector(
        `.script-container[data-script="${CSS.escape(String(scriptId))}"]`,
      )
      ?.remove();
    aiSyncScripts.delete(String(scriptId));
    updateActiveScriptsBadge();
  });
}

window.api.onScript((html, scriptId, meta = {}) => {
  if (!actionsContainer) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html.trim();
  const card = wrapper.firstElementChild;
  if (!card) return;

  card.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", (event) => event.preventDefault());
  });

  if (meta?.aiSync) aiSyncScripts.add(String(scriptId));

  const savedOpts = loadSavedScriptOptions();
  card.querySelectorAll("select").forEach((sel) => {
    const fid = sel.id;
    if (!fid) return;
    if (!bindAiSyncField(sel)) {
      if (
        savedOpts[fid] !== undefined &&
        [...sel.options].some((o) => o.value === savedOpts[fid])
      ) {
        sel.value = savedOpts[fid];
      }
      sel.addEventListener("change", () =>
        saveScriptOptionValue(fid, sel.value),
      );
    }
    window.mcbpDropdown?.enhanceSelect(sel);
  });
  card.querySelectorAll("input").forEach((inp) => {
    const fid = inp.id;
    if (!fid) return;
    if (bindAiSyncField(inp)) return;
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

  // Re-registered script (saved from Studio): swap the card in place.
  const existing = actionsContainer.querySelector(
    `.script-container[data-script="${CSS.escape(scriptName)}"]`,
  );
  if (existing) {
    if (existing.classList.contains("open")) card.classList.add("open");
    existing.replaceWith(card);
    card.classList.add("script-flash");
    setTimeout(() => card.classList.remove("script-flash"), 1200);
  } else {
    actionsContainer.appendChild(card);
  }
  if (meta?.aiSync && latestOllamaStatus)
    syncAiScriptFields(latestOllamaStatus);
  updateActiveScriptsBadge();
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
const $id = (id) => document.getElementById(id);
const aiTabDot = $id("ai-tab-dot");
const aiServiceBadge = $id("ai-service-badge");
const aiHwSummary = $id("ai-hw-summary");
const aiAutoSetupBtn = $id("ai-auto-setup-btn");
const aiRefreshBtn = $id("ai-refresh-btn");
const aiProgressBox = $id("ai-progress-box");
const aiProgressText = $id("ai-progress-text");
const aiProgressPct = $id("ai-progress-pct");
const aiProgressFill = $id("ai-progress-fill");
const aiRecBadge = $id("ai-rec-badge");
const aiToggleEnabledBtn = $id("ai-toggle-enabled");
const aiToggleAgentBtn = $id("ai-toggle-agent");
const aiModelSelect = $id("ai-model-select");
const aiTriggerSelect = $id("ai-trigger-select");
const aiCooldownInput = $id("ai-cooldown-input");
const aiPersonaInput = $id("ai-persona-input");
const aiContextCb = $id("ai-context-cb");
const aiSplitCb = $id("ai-split-cb");
const aiMaxLenInput = $id("ai-maxlen-input");
const aiPartsInput = $id("ai-parts-input");
const aiGapInput = $id("ai-gap-input");
const aiRateInput = $id("ai-rate-input");
const aiPlayersInput = $id("ai-players-input");
const aiAgentModelSelect = $id("ai-agent-model-select");
const aiAllowCodeCb = $id("ai-allowcode-cb");
const aiAgentHint = $id("ai-agent-hint");
const aiModelsCount = $id("ai-models-count");
const aiModelsList = $id("ai-models-list");
const aiCustomModelInput = $id("ai-custom-model-input");
const aiPullCustomBtn = $id("ai-pull-custom-btn");
const aiTestInput = $id("ai-test-input");
const aiTestBtn = $id("ai-test-btn");
const aiTestAgentCb = $id("ai-test-agent-cb");
const aiTestOutput = $id("ai-test-output");

let latestOllamaStatus = null;

[aiModelSelect, aiTriggerSelect, aiAgentModelSelect].forEach((sel) =>
  window.mcbpDropdown?.enhanceSelect(sel),
);

function syncDropdown(sel) {
  if (sel && sel._dd) sel._dd.sync();
}

function setCheckbox(cb, on) {
  if (!cb) return;
  cb.checked = Boolean(on);
  cb.setAttribute("value", on ? "on" : "off");
}

function setInputUnlessFocused(input, value) {
  if (!input || document.activeElement === input) return;
  input.value = value === undefined || value === null ? "" : String(value);
}

function modelTags(m) {
  return Array.isArray(m.tags) ? m.tags : [];
}

// Options for a model <select>: installed first, then downloadable.
function buildModelOptionsHtml(
  st,
  { purpose = "chat", activeValue = "" } = {},
) {
  const hw = st?.hardware || {};
  const catalog = Array.isArray(hw.catalog) ? hw.catalog : [];
  const installed = Array.isArray(st?.installedModels)
    ? st.installedModels
    : [];
  const installedNames = new Set(installed.map((m) => m.name));
  const isInstalled = (name) =>
    installedNames.has(name) || installedNames.has(`${name}:latest`);
  const recName =
    purpose === "code" ? hw.recommendedCodeModel : hw.recommendedModel;

  const fits = (c) =>
    purpose === "code"
      ? modelTags(c).includes("code")
      : purpose === "agent"
        ? modelTags(c).includes("tools") && modelTags(c).includes("chat")
        : modelTags(c).includes("chat");
  const opt = (value, label, hint) =>
    `<option value="${escapeHtml(value)}" data-hint="${escapeHtml(hint)}"${value === activeValue ? " selected" : ""}>${escapeHtml(label)}</option>`;

  const seen = new Set();
  const inst = [];
  for (const m of installed) {
    const base = catalog.find(
      (c) => c.name === m.name || `${c.name}:latest` === m.name,
    );
    if (base && !fits(base) && purpose !== "code") continue;
    if (!base && purpose === "agent" && /coder/i.test(m.name)) continue;
    seen.add(m.name);
    if (base) seen.add(base.name);
    const name = base ? base.name : m.name;
    inst.push(
      opt(name, name, name === recName ? "★ " + m.sizeLabel : m.sizeLabel),
    );
  }
  const more = [];
  for (const c of catalog) {
    if (seen.has(c.name) || !fits(c) || isInstalled(c.name)) continue;
    seen.add(c.name);
    more.push(
      opt(
        c.name,
        c.name,
        `${c.name === recName ? "★ " : ""}${c.sizeLabel} · download`,
      ),
    );
  }
  let html = "";
  if (purpose === "code") {
    html += opt("", "Auto (best coder model)", "");
  } else if (purpose === "agent") {
    html += opt(
      "",
      "Auto",
      st?.agentModelResolved ? `uses ${st.agentModelResolved}` : "",
    );
  }
  if (activeValue && !seen.has(activeValue) && activeValue !== "") {
    html += opt(activeValue, activeValue, "custom");
  }
  if (inst.length)
    html += `<optgroup label="Installed">${inst.join("")}</optgroup>`;
  if (more.length)
    html += `<optgroup label="Download">${more.join("")}</optgroup>`;
  return html;
}

// Script-tab options that mirror the shared AI config (ChatAI / AIAgent).
const AI_SYNC_FIELDS = {
  replyall: {
    key: "triggerMode",
    kind: "checkbox",
    toUi: (v) => v === "all",
    fromUi: (on) => (on ? "all" : "mention"),
  },
  context: {
    key: "includeBotContext",
    kind: "checkbox",
    toUi: (v) => v !== false,
  },
  split: { key: "splitMessages", kind: "checkbox", toUi: (v) => v !== false },
  model: { key: "model", kind: "select" },
  agentmodel: {
    key: "agentModel",
    kind: "select",
    purpose: "agent",
    allowEmpty: true,
  },
  allowcode: { key: "agentAllowCode", kind: "checkbox" },
  cooldown: { key: "cooldownSec", kind: "number" },
  gap: { key: "messageDelaySec", kind: "number" },
  persona: { key: "systemPrompt", kind: "text" },
  players: { key: "agentAllowedPlayers", kind: "text", allowEmpty: true },
};
const aiSyncScripts = new Set();

function aiSyncFieldFor(el) {
  const m = String(el?.id || "").match(/^([^-]+)-(.+)$/);
  if (!m || !aiSyncScripts.has(m[2])) return null;
  return AI_SYNC_FIELDS[m[1]] || null;
}

function syncAiScriptFields(st) {
  const cfg = st?.config || {};
  aiSyncScripts.forEach((scriptName) => {
    Object.entries(AI_SYNC_FIELDS).forEach(([optId, field]) => {
      const el = document.getElementById(`${optId}-${scriptName}`);
      if (!el) return;
      const value = cfg[field.key];
      if (field.kind === "checkbox") {
        setCheckbox(el, field.toUi ? field.toUi(value) : Boolean(value));
      } else if (field.kind === "select") {
        el.innerHTML = buildModelOptionsHtml(st, {
          purpose: field.purpose || "chat",
          activeValue:
            field.purpose === "agent"
              ? value || ""
              : value || st?.hardware?.recommendedModel || "",
        });
        el.value = field.purpose === "agent" ? value || "" : el.value;
        syncDropdown(el);
      } else {
        setInputUnlessFocused(el, value);
      }
    });
  });
}

function saveAiConfig(partial) {
  if (!window.api?.ollamaSaveConfig) return Promise.resolve(null);
  return window.api
    .ollamaSaveConfig(partial)
    .then((st) => {
      renderOllamaStatus(st);
      return st;
    })
    .catch(() => null);
}

// Wires one script-card field to the shared AI config.
function bindAiSyncField(el) {
  const field = aiSyncFieldFor(el);
  if (!field) return false;
  const commit = () => {
    let value;
    if (field.kind === "checkbox") {
      value = field.fromUi ? field.fromUi(el.checked) : el.checked;
    } else if (field.kind === "number") {
      value = Number(String(el.value).replace(",", "."));
      if (!Number.isFinite(value)) {
        renderOllamaStatus(latestOllamaStatus);
        return;
      }
    } else {
      value = String(el.value).trim();
      if (!value && !field.allowEmpty) return;
    }
    saveAiConfig({ [field.key]: value });
  };
  el.addEventListener("change", commit);
  if (el.tagName === "INPUT" && el.type !== "checkbox") {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.blur();
    });
  }
  return true;
}

function renderOllamaStatus(st) {
  if (!st || typeof st !== "object" || Array.isArray(st) || !st.hardware)
    return;
  latestOllamaStatus = st;
  const hw = st.hardware || {};
  const cfg = st.config || {};
  const installed = Array.isArray(st.installedModels) ? st.installedModels : [];
  const installedSet = new Set(installed.map((m) => m.name));
  // Module options like "AI Fixes Errors" only appear once the AI is set up.
  document.body.classList.toggle(
    "ai-ready",
    Boolean(st.installed && installed.length > 0),
  );

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
  const isAgent = Boolean(cfg.agentEnabled);
  if (aiTabDot) aiTabDot.hidden = !(isEnabled || isAgent);
  if (aiToggleEnabledBtn) {
    aiToggleEnabledBtn.classList.toggle("kb-toggle-active", isEnabled);
    aiToggleEnabledBtn.textContent = `Auto-Reply: ${isEnabled ? "on" : "off"}`;
  }
  if (aiToggleAgentBtn) {
    aiToggleAgentBtn.classList.toggle("kb-toggle-active", isAgent);
    aiToggleAgentBtn.textContent = `Actions: ${isAgent ? "on" : "off"}`;
  }

  const activeModel = cfg.model || hw.recommendedModel || "qwen3:1.7b";
  if (aiModelSelect) {
    aiModelSelect.innerHTML = buildModelOptionsHtml(st, {
      activeValue: activeModel,
    });
    aiModelSelect.value = activeModel;
    syncDropdown(aiModelSelect);
  }
  if (aiTriggerSelect && cfg.triggerMode) {
    aiTriggerSelect.value = cfg.triggerMode;
    syncDropdown(aiTriggerSelect);
  }
  setInputUnlessFocused(aiCooldownInput, cfg.cooldownSec);
  setInputUnlessFocused(aiPersonaInput, cfg.systemPrompt);
  setInputUnlessFocused(aiMaxLenInput, cfg.maxMessageLength);
  setInputUnlessFocused(aiPartsInput, cfg.maxParts);
  setInputUnlessFocused(aiGapInput, cfg.messageDelaySec);
  setInputUnlessFocused(aiRateInput, cfg.maxRepliesPerMinute);
  setInputUnlessFocused(aiPlayersInput, cfg.agentAllowedPlayers);
  setCheckbox(aiContextCb, cfg.includeBotContext !== false);
  setCheckbox(aiAllowCodeCb, Boolean(cfg.agentAllowCode));
  if (aiAgentModelSelect) {
    aiAgentModelSelect.innerHTML = buildModelOptionsHtml(st, {
      purpose: "agent",
      activeValue: cfg.agentModel || "",
    });
    aiAgentModelSelect.value = cfg.agentModel || "";
    syncDropdown(aiAgentModelSelect);
  }
  if (aiAgentHint) {
    const agentModel = st.agentModelResolved || "";
    const chatCanAct =
      !cfg.agentModel && agentModel && agentModel === activeModel;
    const codeOn =
      cfg.agentAllowCode && String(cfg.agentAllowedPlayers || "").trim();
    aiAgentHint.classList.toggle(
      "is-warn",
      Boolean(cfg.agentAllowCode && !codeOn),
    );
    aiAgentHint.textContent =
      cfg.agentAllowCode && !codeOn
        ? "Add allowed players to enable code"
        : agentModel
          ? `Runs on ${agentModel}${chatCanAct ? "" : cfg.agentModel ? "" : " (chat model can't do actions)"}`
          : "";
  }
  setCheckbox(aiSplitCb, cfg.splitMessages !== false);
  [aiMaxLenInput, aiPartsInput, aiGapInput].forEach((inp) => {
    if (inp)
      inp.disabled = cfg.splitMessages === false && inp !== aiMaxLenInput;
  });

  syncAiScriptFields(st);
  if (typeof refreshStudioModels === "function") refreshStudioModels(st);

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
        tags: modelTags(c),
        isRecommended: Boolean(c.isRecommended),
        isInstalled:
          installedSet.has(c.name) || installedSet.has(`${c.name}:latest`),
      });
    }
    for (const inst of installed) {
      if (
        !seen.has(inst.name) &&
        !seen.has(inst.name.replace(/:latest$/, ""))
      ) {
        merged.push({
          name: inst.name,
          desc: "Installed local Ollama model",
          sizeLabel: inst.sizeLabel,
          tags: [],
          isRecommended: false,
          isInstalled: true,
        });
      }
    }
    merged.sort((a, b) => Number(b.isInstalled) - Number(a.isInstalled));

    if (aiModelsCount) {
      aiModelsCount.textContent = `${installed.length} installed`;
    }

    const scriptModel = cfg.scriptModel || "";
    aiModelsList.innerHTML = merged
      .map((m) => {
        const isCode = m.tags.includes("code") && !m.tags.includes("chat");
        const isCurrent = isCode
          ? m.name === scriptModel
          : m.name === activeModel;
        const pills = [
          m.isRecommended
            ? `<span class="ai-model-badge is-rec">Recommended</span>`
            : "",
          m.tags.includes("tools")
            ? `<span class="ai-model-badge is-tools" title="Supports AI Agent actions">Actions</span>`
            : "",
          m.tags.includes("code")
            ? `<span class="ai-model-badge is-code" title="Good at writing scripts (Studio)">Code</span>`
            : "",
          m.isInstalled
            ? `<span class="ai-model-badge is-installed">Installed</span>`
            : `<span class="ai-model-badge">${escapeHtml(m.sizeLabel)}</span>`,
        ].join("");
        return `
          <div class="radar-item" title="${escapeHtml(m.desc)}">
            <div class="radar-item-info">
              <span class="radar-item-name">${escapeHtml(m.name)}</span>
              ${pills}
            </div>
            <div class="radar-item-actions">
              <button type="button" class="radar-btn ${isCurrent ? "radar-btn-active" : ""}" data-ai-use="${escapeHtml(m.name)}" data-ai-code="${isCode ? "1" : ""}">${isCurrent ? "Active" : "Use"}</button>
              <button type="button" class="radar-btn" data-ai-pull="${escapeHtml(m.name)}">${m.isInstalled ? "Update" : "Pull"}</button>
            </div>
          </div>
        `;
      })
      .join("");
  }
}

if (aiModelsList) {
  aiModelsList.addEventListener("click", async (e) => {
    const useBtn = e.target.closest("[data-ai-use]");
    const pullBtn = e.target.closest("[data-ai-pull]");
    if (useBtn) {
      const model = useBtn.getAttribute("data-ai-use");
      const isCode = useBtn.getAttribute("data-ai-code") === "1";
      saveAiConfig(isCode ? { scriptModel: model } : { model });
    } else if (pullBtn && window.api?.ollamaPullModel) {
      pullBtn.disabled = true;
      pullBtn.textContent = "Pulling…";
      if (aiProgressBox) aiProgressBox.hidden = false;
      const res = await window.api.ollamaPullModel(
        pullBtn.getAttribute("data-ai-pull"),
      );
      if (res?.status) renderOllamaStatus(res.status);
      setTimeout(() => {
        if (aiProgressBox) aiProgressBox.hidden = true;
      }, 1800);
    }
  });
}

async function refreshOllamaUi() {
  if (!window.api?.ollamaGetStatus) return;
  try {
    renderOllamaStatus(await window.api.ollamaGetStatus());
  } catch (_) {}
}

function bindAiNumber(input, key) {
  if (!input) return;
  input.addEventListener("change", () => {
    const n = Number(String(input.value).replace(",", "."));
    if (Number.isFinite(n)) saveAiConfig({ [key]: n });
    else renderOllamaStatus(latestOllamaStatus);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
}

function bindAiText(input, key, allowEmpty = false) {
  if (!input) return;
  input.addEventListener("change", () => {
    const v = input.value.trim();
    if (v || allowEmpty) saveAiConfig({ [key]: v });
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
}

aiToggleEnabledBtn?.addEventListener("click", () => {
  saveAiConfig({ enabled: !(latestOllamaStatus?.config?.enabled ?? false) });
});
aiToggleAgentBtn?.addEventListener("click", () => {
  saveAiConfig({
    agentEnabled: !(latestOllamaStatus?.config?.agentEnabled ?? false),
  });
});
aiModelSelect?.addEventListener("change", () =>
  saveAiConfig({ model: aiModelSelect.value }),
);
aiTriggerSelect?.addEventListener("change", () =>
  saveAiConfig({ triggerMode: aiTriggerSelect.value }),
);
aiContextCb?.addEventListener("change", () =>
  saveAiConfig({ includeBotContext: aiContextCb.checked }),
);
aiAgentModelSelect?.addEventListener("change", () =>
  saveAiConfig({ agentModel: aiAgentModelSelect.value }),
);
aiAllowCodeCb?.addEventListener("change", () =>
  saveAiConfig({ agentAllowCode: aiAllowCodeCb.checked }),
);
aiSplitCb?.addEventListener("change", () =>
  saveAiConfig({ splitMessages: aiSplitCb.checked }),
);
bindAiNumber(aiCooldownInput, "cooldownSec");
bindAiNumber(aiMaxLenInput, "maxMessageLength");
bindAiNumber(aiPartsInput, "maxParts");
bindAiNumber(aiGapInput, "messageDelaySec");
bindAiNumber(aiRateInput, "maxRepliesPerMinute");
bindAiText(aiPersonaInput, "systemPrompt");
bindAiText(aiPlayersInput, "agentAllowedPlayers", true);

if (aiAutoSetupBtn) {
  aiAutoSetupBtn.addEventListener("click", async () => {
    if (!window.api?.ollamaAutoSetup) return;
    aiAutoSetupBtn.disabled = true;
    aiAutoSetupBtn.textContent = "Setting up…";
    if (aiProgressBox) aiProgressBox.hidden = false;
    try {
      const res = await window.api.ollamaAutoSetup({
        model: aiModelSelect ? aiModelSelect.value : "",
      });
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

aiRefreshBtn?.addEventListener("click", () => refreshOllamaUi());

if (aiPullCustomBtn && aiCustomModelInput) {
  const pullCustom = async () => {
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
  };
  aiPullCustomBtn.addEventListener("click", pullCustom);
  aiCustomModelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      pullCustom();
    }
  });
}

if (aiTestBtn && aiTestInput && aiTestOutput) {
  const runAiTest = async () => {
    if (!window.api?.ollamaTestPrompt) return;
    const useAgent = Boolean(aiTestAgentCb?.checked);
    const prompt =
      aiTestInput.value.trim() ||
      (useAgent ? "come to me" : "hey, what are you working on?");
    const model = aiModelSelect ? aiModelSelect.value : "";
    aiTestBtn.disabled = true;
    aiTestBtn.textContent = "Thinking…";
    aiTestOutput.textContent = useAgent
      ? `Running actions with ${latestOllamaStatus?.agentModelResolved || "Ollama"}…`
      : `Generating reply with ${model || "Ollama"}…`;
    try {
      const res = await window.api.ollamaTestPrompt({
        prompt,
        model: useAgent ? aiAgentModelSelect?.value || "" : model,
        agent: useAgent,
      });
      if (res?.ok) {
        const lines = [];
        (res.actions || []).forEach((a) =>
          lines.push(
            `⚙ ${a.name}(${JSON.stringify(a.args || {})}) → ${a.result.split("\n")[0]}`,
          ),
        );
        const parts = res.parts?.length ? res.parts : [res.reply];
        parts.forEach((p, i) =>
          lines.push(`${parts.length > 1 ? `${i + 1}. ` : ""}"${p}"`),
        );
        if (res.note) lines.push(res.note);
        aiTestOutput.textContent = `[${res.model} · ${res.latencyMs}ms]\n${lines.join("\n")}`;
      } else {
        aiTestOutput.textContent = res?.silent
          ? `[${res.model}] Stayed silent (the persona told it not to reply to this)`
          : `Error: ${res?.error || "Could not reach Ollama. Click Auto-Setup first."}`;
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

aiTestAgentCb?.addEventListener("change", () => {
  aiTestAgentCb.setAttribute("value", aiTestAgentCb.checked ? "on" : "off");
});

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

// --- Script Studio (templates, Mineflayer docs, local AI generator) ---
const studioPicker = $id("studio-template-select");
const studioPrompt = $id("studio-prompt");
const studioModelSelect = $id("studio-model-select");
const studioGenerateBtn = $id("studio-generate-btn");
const studioGenStatus = $id("studio-gen-status");
const studioAiCard = document.querySelector(".studio-ai-card");
const studioEditor = $id("studio-editor");
const studioGutter = $id("studio-gutter");
const studioCheck = $id("studio-check");
const studioFilename = $id("studio-filename");
const studioCheckBtn = $id("studio-check-btn");
const studioSaveBtn = $id("studio-save-btn");
const studioDocsCount = $id("studio-docs-count");
const studioDocsSearch = $id("studio-docs-search");
const studioDocsBadge = $id("studio-docs-badge");
const studioDocsUpdate = $id("studio-docs-update");
const studioDocsList = $id("studio-docs-list");
const studioDocsReader = $id("studio-docs-reader");

const studio = {
  ready: false,
  templates: [],
  customScripts: [],
  currentFile: "",
  filenameTouched: false,
  undoCode: null,
  generating: false,
  activeDocId: "",
  errorLine: null,
};

[studioPicker, studioModelSelect].forEach((sel) =>
  window.mcbpDropdown?.enhanceSelect(sel),
);

document.querySelectorAll(".studio-view-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.getAttribute("data-studio-view");
    document
      .querySelectorAll(".studio-view-tab")
      .forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".studio-view").forEach((pane) => {
      pane.hidden = pane.id !== `studio-view-${view}`;
    });
    if (view === "docs" && studioDocsList && !studioDocsList.children.length) {
      runDocsSearch();
    }
  });
});

function setStudioCheck(text, kind = "idle", extraHtml = "") {
  if (!studioCheck) return;
  studioCheck.className = `studio-check is-${kind}`;
  studioCheck.textContent = text;
  studioCheck.title = text;
  if (extraHtml) studioCheck.insertAdjacentHTML("beforeend", extraHtml);
}

function updateGutter() {
  if (!studioGutter || !studioEditor) return;
  const lines = studioEditor.value.split("\n").length;
  let html = "";
  for (let i = 1; i <= lines; i++) {
    html +=
      i === studio.errorLine
        ? `<span class="is-error">${i}</span>\n`
        : `${i}\n`;
  }
  studioGutter.innerHTML = html;
  studioGutter.scrollTop = studioEditor.scrollTop;
}

function scriptNameFromCode(code) {
  const m = String(code || "").match(/name\s*:\s*["'`]([^"'`\n]{1,48})["'`]/);
  return m ? m[1].trim() : "";
}

function slugifyFile(name) {
  return String(name || "")
    .trim()
    .replace(/\.js$/i, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48);
}

function syncFilenameFromCode() {
  if (!studioFilename || studio.filenameTouched || studio.currentFile) return;
  studioFilename.value = slugifyFile(scriptNameFromCode(studioEditor.value));
}

function setEditorCode(code, { file = "", label = "" } = {}) {
  if (!studioEditor) return;
  const prev = studioEditor.value;
  studio.undoCode = prev.trim() && prev !== code ? prev : null;
  studioEditor.value = code;
  studioEditor.scrollTop = 0;
  studio.currentFile = file;
  studio.filenameTouched = Boolean(file);
  studio.errorLine = null;
  if (studioFilename) {
    studioFilename.value = file
      ? file.replace(/\.js$/, "")
      : slugifyFile(scriptNameFromCode(code));
  }
  updateGutter();
  validateStudio({
    prefix: label,
    undo: studio.undoCode !== null,
  });
}

let studioValidateTimer = null;
async function validateStudio({ prefix = "", undo = false } = {}) {
  if (!window.api?.studioValidate || !studioEditor) return null;
  const code = studioEditor.value;
  const undoHtml = undo
    ? ` <button type="button" class="link-button" data-studio-undo>Undo</button>`
    : "";
  if (!code.trim()) {
    studio.errorLine = null;
    updateGutter();
    setStudioCheck("Pick a template or generate a script", "idle");
    return null;
  }
  const res = await window.api.studioValidate(code);
  studio.errorLine = res?.line || null;
  updateGutter();
  const lead = prefix ? `${prefix} · ` : "";
  if (res?.ok) {
    setStudioCheck(`${lead}✓ ${res.name} looks good`, "ok", undoHtml);
  } else if (res?.line || /^Syntax/.test(res?.error || "")) {
    setStudioCheck(`${lead}${res.error}`, "error", undoHtml);
  } else {
    setStudioCheck(
      `${lead}⚠ ${res?.error || "Check the script"}`,
      "warn",
      undoHtml,
    );
  }
  return res;
}

studioCheck?.addEventListener("click", (e) => {
  if (!e.target.closest("[data-studio-undo]") || studio.undoCode === null)
    return;
  const back = studio.undoCode;
  studio.undoCode = null;
  studioEditor.value = back;
  updateGutter();
  validateStudio({ prefix: "Restored previous code" });
});

if (studioEditor) {
  studioEditor.addEventListener("input", () => {
    updateGutter();
    syncFilenameFromCode();
    clearTimeout(studioValidateTimer);
    studioValidateTimer = setTimeout(() => validateStudio(), 600);
  });
  studioEditor.addEventListener("scroll", () => {
    if (studioGutter) studioGutter.scrollTop = studioEditor.scrollTop;
  });
  studioEditor.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      document.execCommand("insertText", false, "  ");
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveStudioScript();
    }
  });
}

studioFilename?.addEventListener("input", () => {
  studio.filenameTouched = Boolean(studioFilename.value.trim());
  if (!studio.filenameTouched) studio.currentFile = "";
});

function buildPickerOptions() {
  if (!studioPicker) return;
  let html = `<option value="">Open template or script…</option>`;
  if (studio.templates.length) {
    html += `<optgroup label="Templates">${studio.templates
      .map(
        (t) =>
          `<option value="tpl:${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`,
      )
      .join("")}</optgroup>`;
  }
  if (studio.customScripts.length) {
    html += `<optgroup label="My scripts">${studio.customScripts
      .map(
        (c) =>
          `<option value="file:${escapeHtml(c.file)}" data-hint="${escapeHtml(c.file)}">${escapeHtml(c.name)}</option>`,
      )
      .join("")}</optgroup>`;
  }
  studioPicker.innerHTML = html;
  studioPicker.value = "";
  syncDropdown(studioPicker);
}

studioPicker?.addEventListener("change", async () => {
  const val = studioPicker.value;
  studioPicker.value = "";
  syncDropdown(studioPicker);
  if (val.startsWith("tpl:")) {
    const tpl = studio.templates.find((t) => t.id === val.slice(4));
    if (tpl) {
      setEditorCode(tpl.code, { label: `Template: ${tpl.title}` });
      if (studioGenStatus && tpl.desc) studioGenStatus.textContent = tpl.desc;
    }
  } else if (val.startsWith("file:") && window.api?.studioOpenScript) {
    const res = await window.api.studioOpenScript(val.slice(5));
    if (res)
      setEditorCode(res.code, { file: res.file, label: `Opened ${res.file}` });
  }
  studioEditor?.focus();
});

async function saveStudioScript({ overwrite = false } = {}) {
  if (!window.api?.studioSave || !studioEditor) return;
  const code = studioEditor.value;
  const file = slugifyFile(studioFilename?.value) || "";
  clearTimeout(studioValidateTimer);
  const sameFile =
    studio.currentFile &&
    studio.currentFile ===
      `${file || slugifyFile(scriptNameFromCode(code))}.js`;
  studioSaveBtn.disabled = true;
  try {
    const res = await window.api.studioSave({
      code,
      file,
      overwrite: overwrite || Boolean(sameFile),
    });
    if (res?.ok) {
      studio.currentFile = res.file;
      studio.filenameTouched = true;
      studio.customScripts = res.customScripts || studio.customScripts;
      buildPickerOptions();
      const warn = res.warnings?.length ? ` · ⚠ ${res.warnings[0]}` : "";
      setStudioCheck(
        `✓ Saved ${res.file} · ${res.name} is ready in the Scripts tab${warn}`,
        warn ? "warn" : "ok",
      );
    } else if (res?.exists) {
      setStudioCheck(
        `${res.file} already exists.`,
        "warn",
        ` <button type="button" class="link-button" data-studio-overwrite>Overwrite</button>`,
      );
    } else {
      studio.errorLine = res?.line || null;
      updateGutter();
      setStudioCheck(res?.error || "Could not save", "error");
    }
  } finally {
    studioSaveBtn.disabled = false;
  }
}

studioCheck?.addEventListener("click", (e) => {
  if (e.target.closest("[data-studio-overwrite]")) {
    saveStudioScript({ overwrite: true });
  }
});
studioSaveBtn?.addEventListener("click", () => saveStudioScript());
studioCheckBtn?.addEventListener("click", () => validateStudio());

function refreshStudioModels(st) {
  if (!studioModelSelect || !st) return;
  const chosen = st.config?.scriptModel || "";
  studioModelSelect.innerHTML = buildModelOptionsHtml(st, {
    purpose: "code",
    activeValue: chosen,
  });
  studioModelSelect.value = chosen;
  syncDropdown(studioModelSelect);
}

studioModelSelect?.addEventListener("change", () =>
  saveAiConfig({ scriptModel: studioModelSelect.value }),
);

function setGenerating(on) {
  studio.generating = on;
  studioAiCard?.classList.toggle("is-busy", on);
  if (studioGenerateBtn) {
    studioGenerateBtn.textContent = on ? "Cancel" : "Generate";
    studioGenerateBtn.classList.toggle("btn-primary", !on);
    studioGenerateBtn.classList.toggle("btn-danger-soft", on);
  }
  if (studioPrompt) studioPrompt.disabled = on;
  if (studioEditor) studioEditor.readOnly = on;
  if (studioSaveBtn) studioSaveBtn.disabled = on;
}

function stripFences(text) {
  const raw = String(text || "").replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
  const start = raw.search(/```(?:js|javascript)?\s*\n/i);
  if (start === -1) return raw.trim();
  const body = raw.slice(start).replace(/^```(?:js|javascript)?\s*\n/i, "");
  const end = body.indexOf("```");
  return (end === -1 ? body : body.slice(0, end)).trimEnd();
}

async function runStudioGenerate() {
  if (studio.generating) {
    window.api?.studioGenerateCancel?.();
    return;
  }
  const prompt = studioPrompt?.value.trim();
  if (!prompt) {
    studioPrompt?.focus();
    if (studioGenStatus)
      studioGenStatus.textContent = "Describe what the script should do first.";
    return;
  }
  const before = studioEditor.value;
  setGenerating(true);
  if (studioGenStatus) studioGenStatus.textContent = "Starting local AI…";
  try {
    const res = await window.api.studioGenerate({
      prompt,
      currentCode: before,
      model: studioModelSelect?.value || "",
    });
    if (res?.ok && res.code) {
      studioEditor.value = before;
      setEditorCode(res.code, {
        file: before.trim() ? studio.currentFile : "",
        label: `Generated with ${res.model}`,
      });
      if (studioGenStatus) {
        studioGenStatus.textContent = `Done with ${res.model}. Review the code, then Save & Load.`;
      }
    } else {
      studioEditor.value = before;
      updateGutter();
      if (studioGenStatus) {
        studioGenStatus.textContent =
          res?.error === "Cancelled"
            ? "Generation cancelled."
            : `Error: ${res?.error || "Could not reach Ollama"}`;
      }
    }
  } finally {
    setGenerating(false);
  }
}

studioGenerateBtn?.addEventListener("click", runStudioGenerate);
studioPrompt?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runStudioGenerate();
  }
});

window.api?.onStudioGenProgress?.((prog) => {
  if (!prog || !studio.generating) return;
  if (studioGenStatus && prog.message) {
    studioGenStatus.textContent = prog.message;
  }
  if (typeof prog.text === "string" && prog.text && studioEditor) {
    studioEditor.value = stripFences(prog.text);
    updateGutter();
    studioEditor.scrollTop = studioEditor.scrollHeight;
    if (studioGutter) studioGutter.scrollTop = studioEditor.scrollTop;
  }
});

// --- Studio docs ---
function timeAgo(ts) {
  if (!ts) return "";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function renderDocsStatus(st) {
  if (!st) return;
  if (studioDocsCount) studioDocsCount.textContent = String(st.sections || 0);
  if (studioDocsBadge) {
    const ver = st.version ? `v${st.version}` : "";
    studioDocsBadge.textContent = st.downloading
      ? "Downloading docs…"
      : st.source === "downloaded"
        ? `Mineflayer ${ver} · updated ${timeAgo(st.fetchedAt)}`
        : st.source === "bundled"
          ? `Mineflayer ${ver} · bundled copy`
          : "No docs yet";
  }
  if (studioDocsUpdate) studioDocsUpdate.disabled = Boolean(st.downloading);
}

function mdInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

function renderMarkdown(md) {
  const lines = String(md || "").split("\n");
  let html = "";
  let para = [];
  let list = [];
  let code = null;
  const flushPara = () => {
    if (para.length) html += `<p>${mdInline(para.join(" "))}</p>`;
    para = [];
  };
  const flushList = () => {
    if (list.length)
      html += `<ul>${list.map((li) => `<li>${mdInline(li)}</li>`).join("")}</ul>`;
    list = [];
  };
  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) {
        html += `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (/^```/.test(line)) {
      flushPara();
      flushList();
      code = [];
    } else if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (/^#{1,6}\s/.test(line)) {
      flushPara();
      flushList();
      html += `<p><b>${mdInline(line.replace(/^#+\s*/, ""))}</b></p>`;
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else if (list.length && /^\s{2,}/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  if (code !== null)
    html += `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`;
  flushPara();
  flushList();
  return html;
}

let docsSearchTimer = null;
async function runDocsSearch() {
  if (!window.api?.studioDocsSearch || !studioDocsList) return;
  const results = await window.api.studioDocsSearch(
    studioDocsSearch?.value || "",
  );
  if (!results?.length) {
    studioDocsList.innerHTML = `<p class="radar-empty">No matching topics</p>`;
    return;
  }
  studioDocsList.innerHTML = results
    .map(
      (r) => `
        <div class="radar-item${r.id === studio.activeDocId ? " is-active" : ""}" data-doc-id="${escapeHtml(r.id)}">
          <span class="radar-item-name">${escapeHtml(r.title)}</span>
          <span class="studio-doc-path">${escapeHtml(r.path || r.source)}</span>
        </div>`,
    )
    .join("");
}

async function openDocSection(id) {
  if (!window.api?.studioDocsSection || !studioDocsReader) return;
  const sec = await window.api.studioDocsSection(id);
  if (!sec) return;
  studio.activeDocId = id;
  studioDocsList
    ?.querySelectorAll(".radar-item")
    .forEach((el) => el.classList.toggle("is-active", el.dataset.docId === id));
  const hasCode = /```/.test(sec.body);
  studioDocsReader.innerHTML = `
    <h4>${escapeHtml(sec.title)}</h4>
    <span class="studio-doc-path">${escapeHtml([sec.sourceTitle, sec.path].filter(Boolean).join(" › "))}</span>
    ${renderMarkdown(sec.body) || `<p class="radar-empty">No description</p>`}
    <div class="studio-docs-actions">
      <button type="button" class="btn btn-small btn-ghost" data-doc-ask>Ask AI to use this</button>
      ${hasCode ? `<button type="button" class="btn btn-small btn-ghost" data-doc-insert>Insert example</button>` : ""}
    </div>`;
  studioDocsReader.scrollTop = 0;
  studioDocsReader.dataset.title = sec.title;
  studioDocsReader.dataset.example =
    (sec.body.match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/) || [])[1] || "";
}

function insertIntoEditor(text) {
  if (!studioEditor) return;
  studioEditor.focus();
  const start = studioEditor.selectionStart ?? studioEditor.value.length;
  studioEditor.setSelectionRange(start, start);
  document.execCommand("insertText", false, `${text.trimEnd()}\n`);
  updateGutter();
}

function showStudioView(view) {
  document
    .querySelector(`.studio-view-tab[data-studio-view="${view}"]`)
    ?.click();
}

studioDocsList?.addEventListener("click", (e) => {
  const item = e.target.closest("[data-doc-id]");
  if (item) openDocSection(item.dataset.docId);
});

studioDocsReader?.addEventListener("click", (e) => {
  if (e.target.closest("[data-doc-insert]")) {
    showStudioView("editor");
    insertIntoEditor(studioDocsReader.dataset.example || "");
  } else if (e.target.closest("[data-doc-ask]")) {
    showStudioView("editor");
    if (studioPrompt) {
      const title = studioDocsReader.dataset.title || "";
      studioPrompt.value =
        `${studioPrompt.value.trim()} ${studioPrompt.value.trim() ? "using" : "Use"} ${title}`.trim();
      studioPrompt.focus();
    }
  }
});

studioDocsSearch?.addEventListener("input", () => {
  clearTimeout(docsSearchTimer);
  docsSearchTimer = setTimeout(runDocsSearch, 160);
});

studioDocsUpdate?.addEventListener("click", async () => {
  if (!window.api?.studioDocsDownload) return;
  renderDocsStatus({ downloading: true });
  const res = await window.api.studioDocsDownload({ force: true });
  renderDocsStatus(res?.status);
  if (res && !res.ok && studioDocsBadge) {
    studioDocsBadge.textContent = `Download failed · using ${res.status?.source || "bundled"} copy`;
  }
  runDocsSearch();
});

window.api?.onStudioDocsStatus?.((st) => {
  renderDocsStatus(st);
  if (!st?.downloading && studioDocsList?.children.length) runDocsSearch();
});

async function initStudio() {
  if (studio.ready || !window.api?.studioGetInit) return;
  try {
    const init = await window.api.studioGetInit();
    studio.ready = true;
    studio.templates = init.templates || [];
    studio.customScripts = init.customScripts || [];
    buildPickerOptions();
    renderDocsStatus(init.docs);
    if (latestOllamaStatus) refreshStudioModels(latestOllamaStatus);
    updateGutter();
  } catch (_) {}
}

document
  .querySelector('.workspace-tab[data-tab="studio"]')
  ?.addEventListener("click", () => {
    if (!studio.ready) initStudio();
    else if (window.api?.studioGetInit) {
      window.api.studioGetInit().then((init) => {
        studio.customScripts = init.customScripts || [];
        buildPickerOptions();
        renderDocsStatus(init.docs);
      });
    }
  });

initStudio();
