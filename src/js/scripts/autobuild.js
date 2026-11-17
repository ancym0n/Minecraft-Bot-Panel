const fs = require("fs");
const path = require("path");
const { loadLibraries } = require("../runtime");
const { isBotEating, clearPathfinderGoal } = require("../botUtils");

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

function generateTemplateOffsets(name, size) {
  const t = String(name || "platform")
    .trim()
    .toLowerCase();
  const s = Math.max(2, Math.min(15, size || 5));
  const half = Math.floor(s / 2);
  const blocks = [];

  if (t === "wall") {
    for (let y = 0; y < 3; y++) {
      for (let x = -half; x <= half; x++) {
        blocks.push({ dx: x, dy: y, dz: 2 });
      }
    }
  } else if (t === "tower" || t === "pillar") {
    for (let y = 0; y < s; y++) {
      blocks.push({ dx: 1, dy: y, dz: 0 });
    }
  } else if (t === "bridge") {
    for (let z = 1; z <= s; z++) {
      blocks.push({ dx: 0, dy: -1, dz: z });
    }
  } else if (t === "bunker" || t === "hut") {
    for (let y = 0; y < 3; y++) {
      for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
          const isEdge = Math.abs(x) === 2 || Math.abs(z) === 2;
          const isDoor = x === 0 && z === 2 && y < 2;
          if ((isEdge && !isDoor) || y === 2) {
            blocks.push({ dx: x, dy: y, dz: z });
          }
        }
      }
    }
  } else {
    // Default: platform
    for (let x = -half; x <= half; x++) {
      for (let z = -half; z <= half; z++) {
        if (x === 0 && z === 0) continue;
        blocks.push({ dx: x, dy: 0, dz: z });
      }
    }
  }
  return blocks;
}

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

  const templateName = String(rawTemplate || "platform").trim() || "platform";
  const parsedSize = parseInt(rawSize, 10);
  const size =
    Number.isFinite(parsedSize) && parsedSize >= 2 && parsedSize <= 16
      ? parsedSize
      : 5;

  const origin = bot.entity.position.floored();
  let offsets = [];

  if (templateName.endsWith(".json") && fs.existsSync(templateName)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.resolve(templateName), "utf8"),
      );
      if (Array.isArray(parsed)) offsets = parsed;
      else if (Array.isArray(parsed.blocks)) offsets = parsed.blocks;
    } catch (_) {}
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
      while (buildQueue.length > 0) {
        const entry = buildQueue[0];
        const existing = bot.blockAt(entry.pos);
        if (existing && existing.boundingBox === "block") {
          buildQueue.shift();
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
          await bot.pathfinder
            .goto(
              new goals.GoalNear(entry.pos.x, entry.pos.y, entry.pos.z, 3.0),
            )
            .catch(() => {});
        }

        const ref = findReferenceFace(bot, entry.pos, Vec3);
        if (!ref) {
          buildQueue.shift();
          continue;
        }

        await bot.equip(blockItem, "hand").catch(() => {});
        await bot.placeBlock(ref.refBlock, ref.faceVec).catch(() => {});
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
    } catch (_) {
    } finally {
      busy = false;
    }
  }

  try {
    await buildTick();
    await scriptRepeater(buildTick, info.default.interval);
  } finally {
    clearPathfinderGoal(bot);
  }
}

module.exports = {
  info,
  script,
};
