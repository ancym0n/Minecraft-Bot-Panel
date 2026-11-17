const { loadLibraries } = require("../runtime");
const { isBotEating, clearPathfinderGoal } = require("../botUtils");

const info = {
  name: "AutoFarm",
  default: { interval: 900 },
  options: [
    {
      type: "checkbox",
      label: "Replant Seeds",
      id: "replant",
    },
    {
      type: "checkbox",
      label: "Use Bone Meal",
      id: "bonemeal",
    },
    {
      type: "checkbox",
      label: "Collect Drops",
      id: "collect",
    },
    {
      type: "input",
      label: "Radius [blocks]",
      id: "radius",
    },
  ],
};

const CROP_MAX_AGE = {
  wheat: 7,
  carrots: 7,
  potatoes: 7,
  beetroots: 3,
  nether_wart: 3,
};

const CROP_SEED_MAP = {
  wheat: "wheat_seeds",
  carrots: "carrot",
  potatoes: "potato",
  beetroots: "beetroot_seeds",
  nether_wart: "nether_wart",
};

const ALL_SEEDS = [
  "wheat_seeds",
  "carrot",
  "potato",
  "beetroot_seeds",
  "nether_wart",
];

function getCropAge(block) {
  if (!block) return 0;
  if (typeof block._properties?.age === "number") return block._properties.age;
  if (typeof block.metadata === "number") return block.metadata;
  return 0;
}

function isMatureCrop(block) {
  if (!block || !block.name) return false;
  if (block.name in CROP_MAX_AGE) {
    return getCropAge(block) >= CROP_MAX_AGE[block.name];
  }
  return block.name === "melon" || block.name === "pumpkin";
}

function isImmatureCrop(block) {
  if (!block || !block.name) return false;
  if (block.name in CROP_MAX_AGE && block.name !== "nether_wart") {
    return getCropAge(block) < CROP_MAX_AGE[block.name];
  }
  return false;
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.pathfinder) {
    clearLog("AutoFarm:");
    log("AutoFarm: Connect a bot first");
    return;
  }

  const { Vec3, goals } = loadLibraries();
  let busy = false;
  clearLog("AutoFarm:");
  log("AutoFarm: Active (harvesting, replanting & bonemealing)");

  async function farmTick() {
    if (!bot || !bot.entity || busy || isBotEating(bot)) return;
    busy = true;

    try {
      const [replantOpt, bonemealOpt, collectOpt, rawRadius] =
        await Promise.all([
          getOption("replant", info.name),
          getOption("bonemeal", info.name),
          getOption("collect", info.name),
          getOption("radius", info.name),
        ]);

      const doReplant = replantOpt !== "off";
      const doBonemeal = bonemealOpt !== "off";
      const doCollect = collectOpt !== "off";
      const parsedR = parseFloat(rawRadius);
      const radius =
        Number.isFinite(parsedR) && parsedR >= 2 && parsedR <= 48
          ? parsedR
          : 12;

      // 1. Harvest mature crops
      const maturePositions = bot.findBlocks({
        matching: (b) => isMatureCrop(b),
        maxDistance: radius,
        count: 8,
      });

      if (maturePositions.length > 0) {
        const pos = maturePositions[0];
        const cropBlock = bot.blockAt(pos);
        if (cropBlock) {
          const cropName = cropBlock.name;
          if (bot.entity.position.distanceTo(pos) > 3.6) {
            await bot.pathfinder
              .goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2.5))
              .catch(() => {});
          }
          const fresh = bot.blockAt(pos);
          if (fresh && isMatureCrop(fresh)) {
            await bot.lookAt(pos.offset(0.5, 0.2, 0.5), true);
            await bot.dig(fresh, true);
            clearLog("AutoFarm status:");
            log(
              `AutoFarm status: Harvested ${cropName} at (${pos.x}, ${pos.y}, ${pos.z})`,
            );

            if (doReplant && CROP_SEED_MAP[cropName]) {
              const seedName = CROP_SEED_MAP[cropName];
              const seedItem = bot.inventory
                .items()
                .find((i) => i.name === seedName);
              const soilBlock = bot.blockAt(pos.offset(0, -1, 0));
              if (seedItem && soilBlock) {
                await bot.equip(seedItem, "hand").catch(() => {});
                await bot
                  .placeBlock(soilBlock, new Vec3(0, 1, 0))
                  .catch(() => {});
              }
            }
            return;
          }
        }
      }

      // 2. Replant empty farmland / soul_sand
      if (doReplant) {
        const seedItem = bot.inventory
          .items()
          .find((i) => ALL_SEEDS.includes(i.name));
        if (seedItem) {
          const targetSoil =
            seedItem.name === "nether_wart" ? "soul_sand" : "farmland";
          const emptyFarmland = bot.findBlocks({
            matching: (b) => b && b.name === targetSoil,
            maxDistance: radius,
            count: 24,
          });
          for (const fPos of emptyFarmland) {
            const above = bot.blockAt(fPos.offset(0, 1, 0));
            if (above && above.name === "air") {
              if (bot.entity.position.distanceTo(fPos) > 3.6) {
                await bot.pathfinder
                  .goto(new goals.GoalNear(fPos.x, fPos.y, fPos.z, 2.5))
                  .catch(() => {});
              }
              const soil = bot.blockAt(fPos);
              if (soil) {
                await bot.equip(seedItem, "hand").catch(() => {});
                await bot.placeBlock(soil, new Vec3(0, 1, 0)).catch(() => {});
                clearLog("AutoFarm status:");
                log(
                  `AutoFarm status: Planted ${seedItem.name} at (${fPos.x}, ${fPos.y + 1}, ${fPos.z})`,
                );
                return;
              }
            }
          }
        }
      }

      // 3. Apply bone_meal to immature crops
      if (doBonemeal) {
        const boneMeal = bot.inventory
          .items()
          .find((i) => i.name === "bone_meal");
        if (boneMeal) {
          const immaturePositions = bot.findBlocks({
            matching: (b) => isImmatureCrop(b),
            maxDistance: radius,
            count: 8,
          });
          if (immaturePositions.length > 0) {
            const pos = immaturePositions[0];
            if (bot.entity.position.distanceTo(pos) > 3.6) {
              await bot.pathfinder
                .goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2.5))
                .catch(() => {});
            }
            const crop = bot.blockAt(pos);
            if (crop && isImmatureCrop(crop)) {
              await bot.equip(boneMeal, "hand").catch(() => {});
              await bot.activateBlock(crop).catch(() => {});
              clearLog("AutoFarm status:");
              log(
                `AutoFarm status: Applied bone meal to ${crop.name} at (${pos.x}, ${pos.y}, ${pos.z})`,
              );
              return;
            }
          }
        }
      }

      // 4. Collect nearby crop drops
      if (doCollect && bot.entities) {
        let nearestDrop = null;
        let bestDist = radius;
        for (const e of Object.values(bot.entities)) {
          if (!e || !e.position) continue;
          if (
            e.name === "item" ||
            e.displayName === "Item" ||
            e.objectType === "Item"
          ) {
            const d = e.position.distanceTo(bot.entity.position);
            if (d < bestDist && d > 1.2) {
              bestDist = d;
              nearestDrop = e;
            }
          }
        }
        if (nearestDrop) {
          bot.pathfinder.setGoal(new goals.GoalFollow(nearestDrop, 1), true);
        }
      }
    } catch (_) {
    } finally {
      busy = false;
    }
  }

  try {
    await farmTick();
    await scriptRepeater(farmTick, info.default.interval);
  } finally {
    clearPathfinderGoal(bot);
  }
}

module.exports = {
  info,
  script,
};
