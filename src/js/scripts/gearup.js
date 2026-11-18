const { loadLibraries } = require("../runtime");
const {
  equipBestToolForBlock,
  equipBestArmor,
  equipBestWeapon,
  smartDig,
  configureSmartMovements,
  clearPathfinderGoal,
  attachCraftingFix,
  cleanCraftingGrid,
  escapeHazardsAndObstructions,
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

function isBlockFaceOpen(b) {
  if (!b) return true;
  if (b.boundingBox === "empty") return true;
  const n = String(b.name || "");
  return (
    n === "air" ||
    n === "cave_air" ||
    n === "void_air" ||
    n === "water" ||
    n === "short_grass" ||
    n === "tall_grass" ||
    n === "fern" ||
    n === "snow"
  );
}

function findBlockByNames(bot, names, maxDistance = 64) {
  if (!bot || !bot.registry) return null;
  const ids = names
    .map((n) => bot.registry.blocksByName[n]?.id)
    .filter((id) => typeof id === "number");
  if (ids.length === 0) return null;
  const skipped = bot._mcbpGearSkippedBlocks;
  const protectedBlocks = bot._mcbpProtectedBlocks;
  const now = Date.now();
  if (skipped && skipped.size > 0) {
    for (const [k, exp] of skipped.entries()) {
      if (now > exp) skipped.delete(k);
    }
  }
  const positions = bot.findBlocks({
    matching: ids,
    maxDistance,
    count: 64,
  });
  if (!positions || !positions.length) return null;

  const botPos = bot.entity?.position;
  const botFloorX = botPos ? Math.floor(botPos.x) : null;
  const botFloorY = botPos ? Math.floor(botPos.y) : null;
  const botFloorZ = botPos ? Math.floor(botPos.z) : null;

  let bestPos = null;
  let bestScore = -Infinity;

  for (const p of positions) {
    const k = `${p.x},${p.y},${p.z}`;
    const colKey = `col:${p.x},${p.z}`;
    if (skipped?.has(k) || skipped?.has(colKey)) continue;
    if (protectedBlocks?.has(k)) continue;
    // Never pick a block directly underneath the bot's own feet (prevents digging a 1x1 pit straight down!)
    if (botPos && p.x === botFloorX && p.z === botFloorZ && p.y < botFloorY) {
      continue;
    }

    if (!botPos || typeof p.offset !== "function") {
      return bot.blockAt(p);
    }

    const dist = p.distanceTo(botPos);
    const dy = p.y - botFloorY;
    let score = -dist;

    // Prefer blocks near our current Y level (-2 to +4)
    if (dy >= -2 && dy <= 4) {
      score += 25;
    } else if (dy > 6) {
      score -= (dy - 6) * 12;
    } else if (dy < -4) {
      score -= (-4 - dy) * 6;
    }

    // Prefer exposed blocks (cliff face, cave wall, tree trunk) over buried blocks
    let exposed = false;
    for (const [ox, oy, oz] of [
      [0, 1, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      const nb = bot.blockAt(p.offset(ox, oy, oz));
      if (isBlockFaceOpen(nb)) {
        exposed = true;
        break;
      }
    }
    if (exposed) score += 35;

    if (score > bestScore) {
      bestScore = score;
      bestPos = p;
    }
  }

  return bestPos ? bot.blockAt(bestPos) : null;
}

async function moveNearAndDig(bot, goals, block, stepLog) {
  if (!bot || !block || !bot.entity) return false;
  const pos = block.position;
  const dist = pos.distanceTo(bot.entity.position);
  const goalKey = `${pos.x},${pos.y},${pos.z}`;

  const markUnreachable = (ttlMs = 60000) => {
    if (!bot._mcbpGearSkippedBlocks) bot._mcbpGearSkippedBlocks = new Map();
    const exp = Date.now() + ttlMs;
    bot._mcbpGearSkippedBlocks.set(goalKey, exp);
    // Also skip the entire vertical column (and 1-block neighbors) so we don't
    // waste time trying y+1, y+2, y+3 of the same unreachable tree/vein!
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        bot._mcbpGearSkippedBlocks.set(`col:${pos.x + dx},${pos.z + dz}`, exp);
      }
    }
  };

  if (dist > 4.4) {
    let targetChanged = false;
    if (bot._mcbpGearGoalKey === goalKey) {
      const elapsed = Date.now() - (bot._mcbpGearGoalSince || 0);
      if (elapsed > 8500 || (bot._mcbpGearNoPathCount || 0) >= 2) {
        markUnreachable(60000);
        bot._mcbpGearGoalKey = "";
        bot._mcbpGearNoPathCount = 0;
        clearPathfinderGoal(bot);
        stepLog(
          `Skipping unreachable ${block.name} at (${pos.x}, ${pos.y}, ${pos.z}), trying another...`,
        );
        await escapeHazardsAndObstructions(bot, { log: stepLog });
        return false;
      }
    } else {
      bot._mcbpGearGoalKey = goalKey;
      bot._mcbpGearGoalSince = Date.now();
      bot._mcbpGearNoPathCount = 0;
      targetChanged = true;
    }
    stepLog(
      `Walking to ${block.name} at (${pos.x}, ${pos.y}, ${pos.z}) [${dist.toFixed(1)}m]`,
    );
    if (targetChanged || !bot.pathfinder.isMoving()) {
      const goalObj = new goals.GoalNear(pos.x, pos.y, pos.z, 2);
      const onPathCheck = (results) => {
        if (!results || bot._mcbpGearGoalKey !== goalKey) return;
        if (results.status === "noPath") {
          bot._mcbpGearNoPathCount = (bot._mcbpGearNoPathCount || 0) + 1;
          const inProt =
            bot._mcbpProtectedZoneUntil &&
            Date.now() < bot._mcbpProtectedZoneUntil;
          if (
            bot._mcbpGearNoPathCount === 1 &&
            !inProt &&
            bot.pathfinder?.movements &&
            !bot.pathfinder.movements.canDig
          ) {
            bot.pathfinder.movements.canDig = true;
          }
        }
      };
      bot.once("path_update", onPathCheck);
      bot.pathfinder.setGoal(goalObj, false);
    }
    return false;
  }

  bot._mcbpGearGoalKey = "";
  bot._mcbpGearNoPathCount = 0;
  clearPathfinderGoal(bot);
  stepLog(`Mining ${block.name} at (${pos.x}, ${pos.y}, ${pos.z})...`);
  const dug = await smartDig(bot, block, {
    autoTool: true,
    saveLowDurability: false,
  });
  if (dug === false) {
    markUnreachable(45000);
    return false;
  }

  // Brief walk toward block position to pick up dropped item
  bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 1), false);
  await new Promise((r) => setTimeout(r, 450));
  clearPathfinderGoal(bot);
  return true;
}

async function craftItemByName(bot, itemName, count = 1, craftingTable = null) {
  if (!bot || !bot.registry) return false;
  attachCraftingFix(bot);
  await cleanCraftingGrid(bot);
  const itemType = bot.registry.itemsByName[itemName];
  if (!itemType) return false;
  const recipes = bot.recipesFor(itemType.id, null, 1, craftingTable);
  if (!recipes || recipes.length === 0) return false;
  try {
    await bot.craft(recipes[0], count, craftingTable);
    return true;
  } finally {
    await cleanCraftingGrid(bot);
  }
}

async function craftAnyPlanks(bot) {
  if (!bot || !bot.registry) return false;
  await cleanCraftingGrid(bot);
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
  const existing = findBlockByNames(bot, ["crafting_table"], 24);
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
        false,
      );
      const waitStart = Date.now();
      while (
        Date.now() - waitStart < 5000 &&
        existing.position.distanceTo(bot.entity.position) > 3.8
      ) {
        await new Promise((r) => setTimeout(r, 200));
      }
      clearPathfinderGoal(bot);
    }
    if (existing.position.distanceTo(bot.entity.position) <= 4.3) {
      return existing;
    }
  }

  if (countByName(bot, "crafting_table") === 0) {
    while (countPlanks(bot) < 8 && countLogs(bot) > 0) {
      stepLog("Crafting planks from logs for crafting_table...");
      const ok = await craftAnyPlanks(bot);
      if (!ok) break;
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
  const { Vec3 } = loadLibraries();
  const botPos = bot.entity.position;
  const base = botPos.floored();
  const candidates = [];

  for (const oy of [0, 1, -1]) {
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        if (ox === 0 && oz === 0) continue;
        const spacePos = base.offset(ox, oy, oz);
        const horizDist = Math.hypot(
          spacePos.x + 0.5 - botPos.x,
          spacePos.z + 0.5 - botPos.z,
        );
        const fullDist = spacePos.offset(0.5, 0.5, 0.5).distanceTo(botPos);
        if (horizDist < 1.15 || fullDist > 3.8) continue;
        const targetFloor = bot.blockAt(spacePos.offset(0, -1, 0));
        const targetSpace = bot.blockAt(spacePos);
        if (!targetFloor || targetFloor.boundingBox !== "block" || !targetSpace)
          continue;
        const isAir =
          targetSpace.name === "air" ||
          targetSpace.name === "cave_air" ||
          targetSpace.name === "void_air";
        const isCover =
          !isAir &&
          (targetSpace.boundingBox === "empty" ||
            targetSpace.name === "snow" ||
            targetSpace.name.endsWith("_leaves"));
        if (!isAir && !isCover) continue;
        candidates.push({
          targetFloor,
          targetSpace,
          isAir,
          score: (isAir ? 0 : 10) + Math.abs(oy) * 2 + horizDist,
        });
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  for (const cand of candidates.slice(0, 6)) {
    const { targetFloor, targetSpace, isAir } = cand;
    try {
      if (!isAir) {
        await bot.dig(targetSpace, true).catch(() => {});
        await new Promise((r) => setTimeout(r, 120));
      }
      const freshItem =
        bot.inventory.items().find((i) => i.name === item.name) || item;
      await bot.equip(freshItem, "hand");
      stepLog(
        `Placing ${blockName} at (${targetSpace.position.x}, ${targetSpace.position.y}, ${targetSpace.position.z})...`,
      );
      await bot.lookAt(targetFloor.position.offset(0.5, 1, 0.5), true);
      await bot.placeBlock(targetFloor, new Vec3(0, 1, 0));
      await new Promise((r) => setTimeout(r, 250));
      return true;
    } catch (_) {}
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

async function smeltInFurnace(
  bot,
  goals,
  {
    inputNames = ["raw_iron", "iron_ore", "deepslate_iron_ore"],
    outputName = "iron_ingot",
    neededCount = 1,
    stepLog = () => {},
  } = {},
) {
  if (!bot || !bot.registry) return false;
  attachCraftingFix(bot);
  await cleanCraftingGrid(bot);
  let furnaceBlock = findBlockByNames(bot, ["furnace", "blast_furnace"], 24);

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
      false,
    );
    const walkStart = Date.now();
    while (
      Date.now() - walkStart < 5000 &&
      furnaceBlock.position.distanceTo(bot.entity.position) > 3.8
    ) {
      await new Promise((r) => setTimeout(r, 250));
    }
    clearPathfinderGoal(bot);
    if (furnaceBlock.position.distanceTo(bot.entity.position) > 4.3) {
      return false;
    }
  }

  clearPathfinderGoal(bot);
  const findInput = () =>
    bot.inventory.items().find((i) => inputNames.includes(i.name));
  const rawInput = findInput();

  // Convert 1 log into 4 planks if we have no coal/planks fuel
  if (
    !bot.inventory
      .items()
      .some(
        (i) =>
          i.name === "coal" ||
          i.name === "charcoal" ||
          i.name.endsWith("_planks"),
      ) &&
    countLogs(bot) > 0
  ) {
    await craftAnyPlanks(bot);
  }

  const findFuel = () =>
    bot.inventory
      .items()
      .find(
        (i) =>
          i.name === "coal" ||
          i.name === "charcoal" ||
          i.name === "blaze_rod" ||
          i.name === "lava_bucket" ||
          i.name.endsWith("_planks") ||
          LOG_NAMES.includes(i.name),
      );
  const fuelItem = findFuel();

  const initialCount = countByName(bot, outputName);
  const targetTotal = initialCount + Math.max(1, neededCount);

  stepLog(
    `Smelting ${rawInput ? rawInput.name : outputName} in furnace${fuelItem ? ` using ${fuelItem.name}` : ""} (target +${neededCount} ${outputName})...`,
  );
  try {
    const furnace = await bot.openFurnace(furnaceBlock);
    try {
      if (furnace.outputItem()) {
        await furnace.takeOutput().catch(() => {});
      }
      if (!furnace.fuelItem() && fuelItem) {
        await furnace
          .putFuel(fuelItem.type, null, Math.min(fuelItem.count, 20))
          .catch(() => {});
      }
      const curIn = furnace.inputItem();
      const freshIn = findInput();
      if (!curIn && freshIn) {
        await furnace
          .putInput(
            freshIn.type,
            null,
            Math.min(freshIn.count, Math.max(1, neededCount)),
          )
          .catch(() => {});
      }

      const maxWaitMs = Math.max(1, Math.min(32, neededCount)) * 11200 + 2500;
      const startWait = Date.now();
      while (Date.now() - startWait < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 900));
        if (furnace.outputItem()) {
          await furnace.takeOutput().catch(() => {});
          if (countByName(bot, outputName) >= targetTotal) break;
        }
        const inSlot = furnace.inputItem();
        if (!inSlot && !furnace.outputItem()) {
          const moreIn = findInput();
          const remaining = targetTotal - countByName(bot, outputName);
          if (moreIn && remaining > 0) {
            await furnace
              .putInput(moreIn.type, null, Math.min(moreIn.count, remaining))
              .catch(() => {});
          } else {
            break;
          }
        }
        if (!furnace.fuelItem() && (!furnace.fuel || furnace.fuel <= 0)) {
          const moreFuel = findFuel();
          if (moreFuel) {
            await furnace
              .putFuel(moreFuel.type, null, Math.min(moreFuel.count, 4))
              .catch(() => {});
          }
        }
      }
      if (furnace.outputItem()) {
        await furnace.takeOutput().catch(() => {});
      }
    } finally {
      furnace.close();
    }
    const afterCount = countByName(bot, outputName);
    if (afterCount > initialCount) {
      stepLog(
        `Collected ${afterCount - initialCount}x ${outputName} from furnace (now have ${afterCount})`,
      );
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

async function smeltIronInFurnace(bot, goals, neededIngots, stepLog) {
  return smeltInFurnace(bot, goals, {
    inputNames: ["raw_iron", "iron_ore", "deepslate_iron_ore"],
    outputName: "iron_ingot",
    neededCount: neededIngots,
    stepLog,
  });
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
    canDig: false,
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
        await ensureSticksAndPlanks(bot, 4, 4, stepLog);
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
  craftItemByName,
  craftAnyPlanks,
  ensureCraftingTablePlaced,
  ensureSticksAndPlanks,
  placeBlockNearby,
  smeltInFurnace,
  smeltIronInFurnace,
};
