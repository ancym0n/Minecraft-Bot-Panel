const { loadLibraries } = require("../runtime");
const {
  equipBestToolForBlock,
  equipBestArmor,
  equipBestWeapon,
  smartDig,
  configureSmartMovements,
  clearPathfinderGoal,
} = require("../botUtils");

const info = {
  name: "GearUp",
  default: { interval: 700 },
  options: [
    {
      type: "checkbox",
      label: "Tools & Sword",
      id: "tools",
    },
    {
      type: "checkbox",
      label: "Full Armor",
      id: "armor",
    },
    {
      type: "checkbox",
      label: "Craft Shield",
      id: "shield",
    },
    {
      type: "input",
      label: "Tier [wood/stone/iron/diamond]",
      id: "tier",
    },
  ],
};

const LOG_NAMES = [
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log",
  "pale_oak_log",
  "crimson_stem",
  "warped_stem",
];

const STONE_NAMES = ["stone", "cobblestone", "deepslate", "cobbled_deepslate"];

const COAL_ORE_NAMES = ["coal_ore", "deepslate_coal_ore"];
const IRON_ORE_NAMES = ["iron_ore", "deepslate_iron_ore"];
const DIAMOND_ORE_NAMES = ["diamond_ore", "deepslate_diamond_ore"];

const PICKAXE_RANK = [
  "wooden_pickaxe",
  "golden_pickaxe",
  "stone_pickaxe",
  "iron_pickaxe",
  "diamond_pickaxe",
  "netherite_pickaxe",
];

function countItem(bot, predicate) {
  if (!bot || !bot.inventory) return 0;
  let total = 0;
  for (const item of bot.inventory.items()) {
    if (predicate(item)) total += item.count;
  }
  for (const slotIdx of [5, 6, 7, 8, 45]) {
    const eq = bot.inventory.slots?.[slotIdx];
    if (eq && predicate(eq)) total += eq.count || 1;
  }
  return total;
}

function countByName(bot, name) {
  return countItem(bot, (i) => i.name === name);
}

function countPlanks(bot) {
  return countItem(bot, (i) => i.name.endsWith("_planks"));
}

function countLogs(bot) {
  return countItem(
    bot,
    (i) => LOG_NAMES.includes(i.name) || i.name.endsWith("_log"),
  );
}

function countCobble(bot) {
  return countItem(
    bot,
    (i) =>
      i.name === "cobblestone" ||
      i.name === "cobbled_deepslate" ||
      i.name === "blackstone",
  );
}

function hasPickaxeAtLeast(bot, minPickName) {
  const minIdx = PICKAXE_RANK.indexOf(minPickName);
  if (minIdx === -1) return false;
  return countItem(bot, (i) => PICKAXE_RANK.indexOf(i.name) >= minIdx) > 0;
}

function hasItemOrHigherTier(bot, baseSuffix, minTier) {
  const tiers = ["wooden", "stone", "iron", "diamond", "netherite"];
  const minIdx = tiers.indexOf(minTier);
  if (minIdx === -1) return countByName(bot, `${minTier}_${baseSuffix}`) > 0;
  return (
    countItem(bot, (i) => {
      for (let t = minIdx; t < tiers.length; t++) {
        if (i.name === `${tiers[t]}_${baseSuffix}`) return true;
      }
      return false;
    }) > 0
  );
}

function findBlockByNames(bot, names, maxDistance = 64) {
  if (!bot || !bot.registry) return null;
  const ids = names
    .map((n) => bot.registry.blocksByName[n]?.id)
    .filter((id) => typeof id === "number");
  if (ids.length === 0) return null;
  return bot.findBlock({
    matching: ids,
    maxDistance,
  });
}

async function moveNearAndDig(bot, goals, block, stepLog) {
  if (!bot || !block || !bot.entity) return false;
  const pos = block.position;
  const dist = pos.distanceTo(bot.entity.position);

  if (dist > 4.4) {
    stepLog(
      `Walking to ${block.name} at (${pos.x}, ${pos.y}, ${pos.z}) [${dist.toFixed(1)}m]`,
    );
    const goalKey = `${pos.x},${pos.y},${pos.z}`;
    if (bot._mcbpGearGoalKey !== goalKey || !bot.pathfinder.isMoving()) {
      bot._mcbpGearGoalKey = goalKey;
      bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2), false);
    }
    return false;
  }

  bot._mcbpGearGoalKey = "";
  clearPathfinderGoal(bot);
  stepLog(`Mining ${block.name} at (${pos.x}, ${pos.y}, ${pos.z})...`);
  await smartDig(bot, block, { autoTool: true, saveLowDurability: false });

  // Brief walk toward block position to pick up dropped item
  bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 1), false);
  await new Promise((r) => setTimeout(r, 450));
  clearPathfinderGoal(bot);
  return true;
}

async function craftItemByName(bot, itemName, count = 1, craftingTable = null) {
  if (!bot || !bot.registry) return false;
  const itemType = bot.registry.itemsByName[itemName];
  if (!itemType) return false;
  const recipes = bot.recipesFor(itemType.id, null, 1, craftingTable);
  if (!recipes || recipes.length === 0) return false;
  await bot.craft(recipes[0], count, craftingTable);
  return true;
}

async function craftAnyPlanks(bot) {
  if (!bot || !bot.registry) return false;
  const logItem = bot.inventory
    .items()
    .find((i) => LOG_NAMES.includes(i.name) || i.name.endsWith("_log"));
  if (!logItem) return false;
  const prefix = logItem.name.replace(/_(log|stem)$/, "");
  const plankName = `${prefix}_planks`;
  return craftItemByName(bot, plankName, 1, null);
}

async function ensureCraftingTablePlaced(bot, goals, stepLog) {
  if (!bot || !bot.registry) return null;
  const existing = findBlockByNames(bot, ["crafting_table"], 5);
  if (existing) {
    const d = existing.position.distanceTo(bot.entity.position);
    if (d > 3.8) {
      bot.pathfinder.setGoal(
        new goals.GoalNear(
          existing.position.x,
          existing.position.y,
          existing.position.z,
          2,
        ),
        true,
      );
      await new Promise((r) => setTimeout(r, 600));
      clearPathfinderGoal(bot);
    }
    return existing;
  }

  if (countByName(bot, "crafting_table") === 0) {
    if (countPlanks(bot) < 4 && countLogs(bot) > 0) {
      stepLog("Crafting planks from logs for crafting_table...");
      await craftAnyPlanks(bot);
    }
    if (countPlanks(bot) >= 4) {
      stepLog("Crafting crafting_table...");
      await craftItemByName(bot, "crafting_table", 1, null);
    }
  }

  const tableItem = bot.inventory
    .items()
    .find((i) => i.name === "crafting_table");
  if (!tableItem) return null;

  await placeBlockNearby(bot, tableItem, "crafting_table", stepLog);
  return findBlockByNames(bot, ["crafting_table"], 5);
}

async function placeBlockNearby(bot, item, blockName, stepLog) {
  if (!bot || !bot.entity || !item) return false;
  await bot.equip(item, "hand");
  const pos = bot.entity.position.floored();
  const offsets = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 1],
    [-1, 0, -1],
    [1, 0, -1],
    [-1, 0, 1],
  ];

  for (const [ox, oy, oz] of offsets) {
    const targetFloor = bot.blockAt(pos.offset(ox, oy - 1, oz));
    const targetSpace = bot.blockAt(pos.offset(ox, oy, oz));
    if (
      targetFloor &&
      targetFloor.boundingBox === "block" &&
      targetSpace &&
      targetSpace.name === "air"
    ) {
      try {
        stepLog(
          `Placing ${blockName} at (${targetSpace.position.x}, ${targetSpace.position.y}, ${targetSpace.position.z})...`,
        );
        await bot.lookAt(targetFloor.position.offset(0.5, 1, 0.5), true);
        await bot.placeBlock(targetFloor, { x: 0, y: 1, z: 0 });
        await new Promise((r) => setTimeout(r, 250));
        return true;
      } catch (_) {}
    }
  }
  return false;
}

async function ensureSticksAndPlanks(bot, minSticks, minPlanks, stepLog) {
  while (countPlanks(bot) < minPlanks + 2 && countLogs(bot) > 0) {
    stepLog("Crafting planks from logs...");
    const ok = await craftAnyPlanks(bot);
    if (!ok) break;
  }
  while (countByName(bot, "stick") < minSticks && countPlanks(bot) >= 2) {
    stepLog("Crafting sticks from planks...");
    const ok = await craftItemByName(bot, "stick", 1, null);
    if (!ok) break;
  }
}

async function smeltIronInFurnace(bot, goals, neededIngots, stepLog) {
  if (!bot || !bot.registry) return false;
  let furnaceBlock = findBlockByNames(bot, ["furnace", "blast_furnace"], 6);

  if (!furnaceBlock) {
    if (countByName(bot, "furnace") === 0) {
      if (countCobble(bot) < 8) return false;
      const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
      if (!table) return false;
      stepLog("Crafting furnace (8 cobblestone)...");
      await craftItemByName(bot, "furnace", 1, table);
    }
    const furnaceItem = bot.inventory.items().find((i) => i.name === "furnace");
    if (furnaceItem) {
      await placeBlockNearby(bot, furnaceItem, "furnace", stepLog);
      furnaceBlock = findBlockByNames(bot, ["furnace", "blast_furnace"], 6);
    }
  }

  if (!furnaceBlock) return false;

  const dist = furnaceBlock.position.distanceTo(bot.entity.position);
  if (dist > 3.8) {
    bot.pathfinder.setGoal(
      new goals.GoalNear(
        furnaceBlock.position.x,
        furnaceBlock.position.y,
        furnaceBlock.position.z,
        2,
      ),
      true,
    );
    return false;
  }

  clearPathfinderGoal(bot);
  const rawIron = bot.inventory
    .items()
    .find(
      (i) =>
        i.name === "raw_iron" ||
        i.name === "iron_ore" ||
        i.name === "deepslate_iron_ore",
    );
  if (!rawIron) return false;

  const fuelItem = bot.inventory
    .items()
    .find(
      (i) =>
        i.name === "coal" ||
        i.name === "charcoal" ||
        i.name.endsWith("_planks") ||
        LOG_NAMES.includes(i.name),
    );
  if (!fuelItem) {
    stepLog("Need fuel (coal, planks, or logs) to smelt iron...");
    return false;
  }

  stepLog(
    `Smelting ${rawIron.name} in furnace using ${fuelItem.name} (need ${neededIngots} more iron_ingot)...`,
  );
  try {
    const furnace = await bot.openFurnace(furnaceBlock);
    if (!furnace.fuelItem() && fuelItem) {
      await furnace.putFuel(fuelItem.type, null, Math.min(fuelItem.count, 8));
    }
    if (!furnace.inputItem() && rawIron) {
      await furnace.putInput(
        rawIron.type,
        null,
        Math.min(rawIron.count, neededIngots),
      );
    }
    await new Promise((r) => setTimeout(r, 3200));
    if (furnace.outputItem()) {
      await furnace.takeOutput();
      stepLog(
        `Collected iron_ingot from furnace (now have ${countByName(bot, "iron_ingot")})`,
      );
    }
    furnace.close();
    return true;
  } catch (_) {
    return false;
  }
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.pathfinder || !bot.inventory) {
    clearLog("GearUp:");
    log("GearUp: Connect a bot first");
    return;
  }

  const { goals, mcData, Movements } = loadLibraries();
  let busy = false;
  bot._mcbpSprintJump = true;
  configureSmartMovements(bot, mcData, Movements, {
    canDig: true,
    allowSprinting: true,
    allowParkour: true,
  });

  function stepLog(msg) {
    clearLog("GearUp:");
    log(`GearUp: ${msg}`);
  }

  stepLog("Starting full progression (Wood ➙ Stone ➙ Iron ➙ Diamond)...");

  async function gearTick() {
    if (!bot || !bot.entity || !bot.inventory || busy) return;
    busy = true;

    try {
      const [toolsOpt, armorOpt, shieldOpt, rawTier] = await Promise.all([
        getOption("tools", info.name),
        getOption("armor", info.name),
        getOption("shield", info.name),
        getOption("tier", info.name),
      ]);

      const wantTools = toolsOpt !== "off";
      const wantArmor = armorOpt !== "off";
      const wantShield = shieldOpt !== "off";
      const cleanedTier = String(rawTier || "diamond")
        .trim()
        .toLowerCase();
      const targetTier = [
        "wood",
        "wooden",
        "stone",
        "iron",
        "diamond",
      ].includes(cleanedTier)
        ? cleanedTier === "wood"
          ? "wooden"
          : cleanedTier
        : "diamond";

      const tierRank = { wooden: 0, stone: 1, iron: 2, diamond: 3 }[targetTier];

      // Always make sure we have basic wood & sticks before crafting anything
      const totalWoodPotential = countLogs(bot) * 4 + countPlanks(bot);
      const hasAnyPick = hasPickaxeAtLeast(bot, "wooden_pickaxe");

      if ((!hasAnyPick && totalWoodPotential < 12) || totalWoodPotential < 6) {
        const logBlock = findBlockByNames(bot, LOG_NAMES, 64);
        if (!logBlock) {
          stepLog("Searching for trees (no logs within 64 blocks)...");
          return;
        }
        await moveNearAndDig(bot, goals, logBlock, stepLog);
        return;
      }

      // STAGE 1: WOODEN TIER
      if (!hasAnyPick) {
        await ensureSticksAndPlanks(bot, 4, 6, stepLog);
        const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
        if (!table) return;
        stepLog("Crafting wooden_pickaxe...");
        await craftItemByName(bot, "wooden_pickaxe", 1, table);
        await equipBestWeapon(bot);
        return;
      }

      if (targetTier === "wooden") {
        if (wantTools && !hasItemOrHigherTier(bot, "sword", "wooden")) {
          await ensureSticksAndPlanks(bot, 4, 4, stepLog);
          const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
          if (table) {
            stepLog("Crafting wooden_sword & wooden_axe...");
            await craftItemByName(bot, "wooden_sword", 1, table);
            await craftItemByName(bot, "wooden_axe", 1, table);
            await equipBestWeapon(bot);
          }
          return;
        }
        stepLog("Completed Wooden tier gear!");
        bot._mcbpGearUpDone = true;
        return;
      }

      // STAGE 2: STONE TIER
      const hasStonePick = hasPickaxeAtLeast(bot, "stone_pickaxe");
      if (!hasStonePick) {
        if (countCobble(bot) < 3) {
          const stoneBlock = findBlockByNames(bot, STONE_NAMES, 48);
          if (!stoneBlock) {
            stepLog("Searching for stone to mine for stone_pickaxe...");
            return;
          }
          await moveNearAndDig(bot, goals, stoneBlock, stepLog);
          return;
        }
        await ensureSticksAndPlanks(bot, 4, 2, stepLog);
        const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
        if (!table) return;
        stepLog("Crafting stone_pickaxe...");
        await craftItemByName(bot, "stone_pickaxe", 1, table);
        return;
      }

      if (targetTier === "stone") {
        if (wantTools && !hasItemOrHigherTier(bot, "sword", "stone")) {
          if (countCobble(bot) < 5) {
            const stoneBlock = findBlockByNames(bot, STONE_NAMES, 48);
            if (stoneBlock)
              await moveNearAndDig(bot, goals, stoneBlock, stepLog);
            return;
          }
          await ensureSticksAndPlanks(bot, 4, 2, stepLog);
          const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
          if (table) {
            stepLog("Crafting stone_sword & stone_axe...");
            await craftItemByName(bot, "stone_sword", 1, table);
            await craftItemByName(bot, "stone_axe", 1, table);
            await equipBestWeapon(bot);
          }
          return;
        }
        stepLog("Completed Stone tier gear!");
        bot._mcbpGearUpDone = true;
        return;
      }

      // STAGE 3: IRON TIER (required for both "iron" and "diamond")
      const ironTargets = [];
      if (!hasPickaxeAtLeast(bot, "iron_pickaxe")) {
        ironTargets.push({ name: "iron_pickaxe", cost: 3, sticks: 2 });
      }
      if (wantShield && countByName(bot, "shield") === 0) {
        ironTargets.push({ name: "shield", cost: 1, planks: 6 });
      }
      if (targetTier === "iron") {
        if (wantTools) {
          if (!hasItemOrHigherTier(bot, "sword", "iron")) {
            ironTargets.push({ name: "iron_sword", cost: 2, sticks: 1 });
          }
          if (!hasItemOrHigherTier(bot, "axe", "iron")) {
            ironTargets.push({ name: "iron_axe", cost: 3, sticks: 2 });
          }
          if (!hasItemOrHigherTier(bot, "shovel", "iron")) {
            ironTargets.push({ name: "iron_shovel", cost: 1, sticks: 2 });
          }
        }
        if (wantArmor) {
          if (!hasItemOrHigherTier(bot, "chestplate", "iron")) {
            ironTargets.push({ name: "iron_chestplate", cost: 8 });
          }
          if (!hasItemOrHigherTier(bot, "leggings", "iron")) {
            ironTargets.push({ name: "iron_leggings", cost: 7 });
          }
          if (!hasItemOrHigherTier(bot, "helmet", "iron")) {
            ironTargets.push({ name: "iron_helmet", cost: 5 });
          }
          if (!hasItemOrHigherTier(bot, "boots", "iron")) {
            ironTargets.push({ name: "iron_boots", cost: 4 });
          }
        }
      }

      if (ironTargets.length > 0) {
        const nextIronItem = ironTargets[0];
        const ingots = countByName(bot, "iron_ingot");

        if (ingots >= nextIronItem.cost) {
          await ensureSticksAndPlanks(
            bot,
            nextIronItem.sticks || 0,
            nextIronItem.planks || 2,
            stepLog,
          );
          const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
          if (!table) return;
          stepLog(
            `Crafting ${nextIronItem.name} (${nextIronItem.cost} iron_ingot)...`,
          );
          await craftItemByName(bot, nextIronItem.name, 1, table);
          await equipBestArmor(bot, { includeOffhand: true });
          await equipBestWeapon(bot);
          return;
        }

        const rawIronCount =
          countByName(bot, "raw_iron") +
          countByName(bot, "iron_ore") +
          countByName(bot, "deepslate_iron_ore");
        const neededIngots = nextIronItem.cost - ingots;

        // Ensure we have a furnace or 8 cobble to craft one before smelting
        const nearbyFurnace = findBlockByNames(
          bot,
          ["furnace", "blast_furnace"],
          6,
        );
        if (
          !nearbyFurnace &&
          countByName(bot, "furnace") === 0 &&
          countCobble(bot) < 8
        ) {
          const stoneBlock = findBlockByNames(bot, STONE_NAMES, 48);
          if (stoneBlock) {
            stepLog(
              `Mining cobblestone for furnace (${countCobble(bot)}/8)...`,
            );
            await moveNearAndDig(bot, goals, stoneBlock, stepLog);
            return;
          }
        }

        if (rawIronCount > 0) {
          await smeltIronInFurnace(bot, goals, neededIngots, stepLog);
          return;
        }

        // Mine coal if we see any nearby and have no coal
        if (countByName(bot, "coal") < 2) {
          const coalOre = findBlockByNames(bot, COAL_ORE_NAMES, 24);
          if (coalOre) {
            await moveNearAndDig(bot, goals, coalOre, stepLog);
            return;
          }
        }

        const ironOre = findBlockByNames(bot, IRON_ORE_NAMES, 64);
        if (!ironOre) {
          stepLog(
            `Searching for iron_ore (need ${neededIngots} more iron for ${nextIronItem.name})...`,
          );
          return;
        }
        await moveNearAndDig(bot, goals, ironOre, stepLog);
        return;
      }

      if (tierRank <= 2) {
        await equipBestArmor(bot, { includeOffhand: true });
        await equipBestWeapon(bot);
        stepLog("Completed Iron tier gear (armor + tools equipped)!");
        bot._mcbpGearUpDone = true;
        return;
      }

      // STAGE 4: DIAMOND TIER
      const diamondTargets = [];
      if (wantTools) {
        if (!hasItemOrHigherTier(bot, "sword", "diamond")) {
          diamondTargets.push({ name: "diamond_sword", cost: 2, sticks: 1 });
        }
        if (!hasItemOrHigherTier(bot, "pickaxe", "diamond")) {
          diamondTargets.push({ name: "diamond_pickaxe", cost: 3, sticks: 2 });
        }
        if (!hasItemOrHigherTier(bot, "axe", "diamond")) {
          diamondTargets.push({ name: "diamond_axe", cost: 3, sticks: 2 });
        }
        if (!hasItemOrHigherTier(bot, "shovel", "diamond")) {
          diamondTargets.push({ name: "diamond_shovel", cost: 1, sticks: 2 });
        }
      }
      if (wantArmor) {
        if (!hasItemOrHigherTier(bot, "chestplate", "diamond")) {
          diamondTargets.push({ name: "diamond_chestplate", cost: 8 });
        }
        if (!hasItemOrHigherTier(bot, "leggings", "diamond")) {
          diamondTargets.push({ name: "diamond_leggings", cost: 7 });
        }
        if (!hasItemOrHigherTier(bot, "helmet", "diamond")) {
          diamondTargets.push({ name: "diamond_helmet", cost: 5 });
        }
        if (!hasItemOrHigherTier(bot, "boots", "diamond")) {
          diamondTargets.push({ name: "diamond_boots", cost: 4 });
        }
      }

      if (diamondTargets.length === 0) {
        await equipBestArmor(bot, { includeOffhand: true });
        await equipBestWeapon(bot);
        stepLog(
          "Completed full Diamond gear (all selected armor & tools equipped)!",
        );
        bot._mcbpGearUpDone = true;
        return;
      }

      const nextDiamondItem = diamondTargets[0];
      const diamonds = countByName(bot, "diamond");

      if (diamonds >= nextDiamondItem.cost) {
        await ensureSticksAndPlanks(
          bot,
          nextDiamondItem.sticks || 0,
          2,
          stepLog,
        );
        const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
        if (!table) return;
        stepLog(
          `Crafting ${nextDiamondItem.name} (${nextDiamondItem.cost} diamonds)...`,
        );
        await craftItemByName(bot, nextDiamondItem.name, 1, table);
        await equipBestArmor(bot, { includeOffhand: true });
        await equipBestWeapon(bot);
        return;
      }

      const diamondOre = findBlockByNames(bot, DIAMOND_ORE_NAMES, 64);
      if (!diamondOre) {
        stepLog(
          `Scanning for diamond_ore (have ${diamonds}/${nextDiamondItem.cost} diamonds for ${nextDiamondItem.name})...`,
        );
        return;
      }
      await moveNearAndDig(bot, goals, diamondOre, stepLog);
    } catch (err) {
      stepLog(`Step warning: ${err.message || err}`);
    } finally {
      busy = false;
    }
  }

  bot._mcbpGearUpDone = false;
  try {
    await gearTick();
    if (!bot._mcbpGearUpDone) {
      await scriptRepeater(async () => {
        if (bot._mcbpGearUpDone) return;
        await gearTick();
      }, info.default.interval);
    }
  } finally {
    if (bot) {
      bot._mcbpSprintJump = false;
      bot._mcbpGearGoalKey = "";
      clearPathfinderGoal(bot);
      configureSmartMovements(bot, mcData, Movements);
    }
  }
}

module.exports = {
  info,
  script,
};
