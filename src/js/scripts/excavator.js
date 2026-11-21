const { loadLibraries } = require("../runtime");
const { isBotEating, smartDig, clearPathfinderGoal } = require("../botUtils");
const { canMineFromHere, approachForMining } = require("../miningReach");
const planner = require("../wasmPlanner");

const info = {
  name: "Excavator",
  default: { interval: 700 },
  options: [
    {
      type: "checkbox",
      label: "Tunnel Mode",
      id: "tunnel",
    },
    {
      type: "checkbox",
      label: "Auto Tool",
      id: "autotool",
    },
    {
      type: "input",
      label: "Size / Width",
      id: "size",
    },
    {
      type: "input",
      label: "Length / Depth",
      id: "depth",
    },
  ],
};

function isExcavatable(block) {
  if (!block || !block.name) return false;
  const n = block.name;
  if (
    n === "air" ||
    n === "cave_air" ||
    n === "void_air" ||
    n === "bedrock" ||
    n === "barrier" ||
    n === "water" ||
    n === "lava" ||
    n.includes("chest") ||
    n.includes("shulker")
  ) {
    return false;
  }
  return block.diggable !== false;
}

function getCardinalStep(yaw) {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  if (Math.abs(dx) >= Math.abs(dz)) {
    return { fx: dx >= 0 ? 1 : -1, fz: 0, rx: 0, rz: dx >= 0 ? 1 : -1 };
  }
  return { fx: 0, fz: dz >= 0 ? 1 : -1, rx: dz >= 0 ? -1 : 1, rz: 0 };
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.pathfinder) {
    clearLog("Excavator:");
    log("Excavator: Connect a bot first");
    return;
  }

  const { Vec3, goals } = loadLibraries();
  const origin = bot.entity.position.floored();
  const dir = getCardinalStep(bot.entity.yaw || 0);

  const [tunnelOpt, autoToolOpt, rawSize, rawDepth] = await Promise.all([
    getOption("tunnel", info.name),
    getOption("autotool", info.name),
    getOption("size", info.name),
    getOption("depth", info.name),
  ]);
  if (scriptRepeater.signal?.aborted) return;

  const isTunnel = tunnelOpt !== "off";
  const useAutoTool = autoToolOpt !== "off";
  const parsedSize = parseInt(rawSize, 10);
  const parsedDepth = parseInt(rawDepth, 10);
  const size =
    Number.isFinite(parsedSize) && parsedSize >= 1 && parsedSize <= 16
      ? parsedSize
      : 3;
  const depth =
    Number.isFinite(parsedDepth) && parsedDepth >= 1 && parsedDepth <= 64
      ? parsedDepth
      : 12;

  let offsets;
  if (isTunnel) {
    offsets = planner.tunnel(size, depth, dir);
    clearLog("Excavator:");
    log(`Excavator: Digging ${size}x2 tunnel for ${depth} blocks`);
  } else {
    offsets = planner.quarry(size, depth);
    clearLog("Excavator:");
    log(`Excavator: Clearing ${size}x${size}x${depth} quarry volume`);
  }
  const queue = offsets.map(
    ({ dx, dy, dz }) => new Vec3(origin.x + dx, origin.y + dy, origin.z + dz),
  );

  let busy = false;
  let dugCount = 0;

  async function excavateTick() {
    if (!bot || !bot.entity || busy || isBotEating(bot)) return;
    busy = true;

    try {
      while (queue.length > 0) {
        if (scriptRepeater.signal?.aborted) return;
        const targetPos = queue[0];
        const block = bot.blockAt(targetPos);
        if (!block || !isExcavatable(block)) {
          queue.shift();
          continue;
        }

        // Reach is measured from the eyes (~4.5m), so blocks above/below the
        // bot can be dug without standing next to them.
        if (!canMineFromHere(bot, targetPos)) {
          await approachForMining(bot, goals, targetPos, {
            timeoutMs: 15000,
            isCancelled: () => Boolean(scriptRepeater.signal?.aborted),
          });
          if (scriptRepeater.signal?.aborted) return;
        }

        const fresh = bot.blockAt(targetPos);
        if (!fresh || !isExcavatable(fresh)) {
          queue.shift();
          continue;
        }

        const dug = await smartDig(bot, fresh, {
          autoTool: useAutoTool,
          saveLowDurability: true,
          signal: scriptRepeater.signal,
          canDigTarget: (target) =>
            target.position.equals(targetPos) && isExcavatable(target),
        });
        if (scriptRepeater.signal?.aborted) return;
        if (!dug) {
          log(`Excavator: Unable to dig ${fresh.name} at ${targetPos}`);
          return;
        }
        queue.shift();
        dugCount++;

        clearLog("Excavator status:");
        log(
          `Excavator status: Dug ${dugCount} block(s) (${queue.length} remaining)`,
        );
        return;
      }

      clearLog("Excavator status:");
      log(`Excavator status: Finished! Cleared ${dugCount} block(s)`);
    } catch (error) {
      if (!scriptRepeater.signal?.aborted)
        log(`Excavator: ${error.message || error}`);
    } finally {
      busy = false;
    }
  }

  try {
    await excavateTick();
    if (!scriptRepeater.signal?.aborted)
      await scriptRepeater(excavateTick, info.default.interval);
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
