const { loadLibraries } = require("../runtime");
const { isBotEating, smartDig, clearPathfinderGoal } = require("../botUtils");

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

  const queue = [];
  if (isTunnel) {
    const halfW = Math.floor((size - 1) / 2);
    for (let step = 1; step <= depth; step++) {
      for (let h = 1; h >= 0; h--) {
        for (let w = -halfW; w <= size - 1 - halfW; w++) {
          const bx = origin.x + dir.fx * step + dir.rx * w;
          const by = origin.y + h;
          const bz = origin.z + dir.fz * step + dir.rz * w;
          queue.push(new Vec3(bx, by, bz));
        }
      }
    }
    clearLog("Excavator:");
    log(`Excavator: Digging ${size}x2 tunnel for ${depth} blocks`);
  } else {
    const half = Math.floor(size / 2);
    for (let dy = 0; dy > -depth; dy--) {
      for (let dx = -half; dx <= half; dx++) {
        for (let dz = -half; dz <= half; dz++) {
          queue.push(new Vec3(origin.x + dx, origin.y + dy, origin.z + dz));
        }
      }
    }
    clearLog("Excavator:");
    log(`Excavator: Clearing ${size}x${size}x${depth} quarry volume`);
  }

  let busy = false;
  let dugCount = 0;

  async function excavateTick() {
    if (!bot || !bot.entity || busy || isBotEating(bot)) return;
    busy = true;

    try {
      while (queue.length > 0) {
        const targetPos = queue[0];
        const block = bot.blockAt(targetPos);
        if (!block || !isExcavatable(block)) {
          queue.shift();
          continue;
        }

        const dist = bot.entity.position.distanceTo(targetPos);
        if (dist > 4.3) {
          await bot.pathfinder
            .goto(
              new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 3.2),
            )
            .catch(() => {});
        }

        const fresh = bot.blockAt(targetPos);
        if (!fresh || !isExcavatable(fresh)) {
          queue.shift();
          continue;
        }

        await smartDig(bot, fresh, {
          autoTool: useAutoTool,
          saveLowDurability: true,
        });
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
    } catch (_) {
    } finally {
      busy = false;
    }
  }

  try {
    await excavateTick();
    await scriptRepeater(excavateTick, info.default.interval);
  } finally {
    clearPathfinderGoal(bot);
  }
}

module.exports = {
  info,
  script,
};
