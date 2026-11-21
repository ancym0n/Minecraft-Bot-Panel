const { Vec3 } = require("vec3");
const { isHostile } = require("./botUtils");

const BASTION_BLOCKS = new Set([
  "polished_blackstone_bricks",
  "cracked_polished_blackstone_bricks",
  "chiseled_polished_blackstone",
]);
const HAZARDS = new Set([
  "lava",
  "flowing_lava",
  "fire",
  "soul_fire",
  "magma_block",
  "cactus",
  "powder_snow",
]);
const AIR = new Set(["air", "cave_air", "void_air"]);
const TUNNEL_BLOCKS = new Set([
  "netherrack",
  "basalt",
  "smooth_basalt",
  "blackstone",
  "soul_sand",
  "soul_soil",
]);

function isSafeFloor(block) {
  return Boolean(
    block && block.boundingBox === "block" && !HAZARDS.has(block.name),
  );
}

function noNearbyThreats(bot) {
  if ((bot.health ?? 20) < 12) return false;
  return !Object.values(bot.entities || {}).some(
    (entity) =>
      isHostile(entity) && entity.position.distanceTo(bot.entity.position) <= 8,
  );
}

function safeNetherMiningBlock(bot, block) {
  if (!block?.position) return false;
  const directions = [
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  for (const [x, y, z] of directions) {
    const neighbor = bot.blockAt(block.position.offset(x, y, z));
    if (!neighbor || HAZARDS.has(neighbor.name)) return false;
    if (
      y === 1 &&
      ([
        "sand",
        "red_sand",
        "gravel",
        "anvil",
        "chipped_anvil",
        "damaged_anvil",
      ].includes(neighbor.name) ||
        neighbor.name.endsWith("_concrete_powder"))
    ) {
      return false;
    }
  }
  return true;
}

function planNetherTunnelStep(bot, destination) {
  const start = bot.entity.position.floored();
  const dx = destination.x - start.x;
  const dz = destination.z - start.z;
  if ((!dx && !dz) || Math.abs(destination.y - start.y) > 2) {
    return { type: "blocked", reason: "target requires a vertical route" };
  }
  const direction =
    Math.abs(dx) >= Math.abs(dz)
      ? new Vec3(Math.sign(dx), 0, 0)
      : new Vec3(0, 0, Math.sign(dz));
  const feet = start.plus(direction);
  if (!isSafeFloor(bot.blockAt(feet.offset(0, -1, 0)))) {
    return { type: "blocked", reason: "unsafe or unloaded tunnel floor" };
  }
  for (const pos of [feet.offset(0, 1, 0), feet]) {
    const block = bot.blockAt(pos);
    if (!block) return { type: "blocked", reason: "unloaded tunnel block" };
    if (AIR.has(block.name)) continue;
    if (
      !TUNNEL_BLOCKS.has(block.name) ||
      block.diggable === false ||
      !safeNetherMiningBlock(bot, block)
    ) {
      return { type: "blocked", reason: `unsafe tunnel block ${block.name}` };
    }
    return { type: "dig", block };
  }
  for (const pos of [feet, feet.offset(0, 1, 0)]) {
    for (const [x, z] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const neighbor = bot.blockAt(pos.offset(x, 0, z));
      if (!neighbor || HAZARDS.has(neighbor.name)) {
        return { type: "blocked", reason: "hazard beside tunnel" };
      }
    }
  }
  return { type: "move", position: feet };
}

function pruneExpired(entries) {
  const now = Date.now();
  for (const [key, expiresAt] of entries) {
    if (expiresAt <= now) entries.delete(key);
  }
}

function findBastionChests(bot, visited) {
  pruneExpired(visited);
  const ids = ["chest"]
    .map((name) => bot.registry.blocksByName[name]?.id)
    .filter((id) => typeof id === "number");
  if (!ids.length) return [];
  const positions = bot.findBlocks({
    matching: ids,
    maxDistance: 64,
    count: 32,
  });
  const results = [];
  for (const pos of positions || []) {
    if ((visited.get(pos.toString()) || 0) > Date.now()) continue;
    let bricks = 0;
    for (let x = -6; x <= 6 && bricks < 12; x++) {
      for (let y = -4; y <= 4 && bricks < 12; y++) {
        for (let z = -6; z <= 6 && bricks < 12; z++) {
          if (BASTION_BLOCKS.has(bot.blockAt(pos.offset(x, y, z))?.name)) {
            bricks++;
          }
        }
      }
    }
    if (bricks >= 12) results.push(pos);
  }
  return results;
}

async function searchBastionChest(bot, goals, state, signal, log) {
  if (signal?.aborted) return false;
  if (!noNearbyThreats(bot)) {
    log("Waiting for safer conditions before searching a bastion");
    return false;
  }
  const positions = findBastionChests(bot, state.visitedChests);
  const pos = positions[0];
  if (!pos) return false;
  state.exploreGoal = null;
  const key = pos.toString();
  if (pos.distanceTo(bot.entity.position) > 4) {
    if (state.chestGoal !== key) {
      state.chestGoal = key;
      state.chestGoalSince = Date.now();
      bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2), false);
      log("Walking toward a likely bastion chest");
    } else if (Date.now() - state.chestGoalSince > 20000) {
      state.visitedChests.set(key, Date.now() + 60000);
      state.chestGoal = null;
      bot.pathfinder.setGoal(null);
      log("No safe route to the bastion chest");
    }
    return true;
  }
  state.chestGoal = null;
  bot.pathfinder.setGoal(null);
  const block = bot.blockAt(pos);
  if (!block || block.name !== "chest") {
    state.visitedChests.set(key, Date.now() + 60000);
    return true;
  }
  if (bot.currentWindow) {
    log("Waiting for the current inventory window to close");
    return true;
  }
  const container = await bot.openContainer(block);
  try {
    if (signal?.aborted) return true;
    const item = container
      .containerItems()
      .find(
        (candidate) => candidate.name === "netherite_upgrade_smithing_template",
      );
    if (item) {
      log("Taking a Netherite Upgrade Smithing Template from a likely bastion");
      await container.withdraw(item.type, item.metadata, 1, item.nbt);
    }
    state.visitedChests.set(key, Date.now() + 300000);
  } finally {
    await container.close();
  }
  return true;
}

function findSafeExplorationTarget(bot, state) {
  pruneExpired(state.visitedGoals);
  const start = bot.entity.position.floored();
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  for (let attempt = 0; attempt < directions.length; attempt++) {
    const [dx, dz] =
      directions[(state.direction + attempt) % directions.length];
    for (const distance of [24, 16, 8]) {
      for (const dy of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
        const target = new Vec3(
          start.x + dx * distance,
          start.y + dy,
          start.z + dz * distance,
        );
        if ((state.visitedGoals.get(target.toString()) || 0) > Date.now())
          continue;
        let safe = true;
        for (let x = -1; x <= 1 && safe; x++) {
          for (let z = -1; z <= 1 && safe; z++) {
            const feet = target.offset(x, 0, z);
            if (
              !isSafeFloor(bot.blockAt(feet.offset(0, -1, 0))) ||
              !AIR.has(bot.blockAt(feet)?.name) ||
              !AIR.has(bot.blockAt(feet.offset(0, 1, 0))?.name)
            ) {
              safe = false;
            }
          }
        }
        if (safe) {
          state.direction = (state.direction + attempt + 1) % directions.length;
          return target;
        }
      }
    }
  }
  return null;
}

function exploreNether(bot, goals, state, log) {
  if (!noNearbyThreats(bot)) {
    bot.pathfinder.setGoal(null);
    state.exploreGoal = null;
    log("Waiting for safer conditions before exploring the Nether");
    return;
  }
  if (state.exploreGoal) {
    const reached = state.exploreGoal.distanceTo(bot.entity.position) <= 2;
    if (!reached && Date.now() - state.exploreSince < 20000) return;
    state.visitedGoals.set(state.exploreGoal.toString(), Date.now() + 120000);
    state.exploreGoal = null;
    bot.pathfinder.setGoal(null);
  }
  const target = findSafeExplorationTarget(bot, state);
  if (!target) {
    log("No safe exploration route in loaded Nether terrain");
    return;
  }
  state.exploreGoal = target;
  state.exploreSince = Date.now();
  bot.pathfinder.setGoal(
    new goals.GoalNear(target.x, target.y, target.z, 1),
    false,
  );
  log("Exploring loaded Nether terrain for resources or a bastion");
}

function createNetherSearchState() {
  return {
    visitedChests: new Map(),
    visitedGoals: new Map(),
    direction: 0,
    chestGoal: null,
    exploreGoal: null,
  };
}

module.exports = {
  createNetherSearchState,
  noNearbyThreats,
  safeNetherMiningBlock,
  planNetherTunnelStep,
  findBastionChests,
  searchBastionChest,
  findSafeExplorationTarget,
  exploreNether,
};
