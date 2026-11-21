const test = require("node:test");
const assert = require("node:assert/strict");
const { Vec3 } = require("vec3");
const {
  framePlan,
  chooseBuildSite,
  findUnlitPortal,
  advancePortalFrame,
  findPortalApproach,
  enterPortal,
  leavePortal,
} = require("../src/js/netherPortal");

function fixture() {
  const blocks = new Map();
  const key = (pos) => `${pos.x},${pos.y},${pos.z}`;
  const set = (pos, name, axis) => {
    blocks.set(key(pos), {
      name,
      position: pos,
      boundingBox:
        name === "air" || name === "nether_portal" ? "empty" : "block",
      getProperties: () => ({ axis }),
    });
  };
  const blockAt = (pos) =>
    blocks.get(key(pos)) || {
      name: pos.y < 0 ? "stone" : "air",
      position: pos,
      boundingBox: pos.y < 0 ? "block" : "empty",
    };
  const bot = {
    entity: { position: new Vec3(1.5, 2, 1.5) },
    entities: {},
    inventory: {
      items: () => [
        { name: "obsidian", count: 10 },
        { name: "cobblestone", count: 3 },
        { name: "flint_and_steel", count: 1 },
      ],
    },
    registry: {
      blocksByName: { obsidian: { id: 1 }, nether_portal: { id: 2 } },
    },
    blockAt,
    findBlocks: ({ matching }) =>
      [...blocks.values()]
        .filter((block) =>
          matching.includes(
            block.name === "obsidian"
              ? 1
              : block.name === "nether_portal"
                ? 2
                : -1,
          ),
        )
        .map((block) => block.position),
    pathfinder: { setGoal: () => {} },
    equip: async (item) => {
      bot.heldItem = item;
    },
    placeBlock: async (support, face) => {
      set(support.position.plus(face), bot.heldItem.name);
    },
    activateBlock: async (base) => {
      for (let x = 0; x < 2; x++) {
        for (let y = 1; y <= 3; y++) {
          set(base.position.offset(x, y, 0), "nether_portal", "x");
        }
      }
    },
    lookAt: async () => {},
    setControlState: () => {},
  };
  return { bot, set, blockAt };
}

test("portal frame uses ten obsidian and three supported corners", () => {
  for (const axis of ["x", "z"]) {
    const plan = framePlan(new Vec3(0, 0, 0), axis);
    assert.equal(
      plan.steps.filter((step) => step.material === "obsidian").length,
      10,
    );
    assert.equal(
      plan.steps.filter((step) => step.material === "scaffold").length,
      3,
    );
    const previous = new Set();
    for (const step of plan.steps) {
      assert.equal(
        Math.abs(step.face.x) + Math.abs(step.face.y) + Math.abs(step.face.z),
        1,
      );
      assert.ok(step.support.y === -1 || previous.has(step.support.toString()));
      previous.add(step.position.toString());
    }
  }
});

test("portal construction confirms each block and lights the frame", async () => {
  const { bot, blockAt } = fixture();
  const plan = framePlan(new Vec3(0, 0, 0), "x");
  const goals = { GoalNear: class {} };
  for (let i = 0; i < plan.steps.length; i++) {
    await advancePortalFrame(bot, goals, plan, undefined, () => {});
  }
  assert.equal(plan.next, 13);
  for (const step of plan.steps) {
    assert.equal(
      blockAt(step.position).name,
      step.material === "obsidian" ? "obsidian" : "cobblestone",
    );
  }
  await advancePortalFrame(bot, goals, plan, undefined, () => {});
  assert.equal(blockAt(new Vec3(1, 1, 0)).name, "nether_portal");
});

test("portal construction refuses occupied or obstructed positions", async () => {
  const { bot, set } = fixture();
  const plan = framePlan(new Vec3(0, 0, 0), "x");
  set(plan.steps[0].position, "chest");
  await assert.rejects(
    advancePortalFrame(bot, {}, plan, undefined, () => {}),
    /no longer clear/,
  );
  assert.equal(plan.next, 0);
});

test("existing unlit frames can be lit without mining their obsidian", () => {
  const { bot, set } = fixture();
  const plan = framePlan(new Vec3(0, 0, 0), "x");
  for (const step of plan.steps.filter(
    (step) => step.material === "obsidian",
  )) {
    set(step.position, "obsidian");
  }
  const existing = findUnlitPortal(bot);
  assert.ok(existing);
  assert.equal(existing.next, existing.steps.length);
});

test("portal site selection avoids the player and non-air blocks", () => {
  const { bot, set } = fixture();
  bot.entity.position = new Vec3(0.5, 0, 0.5);
  set(new Vec3(1, 0, 0), "chest");
  const plan = chooseBuildSite(bot);
  assert.ok(plan);
  assert.ok(
    plan.steps.every((step) => !step.position.equals(new Vec3(0, 0, 0))),
  );
  assert.ok(
    plan.steps.every((step) => !step.position.equals(new Vec3(1, 0, 0))),
  );
});

test("portal approach enters from a clear side and releases movement", async () => {
  const { bot, set } = fixture();
  const portal = new Vec3(0, 0, 0);
  set(portal, "nether_portal", "x");
  set(portal.offset(0, -1, 0), "obsidian");
  bot.entity.position = new Vec3(0.5, 0, -0.5);
  const controls = [];
  bot.setControlState = (name, value) => {
    controls.push([name, value]);
    if (value) bot.entity.position = new Vec3(0.5, 0, 0.5);
  };
  const approach = findPortalApproach(bot);
  assert.ok(approach);
  await enterPortal(bot, {}, approach, {}, undefined, () => {});
  assert.deepEqual(controls, [
    ["forward", true],
    ["forward", false],
  ]);
});

test("portal exit clears movement after stepping out", async () => {
  const { bot, set } = fixture();
  const portal = new Vec3(0, 0, 0);
  set(portal, "nether_portal", "x");
  set(portal.offset(0, -1, 0), "obsidian");
  bot.entity.position = new Vec3(0.5, 0, 0.5);
  const approach = findPortalApproach(bot);
  const controls = [];
  bot.setControlState = (name, value) => {
    controls.push([name, value]);
    if (value) bot.entity.position = approach.side.offset(0.5, 0, 0.5);
  };
  await leavePortal(bot, approach);
  assert.deepEqual(controls, [
    ["forward", true],
    ["forward", false],
  ]);
});
