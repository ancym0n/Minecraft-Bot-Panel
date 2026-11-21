const { loadLibraries } = require("../runtime");
const {
  FOOD_PRIORITY,
  equipBestArmor,
  equipBestWeapon,
  clearPathfinderGoal,
} = require("../botUtils");

const info = {
  name: "ChestStealer",
  default: { interval: 2200 },
  options: [
    {
      type: "checkbox",
      label: "Steal Supplies",
      id: "steal",
    },
    {
      type: "checkbox",
      label: "Deposit Mined",
      id: "deposit",
    },
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
    },
    {
      type: "input",
      label: "Filter (optional)",
      id: "filter",
    },
  ],
};

const STORAGE_BLOCKS = new Set([
  "chest",
  "trapped_chest",
  "barrel",
  "shulker_box",
  "white_shulker_box",
  "orange_shulker_box",
  "magenta_shulker_box",
  "light_blue_shulker_box",
  "yellow_shulker_box",
  "lime_shulker_box",
  "pink_shulker_box",
  "gray_shulker_box",
  "light_gray_shulker_box",
  "cyan_shulker_box",
  "purple_shulker_box",
  "blue_shulker_box",
  "brown_shulker_box",
  "green_shulker_box",
  "red_shulker_box",
  "black_shulker_box",
]);

function isSupplyItem(name) {
  const n = String(name || "").toLowerCase();
  if (FOOD_PRIORITY.includes(n)) return true;
  return (
    n.endsWith("_sword") ||
    n.endsWith("_pickaxe") ||
    n.endsWith("_axe") ||
    n.endsWith("_shovel") ||
    n.endsWith("_helmet") ||
    n.endsWith("_chestplate") ||
    n.endsWith("_leggings") ||
    n.endsWith("_boots") ||
    n === "totem_of_undying" ||
    n === "shield" ||
    n === "bow" ||
    n === "crossbow" ||
    n.includes("arrow") ||
    n.includes("golden_apple") ||
    n.includes("diamond") ||
    n.includes("netherite") ||
    n.includes("iron_ingot") ||
    n.includes("emerald") ||
    n.includes("ender_pearl") ||
    n.includes("potion") ||
    n.includes("planks") ||
    n.includes("log") ||
    n === "cobblestone"
  );
}

function isEssentialKeepItem(bot, item, keptBestByCat) {
  if (!item || !item.name) return false;
  const n = item.name.toLowerCase();
  if (n === "totem_of_undying" || n === "shield") return true;
  if (FOOD_PRIORITY.slice(0, 12).includes(n)) return true;

  for (const suffix of ["_sword", "_pickaxe", "_axe", "_shovel"]) {
    if (n.endsWith(suffix)) {
      if (!keptBestByCat.has(suffix)) {
        keptBestByCat.add(suffix);
        return true;
      }
    }
  }
  return false;
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.pathfinder) {
    clearLog("ChestStealer:");
    log("ChestStealer: Connect a bot first");
    return;
  }

  const { goals } = loadLibraries();
  const signal = scriptRepeater.signal;
  let busy = false;

  async function runChestCycle() {
    if (signal?.aborted || !bot || !bot.entity || busy) return;
    busy = true;

    try {
      const [stealOpt, depositOpt, rawFilter] = await Promise.all([
        getOption("steal", info.name),
        getOption("deposit", info.name),
        getOption("filter", info.name),
      ]);
      if (signal?.aborted) return;

      const doSteal = stealOpt !== "off" || depositOpt === "off";
      const doDeposit = depositOpt === "on";
      const filterTerms = String(rawFilter || "")
        .toLowerCase()
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const matchesFilter = (itemName) => {
        if (filterTerms.length === 0) return true;
        const low = String(itemName || "").toLowerCase();
        return filterTerms.some((t) => low.includes(t));
      };

      const chestPositions = bot.findBlocks({
        matching: (b) => b && STORAGE_BLOCKS.has(b.name),
        maxDistance: 18,
        count: 6,
      });

      if (!chestPositions || chestPositions.length === 0) {
        clearLog("ChestStealer:");
        log("ChestStealer: No chest, barrel or shulker found within 18m");
        return;
      }

      const targetPos = chestPositions[0];
      const dist = bot.entity.position.distanceTo(targetPos);
      if (dist > 3.6) {
        clearLog("ChestStealer:");
        log(
          `ChestStealer: Walking to container at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`,
        );
        await bot.pathfinder.goto(
          new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2.5),
        );
      }

      if (signal?.aborted) return;
      const chestBlock = bot.blockAt(targetPos);
      if (!chestBlock) return;

      const container = await bot.openContainer(chestBlock).catch(() => null);
      if (!container) {
        clearLog("ChestStealer:");
        log("ChestStealer: Could not open container");
        return;
      }

      let movedCount = 0;
      try {
        if (signal?.aborted) return;
        if (doSteal) {
          const containerItems = container.containerItems();
          for (const item of containerItems) {
            if (signal?.aborted) return;
            if (!bot || !item) continue;
            if (filterTerms.length > 0) {
              if (!matchesFilter(item.name)) continue;
            } else if (!isSupplyItem(item.name)) {
              continue;
            }
            await container.withdraw(item.type, null, item.count);
            movedCount += item.count;
          }
        }

        if (doDeposit && !signal?.aborted) {
          await equipBestArmor(bot, { includeOffhand: true, signal });
          if (signal?.aborted) return;
          const keptBest = new Set();
          const invItems = bot.inventory.items();
          for (const item of invItems) {
            if (signal?.aborted) return;
            if (!bot || !item) continue;
            if (filterTerms.length > 0) {
              if (!matchesFilter(item.name)) continue;
            } else if (isEssentialKeepItem(bot, item, keptBest)) {
              continue;
            }
            await container.deposit(item.type, null, item.count);
            movedCount += item.count;
          }
        }
      } finally {
        await container.close();
      }

      if (signal?.aborted) return;
      if (doSteal) {
        await equipBestArmor(bot, { includeOffhand: true, signal });
        if (signal?.aborted) return;
        await equipBestWeapon(bot, { saveLowDurability: true, signal });
      }

      clearLog("ChestStealer:");
      log(
        `ChestStealer: Transferred ${movedCount} item(s) (${doSteal ? "withdraw" : ""}${doSteal && doDeposit ? " + " : ""}${doDeposit ? "deposit" : ""})`,
      );
    } catch (err) {
      if (!signal?.aborted) log(`ChestStealer: ${err.message || err}`);
    } finally {
      busy = false;
    }
  }

  try {
    await runChestCycle();
    if (signal?.aborted) return;
    const repeatOpt = await getOption("repeat", info.name);
    if (!signal?.aborted && repeatOpt === "on") {
      await scriptRepeater(runChestCycle, info.default.interval);
    }
  } finally {
    if (!scriptRepeater.isCurrent || scriptRepeater.isCurrent()) {
      clearPathfinderGoal(bot);
    }
  }
}

module.exports = {
  info,
  script,
};
