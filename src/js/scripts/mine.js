const { loadLibraries } = require("../runtime");
const {
  isBotEating,
  smartDig,
  configureSmartMovements,
  clearPathfinderGoal,
} = require("../botUtils");
const { aiBrain } = require("../aiBrain");
const { collectNearbyDropsAround } = require("./gearup");
const {
  MiningSkipList,
  pickMiningTarget,
  canMineFromHere,
  miningGoalFor,
  eyeDistance,
} = require("../miningReach");

const info = {
  name: "Mine",
  default: { interval: 650 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
    },
    {
      type: "checkbox",
      label: "Auto Tool",
      id: "autotool",
    },
    {
      type: "input",
      label: "Block ID",
      id: "blockId",
    },
  ],
};

function resolveMatchingBlockIds(bot, rawInput) {
  if (!bot?.registry?.blocksByName) return [];
  const names = String(rawInput || "")
    .toLowerCase()
    .split(/[\s,]+/)
    .map((s) => s.replace(/^minecraft:/, "").trim())
    .filter(Boolean);

  const idSet = new Set();
  for (const name of names) {
    const exact = bot.registry.blocksByName[name];
    if (exact && typeof exact.id === "number") {
      idSet.add(exact.id);
    }
    const deepslateVariant = bot.registry.blocksByName[`deepslate_${name}`];
    if (deepslateVariant && typeof deepslateVariant.id === "number") {
      idSet.add(deepslateVariant.id);
    }
    if (name === "stone" || name === "cobblestone") {
      for (const sName of [
        "stone",
        "cobblestone",
        "deepslate",
        "cobbled_deepslate",
      ]) {
        const sb = bot.registry.blocksByName[sName];
        if (sb && typeof sb.id === "number") idSet.add(sb.id);
      }
    }
    if (
      name === "log" ||
      name === "logs" ||
      name === "wood" ||
      name === "tree" ||
      name === "trees"
    ) {
      for (const b of Object.values(bot.registry.blocksByName)) {
        if (b && (b.name.endsWith("_log") || b.name.endsWith("_stem"))) {
          idSet.add(b.id);
        }
      }
    }
  }
  return Array.from(idSet);
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.registry || !bot.pathfinder) {
    clearLog("Mine:");
    log("Mine: Connect a bot first");
    return;
  }

  const { goals, mcData, Movements } = loadLibraries();
  const signal = scriptRepeater.signal;
  const [rawBlockName, repeat, autoToolOpt] = await Promise.all([
    getOption("blockId", info.name),
    getOption("repeat", info.name),
    getOption("autotool", info.name),
  ]);
  if (signal?.aborted) return;

  const initialBlockName = String(rawBlockName || "")
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, "");

  if (!initialBlockName) {
    clearLog("Mine:");
    log("Mine: Enter a block ID (e.g. oak_log, stone, diamond_ore)");
    return;
  }

  // Enable digging in pathfinder so the bot can dig through leaves/dirt/stone to reach target blocks
  configureSmartMovements(bot, mcData, Movements, {
    canDig: true,
    allowSprinting: true,
    allowParkour: true,
  });

  let isMining = false;
  let lastGoalKey = "";
  let goalSince = 0;
  let noPathCount = 0;
  const skips = new MiningSkipList();

  async function mineStep() {
    if (
      signal?.aborted ||
      !bot ||
      !bot.entity ||
      !bot.registry ||
      !bot.pathfinder ||
      isMining ||
      isBotEating(bot)
    ) {
      return false;
    }

    const liveBlockInput = await getOption("blockId", info.name);
    const liveAutoTool = await getOption("autotool", info.name);
    if (signal?.aborted) return false;
    const blockQuery =
      String(liveBlockInput || initialBlockName)
        .trim()
        .toLowerCase()
        .replace(/^minecraft:/, "") || initialBlockName;

    const matchingIds = resolveMatchingBlockIds(bot, blockQuery);
    if (matchingIds.length === 0) {
      clearLog("Mine:");
      log(`Mine: Block "${blockQuery}" not found in registry`);
      return false;
    }

    const isAllowed = (p) =>
      !skips.has(p) && !bot._mcbpProtectedBlocks?.has(`${p.x},${p.y},${p.z}`);

    let targetBlock = null;
    if (typeof bot.findBlocks === "function") {
      const positions = bot.findBlocks({
        matching: matchingIds,
        maxDistance: 64,
        count: 64,
      });
      // Stay on the block we are already walking to unless it is gone.
      const [lx, ly, lz] = lastGoalKey
        ? lastGoalKey.split(",").map(Number)
        : [];
      const prefer = lastGoalKey ? { x: lx, y: ly, z: lz } : null;
      const bestPos = pickMiningTarget(bot, positions, isAllowed, { prefer });
      if (bestPos) targetBlock = bot.blockAt(bestPos);
    } else if (typeof bot.findBlock === "function") {
      targetBlock = bot.findBlock({
        matching: matchingIds,
        maxDistance: 64,
      });
    }

    if (!targetBlock) {
      clearLog("Mining ");
      log(`Mine: No "${blockQuery}" found within 64 blocks`);
      return false;
    }

    const pos = targetBlock.position;
    const dist = eyeDistance(bot, pos);
    const goalKey = `${pos.x},${pos.y},${pos.z}`;
    clearLog("Mining ");

    if (canMineFromHere(bot, pos)) {
      const statusMsg = `Mining ${targetBlock.name} (${pos.x}, ${pos.y}, ${pos.z}) [${dist.toFixed(1)}m]`;
      log(statusMsg);
      aiBrain?.setSubObjective?.(
        statusMsg,
        { source: "Mine", objective: `Mine ${blockQuery}` },
        bot,
      );
      try {
        isMining = true;
        lastGoalKey = "";
        noPathCount = 0;
        clearPathfinderGoal(bot);
        const dug = await smartDig(bot, targetBlock, {
          autoTool: liveAutoTool !== "off",
          saveLowDurability: true,
          signal,
        });
        if (signal?.aborted) return false;
        if (dug === false) {
          skips.skip(pos, { ttlMs: 45000, columnAbove: true });
          return false;
        }
        // Finish everything in reach first (a whole trunk), then walk over
        // and pick up what fell - logs broken 4 blocks up drop out of range.
        const moreInReach = (
          bot.findBlocks({
            matching: matchingIds,
            maxDistance: 6,
            count: 16,
          }) || []
        ).some((p) => isAllowed(p) && canMineFromHere(bot, p));
        if (!moreInReach) {
          aiBrain?.setSubObjective?.(
            `Pick up ${targetBlock.name} drops`,
            { source: "Mine", objective: `Mine ${blockQuery}` },
            bot,
          );
          await collectNearbyDropsAround(bot, goals, pos, 1500, signal);
          if (signal?.aborted) return false;
          clearPathfinderGoal(bot);
        }
        return true;
      } catch (error) {
        if (!signal?.aborted) log(`Mine: ${error.message || error}`);
        skips.skip(pos, { ttlMs: 45000, columnAbove: true });
        return false;
      } finally {
        isMining = false;
      }
    } else {
      let targetChanged = false;
      if (lastGoalKey === goalKey) {
        if (Date.now() - goalSince > 9000 || noPathCount >= 2) {
          skips.skip(pos, { ttlMs: 60000, columnAbove: true });
          lastGoalKey = "";
          noPathCount = 0;
          clearPathfinderGoal(bot);
          log(
            `Mine: Skipping unreachable ${targetBlock.name} at (${pos.x}, ${pos.y}, ${pos.z}), trying another...`,
          );
          return false;
        }
      } else {
        lastGoalKey = goalKey;
        goalSince = Date.now();
        noPathCount = 0;
        targetChanged = true;
      }
      const statusMsg = `Approaching ${targetBlock.name} (${pos.x}, ${pos.y}, ${pos.z}) [${dist.toFixed(1)}m]`;
      log(statusMsg);
      aiBrain?.setSubObjective?.(
        statusMsg,
        { source: "Mine", objective: `Mine ${blockQuery}` },
        bot,
      );
      if (targetChanged || !bot.pathfinder.isMoving()) {
        const onPathCheck = (results) => {
          if (!results || lastGoalKey !== goalKey) return;
          if (results.status === "noPath") noPathCount += 1;
        };
        bot.once("path_update", onPathCheck);
        bot.pathfinder.setGoal(miningGoalFor(bot, goals, pos), false);
      }
      return false;
    }
  }

  try {
    if (repeat === "on") {
      await mineStep();
      if (!signal?.aborted)
        await scriptRepeater(mineStep, info.default.interval);
    } else {
      // Single-block mode: walk up to the block and finish mining it
      for (let attempt = 0; attempt < 25; attempt++) {
        if (signal?.aborted || !bot || !bot.entity) break;
        const dug = await mineStep();
        if (dug) break;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  } finally {
    if (bot && (!scriptRepeater.isCurrent || scriptRepeater.isCurrent())) {
      if (aiBrain?.subSource === "Mine") aiBrain.setSubObjective("", {}, bot);
      if (bot.pathfinder) {
        clearPathfinderGoal(bot);
        configureSmartMovements(bot, mcData, Movements);
      }
    }
  }
}

module.exports = {
  info,
  script,
};
