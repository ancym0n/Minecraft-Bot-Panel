const { isBotEating, equipBestArmor, equipBestWeapon } = require("../botUtils");

const info = {
  name: "InvManager",
  default: { interval: 2000 },
  options: [
    {
      type: "checkbox",
      label: "Drop Junk",
      id: "dropjunk",
    },
    {
      type: "checkbox",
      label: "Sort & Equip",
      id: "sortgear",
    },
    {
      type: "input",
      label: "Keep Free Slots",
      id: "freeslots",
    },
    {
      type: "input",
      label: "Extra Junk",
      id: "junklist",
    },
  ],
};

const DEFAULT_JUNK_ITEMS = new Set([
  "dirt",
  "coarse_dirt",
  "rooted_dirt",
  "cobblestone",
  "cobbled_deepslate",
  "gravel",
  "andesite",
  "diorite",
  "granite",
  "tuff",
  "calcite",
  "netherrack",
  "basalt",
  "rotten_flesh",
  "poisonous_potato",
  "spider_eye",
  "WHEAT_SEEDS".toLowerCase(),
  "beetroot_seeds",
  "melon_seeds",
  "pumpkin_seeds",
  "kelp",
  "bamboo",
  "cactus",
  "dead_bush",
  "fern",
  "short_grass",
  "tall_grass",
  "dandelion",
  "poppy",
  "feather",
  "string",
  "flint",
  "snowball",
]);

const VALUABLE_KEYWORDS = [
  "diamond",
  "netherite",
  "emerald",
  "gold",
  "iron",
  "coal",
  "lapis",
  "redstone",
  "quartz",
  "copper",
  "totem",
  "shield",
  "apple",
  "carrot",
  "cooked",
  "bread",
  "beef",
  "porkchop",
  "sword",
  "pickaxe",
  "axe",
  "shovel",
  "hoe",
  "helmet",
  "chestplate",
  "leggings",
  "boots",
  "elytra",
  "bow",
  "crossbow",
  "trident",
  "mace",
  "potion",
  "pearl",
  "shulker",
  "chest",
];

function isValuableItem(name) {
  const n = String(name || "").toLowerCase();
  return VALUABLE_KEYWORDS.some((kw) => n.includes(kw));
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.inventory) {
    clearLog("InvManager:");
    log("InvManager: Connect a bot first");
    return;
  }

  let busy = false;
  clearLog("InvManager:");
  log("InvManager: Active (cleaning junk & organizing gear)");

  async function manageTick() {
    if (!bot || !bot.inventory || busy || isBotEating(bot)) return;
    busy = true;

    try {
      const [dropJunkOpt, sortGearOpt, rawFreeSlots, rawJunkList] =
        await Promise.all([
          getOption("dropjunk", info.name),
          getOption("sortgear", info.name),
          getOption("freeslots", info.name),
          getOption("junklist", info.name),
        ]);

      const doDropJunk = dropJunkOpt !== "off";
      const doSortGear = sortGearOpt !== "off";
      const parsedFree = parseInt(rawFreeSlots, 10);
      const targetFreeSlots =
        Number.isFinite(parsedFree) && parsedFree >= 0 && parsedFree <= 30
          ? parsedFree
          : 6;

      const extraJunk = String(rawJunkList || "")
        .toLowerCase()
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (doSortGear && !isBotEating(bot)) {
        await equipBestArmor(bot, { includeOffhand: true });
        await equipBestWeapon(bot, { saveLowDurability: true });
      }

      if (!doDropJunk) return;

      const items = bot.inventory.items();
      const usedSlots = items.length;
      const freeSlots = 36 - usedSlots;

      // Always drop explicit extraJunk; drop default junk when free slots < targetFreeSlots
      // (keep 1 stack of cobblestone/dirt for bridging unless slots are critically full)
      let keptScaffoldStack = false;
      let droppedStacks = 0;

      for (const item of items) {
        if (!bot || isBotEating(bot)) break;
        const n = String(item.name || "").toLowerCase();
        const isExtra = extraJunk.some((j) => n.includes(j));
        const isDefaultJunk = DEFAULT_JUNK_ITEMS.has(n) && !isValuableItem(n);

        if (!isExtra && !isDefaultJunk) continue;
        if (!isExtra && freeSlots >= targetFreeSlots && usedSlots < 30) {
          continue;
        }

        if (
          !isExtra &&
          !keptScaffoldStack &&
          (n === "cobblestone" || n === "dirt" || n === "cobbled_deepslate")
        ) {
          keptScaffoldStack = true;
          continue;
        }

        await bot
          .tossStack(item)
          .then(() => {
            droppedStacks++;
          })
          .catch(() => {});
      }

      if (droppedStacks > 0) {
        clearLog("InvManager:");
        log(`InvManager: Cleaned ${droppedStacks} junk stack(s)`);
      }
    } catch (_) {
    } finally {
      busy = false;
    }
  }

  await manageTick();
  await scriptRepeater(manageTick, info.default.interval);
}

module.exports = {
  info,
  script,
};
