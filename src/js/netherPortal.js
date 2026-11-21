const { Vec3 } = require("vec3");

const AIR = new Set(["air", "cave_air", "void_air"]);
const UNSAFE_FLOOR = new Set([
  "magma_block",
  "cactus",
  "campfire",
  "soul_campfire",
  "sweet_berry_bush",
  "powder_snow",
]);
const SCAFFOLD = new Set([
  "cobblestone",
  "cobbled_deepslate",
  "blackstone",
  "dirt",
  "netherrack",
]);

function isAir(block) {
  return Boolean(block && AIR.has(block.name));
}

function safeFloor(block) {
  return Boolean(
    block && block.boundingBox === "block" && !UNSAFE_FLOOR.has(block.name),
  );
}

function framePlan(base, axis) {
  if (axis !== "x" && axis !== "z") throw new Error("Invalid portal axis");
  const at = (horizontal, vertical) =>
    base.offset(
      axis === "x" ? horizontal : 0,
      vertical,
      axis === "z" ? horizontal : 0,
    );
  const steps = [];
  const add = (h, y, material, supportH, supportY) => {
    const position = at(h, y);
    const support = at(supportH, supportY);
    steps.push({ position, support, face: position.minus(support), material });
  };
  add(0, 0, "scaffold", 0, -1);
  add(3, 0, "scaffold", 3, -1);
  add(1, 0, "obsidian", 1, -1);
  add(2, 0, "obsidian", 2, -1);
  for (let y = 1; y <= 3; y++) {
    add(0, y, "obsidian", 0, y - 1);
    add(3, y, "obsidian", 3, y - 1);
  }
  add(0, 4, "scaffold", 0, 3);
  add(1, 4, "obsidian", 0, 4);
  add(2, 4, "obsidian", 1, 4);
  return { base, axis, steps, next: 0, ignitedAt: 0, ignitionAttempts: 0 };
}

function chooseBuildSite(bot) {
  const feet = bot.entity.position.floored();
  const candidates = [];
  for (const axis of ["x", "z"]) {
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        const base = feet.offset(dx, 0, dz);
        const plan = framePlan(base, axis);
        let safe = true;
        for (let h = 0; h < 4 && safe; h++) {
          for (let side = -1; side <= 1 && safe; side++) {
            const x = axis === "x" ? h : side;
            const z = axis === "x" ? side : h;
            if (!safeFloor(bot.blockAt(base.offset(x, -1, z)))) {
              safe = false;
              break;
            }
            const height = side === 0 ? 5 : 2;
            for (let y = 0; y < height; y++) {
              const pos = base.offset(x, y, z);
              if (!isAir(bot.blockAt(pos)) || pos.equals(feet)) {
                safe = false;
                break;
              }
            }
          }
        }
        if (safe) candidates.push({ plan, distance: base.distanceTo(feet) });
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.plan || null;
}

function findUnlitPortal(bot) {
  const obsidian = bot.registry?.blocksByName?.obsidian?.id;
  if (obsidian == null) return null;
  const positions = bot.findBlocks({
    matching: [obsidian],
    maxDistance: 64,
    count: 128,
  });
  for (const pos of positions || []) {
    for (const axis of ["x", "z"]) {
      for (const offset of [1, 2]) {
        const base = pos.offset(
          axis === "x" ? -offset : 0,
          0,
          axis === "z" ? -offset : 0,
        );
        const plan = framePlan(base, axis);
        const frame = plan.steps.filter((step) => step.material === "obsidian");
        if (
          !frame.every(
            (step) => bot.blockAt(step.position)?.name === "obsidian",
          )
        )
          continue;
        let empty = true;
        for (let h = 1; h <= 2 && empty; h++) {
          for (let y = 1; y <= 3; y++) {
            const inside = base.offset(
              axis === "x" ? h : 0,
              y,
              axis === "z" ? h : 0,
            );
            if (!isAir(bot.blockAt(inside))) {
              empty = false;
              break;
            }
          }
        }
        if (empty) {
          plan.next = plan.steps.length;
          return plan;
        }
      }
    }
  }
  return null;
}

async function advancePortalFrame(bot, goals, plan, signal, log) {
  if (signal?.aborted) return;
  while (plan.next < plan.steps.length) {
    const step = plan.steps[plan.next];
    const block = bot.blockAt(step.position);
    const complete =
      step.material === "obsidian"
        ? block?.name === "obsidian"
        : SCAFFOLD.has(block?.name);
    if (complete) {
      plan.next++;
      continue;
    }
    if (!isAir(block)) throw new Error("Portal site is no longer clear");
    const occupied = Object.values(bot.entities || {}).some((entity) => {
      if (!entity?.position) return false;
      const feet = entity.position.floored();
      return (
        feet.equals(step.position) || feet.offset(0, 1, 0).equals(step.position)
      );
    });
    if (occupied) throw new Error("An entity is occupying the portal site");
    const support = bot.blockAt(step.support);
    if (!safeFloor(support)) throw new Error("Portal support is missing");
    if (step.position.distanceTo(bot.entity.position) > 4) {
      log("Walking closer to the portal frame");
      bot.pathfinder.setGoal(
        new goals.GoalNear(
          step.position.x,
          step.position.y,
          step.position.z,
          3,
        ),
        false,
      );
      return;
    }
    const item = bot.inventory
      .items()
      .find((candidate) =>
        step.material === "obsidian"
          ? candidate.name === "obsidian"
          : SCAFFOLD.has(candidate.name),
      );
    if (!item) throw new Error(`Missing ${step.material} for the portal frame`);
    await bot.equip(item, "hand");
    if (signal?.aborted) return;
    await bot.placeBlock(support, step.face);
    if (signal?.aborted) return;
    const placed = bot.blockAt(step.position);
    if (
      step.material === "obsidian"
        ? placed?.name !== "obsidian"
        : !SCAFFOLD.has(placed?.name)
    ) {
      throw new Error("Server did not confirm the portal block");
    }
    plan.next++;
    return;
  }

  const interior = plan.base.offset(
    plan.axis === "x" ? 1 : 0,
    1,
    plan.axis === "z" ? 1 : 0,
  );
  if (bot.blockAt(interior)?.name === "nether_portal") return;
  if (!isAir(bot.blockAt(interior))) {
    throw new Error("The portal interior is obstructed");
  }
  if (Date.now() - plan.ignitedAt < 5000) return;
  if (plan.ignitionAttempts >= 2) {
    throw new Error("Server did not activate the portal");
  }
  const lighter = bot.inventory
    .items()
    .find((item) => item.name === "flint_and_steel");
  if (!lighter) throw new Error("Missing flint and steel");
  const baseBlock = bot.blockAt(interior.offset(0, -1, 0));
  if (baseBlock?.name !== "obsidian")
    throw new Error("Portal frame is incomplete");
  if (baseBlock.position.distanceTo(bot.entity.position) > 4) {
    bot.pathfinder.setGoal(
      new goals.GoalNear(
        baseBlock.position.x,
        baseBlock.position.y,
        baseBlock.position.z,
        2,
      ),
      false,
    );
    return;
  }
  await bot.equip(lighter, "hand");
  if (signal?.aborted) return;
  log("Lighting the completed Nether portal");
  await bot.activateBlock(baseBlock, new Vec3(0, 1, 0));
  plan.ignitedAt = Date.now();
  plan.ignitionAttempts++;
}

function findPortalApproach(bot) {
  const portalId = bot.registry?.blocksByName?.nether_portal?.id;
  if (portalId == null) return null;
  const positions = bot.findBlocks({
    matching: [portalId],
    maxDistance: 64,
    count: 128,
  });
  for (const pos of positions || []) {
    const portal = bot.blockAt(pos);
    const axis = portal?.getProperties?.().axis;
    if (axis !== "x" && axis !== "z") continue;
    if (!safeFloor(bot.blockAt(pos.offset(0, -1, 0)))) continue;
    for (const direction of [-1, 1]) {
      const side = pos.offset(
        axis === "z" ? direction : 0,
        0,
        axis === "x" ? direction : 0,
      );
      if (
        isAir(bot.blockAt(side)) &&
        isAir(bot.blockAt(side.offset(0, 1, 0))) &&
        safeFloor(bot.blockAt(side.offset(0, -1, 0)))
      ) {
        return { portal: pos, side };
      }
    }
  }
  return null;
}

async function enterPortal(bot, goals, approach, state, signal, log) {
  if (signal?.aborted) return;
  const current = bot.blockAt(bot.entity.position.floored());
  if (current?.name === "nether_portal") {
    if (!state.insideSince) state.insideSince = Date.now();
    if (Date.now() - state.insideSince > 30000) {
      throw new Error("Portal did not change dimensions");
    }
    log("Waiting inside the portal for the dimension change");
    return;
  }
  state.insideSince = 0;
  const sideCenter = approach.side.offset(0.5, 0, 0.5);
  if (sideCenter.distanceTo(bot.entity.position) > 1) {
    const key = approach.side.toString();
    if (state.approachKey !== key) {
      state.approachKey = key;
      state.approachSince = Date.now();
      bot.pathfinder.setGoal(
        new goals.GoalNear(
          approach.side.x,
          approach.side.y,
          approach.side.z,
          0,
        ),
        false,
      );
    } else if (Date.now() - state.approachSince > 20000) {
      throw new Error("No safe route to the portal entrance");
    }
    return;
  }
  state.approachKey = null;
  bot.pathfinder.setGoal(null);
  const target = approach.portal.offset(0.5, 0, 0.5);
  target.y = bot.entity.position.y + (bot.entity.eyeHeight || 1.62);
  await bot.lookAt(target, true);
  if (signal?.aborted) return;
  bot.setControlState("forward", true);
  try {
    const start = Date.now();
    while (
      !signal?.aborted &&
      Date.now() - start < 1200 &&
      bot.blockAt(bot.entity.position.floored())?.name !== "nether_portal"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    bot.setControlState("forward", false);
  }
}

async function leavePortal(bot, approach, signal) {
  const target = approach.side.offset(0.5, 0, 0.5);
  target.y = bot.entity.position.y + (bot.entity.eyeHeight || 1.62);
  await bot.lookAt(target, true);
  if (signal?.aborted) return;
  bot.setControlState("forward", true);
  try {
    const start = Date.now();
    while (
      !signal?.aborted &&
      Date.now() - start < 1200 &&
      bot.blockAt(bot.entity.position.floored())?.name === "nether_portal"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    bot.setControlState("forward", false);
  }
}

module.exports = {
  framePlan,
  chooseBuildSite,
  findUnlitPortal,
  advancePortalFrame,
  findPortalApproach,
  enterPortal,
  leavePortal,
};
