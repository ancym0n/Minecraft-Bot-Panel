const { loadLibraries } = require("../runtime");
const {
  isBotEating,
  smartDig,
  configureSmartMovements,
  clearPathfinderGoal,
} = require("../botUtils");

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
    if (name === "log" || name === "wood") {
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
  const [rawBlockName, repeat, autoToolOpt] = await Promise.all([
    getOption("blockId", info.name),
    getOption("repeat", info.name),
    getOption("autotool", info.name),
  ]);

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

  async function mineStep() {
    if (
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

    const targetBlock = bot.findBlock({
      matching: matchingIds,
      maxDistance: 64,
    });

    if (!targetBlock) {
      clearLog("Mining ");
      log(`Mine: No "${blockQuery}" found within 64 blocks`);
      return false;
    }

    const pos = targetBlock.position;
    const dist = pos.distanceTo(bot.entity.position);
    clearLog("Mining ");
    log(
      `Mining ${targetBlock.name} (${pos.x}, ${pos.y}, ${pos.z}) [${dist.toFixed(1)}m]`,
    );

    if (dist <= 4.5) {
      try {
        isMining = true;
        lastGoalKey = "";
        clearPathfinderGoal(bot);
        await smartDig(bot, targetBlock, {
          autoTool: liveAutoTool !== "off",
          saveLowDurability: true,
        });
        return true;
      } catch (_) {
        return false;
      } finally {
        isMining = false;
      }
    } else {
      const goalKey = `${pos.x},${pos.y},${pos.z}`;
      if (lastGoalKey !== goalKey || !bot.pathfinder.isMoving()) {
        lastGoalKey = goalKey;
        bot.pathfinder.setGoal(
          new goals.GoalNear(pos.x, pos.y, pos.z, 2),
          false,
        );
      }
      return false;
    }
  }

  try {
    if (repeat === "on") {
      await mineStep();
      await scriptRepeater(mineStep, info.default.interval);
    } else {
      // Single-block mode: walk up to the block and finish mining it
      for (let attempt = 0; attempt < 25; attempt++) {
        if (!bot || !bot.entity) break;
        const dug = await mineStep();
        if (dug) break;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  } finally {
    if (bot && bot.pathfinder) {
      clearPathfinderGoal(bot);
      configureSmartMovements(bot, mcData, Movements);
    }
  }
}

module.exports = {
  info,
  script,
};
