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
  performPvpAttack,
} = require("../botUtils");
const { aiBrain } = require("../aiBrain");

const info = {
  name: "GearUp",
  default: { interval: 700 },
  options: [
    {
      type: "select",
      label: "Target Loot / Tier",
      id: "tier",
      choices: [
        { value: "leather", label: "Leather & Wood" },
        { value: "wood", label: "Wooden Tools" },
        { value: "stone", label: "Stone & Leather" },
        { value: "gold", label: "Golden Gear" },
        { value: "iron", label: "Full Iron" },
        { value: "diamond", label: "Full Diamond" },
        { value: "netherite", label: "Netherite / Best" },
      ],
    },
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
const GOLD_ORE_NAMES = ["gold_ore", "deepslate_gold_ore", "nether_gold_ore"];
const DIAMOND_ORE_NAMES = ["diamond_ore", "deepslate_diamond_ore"];
const LEATHER_ANIMALS = new Set([
  "cow",
  "mooshroom",
  "horse",
  "donkey",
  "mule",
  "llama",
  "trader_llama",
  "hoglin",
]);

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
  const isArmor = ["helmet", "chestplate", "leggings", "boots"].includes(
    baseSuffix,
  );
  const tiers = isArmor
    ? ["leather", "golden", "chainmail", "iron", "diamond", "netherite"]
    : ["wooden", "golden", "stone", "iron", "diamond", "netherite"];
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

function findNearbyDroppedItems(bot, centerPos, maxDistance = 6) {
  if (!bot || !bot.entities || !centerPos) return [];
  const drops = [];
  for (const e of Object.values(bot.entities)) {
    if (!e || e === bot.entity || !e.position) continue;
    const isDrop =
      e.name === "item" ||
      e.displayName === "Item" ||
      (e.type === "object" && e.objectType === "Item");
    if (!isDrop) continue;
    const d = e.position.distanceTo(centerPos);
    if (d <= maxDistance) {
      drops.push({ entity: e, dist: d });
    }
  }
  drops.sort((a, b) => a.dist - b.dist);
  return drops.map((d) => d.entity);
}

async function collectNearbyDropsAround(bot, goals, centerPos, maxWaitMs = 1500) {
  if (!bot || !bot.entity || !goals || !centerPos) return;
  // 1. Step onto/within 1 block of the mined block position
  const distToBlock = centerPos.distanceTo(bot.entity.position);
  if (distToBlock > 1.35) {
    bot.pathfinder.setGoal(
      new goals.GoalNear(centerPos.x, centerPos.y, centerPos.z, 1),
      false,
    );
    const startWalk = Date.now();
    while (
      Date.now() - startWalk < Math.min(1200, maxWaitMs) &&
      bot.entity &&
      centerPos.distanceTo(bot.entity.position) > 1.35
    ) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  // 2. Actively sweep any dropped item entity within 5.5 blocks (critical in caves!)
  const drops = findNearbyDroppedItems(bot, centerPos, 5.5);
  for (const drop of drops.slice(0, 3)) {
    if (!bot.entity || !drop.isValid || !drop.position) continue;
    const dp = drop.position;
    if (dp.distanceTo(bot.entity.position) > 1.2) {
      bot.pathfinder.setGoal(new goals.GoalNear(dp.x, dp.y, dp.z, 1), false);
      const waitDrop = Date.now();
      while (
        Date.now() - waitDrop < 1100 &&
        bot.entity &&
        drop.isValid &&
        drop.position &&
        drop.position.distanceTo(bot.entity.position) > 1.2
      ) {
        await new Promise((r) => setTimeout(r, 110));
      }
    }
  }
  await new Promise((r) => setTimeout(r, 180));
  clearPathfinderGoal(bot);
}

async function moveNearAndDig(bot, goals, block, stepLog) {
  if (!bot || !block || !bot.entity) return false;
  const pos = block.position;
  const targetName = block.name;
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

  // Walk until ~1 block away from the target block (<= 2.55m center-to-feet)
  // so we don't mine intervening cave walls from 4m away and lose the drop!
  if (dist > 2.55) {
    let targetChanged = false;
    if (bot._mcbpGearGoalKey === goalKey) {
      const elapsed = Date.now() - (bot._mcbpGearGoalSince || 0);
      if (elapsed > 8500 || (bot._mcbpGearNoPathCount || 0) >= 2) {
        // If we got within 3.9m and pathfinder can't get closer because a block is in the way,
        // fall through and let smartDig tunnel the 1 intervening block!
        if (dist > 3.95) {
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
        stepLog(
          `Walking to 1m of ${block.name} at (${pos.x}, ${pos.y}, ${pos.z}) [${dist.toFixed(1)}m]`,
        );
        if (!bot.pathfinder.isMoving()) {
          bot.pathfinder.setGoal(
            new goals.GoalNear(pos.x, pos.y, pos.z, 1),
            false,
          );
        }
        return false;
      }
    } else {
      bot._mcbpGearGoalKey = goalKey;
      bot._mcbpGearGoalSince = Date.now();
      bot._mcbpGearNoPathCount = 0;
      targetChanged = true;
      stepLog(
        `Walking to 1m of ${block.name} at (${pos.x}, ${pos.y}, ${pos.z}) [${dist.toFixed(1)}m]`,
      );
      if (targetChanged || !bot.pathfinder.isMoving()) {
        const goalObj = new goals.GoalNear(pos.x, pos.y, pos.z, 1);
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
  }

  bot._mcbpGearGoalKey = "";
  bot._mcbpGearNoPathCount = 0;
  clearPathfinderGoal(bot);
  stepLog(`Mining ${targetName} at (${pos.x}, ${pos.y}, ${pos.z}) [1m range]...`);

  // Up to 3 dig passes in case 1–2 dirt/stone blocks are covering the ore face
  for (let pass = 0; pass < 3; pass++) {
    const liveTarget = bot.blockAt(pos);
    if (
      !liveTarget ||
      liveTarget.name === "air" ||
      liveTarget.name === "cave_air" ||
      liveTarget.name === "void_air"
    ) {
      break;
    }
    const dug = await smartDig(bot, liveTarget, {
      autoTool: true,
      saveLowDurability: false,
    });
    if (dug === false) {
      markUnreachable(45000);
      return false;
    }
    const afterBlock = bot.blockAt(pos);
    if (
      !afterBlock ||
      afterBlock.name === "air" ||
      afterBlock.name === "cave_air" ||
      afterBlock.name === "void_air" ||
      afterBlock.name !== targetName
    ) {
      break;
    }
    // We dug a blocker in front of the ore — step closer (1 block away) before digging the ore itself
    if (pos.distanceTo(bot.entity.position) > 2.2) {
      bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 1), false);
      await new Promise((r) => setTimeout(r, 450));
      clearPathfinderGoal(bot);
    }
  }

  await collectNearbyDropsAround(bot, goals, pos, 1500);
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

async function findRememberedOrNearbyWorkstation(
  bot,
  goals,
  names,
  landmarkKey,
  label,
  stepLog,
) {
  if (!bot || !bot.entity) return null;
  // 1. Scan nearby loaded chunks up to 36 blocks
  let found = findBlockByNames(bot, names, 36);
  // 2. If not immediately found, check aiBrain landmarks memory within 56 blocks
  if (!found && aiBrain?.landmarks) {
    const lm = aiBrain.landmarks.get(landmarkKey);
    if (lm && typeof lm.x === "number") {
      const { Vec3 } = loadLibraries();
      const lmPos = new Vec3(lm.x, lm.y, lm.z);
      const lmDist = lmPos.distanceTo(bot.entity.position);
      if (lmDist <= 56) {
        const blkAtLm = bot.blockAt(lmPos);
        if (blkAtLm && names.includes(blkAtLm.name)) {
          found = blkAtLm;
        } else if (!blkAtLm && lmDist > 16) {
          stepLog(
            `Walking toward remembered ${label} at (${lm.x}, ${lm.y}, ${lm.z}) [${lmDist.toFixed(1)}m]...`,
          );
          bot.pathfinder.setGoal(
            new goals.GoalNear(lm.x, lm.y, lm.z, 2),
            false,
          );
          await new Promise((r) => setTimeout(r, 1500));
          clearPathfinderGoal(bot);
          found = findBlockByNames(bot, names, 36);
        }
      }
    }
  }
  if (found && found.position) {
    aiBrain?.recordLandmark?.(landmarkKey, found.position, label, bot);
  }
  return found;
}

async function ensureCraftingTablePlaced(bot, goals, stepLog) {
  if (!bot || !bot.registry) return null;
  const existing = await findRememberedOrNearbyWorkstation(
    bot,
    goals,
    ["crafting_table"],
    "crafting_table",
    "Crafting Table",
    stepLog,
  );
  if (existing) {
    const d = existing.position.distanceTo(bot.entity.position);
    if (d > 2.6) {
      stepLog(
        `Using existing crafting_table at (${existing.position.x}, ${existing.position.y}, ${existing.position.z}) [${d.toFixed(1)}m]...`,
      );
      bot.pathfinder.setGoal(
        new goals.GoalNear(
          existing.position.x,
          existing.position.y,
          existing.position.z,
          1,
        ),
        false,
      );
      const waitStart = Date.now();
      while (
        Date.now() - waitStart < 6000 &&
        existing.position.distanceTo(bot.entity.position) > 2.8
      ) {
        await new Promise((r) => setTimeout(r, 200));
      }
      clearPathfinderGoal(bot);
    }
    if (existing.position.distanceTo(bot.entity.position) <= 4.2) {
      aiBrain?.recordLandmark?.(
        "crafting_table",
        existing.position,
        "Crafting Table",
        bot,
      );
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
      stepLog("Crafting crafting_table (no existing table nearby)...");
      await craftItemByName(bot, "crafting_table", 1, null);
    }
  }

  const tableItem = bot.inventory
    .items()
    .find((i) => i.name === "crafting_table");
  if (!tableItem) return null;

  await placeBlockNearby(bot, tableItem, "crafting_table", stepLog);
  const placed = findBlockByNames(bot, ["crafting_table"], 6);
  if (placed?.position) {
    aiBrain?.recordLandmark?.(
      "crafting_table",
      placed.position,
      "Crafting Table",
      bot,
    );
  }
  return placed;
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
      if (blockName === "crafting_table" || blockName === "furnace") {
        aiBrain?.recordLandmark?.(
          blockName,
          targetSpace.position,
          blockName === "crafting_table" ? "Crafting Table" : "Furnace",
          bot,
        );
      }
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
  let furnaceBlock = await findRememberedOrNearbyWorkstation(
    bot,
    goals,
    ["furnace", "blast_furnace"],
    "furnace",
    "Furnace",
    stepLog,
  );

  if (!furnaceBlock) {
    if (countByName(bot, "furnace") === 0) {
      if (countCobble(bot) < 8) return false;
      const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
      if (!table) return false;
      stepLog("Crafting furnace (8 cobblestone, no existing furnace nearby)...");
      await craftItemByName(bot, "furnace", 1, table);
    }
    const furnaceItem = bot.inventory.items().find((i) => i.name === "furnace");
    if (furnaceItem) {
      await placeBlockNearby(bot, furnaceItem, "furnace", stepLog);
      furnaceBlock = findBlockByNames(bot, ["furnace", "blast_furnace"], 6);
      if (furnaceBlock?.position) {
        aiBrain?.recordLandmark?.(
          "furnace",
          furnaceBlock.position,
          "Furnace",
          bot,
        );
      }
    }
  }

  if (!furnaceBlock) return false;

  const dist = furnaceBlock.position.distanceTo(bot.entity.position);
  if (dist > 2.6) {
    bot.pathfinder.setGoal(
      new goals.GoalNear(
        furnaceBlock.position.x,
        furnaceBlock.position.y,
        furnaceBlock.position.z,
        1,
      ),
      false,
    );
    const walkStart = Date.now();
    while (
      Date.now() - walkStart < 6000 &&
      furnaceBlock.position.distanceTo(bot.entity.position) > 2.8
    ) {
      await new Promise((r) => setTimeout(r, 250));
    }
    clearPathfinderGoal(bot);
    if (furnaceBlock.position.distanceTo(bot.entity.position) > 4.2) {
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

async function smeltGoldInFurnace(bot, goals, neededIngots, stepLog) {
  return smeltInFurnace(bot, goals, {
    inputNames: ["raw_gold", "gold_ore", "deepslate_gold_ore", "nether_gold_ore"],
    outputName: "gold_ingot",
    neededCount: neededIngots,
    stepLog,
  });
}

function normalizeGearTier(rawTier) {
  const cleaned = String(rawTier || "diamond")
    .trim()
    .toLowerCase();
  if (cleaned === "wood" || cleaned === "wooden") return "wooden";
  if (cleaned === "leather") return "leather";
  if (cleaned === "stone") return "stone";
  if (cleaned === "gold" || cleaned === "golden") return "gold";
  if (cleaned === "iron") return "iron";
  if (cleaned === "netherite") return "netherite";
  return "diamond";
}

function buildGearUpPlanSnapshot(
  bot,
  targetTier,
  { wantTools = true, wantArmor = true, wantShield = true } = {},
) {
  const totalWood = countLogs(bot) * 4 + countPlanks(bot);
  const hasWoodPick = hasPickaxeAtLeast(bot, "wooden_pickaxe");
  const hasStonePick = hasPickaxeAtLeast(bot, "stone_pickaxe");
  const hasIronPick = hasPickaxeAtLeast(bot, "iron_pickaxe");
  const hasDiamondPick = hasPickaxeAtLeast(bot, "diamond_pickaxe");
  const hasShield = countByName(bot, "shield") > 0;
  const hasTable =
    countByName(bot, "crafting_table") > 0 ||
    Boolean(findBlockByNames(bot, ["crafting_table"], 36)) ||
    Boolean(aiBrain?.landmarks?.has("crafting_table"));
  const hasFurnace =
    countByName(bot, "furnace") > 0 ||
    Boolean(findBlockByNames(bot, ["furnace", "blast_furnace"], 36)) ||
    Boolean(aiBrain?.landmarks?.has("furnace"));

  const tierRank = {
    leather: 0,
    wooden: 0,
    stone: 1,
    gold: 2,
    iron: 3,
    diamond: 4,
    netherite: 5,
  }[targetTier] ?? 4;

  const steps = [];

  // 1. Wood & Crafting Table
  const woodDone = hasWoodPick || totalWood >= 12;
  steps.push({
    label: "Gather wood logs & craft planks/sticks",
    done: woodDone,
  });
  steps.push({
    label: "Locate nearby or place Crafting Table",
    done: hasWoodPick || hasTable,
  });
  steps.push({
    label: "Craft Wooden Pickaxe",
    done: hasWoodPick,
  });

  if (targetTier === "wooden" || targetTier === "leather") {
    if (wantTools) {
      steps.push({
        label: "Craft Wooden Sword & Wooden Axe",
        done: hasItemOrHigherTier(bot, "sword", "wooden"),
      });
    }
    if (targetTier === "leather" && wantArmor) {
      const hasLeatherArmor =
        hasItemOrHigherTier(bot, "chestplate", "leather") &&
        hasItemOrHigherTier(bot, "leggings", "leather") &&
        hasItemOrHigherTier(bot, "helmet", "leather") &&
        hasItemOrHigherTier(bot, "boots", "leather");
      steps.push({
        label: `Hunt leather & craft Leather Armor (${countByName(bot, "leather")} leather)`,
        done: hasLeatherArmor,
      });
    }
  }

  // 2. Stone Tier
  if (tierRank >= 1) {
    steps.push({
      label: `Mine cobblestone & craft Stone Pickaxe (${countCobble(bot)} cobble)`,
      done: hasStonePick,
    });
    if (targetTier === "stone" && wantTools) {
      steps.push({
        label: "Craft Stone Sword & Stone Axe",
        done: hasItemOrHigherTier(bot, "sword", "stone"),
      });
    }
    if (targetTier === "stone" && wantArmor && countByName(bot, "leather") >= 4) {
      const hasLeatherPieces =
        hasItemOrHigherTier(bot, "chestplate", "leather") ||
        hasItemOrHigherTier(bot, "helmet", "leather") ||
        hasItemOrHigherTier(bot, "boots", "leather");
      steps.push({
        label: "Craft available Leather Armor pieces",
        done: hasLeatherPieces,
      });
    }
  }

  // 3. Furnace & Iron Tier
  if (tierRank >= 2) {
    steps.push({
      label: "Locate nearby or craft Furnace (8 cobblestone)",
      done: hasIronPick || hasFurnace,
    });
    steps.push({
      label: "Mine iron_ore, smelt iron_ingot & craft Iron Pickaxe",
      done: hasIronPick,
    });
    if (wantShield) {
      steps.push({
        label: "Craft & equip Shield (1 iron_ingot + 6 planks)",
        done: hasShield,
      });
    }
  }

  if (targetTier === "gold") {
    if (wantTools) {
      steps.push({
        label: "Mine gold_ore, smelt gold_ingot & craft Golden Tools",
        done:
          hasItemOrHigherTier(bot, "sword", "golden") &&
          hasItemOrHigherTier(bot, "pickaxe", "golden"),
      });
    }
    if (wantArmor) {
      steps.push({
        label: "Craft & equip Full Golden Armor",
        done:
          hasItemOrHigherTier(bot, "chestplate", "golden") &&
          hasItemOrHigherTier(bot, "leggings", "golden") &&
          hasItemOrHigherTier(bot, "helmet", "golden") &&
          hasItemOrHigherTier(bot, "boots", "golden"),
      });
    }
  }

  if (targetTier === "iron") {
    if (wantTools) {
      steps.push({
        label: "Craft Iron Sword, Iron Axe & Iron Shovel",
        done:
          hasItemOrHigherTier(bot, "sword", "iron") &&
          hasItemOrHigherTier(bot, "axe", "iron"),
      });
    }
    if (wantArmor) {
      steps.push({
        label: `Smelt iron & craft Full Iron Armor (${countByName(bot, "iron_ingot")} ingots)`,
        done:
          hasItemOrHigherTier(bot, "chestplate", "iron") &&
          hasItemOrHigherTier(bot, "leggings", "iron") &&
          hasItemOrHigherTier(bot, "helmet", "iron") &&
          hasItemOrHigherTier(bot, "boots", "iron"),
      });
    }
  }

  // 4. Diamond / Netherite Tier
  if (tierRank >= 4) {
    if (wantTools) {
      steps.push({
        label: `Mine diamond_ore & craft Diamond Tools (${countByName(bot, "diamond")} diamonds)`,
        done:
          hasDiamondPick && hasItemOrHigherTier(bot, "sword", "diamond"),
      });
    }
    if (wantArmor) {
      steps.push({
        label: "Craft & equip Full Diamond Armor",
        done:
          hasItemOrHigherTier(bot, "chestplate", "diamond") &&
          hasItemOrHigherTier(bot, "leggings", "diamond") &&
          hasItemOrHigherTier(bot, "helmet", "diamond") &&
          hasItemOrHigherTier(bot, "boots", "diamond"),
      });
    }
  }

  let activePlaced = false;
  const formattedSteps = steps.map((s) => {
    if (s.done) return { label: s.label, status: "done" };
    if (!activePlaced) {
      activePlaced = true;
      return { label: s.label, status: "active" };
    }
    return { label: s.label, status: "pending" };
  });

  const activeIdx = formattedSteps.findIndex((s) => s.status === "active");
  const currentStep =
    activeIdx >= 0
      ? `[${activeIdx + 1}/${formattedSteps.length}] ${formattedSteps[activeIdx].label}`
      : `Completed ${targetTier.toUpperCase()} tier progression`;

  return {
    goal: `GearUp (${targetTier.toUpperCase()} Tier)`,
    currentStep,
    steps: formattedSteps,
  };
}

async function huntNearestLeatherAnimal(bot, goals, stepLog) {
  if (!bot || !bot.entity || !bot.entities) return false;
  const me = bot.entity.position;
  const candidates = Object.values(bot.entities)
    .filter(
      (e) =>
        e &&
        e !== bot.entity &&
        e.position &&
        LEATHER_ANIMALS.has(String(e.name || "").toLowerCase()) &&
        e.position.distanceTo(me) <= 48,
    )
    .sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me));
  if (!candidates.length) return false;
  const target = candidates[0];
  const dist = target.position.distanceTo(me);
  if (dist > 3.2) {
    stepLog(
      `Hunting ${target.name} for leather at (${Math.floor(target.position.x)}, ${Math.floor(target.position.y)}, ${Math.floor(target.position.z)}) [${dist.toFixed(1)}m]...`,
    );
    bot.pathfinder.setGoal(
      new goals.GoalNear(
        target.position.x,
        target.position.y,
        target.position.z,
        1,
      ),
      false,
    );
    return false;
  }
  clearPathfinderGoal(bot);
  await equipBestWeapon(bot);
  const lastPos = target.position.clone();
  await performPvpAttack(bot, target, { useCrits: true, maxRange: 3.8 }).catch(
    () => {
      bot.attack(target);
    },
  );
  await new Promise((r) => setTimeout(r, 350));
  if (!target.isValid) {
    await collectNearbyDropsAround(bot, goals, lastPos, 1500);
  }
  return true;
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
      const targetTier = normalizeGearTier(rawTier);

      const tierRank =
        {
          leather: 0,
          wooden: 0,
          stone: 1,
          gold: 2,
          iron: 3,
          diamond: 4,
          netherite: 5,
        }[targetTier] ?? 4;

      // Keep the AI Brain synchronized with the full live GearUp plan
      const planSnap = buildGearUpPlanSnapshot(bot, targetTier, {
        wantTools,
        wantArmor,
        wantShield,
      });
      aiBrain?.syncPlan?.(planSnap, bot);
      bot._mcbpActivePlanSummary = `${planSnap.goal}: ${planSnap.currentStep}`;

      // Opportunistically record nearby Crafting Table & Furnace landmarks
      const seenTable = findBlockByNames(bot, ["crafting_table"], 24);
      if (seenTable?.position) {
        aiBrain?.recordLandmark?.(
          "crafting_table",
          seenTable.position,
          "Crafting Table",
          bot,
        );
      }
      const seenFurnace = findBlockByNames(
        bot,
        ["furnace", "blast_furnace"],
        24,
      );
      if (seenFurnace?.position) {
        aiBrain?.recordLandmark?.(
          "furnace",
          seenFurnace.position,
          "Furnace",
          bot,
        );
      }

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

      // STAGE 1: WOODEN & LEATHER TIER
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

      if (targetTier === "wooden" || targetTier === "leather") {
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
        if (targetTier === "leather" && wantArmor) {
          const leatherTargets = [];
          if (!hasItemOrHigherTier(bot, "chestplate", "leather")) {
            leatherTargets.push({ name: "leather_chestplate", cost: 8 });
          }
          if (!hasItemOrHigherTier(bot, "leggings", "leather")) {
            leatherTargets.push({ name: "leather_leggings", cost: 7 });
          }
          if (!hasItemOrHigherTier(bot, "helmet", "leather")) {
            leatherTargets.push({ name: "leather_helmet", cost: 5 });
          }
          if (!hasItemOrHigherTier(bot, "boots", "leather")) {
            leatherTargets.push({ name: "leather_boots", cost: 4 });
          }
          if (leatherTargets.length > 0) {
            const nextLeather = leatherTargets[0];
            const leatherCount = countByName(bot, "leather");
            if (leatherCount >= nextLeather.cost) {
              const table = await ensureCraftingTablePlaced(
                bot,
                goals,
                stepLog,
              );
              if (!table) return;
              stepLog(
                `Crafting ${nextLeather.name} (${nextLeather.cost} leather)...`,
              );
              await craftItemByName(bot, nextLeather.name, 1, table);
              await equipBestArmor(bot, { includeOffhand: true });
              return;
            }
            const hunted = await huntNearestLeatherAnimal(bot, goals, stepLog);
            if (!hunted) {
              stepLog(
                `Searching for cows/horses for leather (have ${leatherCount}/${nextLeather.cost} for ${nextLeather.name})...`,
              );
            }
            return;
          }
        }
        await equipBestArmor(bot, { includeOffhand: true });
        await equipBestWeapon(bot);
        stepLog(
          `Completed ${targetTier === "leather" ? "Leather & Wood" : "Wooden"} tier gear!`,
        );
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
        // Craft any leather armor piece we already have enough leather for
        if (wantArmor && countByName(bot, "leather") >= 4) {
          const leatherOpts = [
            { suffix: "chestplate", name: "leather_chestplate", cost: 8 },
            { suffix: "leggings", name: "leather_leggings", cost: 7 },
            { suffix: "helmet", name: "leather_helmet", cost: 5 },
            { suffix: "boots", name: "leather_boots", cost: 4 },
          ];
          const craftableLeather = leatherOpts.find(
            (o) =>
              !hasItemOrHigherTier(bot, o.suffix, "leather") &&
              countByName(bot, "leather") >= o.cost,
          );
          if (craftableLeather) {
            const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
            if (table) {
              stepLog(`Crafting ${craftableLeather.name}...`);
              await craftItemByName(bot, craftableLeather.name, 1, table);
              await equipBestArmor(bot, { includeOffhand: true });
              return;
            }
          }
        }
        await equipBestArmor(bot, { includeOffhand: true });
        await equipBestWeapon(bot);
        stepLog("Completed Stone tier gear!");
        bot._mcbpGearUpDone = true;
        return;
      }

      // STAGE 3: IRON TIER (required for "gold", "iron", "diamond", and "netherite")
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

        // Ensure we have an existing/remembered furnace or 8 cobble to craft one before smelting
        const nearbyFurnace =
          findBlockByNames(bot, ["furnace", "blast_furnace"], 36) ||
          (aiBrain?.landmarks?.has("furnace") ? true : null);
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

      // STAGE 3B: GOLD TIER
      if (targetTier === "gold") {
        const goldTargets = [];
        if (wantTools) {
          if (!hasItemOrHigherTier(bot, "sword", "golden")) {
            goldTargets.push({ name: "golden_sword", cost: 2, sticks: 1 });
          }
          if (!hasItemOrHigherTier(bot, "pickaxe", "golden")) {
            goldTargets.push({ name: "golden_pickaxe", cost: 3, sticks: 2 });
          }
          if (!hasItemOrHigherTier(bot, "axe", "golden")) {
            goldTargets.push({ name: "golden_axe", cost: 3, sticks: 2 });
          }
        }
        if (wantArmor) {
          if (!hasItemOrHigherTier(bot, "chestplate", "golden")) {
            goldTargets.push({ name: "golden_chestplate", cost: 8 });
          }
          if (!hasItemOrHigherTier(bot, "leggings", "golden")) {
            goldTargets.push({ name: "golden_leggings", cost: 7 });
          }
          if (!hasItemOrHigherTier(bot, "helmet", "golden")) {
            goldTargets.push({ name: "golden_helmet", cost: 5 });
          }
          if (!hasItemOrHigherTier(bot, "boots", "golden")) {
            goldTargets.push({ name: "golden_boots", cost: 4 });
          }
        }
        if (goldTargets.length > 0) {
          const nextGold = goldTargets[0];
          const goldIngots = countByName(bot, "gold_ingot");
          if (goldIngots >= nextGold.cost) {
            await ensureSticksAndPlanks(
              bot,
              nextGold.sticks || 0,
              2,
              stepLog,
            );
            const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
            if (!table) return;
            stepLog(
              `Crafting ${nextGold.name} (${nextGold.cost} gold_ingot)...`,
            );
            await craftItemByName(bot, nextGold.name, 1, table);
            await equipBestArmor(bot, { includeOffhand: true });
            await equipBestWeapon(bot);
            return;
          }
          const rawGoldCount =
            countByName(bot, "raw_gold") +
            countByName(bot, "gold_ore") +
            countByName(bot, "deepslate_gold_ore");
          const neededGold = nextGold.cost - goldIngots;
          if (rawGoldCount > 0) {
            await smeltGoldInFurnace(bot, goals, neededGold, stepLog);
            return;
          }
          const goldOre = findBlockByNames(bot, GOLD_ORE_NAMES, 64);
          if (!goldOre) {
            stepLog(
              `Searching for gold_ore (need ${neededGold} more gold for ${nextGold.name})...`,
            );
            return;
          }
          await moveNearAndDig(bot, goals, goldOre, stepLog);
          return;
        }
        await equipBestArmor(bot, { includeOffhand: true });
        await equipBestWeapon(bot);
        stepLog("Completed Golden tier gear (armor + tools equipped)!");
        bot._mcbpGearUpDone = true;
        return;
      }

      if (tierRank <= 3) {
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
      bot._mcbpActivePlanSummary = "";
      if (aiBrain?.currentGoal?.startsWith("GearUp")) {
        aiBrain.syncPlan({ goal: "Idle", currentStep: "", steps: [] }, bot);
      }
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
  smeltGoldInFurnace,
  collectNearbyDropsAround,
  buildGearUpPlanSnapshot,
  normalizeGearTier,
};
