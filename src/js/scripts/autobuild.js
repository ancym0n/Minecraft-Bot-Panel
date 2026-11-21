const fs = require("fs");
const path = require("path");
const { loadLibraries } = require("../runtime");
const { isBotEating, clearPathfinderGoal } = require("../botUtils");
const { template: generateTemplateOffsets } = require("../wasmPlanner");

const info = {
  name: "AutoBuild",
  default: { interval: 650 },
  options: [
    {
      type: "input",
      label: "Template / File",
      id: "template",
    },
    {
      type: "input",
      label: "Size [blocks]",
      id: "size",
    },
  ],
};

const PLACEABLE_BLOCKS = [
  "cobblestone",
  "cobbled_deepslate",
  "stone",
  "stone_bricks",
  "oak_planks",
  "spruce_planks",
  "birch_planks",
  "jungle_planks",
  "acacia_planks",
  "dark_oak_planks",
  "dirt",
  "sandstone",
  "bricks",
  "netherrack",
  "white_wool",
  "glass",
  "obsidian",
];

function findReferenceFace(bot, targetPos, Vec3) {
  const dirs = [
    new Vec3(0, -1, 0),
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
    new Vec3(0, 1, 0),
  ];
  for (const d of dirs) {
    const neighborPos = targetPos.plus(d);
    const neighbor = bot.blockAt(neighborPos);
    if (
      neighbor &&
      neighbor.boundingBox === "block" &&
      neighbor.name !== "air"
    ) {
      return {
        refBlock: neighbor,
        faceVec: new Vec3(-d.x, -d.y, -d.z),
      };
    }
  }
  return null;
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.inventory || !bot.pathfinder) {
    clearLog("AutoBuild:");
    log("AutoBuild: Connect a bot first");
    return;
  }

  const { Vec3, goals } = loadLibraries();
  const [rawTemplate, rawSize] = await Promise.all([
    getOption("template", info.name),
    getOption("size", info.name),
  ]);
  if (scriptRepeater.signal?.aborted) return;

  const templateName = String(rawTemplate || "platform").trim() || "platform";
  const parsedSize = parseInt(rawSize, 10);
  const size =
    Number.isFinite(parsedSize) && parsedSize >= 2 && parsedSize <= 16
      ? parsedSize
      : 5;

  const origin = bot.entity.position.floored();
  let offsets = [];

  if (templateName.endsWith(".json")) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.resolve(templateName), "utf8"),
      );
      if (Array.isArray(parsed)) offsets = parsed;
      else if (Array.isArray(parsed.blocks)) offsets = parsed.blocks;
      if (!offsets.length) throw new Error("template contains no blocks");
      for (const entry of offsets) {
        if (!entry || typeof entry !== "object") {
          throw new Error("template contains an invalid block");
        }
        for (const coordinate of [
          entry.dx ?? entry.x,
          entry.dy ?? entry.y,
          entry.dz ?? entry.z,
        ]) {
          if (coordinate != null && !Number.isInteger(Number(coordinate))) {
            throw new Error("template coordinates must be integers");
          }
        }
        if (entry.block != null && typeof entry.block !== "string") {
          throw new Error("template block names must be strings");
        }
      }
    } catch (err) {
      clearLog("AutoBuild:");
      log(`AutoBuild: Cannot read template: ${err.message || err}`);
      return;
    }
  }

  if (offsets.length === 0) {
    offsets = generateTemplateOffsets(templateName, size);
  }

  const buildQueue = offsets.map((o) => ({
    pos: new Vec3(
      origin.x + (Number(o.dx ?? o.x) || 0),
      origin.y + (Number(o.dy ?? o.y) || 0),
      origin.z + (Number(o.dz ?? o.z) || 0),
    ),
    blockName: o.block || null,
  }));

  clearLog("AutoBuild:");
  log(
    `AutoBuild: Constructing "${templateName}" (${buildQueue.length} blocks queued)`,
  );

  let busy = false;
  let placedCount = 0;

  async function buildTick() {
    if (!bot || !bot.entity || busy || isBotEating(bot)) return;
    busy = true;

    try {
      let deferred = 0;
      while (buildQueue.length > 0) {
        if (scriptRepeater.signal?.aborted) return;
        const entry = buildQueue[0];
        const existing = bot.blockAt(entry.pos);
        if (existing && existing.boundingBox === "block") {
          buildQueue.shift();
          deferred = 0;
          continue;
        }

        const blockItem = bot.inventory.items().find((i) => {
          if (entry.blockName) return i.name === entry.blockName;
          return (
            PLACEABLE_BLOCKS.includes(i.name) || i.name.endsWith("_planks")
          );
        });

        if (!blockItem) {
          clearLog("AutoBuild status:");
          log("AutoBuild status: Out of building blocks in inventory");
          return;
        }

        const dist = bot.entity.position.distanceTo(entry.pos);
        if (dist > 4.2) {
          await bot.pathfinder.goto(
            new goals.GoalNear(entry.pos.x, entry.pos.y, entry.pos.z, 3.0),
          );
          if (scriptRepeater.signal?.aborted) return;
        }

        const ref = findReferenceFace(bot, entry.pos, Vec3);
        if (!ref) {
          buildQueue.push(buildQueue.shift());
          deferred++;
          if (deferred >= buildQueue.length) {
            clearLog("AutoBuild status:");
            log(
              `AutoBuild status: No reachable support for ${buildQueue.length} remaining block(s)`,
            );
            return;
          }
          continue;
        }

        await bot.equip(blockItem, "hand");
        if (scriptRepeater.signal?.aborted) return;
        await bot.placeBlock(ref.refBlock, ref.faceVec);
        if (scriptRepeater.signal?.aborted) return;
        buildQueue.shift();
        placedCount++;

        clearLog("AutoBuild status:");
        log(
          `AutoBuild status: Placed ${placedCount} block(s) (${buildQueue.length} left)`,
        );
        return;
      }

      clearLog("AutoBuild status:");
      log(
        `AutoBuild status: Completed "${templateName}" (${placedCount} blocks)`,
      );
    } catch (err) {
      if (!scriptRepeater.signal?.aborted) {
        clearLog("AutoBuild status:");
        log(`AutoBuild status: Placement failed: ${err.message || err}`);
      }
    } finally {
      busy = false;
    }
  }

  try {
    await buildTick();
    if (!scriptRepeater.signal?.aborted)
      await scriptRepeater(buildTick, info.default.interval);
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
