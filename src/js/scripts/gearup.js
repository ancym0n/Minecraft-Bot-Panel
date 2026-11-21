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
const { upgradeAtSmithingTable } = require("../smithing");
const {
  chooseBuildSite,
  findUnlitPortal,
  advancePortalFrame,
  findPortalApproach,
  enterPortal,
  leavePortal,
} = require("../netherPortal");
const {
  createNetherSearchState,
  noNearbyThreats,
  safeNetherMiningBlock,
  planNetherTunnelStep,
  searchBastionChest,
  exploreNether,
} = require("../netherExplore");
const {
  MiningSkipList,
  pickMiningTarget,
  canMineFromHere,
  miningGoalFor,
  eyeDistance,
  isExposed,
  coverAbove,
  inProtectedZone,
  isUnderCover,
  countClimbBlocks,
  setClimbMode,
} = require("../miningReach");

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

function getGearSkipList(bot) {
  if (
    !bot._mcbpGearSkipList ||
    !(bot._mcbpGearSkipList instanceof MiningSkipList)
  ) {
    bot._mcbpGearSkipList = new MiningSkipList();
  }
  return bot._mcbpGearSkipList;
}

function findBlockByNames(bot, names, maxDistance = 64) {
  if (!bot || !bot.registry) return null;
  const ids = names
    .map((n) => bot.registry.blocksByName[n]?.id)
    .filter((id) => typeof id === "number");
  if (ids.length === 0) return null;
  const skips = getGearSkipList(bot);
  const legacySkipped = bot._mcbpGearSkippedBlocks;
  const protectedBlocks = bot._mcbpProtectedBlocks;
  const now = Date.now();
  if (legacySkipped && legacySkipped.size > 0) {
    for (const [k, exp] of legacySkipped.entries()) {
      if (now > exp) legacySkipped.delete(k);
    }
  }
  const positions = bot.findBlocks({
    matching: ids,
    maxDistance,
    count: 64,
  });
  if (!positions || !positions.length) return null;

  const isAllowed = (p) => {
    const k = `${p.x},${p.y},${p.z}`;
    if (skips.has(p)) return false;
    if (legacySkipped?.has(k) || legacySkipped?.has(`col:${p.x},${p.z}`))
      return false;
    if (protectedBlocks?.has(k)) return false;
    return true;
  };

  // Keep walking to the block we already chose instead of switching to a
  // slightly closer one every step.
  const gk = bot._mcbpGearGoalKey
    ? bot._mcbpGearGoalKey.split(",").map(Number)
    : null;
  const prefer =
    gk && gk.length === 3 ? { x: gk[0], y: gk[1], z: gk[2] } : null;
  const bestPos = pickMiningTarget(bot, positions, isAllowed, { prefer });
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

async function collectNearbyDropsAround(
  bot,
  goals,
  centerPos,
  maxWaitMs = 1500,
  signal,
) {
  if (signal?.aborted || !bot || !bot.entity || !goals || !centerPos) return;
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
      !signal?.aborted &&
      bot.entity &&
      centerPos.distanceTo(bot.entity.position) > 1.35
    ) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  // 2. Actively sweep any dropped item entity within 5.5 blocks (critical in caves!)
  const drops = findNearbyDroppedItems(bot, centerPos, 5.5);
  for (const drop of drops.slice(0, 3)) {
    if (signal?.aborted) break;
    if (!bot.entity || !drop.isValid || !drop.position) continue;
    const dp = drop.position;
    if (dp.distanceTo(bot.entity.position) > 1.2) {
      bot.pathfinder.setGoal(new goals.GoalNear(dp.x, dp.y, dp.z, 1), false);
      const waitDrop = Date.now();
      while (
        Date.now() - waitDrop < 1100 &&
        !signal?.aborted &&
        bot.entity &&
        drop.isValid &&
        drop.position &&
        drop.position.distanceTo(bot.entity.position) > 1.2
      ) {
        await new Promise((r) => setTimeout(r, 110));
      }
    }
  }
  if (!signal?.aborted) await new Promise((r) => setTimeout(r, 180));
  clearPathfinderGoal(bot);
}

// Counts "no path" for the current GearUp target. With engine failover on,
// Baritone's noPath is handed to the backup engine instead of being emitted,
// so the engine-switch event counts too. The first one turns on climbing.
function watchGearNoPath(bot) {
  if (bot._mcbpGearPathWatch) return;
  bot._mcbpGearPathWatch = true;
  const onNoPath = () => {
    const key = bot._mcbpGearGoalKey;
    if (!key) return;
    bot._mcbpGearNoPathCount = (bot._mcbpGearNoPathCount || 0) + 1;
    if (bot._mcbpGearClimbKey !== key) {
      bot._mcbpGearClimbKey = key;
      if (setClimbMode(bot, true)) bot._mcbpGearNeedRegoal = true;
    }
  };
  bot.on("path_update", (r) => {
    if (r?.status === "noPath") onNoPath();
  });
  bot.on("pathfinder_engine_switched", (info) => {
    if (/noPath/i.test(String(info?.reason || ""))) onNoPath();
  });
}

async function moveNearAndDig(bot, goals, block, stepLog, signal) {
  if (signal?.aborted || !bot || !block || !bot.entity) return false;
  const pos = block.position;
  const targetName = block.name;
  const eyeDist = eyeDistance(bot, pos);
  const goalKey = `${pos.x},${pos.y},${pos.z}`;
  const skips = getGearSkipList(bot);

  const markUnreachable = (ttlMs = 60000) => {
    skips.skip(pos, { ttlMs, columnAbove: true });
  };
  const nether =
    String(bot.game?.dimension || "").replace(/^minecraft:/, "") ===
    "the_nether";
  const canDigTarget = nether
    ? (candidate) => safeNetherMiningBlock(bot, candidate)
    : undefined;
  if (canDigTarget && !canDigTarget(block)) {
    markUnreachable();
    stepLog(
      `Skipping ${block.name}: nearby lava, falling blocks, or unloaded terrain`,
    );
    return false;
  }

  // Walk until the block is within normal mining reach (~4.5m from eyes with
  // line of sight). Buried blocks (stone under dirt) need the pathfinder to
  // dig down to them, so digging is switched on only for those.
  if (!canMineFromHere(bot, pos)) {
    if (nether && !isExposed(bot, pos)) {
      const step = planNetherTunnelStep(bot, pos);
      if (step.type === "blocked") {
        markUnreachable();
        clearPathfinderGoal(bot);
        stepLog(`Cannot tunnel to ${block.name}: ${step.reason}`);
        return false;
      }
      if (step.type === "dig") {
        clearPathfinderGoal(bot);
        stepLog(`Opening a safe tunnel toward ${block.name}`);
        const dug = await smartDig(bot, step.block, {
          signal,
          saveLowDurability: false,
          canDigTarget: (candidate) =>
            candidate.position.equals(step.block.position) &&
            safeNetherMiningBlock(bot, candidate),
        });
        if (!dug && !signal?.aborted) {
          markUnreachable();
          stepLog(`Could not safely excavate toward ${block.name}`);
        }
        return false;
      }
      const key = `tunnel:${step.position.toString()}`;
      if (bot._mcbpGearGoalKey !== key) {
        bot._mcbpGearGoalKey = key;
        bot._mcbpGearGoalSince = Date.now();
        bot.pathfinder.setGoal(
          new goals.GoalNear(
            step.position.x,
            step.position.y,
            step.position.z,
            0,
          ),
          false,
        );
      } else if (Date.now() - bot._mcbpGearGoalSince > 12000) {
        markUnreachable();
        bot._mcbpGearGoalKey = "";
        clearPathfinderGoal(bot);
        stepLog(`No safe path through the tunnel toward ${block.name}`);
      }
      return false;
    }
    const where = `(${pos.x}, ${pos.y}, ${pos.z})`;
    const buried = !isExposed(bot, pos);
    const cover = buried ? coverAbove(bot, pos) : { count: 0, names: [] };
    const protectedZone = inProtectedZone(bot);
    const underCover = isUnderCover(bot);
    watchGearNoPath(bot);
    // Dig/pillar only when walking can't do it: buried target, the bot is in
    // a pit/cave, or the pathfinder already found no walkable path.
    const climb =
      !nether && (buried || underCover || bot._mcbpGearClimbKey === goalKey);
    const why = buried
      ? `${block.name} is buried${cover.count ? ` under ${cover.count} block(s) of ${cover.names.slice(0, 2).join("/")}` : ""}, digging down to it`
      : underCover
        ? `${block.name} is ${eyeDist.toFixed(1)}m away and I'm under cover (pit/cave), so I may dig or pillar out with junk blocks`
        : `${block.name} is ${eyeDist.toFixed(1)}m away, walking until it is in reach`;
    setClimbMode(bot, climb);

    const now = Date.now();
    if (bot._mcbpGearGoalKey !== goalKey) {
      bot._mcbpGearGoalKey = goalKey;
      bot._mcbpGearGoalSince = now;
      bot._mcbpGearBestDist = eyeDist;
      bot._mcbpGearProgressAt = now;
      bot._mcbpGearNoPathCount = 0;
      stepLog(
        `Going for ${block.name} at ${where} [${eyeDist.toFixed(1)}m] - ${why}`,
      );
      aiBrain?.setSubObjective?.(
        `Reach ${block.name} at ${where}`,
        {
          reason: why,
          source: "GearUp",
          objective: aiBrain?.getObjective?.() || "GearUp",
        },
        bot,
      );
      bot.pathfinder.setGoal(miningGoalFor(bot, goals, pos, { buried }), false);
      return false;
    }

    // No walkable path: retry once with digging + pillaring enabled.
    if (bot._mcbpGearNeedRegoal) {
      bot._mcbpGearNeedRegoal = false;
      bot._mcbpGearProgressAt = now;
      bot._mcbpGearNoPathCount = 0;
      const blocks = countClimbBlocks(bot);
      stepLog(
        `No walkable path to ${block.name} at ${where} - ${protectedZone ? "digging is blocked here, trying anyway" : `allowing digging${blocks ? ` and pillaring (${blocks} dirt/cobblestone)` : ""} to get there`}`,
      );
      aiBrain?.setSubObjective?.(
        `Reach ${block.name} at ${where}`,
        {
          reason: "no walkable path, so digging/pillaring a way there",
          source: "GearUp",
          objective: aiBrain?.getObjective?.() || "GearUp",
        },
        bot,
      );
      try {
        bot.pathfinder.setMovements(bot.pathfinder.movements);
      } catch (_) {}
      bot.pathfinder.setGoal(miningGoalFor(bot, goals, pos, { buried }), false);
      return false;
    }

    // Judge by progress, not a fixed timer: digging down through dirt is slow
    // but steady. Give up only after no progress for a while or a hard cap.
    if (eyeDist < (bot._mcbpGearBestDist ?? Infinity) - 0.4) {
      bot._mcbpGearBestDist = eyeDist;
      bot._mcbpGearProgressAt = now;
    }
    const stalledMs = now - (bot._mcbpGearProgressAt || now);
    const totalMs = now - (bot._mcbpGearGoalSince || now);
    const noPath = (bot._mcbpGearNoPathCount || 0) >= 2;
    if (noPath || stalledMs > (buried ? 12000 : 8500) || totalMs > 45000) {
      const reason = noPath
        ? "no path to it"
        : stalledMs > 8500
          ? `no progress for ${Math.round(stalledMs / 1000)}s`
          : "took too long";
      markUnreachable(60000);
      bot._mcbpGearGoalKey = "";
      bot._mcbpGearNoPathCount = 0;
      clearPathfinderGoal(bot);
      stepLog(
        `Skipping ${block.name} at ${where} (${reason}${protectedZone && buried ? ", digging is blocked here" : ""}), picking another...`,
      );
      aiBrain?.recordProblem?.(
        "GearUp",
        `could not reach ${block.name} at ${where}: ${reason}`,
        buried
          ? "prefer exposed blocks (cliffs, caves, surface stone) or dig a staircase down"
          : "try a different target",
        bot,
      );
      if (!nether) await escapeHazardsAndObstructions(bot, { log: stepLog });
      return false;
    }
    if (!bot.pathfinder.isMoving()) {
      bot.pathfinder.setGoal(miningGoalFor(bot, goals, pos, { buried }), false);
    }
    return false;
  }

  bot._mcbpGearGoalKey = "";
  bot._mcbpGearNoPathCount = 0;
  clearPathfinderGoal(bot);
  stepLog(
    `Mining ${targetName} at (${pos.x}, ${pos.y}, ${pos.z}) [${eyeDist.toFixed(1)}m]...`,
  );

  // Up to 4 dig passes in case 1-2 dirt/stone/leaf blocks are covering the block face
  for (let pass = 0; pass < 4; pass++) {
    if (signal?.aborted) return false;
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
      signal,
      canDigTarget,
    });
    if (signal?.aborted) return false;
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
    if (!canMineFromHere(bot, pos)) {
      bot.pathfinder.setGoal(miningGoalFor(bot, goals, pos), false);
      await new Promise((r) => setTimeout(r, 450));
      clearPathfinderGoal(bot);
    }
  }

  // Next leg: walk without digging on open ground, but keep digging/pillaring
  // on while we are still in the pit we just dug (drops, next target).
  if (!nether) setClimbMode(bot, isUnderCover(bot));
  await collectNearbyDropsAround(bot, goals, pos, 1500, signal);
  return true;
}

async function craftItemByName(
  bot,
  itemName,
  count = 1,
  craftingTable = null,
  signal,
) {
  if (signal?.aborted || !bot || !bot.registry) return false;
  attachCraftingFix(bot);
  await cleanCraftingGrid(bot);
  if (signal?.aborted) return false;
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

async function craftAnyPlanks(bot, signal) {
  if (signal?.aborted || !bot || !bot.registry) return false;
  await cleanCraftingGrid(bot);
  if (signal?.aborted) return false;
  const logItem = bot.inventory
    .items()
    .find((i) => LOG_NAMES.includes(i.name) || i.name.endsWith("_log"));
  if (!logItem) return false;
  const prefix = logItem.name.replace(/_(log|stem)$/, "");
  const plankName = `${prefix}_planks`;
  return craftItemByName(bot, plankName, 1, null, signal);
}

async function findRememberedOrNearbyWorkstation(
  bot,
  goals,
  names,
  landmarkKey,
  label,
  stepLog,
  signal,
) {
  if (signal?.aborted || !bot || !bot.entity) return null;
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
          if (signal?.aborted) return null;
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

async function ensureCraftingTablePlaced(bot, goals, stepLog, signal) {
  if (signal?.aborted || !bot || !bot.registry) return null;
  const existing = await findRememberedOrNearbyWorkstation(
    bot,
    goals,
    ["crafting_table"],
    "crafting_table",
    "Crafting Table",
    stepLog,
    signal,
  );
  if (signal?.aborted) return null;
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
        !signal?.aborted &&
        existing.position.distanceTo(bot.entity.position) > 2.8
      ) {
        await new Promise((r) => setTimeout(r, 200));
      }
      clearPathfinderGoal(bot);
      if (signal?.aborted) return null;
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
    while (!signal?.aborted && countPlanks(bot) < 8 && countLogs(bot) > 0) {
      stepLog("Crafting planks from logs for crafting_table...");
      const ok = await craftAnyPlanks(bot, signal);
      if (!ok) break;
    }
    if (!signal?.aborted && countPlanks(bot) >= 4) {
      stepLog("Crafting crafting_table (no existing table nearby)...");
      await craftItemByName(bot, "crafting_table", 1, null, signal);
    }
  }

  if (signal?.aborted) return null;
  const tableItem = bot.inventory
    .items()
    .find((i) => i.name === "crafting_table");
  if (!tableItem) return null;

  await placeBlockNearby(bot, tableItem, "crafting_table", stepLog, signal);
  if (signal?.aborted) return null;
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

async function placeBlockNearby(bot, item, blockName, stepLog, signal) {
  if (signal?.aborted || !bot || !bot.entity || !item) return false;
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

  let lastError;
  for (const cand of candidates.slice(0, 6)) {
    if (signal?.aborted) return false;
    const { targetFloor, targetSpace, isAir } = cand;
    try {
      if (!isAir) {
        await bot.dig(targetSpace, true).catch(() => {});
        await new Promise((r) => setTimeout(r, 120));
        if (signal?.aborted) return false;
      }
      const freshItem =
        bot.inventory.items().find((i) => i.name === item.name) || item;
      await bot.equip(freshItem, "hand");
      if (signal?.aborted) return false;
      stepLog(
        `Placing ${blockName} at (${targetSpace.position.x}, ${targetSpace.position.y}, ${targetSpace.position.z})...`,
      );
      await bot.lookAt(targetFloor.position.offset(0.5, 1, 0.5), true);
      if (signal?.aborted) return false;
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
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError && !signal?.aborted)
    stepLog(`Could not place ${blockName}: ${lastError.message || lastError}`);
  return false;
}

async function ensureSticksAndPlanks(
  bot,
  minSticks,
  minPlanks,
  stepLog,
  signal,
) {
  while (
    !signal?.aborted &&
    countPlanks(bot) < minPlanks + 2 &&
    countLogs(bot) > 0
  ) {
    stepLog("Crafting planks from logs...");
    const ok = await craftAnyPlanks(bot, signal);
    if (!ok) break;
  }
  while (
    !signal?.aborted &&
    countByName(bot, "stick") < minSticks &&
    countPlanks(bot) >= 2
  ) {
    stepLog("Crafting sticks from planks...");
    const ok = await craftItemByName(bot, "stick", 1, null, signal);
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
    reservePlanks = 0,
    signal,
    requireEmptyFurnace = false,
    recoveryLog = stepLog,
  } = {},
) {
  if (!bot || !bot.registry || signal?.aborted) return false;
  attachCraftingFix(bot);
  await cleanCraftingGrid(bot);
  if (signal?.aborted) return false;
  let furnaceBlock = await findRememberedOrNearbyWorkstation(
    bot,
    goals,
    ["furnace", "blast_furnace"],
    "furnace",
    "Furnace",
    stepLog,
    signal,
  );
  if (signal?.aborted) return false;

  if (!furnaceBlock) {
    if (countByName(bot, "furnace") === 0) {
      if (countCobble(bot) < 8) {
        const stone = findBlockByNames(bot, [...STONE_NAMES, "blackstone"], 48);
        if (stone) await moveNearAndDig(bot, goals, stone, stepLog, signal);
        else stepLog("Need 8 cobblestone or blackstone for a furnace");
        return false;
      }
      const table = await ensureCraftingTablePlaced(
        bot,
        goals,
        stepLog,
        signal,
      );
      if (!table || signal?.aborted) return false;
      stepLog(
        "Crafting furnace (8 cobblestone, no existing furnace nearby)...",
      );
      await craftItemByName(bot, "furnace", 1, table, signal);
      if (signal?.aborted) return false;
    }
    const furnaceItem = bot.inventory.items().find((i) => i.name === "furnace");
    if (furnaceItem) {
      await placeBlockNearby(bot, furnaceItem, "furnace", stepLog, signal);
      if (signal?.aborted) return false;
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
      !signal?.aborted &&
      furnaceBlock.position.distanceTo(bot.entity.position) > 2.8
    ) {
      await new Promise((r) => setTimeout(r, 250));
    }
    clearPathfinderGoal(bot);
    if (signal?.aborted) return false;
    if (furnaceBlock.position.distanceTo(bot.entity.position) > 4.2) {
      return false;
    }
  }

  clearPathfinderGoal(bot);
  let openFurnace = null;
  const inventoryItems = () =>
    openFurnace
      ? openFurnace.slots
          .slice(openFurnace.inventoryStart, openFurnace.inventoryEnd)
          .filter(Boolean)
      : bot.inventory.items();
  const availableCount = (predicate) =>
    inventoryItems().reduce(
      (total, item) => total + (predicate(item) ? item.count : 0),
      0,
    );
  const isFuelPlank = (item) =>
    item.name.endsWith("_planks") &&
    !["crimson_planks", "warped_planks"].includes(item.name);
  const availablePlanks = () => availableCount(isFuelPlank);
  const findInput = () =>
    inventoryItems().find((i) => inputNames.includes(i.name));
  const rawInput = findInput();

  // Fuel: coal/charcoal first (8 smelts each); planks only beyond the ones
  // reserved for crafting (1.5 each); logs are turned into planks first
  // (1 log = 4 planks = 6 smelts instead of 1.5).
  const coalLike = (i) =>
    ["coal", "charcoal", "blaze_rod", "lava_bucket"].includes(i.name);
  const hasCoal = () => inventoryItems().some(coalLike);
  while (
    !hasCoal() &&
    availablePlanks() - reservePlanks <
      Math.ceil(Math.max(1, neededCount) / SMELT_PER_PLANK) &&
    countLogs(bot) > 0
  ) {
    if (!(await craftAnyPlanks(bot, signal))) break;
    if (signal?.aborted) return false;
  }
  const findFuel = () => {
    const items = inventoryItems();
    const coal = items.find(coalLike);
    if (coal) return coal;
    if (availablePlanks() - reservePlanks > 0) {
      return items.find(isFuelPlank) || null;
    }
    return (
      items.find(
        (i) =>
          LOG_NAMES.includes(i.name) &&
          !["crimson_stem", "warped_stem"].includes(i.name),
      ) || null
    );
  };
  // How many of `item` to load for `smelts` smelts.
  const fuelAmount = (item, smelts) => {
    if (!item) return 0;
    const per = coalLike(item) ? SMELT_PER_COAL : SMELT_PER_PLANK;
    let n = Math.ceil(Math.max(1, smelts) / per);
    if (item.name.endsWith("_planks"))
      n = Math.min(n, availablePlanks() - reservePlanks);
    return Math.max(1, Math.min(item.count, n));
  };
  const fuelItem = findFuel();
  if (requireEmptyFurnace && !fuelItem) {
    stepLog("Need fuel before starting the furnace");
    return false;
  }

  const initialCount = countByName(bot, outputName);
  const targetTotal = initialCount + Math.max(1, neededCount);

  stepLog(
    `Smelting ${rawInput ? rawInput.name : outputName} in furnace${fuelItem ? ` using ${fuelItem.name}` : ""} (target +${neededCount} ${outputName})...`,
  );
  try {
    const furnace = await bot.openFurnace(furnaceBlock);
    openFurnace = furnace;
    const trackedWindow = bot.currentWindow === furnace;
    let owned = null;
    try {
      if (signal?.aborted) return false;
      if (
        requireEmptyFurnace &&
        (furnace.inputItem() || furnace.fuelItem() || furnace.outputItem())
      ) {
        throw new Error("Furnace is occupied; refusing to move its contents");
      }
      if (requireEmptyFurnace) {
        owned = {
          inputs: new Set(),
          fuels: new Set(),
          outstandingInput: 0,
          insertedFuel: 0,
        };
      }
      if (
        furnace.inputItem() &&
        !inputNames.includes(furnace.inputItem().name)
      ) {
        throw new Error("Furnace contains a different input item");
      }
      if (furnace.outputItem()) {
        if (furnace.outputItem().name !== outputName) {
          throw new Error("Furnace contains a different output item");
        }
        await furnace.takeOutput();
      }
      if (signal?.aborted) return false;
      if (!furnace.fuelItem() && fuelItem) {
        const amount = fuelAmount(fuelItem, neededCount);
        await furnace.putFuel(fuelItem.type, null, amount);
        if (owned) {
          owned.fuels.add(fuelItem.name);
          owned.insertedFuel += amount;
        }
      }
      if (signal?.aborted) return false;
      const curIn = furnace.inputItem();
      const freshIn = findInput();
      if (!curIn && freshIn) {
        const amount = Math.min(freshIn.count, Math.max(1, neededCount));
        await furnace.putInput(freshIn.type, null, amount);
        if (owned) {
          owned.inputs.add(freshIn.name);
          owned.outstandingInput += amount;
        }
      }

      const maxWaitMs = Math.max(1, Math.min(32, neededCount)) * 11200 + 2500;
      const startWait = Date.now();
      while (!signal?.aborted && Date.now() - startWait < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 900));
        if (signal?.aborted) return false;
        if (furnace.outputItem()) {
          if (furnace.outputItem().name !== outputName) {
            throw new Error("Furnace produced an unexpected item");
          }
          const outputCount = furnace.outputItem().count;
          await furnace.takeOutput();
          if (owned) owned.outstandingInput -= outputCount;
          if (availableCount((item) => item.name === outputName) >= targetTotal)
            break;
        }
        const inSlot = furnace.inputItem();
        if (!inSlot && !furnace.outputItem()) {
          const moreIn = findInput();
          const remaining =
            targetTotal - availableCount((item) => item.name === outputName);
          if (moreIn && remaining > 0) {
            const amount = Math.min(moreIn.count, remaining);
            await furnace.putInput(moreIn.type, null, amount);
            if (owned) {
              owned.inputs.add(moreIn.name);
              owned.outstandingInput += amount;
            }
          } else {
            break;
          }
        }
        if (!furnace.fuelItem() && (!furnace.fuel || furnace.fuel <= 0)) {
          const moreFuel = findFuel();
          const left =
            targetTotal - availableCount((item) => item.name === outputName);
          if (moreFuel && left > 0) {
            const amount = fuelAmount(moreFuel, left);
            await furnace.putFuel(moreFuel.type, null, amount);
            if (owned) {
              owned.fuels.add(moreFuel.name);
              owned.insertedFuel += amount;
            }
          }
        }
      }
      if (!signal?.aborted && furnace.outputItem()?.name === outputName) {
        const outputCount = furnace.outputItem().count;
        await furnace.takeOutput();
        if (owned) owned.outstandingInput -= outputCount;
      }
    } finally {
      try {
        if (owned) {
          if (trackedWindow && bot.currentWindow !== furnace) {
            recoveryLog(
              "Furnace window changed; recover its contents manually",
            );
          } else {
            const input = furnace.inputItem();
            const fuel = furnace.fuelItem();
            const output = furnace.outputItem();
            const inputCount = input?.count || 0;
            const outputCount = output?.count || 0;
            const unexpected =
              (input && !owned.inputs.has(input.name)) ||
              (output && output.name !== outputName) ||
              (fuel && !owned.fuels.has(fuel.name)) ||
              inputCount + outputCount > owned.outstandingInput ||
              (fuel?.count || 0) > owned.insertedFuel;
            if (unexpected) {
              recoveryLog(
                "Furnace contents changed unexpectedly; recover your materials manually",
              );
            } else {
              if (output) await furnace.takeOutput();
              if (input) await furnace.takeInput();
              if (fuel) await furnace.takeFuel();
              if (input || output || fuel)
                recoveryLog("Recovered remaining furnace materials");
            }
          }
        }
      } catch (error) {
        recoveryLog(
          `Could not recover furnace materials; retrieve them manually: ${error.message || error}`,
        );
      } finally {
        await furnace.close();
        openFurnace = null;
      }
    }
    if (signal?.aborted) return false;
    const afterCount = countByName(bot, outputName);
    if (afterCount > initialCount) {
      stepLog(
        `Collected ${afterCount - initialCount}x ${outputName} from furnace (now have ${afterCount})`,
      );
      return true;
    }
    return false;
  } catch (err) {
    if (!signal?.aborted) stepLog(`Smelting failed: ${err.message || err}`);
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
    inputNames: [
      "raw_gold",
      "gold_ore",
      "deepslate_gold_ore",
      "nether_gold_ore",
    ],
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
    if (
      targetTier === "stone" &&
      wantArmor &&
      countByName(bot, "leather") >= 4
    ) {
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
        done: hasDiamondPick && hasItemOrHigherTier(bot, "sword", "diamond"),
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

  if (targetTier === "netherite") {
    const pieces = [
      ...(wantTools ? ["sword", "pickaxe", "axe", "shovel"] : []),
      ...(wantArmor ? ["helmet", "chestplate", "leggings", "boots"] : []),
    ];
    if (pieces.length) {
      steps.push({
        label: "Upgrade requested equipment to Netherite",
        done: pieces.every((piece) =>
          hasItemOrHigherTier(bot, piece, "netherite"),
        ),
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

async function huntNearestLeatherAnimal(bot, goals, stepLog, signal) {
  if (signal?.aborted || !bot || !bot.entity || !bot.entities) return false;
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
  if (signal?.aborted) return false;
  const lastPos = target.position.clone();
  await performPvpAttack(bot, target, {
    useCrits: true,
    maxRange: 3.8,
    signal,
  }).catch((error) => {
    if (signal?.aborted) return;
    stepLog(`Attack failed: ${error.message || error}`);
    bot.attack(target);
  });
  await new Promise((r) => setTimeout(r, 350));
  if (!signal?.aborted && !target.isValid) {
    await collectNearbyDropsAround(bot, goals, lastPos, 1500, signal);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bill of materials: what a whole stage needs before anything is crafted.
// ---------------------------------------------------------------------------

// Vanilla recipes: material count + sticks per tool, material per armor piece.
const TOOL_COST = {
  pickaxe: { count: 3, sticks: 2 },
  axe: { count: 3, sticks: 2 },
  sword: { count: 2, sticks: 1 },
  shovel: { count: 1, sticks: 2 },
};
const ARMOR_COST = { helmet: 5, chestplate: 8, leggings: 7, boots: 4 };
const STONE_TOOL_MATS = ["cobblestone", "cobbled_deepslate", "blackstone"];
const SMELT_PER_COAL = 8;
const SMELT_PER_PLANK = 1.5;
const RAW_FOR_INGOT = {
  iron_ingot: ["raw_iron", "iron_ore", "deepslate_iron_ore"],
  gold_ingot: ["raw_gold", "gold_ore", "deepslate_gold_ore", "nether_gold_ore"],
};

function isLogName(n) {
  return LOG_NAMES.includes(n) || n.endsWith("_log") || n.endsWith("_stem");
}

// { itemName: count } for everything in the inventory.
function inventoryCounts(bot) {
  const counts = {};
  for (const i of bot?.inventory?.items?.() || []) {
    counts[i.name] = (counts[i.name] || 0) + i.count;
  }
  return counts;
}

function sumCounts(counts, pred) {
  let n = 0;
  for (const [name, c] of Object.entries(counts || {})) if (pred(name)) n += c;
  return n;
}

// Everything still to craft in `stage` for the chosen tier/options.
// `owns(suffix, tier)` and `hasPick(name)` say what the bot already has.
function gearStageItems(stage, tier, opts, owns, hasPick, countOf) {
  const { wantTools = true, wantArmor = true, wantShield = true } = opts || {};
  const items = [];
  const tool = (prefix, kind, mat) => ({
    name: `${prefix}_${kind}`,
    mat,
    count: TOOL_COST[kind].count,
    sticks: TOOL_COST[kind].sticks,
  });
  const armor = (prefix, piece, mat) => ({
    name: `${prefix}_${piece}`,
    mat,
    count: ARMOR_COST[piece],
    sticks: 0,
  });
  const fullSet = (prefix, toolTier, mat, toolKinds) => {
    if (wantTools) {
      for (const kind of toolKinds) {
        if (!owns(kind, toolTier)) items.push(tool(prefix, kind, mat));
      }
    }
    if (wantArmor) {
      for (const piece of Object.keys(ARMOR_COST)) {
        if (!owns(piece, toolTier)) items.push(armor(prefix, piece, mat));
      }
    }
  };
  if (stage === "wooden") {
    if (!hasPick("wooden_pickaxe"))
      items.push(tool("wooden", "pickaxe", "planks"));
    if ((tier === "wooden" || tier === "leather") && wantTools) {
      if (!owns("sword", "wooden"))
        items.push(tool("wooden", "sword", "planks"));
      if (!owns("axe", "wooden")) items.push(tool("wooden", "axe", "planks"));
    }
  } else if (stage === "stone") {
    if (!hasPick("stone_pickaxe"))
      items.push(tool("stone", "pickaxe", "cobblestone"));
    if (tier === "stone" && wantTools) {
      if (!owns("sword", "stone"))
        items.push(tool("stone", "sword", "cobblestone"));
      if (!owns("axe", "stone"))
        items.push(tool("stone", "axe", "cobblestone"));
    }
  } else if (stage === "iron") {
    if (!hasPick("iron_pickaxe"))
      items.push(tool("iron", "pickaxe", "iron_ingot"));
    if (wantShield && countOf("shield") === 0) {
      items.push({
        name: "shield",
        mat: "iron_ingot",
        count: 1,
        sticks: 0,
        planks: 6,
      });
    }
    if (tier === "iron") {
      if (wantTools) {
        for (const kind of ["sword", "axe", "shovel"]) {
          if (!owns(kind, "iron")) items.push(tool("iron", kind, "iron_ingot"));
        }
      }
      if (wantArmor) {
        for (const piece of Object.keys(ARMOR_COST)) {
          if (!owns(piece, "iron"))
            items.push(armor("iron", piece, "iron_ingot"));
        }
      }
    }
  } else if (stage === "gold") {
    fullSet("golden", "golden", "gold_ingot", ["sword", "pickaxe", "axe"]);
  } else if (stage === "diamond") {
    fullSet("diamond", "diamond", "diamond", [
      "sword",
      "pickaxe",
      "axe",
      "shovel",
    ]);
  }
  return items;
}

// Totals for `items` against the inventory `inv` ({name: count}), including
// sticks -> planks -> logs, a crafting table, a furnace (8 cobblestone), one
// raw ore per missing ingot, and smelting fuel (coal 8 / plank 1.5 smelts).
// `missing` is what still has to be gathered; `ready` = craft now.
function computeGearBudget(
  items,
  inv,
  { haveTable = false, haveFurnace = false, coalAvailable = true } = {},
) {
  const c = inv || {};
  const planksHave = sumCounts(c, (n) => n.endsWith("_planks"));
  const logsHave = sumCounts(c, isLogName);
  const sticksHave = c.stick || 0;
  const cobbleHave = sumCounts(c, (n) => STONE_TOOL_MATS.includes(n));

  const mats = {};
  let sticks = 0;
  let planksDirect = 0;
  for (const it of items) {
    mats[it.mat] = (mats[it.mat] || 0) + it.count;
    sticks += it.sticks || 0;
    planksDirect += it.planks || 0;
  }
  if (mats.planks) planksDirect += mats.planks;

  const smeltOut = mats.iron_ingot
    ? "iron_ingot"
    : mats.gold_ingot
      ? "gold_ingot"
      : null;
  const ingotsNeed = smeltOut ? mats[smeltOut] : 0;
  const ingotsHave = smeltOut ? c[smeltOut] || 0 : 0;
  const ingotsMissing = Math.max(0, ingotsNeed - ingotsHave);
  const rawNames = smeltOut ? RAW_FOR_INGOT[smeltOut] : [];
  const rawHave = sumCounts(c, (n) => rawNames.includes(n));
  const rawMissing = Math.max(0, ingotsMissing - rawHave);
  const smelts = Math.min(ingotsMissing, rawHave);

  const needFurnace = ingotsMissing > 0 && !haveFurnace && !(c.furnace > 0);
  const cobbleNeed = (mats.cobblestone || 0) + (needFurnace ? 8 : 0);
  const cobbleMissing = Math.max(0, cobbleNeed - cobbleHave);

  // Fuel for every ingot still to make (not only what is smeltable now).
  const coalHave = (c.coal || 0) + (c.charcoal || 0);
  const smeltsWithoutCoal = Math.max(
    0,
    ingotsMissing - coalHave * SMELT_PER_COAL,
  );
  let coalMissing = 0;
  let fuelPlanks = 0;
  if (smeltsWithoutCoal > 0) {
    if (coalAvailable)
      coalMissing = Math.ceil(smeltsWithoutCoal / SMELT_PER_COAL);
    else fuelPlanks = Math.ceil(smeltsWithoutCoal / SMELT_PER_PLANK);
  }

  const sticksMissing = Math.max(0, sticks - sticksHave);
  const planksForSticks = Math.ceil(sticksMissing / 4) * 2;
  const planksForTable = haveTable || c.crafting_table > 0 ? 0 : 4;
  const craftPlanks = planksDirect + planksForSticks + planksForTable;
  const planksNeed = craftPlanks + fuelPlanks;
  const planksMissing = Math.max(0, planksNeed - planksHave);
  const logsMissing = Math.max(0, Math.ceil(planksMissing / 4) - logsHave);

  const missing = {};
  if (logsMissing) missing.logs = logsMissing;
  if (cobbleMissing) missing.cobblestone = cobbleMissing;
  if (coalMissing) missing.coal = coalMissing;
  if (rawMissing) missing[rawNames[0]] = rawMissing;
  for (const m of ["diamond", "leather"]) {
    const miss = Math.max(0, (mats[m] || 0) - (c[m] || 0));
    if (miss) missing[m] = miss;
  }
  return {
    items,
    mats,
    sticks,
    craftPlanks,
    fuelPlanks,
    planksNeed,
    cobbleNeed,
    needFurnace,
    smeltOut,
    ingotsNeed,
    ingotsMissing,
    smelts,
    missing,
    ready: Object.keys(missing).length === 0 && ingotsMissing === 0,
  };
}

// "need 24 iron_ingot (have 3), 7 sticks, 8 cobblestone (furnace), 3 coal - missing: 21 raw_iron, 3 coal"
function describeGearBudget(stage, b, inv) {
  const c = inv || {};
  const parts = [];
  for (const [mat, n] of Object.entries(b.mats)) {
    if (mat === "planks") continue;
    const have =
      mat === "cobblestone"
        ? sumCounts(c, (x) => STONE_TOOL_MATS.includes(x))
        : c[mat] || 0;
    parts.push(`${n} ${mat} (have ${have})`);
  }
  if (b.sticks) parts.push(`${b.sticks} sticks`);
  if (b.craftPlanks) parts.push(`${b.craftPlanks} planks`);
  if (b.needFurnace) parts.push("8 cobblestone for a furnace");
  if (b.ingotsMissing) {
    parts.push(
      b.fuelPlanks
        ? `${b.fuelPlanks} planks as fuel`
        : `${Math.ceil(b.ingotsMissing / SMELT_PER_COAL)} coal`,
    );
  }
  const miss = Object.entries(b.missing).map(([k, v]) => `${v} ${k}`);
  return `${stage} plan: craft ${b.items.map((i) => i.name).join(", ")} - needs ${parts.join(", ")}${
    miss.length
      ? ` - still missing: ${miss.join(", ")}`
      : b.smelts
        ? ` - smelting ${b.smelts} first`
        : " - have everything"
  }`;
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.pathfinder || !bot.inventory) {
    clearLog("GearUp:");
    log("GearUp: Connect a bot first");
    return;
  }

  const { goals, mcData, Movements } = loadLibraries();
  const signal = scriptRepeater.signal;
  let busy = false;
  let netheriteBlocked = false;
  let portalPlan = null;
  const portalEntryState = {};
  const portalLandmarks = new Map();
  let observedDimension = "";
  let lastDimensionChange = 0;
  const netherSearch = createNetherSearchState();
  bot._mcbpSprintJump = true;
  configureSmartMovements(bot, mcData, Movements, {
    canDig: false,
    allowSprinting: true,
    allowParkour: true,
  });

  function stepLog(msg) {
    clearLog("GearUp:");
    log(`GearUp: ${msg}`);
    aiBrain?.setSubObjective?.(
      msg,
      { source: "GearUp", objective: aiBrain?.getObjective?.() || "GearUp" },
      bot,
    );
  }

  function recoveryLog(msg) {
    if (signal?.aborted && scriptRepeater.report) {
      scriptRepeater.report(`GearUp: ${msg}`);
    } else {
      stepLog(msg);
    }
  }

  stepLog("Starting full progression (Wood ➙ Stone ➙ Iron ➙ Diamond)...");

  let lastPlanLine = "";

  // One step of a stage: gather the next missing material, smelt, or craft
  // the whole batch. Returns "done" once the stage has nothing left to craft.
  async function runGearStage(stage, tier, opts) {
    const items = gearStageItems(
      stage,
      tier,
      opts,
      (suffix, t) => hasItemOrHigherTier(bot, suffix, t),
      (name) => hasPickaxeAtLeast(bot, name),
      (name) => countByName(bot, name),
    );
    if (!items.length) return "done";

    const inv = inventoryCounts(bot);
    const haveTable =
      Boolean(findBlockByNames(bot, ["crafting_table"], 32)) ||
      Boolean(aiBrain?.landmarks?.has?.("crafting_table"));
    const haveFurnace =
      Boolean(findBlockByNames(bot, ["furnace", "blast_furnace"], 36)) ||
      Boolean(aiBrain?.landmarks?.has?.("furnace"));
    const coalOre = findBlockByNames(bot, COAL_ORE_NAMES, 48);
    const budget = computeGearBudget(items, inv, {
      haveTable,
      haveFurnace,
      coalAvailable:
        Boolean(coalOre) || (inv.coal || 0) + (inv.charcoal || 0) > 0,
    });
    const planLine = describeGearBudget(stage, budget, inv);
    if (planLine !== lastPlanLine) {
      lastPlanLine = planLine;
      stepLog(planLine);
      aiBrain?.setSubObjective?.(
        `${stage} stage: ${
          budget.ready
            ? "craft everything"
            : `gather ${
                Object.entries(budget.missing)
                  .map(([k, v]) => `${v} ${k}`)
                  .join(", ") || "smelt"
              }`
        }`,
        {
          reason: "collect every material for the whole set before crafting",
          source: "GearUp",
          objective: aiBrain?.getObjective?.() || "GearUp",
        },
        bot,
      );
    }

    const m = budget.missing;
    // 1. Wood (planks for sticks, table, shield, wooden tools, plank fuel).
    if (m.logs) {
      const logBlock = findBlockByNames(bot, LOG_NAMES, 64);
      if (!logBlock) {
        if (
          String(bot.game?.dimension || "").replace(/^minecraft:/, "") ===
          "the_nether"
        ) {
          await ensureOverworld();
          return "busy";
        }
        stepLog(`Searching for trees (need ${m.logs} more logs)...`);
        return "busy";
      }
      await moveNearAndDig(bot, goals, logBlock, stepLog, signal);
      return "busy";
    }
    // 2. Cobblestone (stone tools, furnace).
    if (m.cobblestone) {
      const stoneBlock = findBlockByNames(bot, STONE_NAMES, 48);
      if (!stoneBlock) {
        stepLog(
          `Searching for stone (need ${m.cobblestone} more cobblestone)...`,
        );
        return "busy";
      }
      await moveNearAndDig(bot, goals, stoneBlock, stepLog, signal);
      return "busy";
    }
    // 3. Fuel for every ingot.
    if (m.coal) {
      if (coalOre) {
        await moveNearAndDig(bot, goals, coalOre, stepLog, signal);
        return "busy";
      }
      // computeGearBudget switches to plank fuel when no coal is around.
    }
    // 4. Ore / diamonds / leather.
    const rawKey = Object.keys(m).find((k) => k.startsWith("raw_"));
    if (rawKey) {
      const names = rawKey === "raw_iron" ? IRON_ORE_NAMES : GOLD_ORE_NAMES;
      const ore = findBlockByNames(bot, names, 64);
      if (!ore) {
        if (
          rawKey === "raw_iron" &&
          String(bot.game?.dimension || "").replace(/^minecraft:/, "") ===
            "the_nether"
        ) {
          await ensureOverworld();
          return "busy";
        }
        stepLog(
          `Searching for ${names[0]} (need ${m[rawKey]} more ${rawKey})...`,
        );
        return "busy";
      }
      await moveNearAndDig(bot, goals, ore, stepLog, signal);
      return "busy";
    }
    if (m.diamond) {
      const ore = findBlockByNames(bot, DIAMOND_ORE_NAMES, 64);
      if (!ore) {
        if (
          String(bot.game?.dimension || "").replace(/^minecraft:/, "") ===
          "the_nether"
        ) {
          await ensureOverworld();
          return "busy";
        }
        stepLog(
          `Scanning for diamond_ore (need ${m.diamond} more diamonds)...`,
        );
        return "busy";
      }
      await moveNearAndDig(bot, goals, ore, stepLog, signal);
      return "busy";
    }
    // 5. Smelt every ingot in one furnace visit.
    if (budget.ingotsMissing > 0) {
      const ok = await smeltInFurnace(bot, goals, {
        inputNames: RAW_FOR_INGOT[budget.smeltOut],
        outputName: budget.smeltOut,
        neededCount: budget.ingotsMissing,
        reservePlanks: budget.craftPlanks,
        stepLog,
        signal,
      });
      if (!ok)
        stepLog(
          `Could not smelt ${budget.smeltOut} yet (furnace/fuel) - retrying...`,
        );
      return "busy";
    }
    // 6. Everything is here: craft the whole batch at one table.
    await ensureSticksAndPlanks(
      bot,
      budget.sticks,
      budget.craftPlanks,
      stepLog,
      signal,
    );
    if (signal?.aborted) return "busy";
    const table = await ensureCraftingTablePlaced(bot, goals, stepLog, signal);
    if (!table || signal?.aborted) return "busy";
    let crafted = 0;
    for (const it of items) {
      if (signal?.aborted) return "busy";
      stepLog(
        `Crafting ${it.name} (${it.count} ${it.mat}${it.sticks ? ` + ${it.sticks} sticks` : ""})...`,
      );
      if (await craftItemByName(bot, it.name, 1, table, signal)) {
        crafted += 1;
      } else {
        stepLog(`Could not craft ${it.name} - re-checking materials`);
        break;
      }
    }
    if (signal?.aborted) return "busy";
    await equipBestArmor(bot, { includeOffhand: true, signal });
    if (!signal?.aborted) await equipBestWeapon(bot, { signal });
    if (crafted) stepLog(`Crafted ${crafted}/${items.length} ${stage} item(s)`);
    return "busy";
  }

  function observeDimension() {
    const dimension = String(bot.game?.dimension || "").replace(
      /^minecraft:/,
      "",
    );
    if (dimension && dimension !== observedDimension) {
      if (
        observedDimension ||
        bot.blockAt(bot.entity.position.floored())?.name === "nether_portal"
      ) {
        lastDimensionChange = Date.now();
      }
      observedDimension = dimension;
      portalEntryState.insideSince = 0;
      portalEntryState.approachKey = null;
      portalEntryState.returnGoal = null;
    }
    if (
      dimension &&
      !portalLandmarks.has(dimension) &&
      bot.registry?.blocksByName?.nether_portal
    ) {
      const portal = findPortalApproach(bot);
      if (portal) portalLandmarks.set(dimension, portal.portal.clone());
    }
    return dimension;
  }

  async function traversePortal(approach) {
    const coolingDown = Date.now() - lastDimensionChange < 16000;
    const inside =
      bot.blockAt(bot.entity.position.floored())?.name === "nether_portal";
    if (coolingDown) {
      if (inside) await leavePortal(bot, approach, signal);
      else stepLog("Waiting for the portal cooldown before travelling");
      return;
    }
    await enterPortal(bot, goals, approach, portalEntryState, signal, stepLog);
  }

  async function ensureNether() {
    const dimension = observeDimension();
    if (dimension === "the_nether") return true;
    if (dimension !== "overworld") {
      stepLog("Cannot safely enter the Nether from the current dimension");
      return false;
    }

    const approach = findPortalApproach(bot);
    if (approach) {
      portalLandmarks.set(dimension, approach.portal.clone());
      await traversePortal(approach);
      return false;
    }
    const portalId = bot.registry.blocksByName.nether_portal?.id;
    if (
      portalId != null &&
      bot.findBlocks({ matching: [portalId], maxDistance: 64, count: 1 }).length
    ) {
      stepLog("Found a Nether portal but no safe entrance is reachable");
      return false;
    }
    if (!portalPlan) portalPlan = findUnlitPortal(bot);
    if (!portalPlan) {
      if (countByName(bot, "obsidian") < 10) {
        const obsidian = findBlockByNames(bot, ["obsidian"], 64);
        if (obsidian && hasPickaxeAtLeast(bot, "diamond_pickaxe")) {
          await moveNearAndDig(bot, goals, obsidian, stepLog, signal);
        } else {
          stepLog(
            "Need 10 obsidian and a diamond pickaxe to build a Nether portal",
          );
        }
        return false;
      }
      const filler = bot.inventory
        .items()
        .reduce(
          (total, item) =>
            total +
            ([
              "cobblestone",
              "cobbled_deepslate",
              "blackstone",
              "dirt",
              "netherrack",
            ].includes(item.name)
              ? item.count
              : 0),
          0,
        );
      if (filler < 3) {
        const stone = findBlockByNames(bot, STONE_NAMES, 48);
        if (stone) await moveNearAndDig(bot, goals, stone, stepLog, signal);
        else stepLog("Need 3 support blocks to build a Nether portal");
        return false;
      }
    }

    if (countByName(bot, "flint_and_steel") === 0) {
      if (countByName(bot, "flint") === 0) {
        const gravel = findBlockByNames(bot, ["gravel"], 64);
        if (gravel) await moveNearAndDig(bot, goals, gravel, stepLog, signal);
        else stepLog("Need flint from gravel to light the Nether portal");
        return false;
      }
      if (countByName(bot, "iron_ingot") === 0) {
        const rawIron = inventoryCounts(bot);
        if ((rawIron.raw_iron || 0) + (rawIron.iron_ore || 0) > 0) {
          if (!(await ensureSmeltingFuel()) || signal?.aborted) return false;
          await smeltInFurnace(bot, goals, {
            neededCount: 1,
            stepLog,
            signal,
            requireEmptyFurnace: true,
            recoveryLog,
          });
        } else {
          const ironOre = findBlockByNames(bot, IRON_ORE_NAMES, 64);
          if (ironOre)
            await moveNearAndDig(bot, goals, ironOre, stepLog, signal);
          else stepLog("Need an iron ingot to craft flint and steel");
        }
        return false;
      }
      if (!(await craftItemByName(bot, "flint_and_steel", 1, null, signal))) {
        stepLog("Could not craft flint and steel");
      }
      return false;
    }

    if (!portalPlan) {
      if (inProtectedZone(bot)) {
        stepLog("Cannot build a Nether portal in a protected area");
        return false;
      }
      portalPlan = chooseBuildSite(bot);
      if (!portalPlan) {
        stepLog("No clear, safe site for a Nether portal in loaded terrain");
        return false;
      }
      stepLog("Building a Nether portal on clear ground");
    }
    await advancePortalFrame(bot, goals, portalPlan, signal, stepLog);
    return false;
  }

  async function ensureOverworld() {
    const dimension = observeDimension();
    if (dimension === "overworld") return true;
    if (dimension !== "the_nether") {
      stepLog("Cannot safely return to the Overworld from this dimension");
      return false;
    }
    if (!ensureSafeNetherMovement()) return false;
    const approach = findPortalApproach(bot);
    if (approach) {
      portalLandmarks.set(dimension, approach.portal.clone());
      await traversePortal(approach);
      return false;
    }
    const remembered = portalLandmarks.get(dimension);
    if (!remembered) {
      stepLog("Cannot find a safe return portal in the Nether");
      return false;
    }
    const key = remembered.toString();
    if (portalEntryState.returnGoal !== key) {
      portalEntryState.returnGoal = key;
      portalEntryState.returnSince = Date.now();
      bot.pathfinder.setGoal(
        new goals.GoalNear(remembered.x, remembered.y, remembered.z, 3),
        false,
      );
      stepLog("Returning to the remembered Nether portal");
    } else if (Date.now() - portalEntryState.returnSince > 45000) {
      clearPathfinderGoal(bot);
      stepLog("No safe route back to the remembered Nether portal");
    }
    return false;
  }

  async function ensureSmeltingFuel() {
    const items = bot.inventory.items();
    if (
      items.some(
        (item) =>
          ["coal", "charcoal", "blaze_rod", "lava_bucket"].includes(
            item.name,
          ) ||
          (item.name.endsWith("_planks") &&
            !["crimson_planks", "warped_planks"].includes(item.name)) ||
          (item.name.endsWith("_log") && !item.name.startsWith("stripped_")),
      )
    ) {
      return true;
    }
    const coal = findBlockByNames(bot, COAL_ORE_NAMES, 64);
    if (coal) {
      await moveNearAndDig(bot, goals, coal, stepLog, signal);
      return false;
    }
    const wood = findBlockByNames(
      bot,
      LOG_NAMES.filter((name) => name.endsWith("_log")),
      64,
    );
    if (wood) {
      await moveNearAndDig(bot, goals, wood, stepLog, signal);
    } else if (observeDimension() === "the_nether") {
      await ensureOverworld();
    } else {
      stepLog("Searching for coal or wood to fuel the furnace");
    }
    return false;
  }

  function ensureSafeNetherMovement() {
    const movement = bot.pathfinder.movements;
    if (
      movement &&
      movement.canDig === false &&
      movement.allowParkour === false &&
      movement.allowParkourAscend === false &&
      movement.maxDropDown <= 1
    ) {
      return true;
    }
    const configured = configureSmartMovements(bot, mcData, Movements, {
      canDig: false,
      allowSprinting: false,
      allowParkour: false,
      allowParkourAscend: false,
      maxDropDown: 1,
    });
    if (!configured) stepLog("Cannot configure safe Nether navigation");
    return Boolean(configured);
  }

  async function runNetheriteStage(pieces) {
    const remaining = pieces.filter(
      (piece) => !hasItemOrHigherTier(bot, piece, "netherite"),
    );
    if (!remaining.length) return "done";
    const registry = bot.registry;
    if (
      !registry?.itemsByName?.netherite_ingot ||
      typeof registry.version?.[">="] !== "function" ||
      !registry.version[">="]("1.16")
    ) {
      stepLog("Netherite smithing is not supported by this Minecraft version");
      return "blocked";
    }

    if (countByName(bot, "netherite_ingot") === 0) {
      const scrap = countByName(bot, "netherite_scrap");
      const gold = countByName(bot, "gold_ingot");
      if (scrap >= 4 && gold >= 4) {
        const table = await ensureCraftingTablePlaced(
          bot,
          goals,
          stepLog,
          signal,
        );
        if (signal?.aborted || !table) return "busy";
        stepLog("Crafting a Netherite ingot from scrap and gold");
        if (
          !(await craftItemByName(bot, "netherite_ingot", 1, table, signal))
        ) {
          stepLog("Could not craft a Netherite ingot from the available items");
        }
        return "busy";
      }
      if (scrap < 4) {
        const debris = countByName(bot, "ancient_debris");
        if (debris > 0) {
          if (!(await ensureSmeltingFuel()) || signal?.aborted) return "busy";
          await smeltInFurnace(bot, goals, {
            inputNames: ["ancient_debris"],
            outputName: "netherite_scrap",
            neededCount: Math.min(debris, 4 - scrap),
            stepLog,
            signal,
            requireEmptyFurnace: true,
            recoveryLog,
          });
          return "busy";
        }
        if (!hasPickaxeAtLeast(bot, "diamond_pickaxe")) {
          if (countByName(bot, "diamond") < 3) {
            const diamondOre = findBlockByNames(bot, DIAMOND_ORE_NAMES, 64);
            if (diamondOre) {
              await moveNearAndDig(bot, goals, diamondOre, stepLog, signal);
            } else if (
              String(bot.game?.dimension || "").replace(/^minecraft:/, "") ===
              "the_nether"
            ) {
              await ensureOverworld();
            } else {
              stepLog("Need 3 diamonds for a pickaxe to mine ancient debris");
            }
            return "busy";
          }
          await ensureSticksAndPlanks(bot, 2, 0, stepLog, signal);
          if (signal?.aborted) return "busy";
          const table = await ensureCraftingTablePlaced(
            bot,
            goals,
            stepLog,
            signal,
          );
          if (signal?.aborted || !table) return "busy";
          if (
            !(await craftItemByName(bot, "diamond_pickaxe", 1, table, signal))
          ) {
            stepLog("Could not craft a diamond pickaxe for ancient debris");
          }
          return "busy";
        }
        if (!(await ensureNether()) || signal?.aborted) return "busy";
        if (!noNearbyThreats(bot)) {
          clearPathfinderGoal(bot);
          stepLog("Waiting for safer conditions before mining ancient debris");
          return "busy";
        }
        const target = findBlockByNames(bot, ["ancient_debris"], 64);
        if (target) {
          if (!ensureSafeNetherMovement()) return "busy";
          netherSearch.exploreGoal = null;
          await moveNearAndDig(bot, goals, target, stepLog, signal);
        } else {
          if (ensureSafeNetherMovement()) {
            exploreNether(bot, goals, netherSearch, stepLog);
          }
        }
        return "busy";
      }

      if (countByName(bot, "gold_nugget") >= 9) {
        const table = await ensureCraftingTablePlaced(
          bot,
          goals,
          stepLog,
          signal,
        );
        if (signal?.aborted || !table) return "busy";
        if (!(await craftItemByName(bot, "gold_ingot", 1, table, signal))) {
          stepLog("Could not craft a gold ingot from nuggets");
        }
        return "busy";
      }
      const goldInputs = [
        "raw_gold",
        "gold_ore",
        "deepslate_gold_ore",
        "nether_gold_ore",
      ];
      const rawGold = inventoryCounts(bot);
      if (goldInputs.some((name) => rawGold[name] > 0)) {
        if (!(await ensureSmeltingFuel()) || signal?.aborted) return "busy";
        await smeltInFurnace(bot, goals, {
          inputNames: goldInputs,
          outputName: "gold_ingot",
          neededCount: Math.min(
            4 - gold,
            goldInputs.reduce((total, name) => total + (rawGold[name] || 0), 0),
          ),
          stepLog,
          signal,
          requireEmptyFurnace: true,
          recoveryLog,
        });
        return "busy";
      }
      const goldOre = findBlockByNames(bot, GOLD_ORE_NAMES, 64);
      const inNether = observeDimension() === "the_nether";
      if (inNether && !noNearbyThreats(bot)) {
        clearPathfinderGoal(bot);
        netherSearch.exploreGoal = null;
        stepLog("Waiting for safer conditions before searching for gold");
        return "busy";
      }
      if (goldOre) {
        netherSearch.exploreGoal = null;
        await moveNearAndDig(bot, goals, goldOre, stepLog, signal);
      } else if (inNether) {
        if (ensureSafeNetherMovement()) {
          exploreNether(bot, goals, netherSearch, stepLog);
        }
      } else {
        stepLog(
          "No gold ore in loaded chunks; provide gold or explore manually",
        );
      }
      return "busy";
    }

    const needsTemplate = registry.version[">="]("1.20");
    if (
      needsTemplate &&
      countByName(bot, "netherite_upgrade_smithing_template") === 0
    ) {
      if (!(await ensureNether()) || signal?.aborted) return "busy";
      if (!ensureSafeNetherMovement()) return "busy";
      if (
        !(await searchBastionChest(bot, goals, netherSearch, signal, stepLog))
      ) {
        if (!signal?.aborted) exploreNether(bot, goals, netherSearch, stepLog);
      }
      return "busy";
    }
    if (
      needsTemplate &&
      remaining.length > 1 &&
      countByName(bot, "netherite_upgrade_smithing_template") === 1
    ) {
      if (countByName(bot, "diamond") < 7) {
        const diamondOre = findBlockByNames(bot, DIAMOND_ORE_NAMES, 64);
        if (diamondOre) {
          await moveNearAndDig(bot, goals, diamondOre, stepLog, signal);
        } else if (
          String(bot.game?.dimension || "").replace(/^minecraft:/, "") ===
          "the_nether"
        ) {
          await ensureOverworld();
        } else {
          stepLog("Need 7 diamonds to duplicate the last Netherite template");
        }
        return "busy";
      }
      if (countByName(bot, "netherrack") === 0) {
        const netherrack = findBlockByNames(bot, ["netherrack"], 64);
        if (netherrack) {
          await moveNearAndDig(bot, goals, netherrack, stepLog, signal);
        } else if (observeDimension() === "overworld") {
          await ensureNether();
        } else {
          stepLog("Need netherrack to duplicate the last Netherite template");
        }
        return "busy";
      }
      const craftingTable = await ensureCraftingTablePlaced(
        bot,
        goals,
        stepLog,
        signal,
      );
      if (signal?.aborted || !craftingTable) return "busy";
      stepLog("Duplicating the Netherite Upgrade Smithing Template");
      if (
        !(await craftItemByName(
          bot,
          "netherite_upgrade_smithing_template",
          1,
          craftingTable,
          signal,
        ))
      ) {
        stepLog("Could not duplicate the Netherite template");
      }
      return "busy";
    }

    let table = findBlockByNames(bot, ["smithing_table"], 36);
    if (!table) {
      if (countByName(bot, "smithing_table") === 0) {
        if (countByName(bot, "iron_ingot") < 2) {
          const ironInputs = ["raw_iron", "iron_ore", "deepslate_iron_ore"];
          if (ironInputs.some((name) => countByName(bot, name) > 0)) {
            if (!(await ensureSmeltingFuel()) || signal?.aborted) return "busy";
            await smeltInFurnace(bot, goals, {
              inputNames: ironInputs,
              outputName: "iron_ingot",
              neededCount: 2 - countByName(bot, "iron_ingot"),
              stepLog,
              signal,
              requireEmptyFurnace: true,
              recoveryLog,
            });
          } else {
            const ironOre = findBlockByNames(bot, IRON_ORE_NAMES, 64);
            if (ironOre) {
              await moveNearAndDig(bot, goals, ironOre, stepLog, signal);
            } else if (observeDimension() === "the_nether") {
              await ensureOverworld();
            } else {
              stepLog("Need iron ore to craft a smithing table");
            }
          }
          return "busy";
        }
        const nearbyTable = findBlockByNames(bot, ["crafting_table"], 36);
        const planksNeeded =
          4 + (nearbyTable || countByName(bot, "crafting_table") ? 0 : 4);
        if (countPlanks(bot) + countLogs(bot) * 4 < planksNeeded) {
          const logBlock = findBlockByNames(bot, LOG_NAMES, 64);
          if (logBlock) {
            await moveNearAndDig(bot, goals, logBlock, stepLog, signal);
          } else if (observeDimension() === "the_nether") {
            await ensureOverworld();
          } else {
            stepLog("Need wood to craft a smithing table");
          }
          return "busy";
        }
        await ensureSticksAndPlanks(bot, 0, 4, stepLog, signal);
        if (signal?.aborted) return "busy";
        const craftingTable = await ensureCraftingTablePlaced(
          bot,
          goals,
          stepLog,
          signal,
        );
        if (signal?.aborted || !craftingTable) return "busy";
        if (
          !(await craftItemByName(
            bot,
            "smithing_table",
            1,
            craftingTable,
            signal,
          ))
        ) {
          stepLog("Could not craft a smithing table");
          return "busy";
        }
      }
      if (signal?.aborted) return "busy";
      const item = bot.inventory
        .items()
        .find((i) => i.name === "smithing_table");
      if (
        !item ||
        !(await placeBlockNearby(bot, item, "smithing_table", stepLog, signal))
      ) {
        stepLog("Could not place a smithing table safely");
        return "busy";
      }
      if (signal?.aborted) return "busy";
      table = findBlockByNames(bot, ["smithing_table"], 6);
      if (!table) {
        stepLog("The server did not confirm the smithing table placement");
        return "busy";
      }
    }
    if (table.position.distanceTo(bot.entity.position) > 4) {
      stepLog("Walking to the smithing table");
      bot.pathfinder.setGoal(
        new goals.GoalNear(
          table.position.x,
          table.position.y,
          table.position.z,
          2,
        ),
        false,
      );
      return "busy";
    }
    clearPathfinderGoal(bot);
    const piece = remaining[0];
    if (!bot.inventory.items().some((i) => i.name === `diamond_${piece}`)) {
      const armorSlots = {
        helmet: "head",
        chestplate: "torso",
        leggings: "legs",
        boots: "feet",
      };
      if (!armorSlots[piece]) {
        stepLog(`Missing diamond_${piece} to upgrade`);
        return "busy";
      }
      await bot.unequip(armorSlots[piece]);
      if (signal?.aborted) return "busy";
    }
    stepLog(`Upgrading diamond_${piece} at the smithing table`);
    await upgradeAtSmithingTable(bot, table, piece, signal);
    if (signal?.aborted) return "busy";
    if (!hasItemOrHigherTier(bot, piece, "netherite")) {
      stepLog(`Server did not confirm netherite_${piece} in inventory`);
      return "busy";
    }
    await equipBestArmor(bot, { includeOffhand: true, signal });
    if (signal?.aborted) return "busy";
    await equipBestWeapon(bot, { signal });
    return "busy";
  }

  async function gearTick() {
    if (signal?.aborted || !bot || !bot.entity || !bot.inventory || busy)
      return;
    busy = true;

    try {
      const [toolsOpt, armorOpt, shieldOpt, rawTier] = await Promise.all([
        getOption("tools", info.name),
        getOption("armor", info.name),
        getOption("shield", info.name),
        getOption("tier", info.name),
      ]);
      if (signal?.aborted) return;

      const wantTools = toolsOpt !== "off";
      const wantArmor = armorOpt !== "off";
      const wantShield = shieldOpt !== "off";
      const targetTier = normalizeGearTier(rawTier);
      if (targetTier === "netherite" && bot.game?.dimension) {
        const dimension = observeDimension();
        if (
          Date.now() - lastDimensionChange < 16000 &&
          bot.blockAt(bot.entity.position.floored())?.name === "nether_portal"
        ) {
          const approach = findPortalApproach(bot);
          if (approach) await leavePortal(bot, approach, signal);
          else stepLog("Cannot find a safe way out of the portal");
          return;
        }
        if (dimension === "the_nether" && !ensureSafeNetherMovement()) return;
      }

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

      // Stages in order. Each one first works out EVERYTHING it will craft
      // (all tools/armor for the chosen tier), gathers every material for
      // it - logs, cobblestone, coal, raw ore - smelts it all in one go and
      // only then crafts the whole batch at one table.
      const stages = ["wooden"];
      if (targetTier !== "wooden" && targetTier !== "leather") {
        stages.push("stone", "iron");
        if (targetTier === "gold") stages.push("gold");
        if (tierRank >= 4) stages.push("diamond");
      }
      for (const stage of stages) {
        if (signal?.aborted) return;
        const outcome = await runGearStage(stage, targetTier, {
          wantTools,
          wantArmor,
          wantShield,
        });
        if (outcome !== "done") return;
      }

      // Leather armor (Leather & Wood tier, or any leather on hand for Stone).
      if (
        wantArmor &&
        (targetTier === "leather" ||
          (targetTier === "stone" && countByName(bot, "leather") >= 4))
      ) {
        const leatherOpts = Object.entries(ARMOR_COST)
          .map(([piece, cost]) => ({ piece, cost, name: `leather_${piece}` }))
          .sort((a, b) => b.cost - a.cost)
          .filter((o) => !hasItemOrHigherTier(bot, o.piece, "leather"));
        const leatherCount = countByName(bot, "leather");
        const totalLeather = leatherOpts.reduce((n, o) => n + o.cost, 0);
        const craftable = leatherOpts.find((o) => leatherCount >= o.cost);
        if (
          leatherOpts.length &&
          targetTier === "leather" &&
          leatherCount < totalLeather
        ) {
          // Gather all leather for the full set first.
          const hunted = await huntNearestLeatherAnimal(
            bot,
            goals,
            stepLog,
            signal,
          );
          if (!hunted) {
            stepLog(
              `Searching for cows/horses for leather (have ${leatherCount}/${totalLeather} for ${leatherOpts.map((o) => o.name).join(", ")})...`,
            );
          }
          return;
        }
        if (craftable) {
          const table = await ensureCraftingTablePlaced(
            bot,
            goals,
            stepLog,
            signal,
          );
          if (!table || signal?.aborted) return;
          stepLog(`Crafting ${craftable.name} (${craftable.cost} leather)...`);
          await craftItemByName(bot, craftable.name, 1, table, signal);
          if (!signal?.aborted)
            await equipBestArmor(bot, { includeOffhand: true, signal });
          return;
        }
      }

      await equipBestArmor(bot, { includeOffhand: true, signal });
      if (signal?.aborted) return;
      await equipBestWeapon(bot, { signal });
      if (signal?.aborted) return;
      if (targetTier === "netherite") {
        const pieces = [
          ...(wantTools ? ["sword", "pickaxe", "axe", "shovel"] : []),
          ...(wantArmor ? ["helmet", "chestplate", "leggings", "boots"] : []),
        ];
        const outcome = await runNetheriteStage(pieces);
        if (outcome !== "done") {
          if (outcome === "blocked") {
            netheriteBlocked = true;
            scriptRepeater.stop?.();
          }
          return;
        }
        if (wantArmor) {
          const armorSlots = [
            [5, "helmet"],
            [6, "chestplate"],
            [7, "leggings"],
            [8, "boots"],
          ];
          const missing = armorSlots.find(
            ([slot, piece]) =>
              bot.inventory.slots?.[slot]?.name !== `netherite_${piece}`,
          );
          if (missing) {
            stepLog(`Could not equip netherite_${missing[1]}`);
            return;
          }
        }
      }
      const tierLabel = {
        leather: "Leather & Wood",
        wooden: "Wooden",
        stone: "Stone",
        gold: "Golden",
        iron: "Iron",
        diamond: "Diamond",
        netherite: "Netherite",
      }[targetTier];
      stepLog(
        `Completed ${tierLabel} tier gear (selected items are available)!`,
      );
      bot._mcbpGearUpDone = true;
    } catch (err) {
      stepLog(`Step warning: ${err.message || err}`);
    } finally {
      busy = false;
    }
  }

  bot._mcbpGearUpDone = false;
  try {
    await gearTick();
    if (!bot._mcbpGearUpDone && !netheriteBlocked) {
      await scriptRepeater(async () => {
        if (bot._mcbpGearUpDone) return;
        await gearTick();
      }, info.default.interval);
    }
  } finally {
    if (bot && (!scriptRepeater.isCurrent || scriptRepeater.isCurrent())) {
      bot._mcbpSprintJump = false;
      bot._mcbpGearGoalKey = "";
      bot._mcbpActivePlanSummary = "";
      if (aiBrain?.subSource === "GearUp") {
        aiBrain.setSubObjective("", {}, bot);
      }
      if (aiBrain?.currentGoal?.startsWith("GearUp")) {
        aiBrain.syncPlan({ goal: "Idle", currentStep: "", steps: [] }, bot);
      }
      const owner = bot.pathfinder?.getPathOwner?.();
      clearPathfinderGoal(bot);
      if (!owner || owner === info.name)
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
  gearStageItems,
  computeGearBudget,
  describeGearBudget,
};
