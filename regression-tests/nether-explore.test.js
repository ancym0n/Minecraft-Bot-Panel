const test = require("node:test");
const assert = require("node:assert/strict");
const { Vec3 } = require("vec3");
const {
  createNetherSearchState,
  findBastionChests,
  searchBastionChest,
  findSafeExplorationTarget,
  safeNetherMiningBlock,
  planNetherTunnelStep,
} = require("../src/js/netherExplore");
const { smartDig } = require("../src/js/botUtils");

function fixture({ bastion = true } = {}) {
  const chest = new Vec3(1, 0, 0);
  const blocks = new Map([[chest.toString(), "chest"]]);
  if (bastion) {
    for (let x = -2; x <= 1; x++) {
      for (let z = -2; z <= 0; z++) {
        blocks.set(
          chest.offset(x, -1, z).toString(),
          "polished_blackstone_bricks",
        );
      }
    }
  }
  const bot = {
    registry: { blocksByName: { chest: { id: 1 } } },
    entity: { position: new Vec3(0, 0, 0) },
    health: 20,
    entities: {},
    pathfinder: { setGoal: () => {} },
    findBlocks: () => [chest],
    blockAt: (pos) => {
      const name = blocks.get(pos.toString()) || (pos.y < 0 ? "stone" : "air");
      return {
        position: pos,
        name,
        boundingBox: ["air", "lava"].includes(name) ? "empty" : "block",
      };
    },
  };
  return { bot, chest, blocks };
}

test("bastion search ignores chests without structure evidence", () => {
  const state = createNetherSearchState();
  const { bot } = fixture({ bastion: false });
  assert.deepEqual(findBastionChests(bot, state.visitedChests), []);
});

test("bastion search withdraws only the requested template and closes the chest", async () => {
  const { bot, chest } = fixture();
  const state = createNetherSearchState();
  const actions = [];
  bot.openContainer = async () => ({
    containerItems: () => [
      { name: "diamond", type: 2, count: 10 },
      { name: "netherite_upgrade_smithing_template", type: 3, metadata: 0 },
    ],
    withdraw: async (...args) => actions.push(args),
    close: async () => actions.push("closed"),
  });
  assert.equal(
    await searchBastionChest(bot, {}, state, undefined, () => {}),
    true,
  );
  assert.deepEqual(actions, [[3, 0, 1, undefined], "closed"]);
  assert.ok(state.visitedChests.has(chest.toString()));
  assert.equal(
    await searchBastionChest(bot, {}, state, undefined, () => {}),
    false,
  );
});

test("bastion search closes without withdrawing when stopped during open", async () => {
  const { bot } = fixture();
  const state = createNetherSearchState();
  const controller = new AbortController();
  const actions = [];
  let release;
  bot.openContainer = () =>
    new Promise((resolve) => {
      release = () =>
        resolve({
          containerItems: () => [
            { name: "netherite_upgrade_smithing_template" },
          ],
          withdraw: async () => actions.push("withdraw"),
          close: async () => actions.push("closed"),
        });
    });
  const running = searchBastionChest(
    bot,
    {},
    state,
    controller.signal,
    () => {},
  );
  controller.abort();
  release();
  await running;
  assert.deepEqual(actions, ["closed"]);
});

test("exploration avoids unsafe footing and waits when hostile mobs are near", async () => {
  const { bot, blocks } = fixture();
  const state = createNetherSearchState();
  blocks.set(new Vec3(24, -1, 0).toString(), "lava");
  const target = findSafeExplorationTarget(bot, state);
  assert.ok(target);
  assert.notDeepEqual([target.x, target.y, target.z], [24, 0, 0]);
  bot.entities[2] = { name: "piglin_brute", position: new Vec3(2, 0, 0) };
  let opened = false;
  bot.openContainer = async () => {
    opened = true;
  };
  assert.equal(
    await searchBastionChest(bot, {}, state, undefined, () => {}),
    false,
  );
  assert.equal(opened, false);
});

test("Nether mining rejects neighboring hazards, falling blocks, and unloaded terrain", () => {
  const { bot, blocks } = fixture();
  const position = new Vec3(4, 0, 0);
  const target = bot.blockAt(position);
  assert.equal(safeNetherMiningBlock(bot, target), true);
  blocks.set(position.offset(1, 0, 0).toString(), "lava");
  assert.equal(safeNetherMiningBlock(bot, target), false);
  blocks.delete(position.offset(1, 0, 0).toString());
  blocks.set(position.offset(0, 1, 0).toString(), "gravel");
  assert.equal(safeNetherMiningBlock(bot, target), false);
  blocks.delete(position.offset(0, 1, 0).toString());
  const original = bot.blockAt;
  bot.blockAt = (pos) =>
    pos.equals(position.offset(0, -1, 0)) ? null : original(pos);
  assert.equal(safeNetherMiningBlock(bot, target), false);
});

test("Nether tunnel clears the upper and lower blocks before walking", () => {
  const { bot, blocks } = fixture({ bastion: false });
  const destination = new Vec3(8, 0, 0);
  const feet = new Vec3(1, 0, 0);
  const head = feet.offset(0, 1, 0);
  blocks.set(feet.toString(), "netherrack");
  blocks.set(head.toString(), "netherrack");
  let step = planNetherTunnelStep(bot, destination);
  assert.equal(step.type, "dig");
  assert.ok(step.block.position.equals(head));
  blocks.delete(head.toString());
  step = planNetherTunnelStep(bot, destination);
  assert.equal(step.type, "dig");
  assert.ok(step.block.position.equals(feet));
  blocks.delete(feet.toString());
  step = planNetherTunnelStep(bot, destination);
  assert.equal(step.type, "move");
  assert.ok(step.position.equals(feet));
});

test("Nether tunnel advances through multiple blocks toward a known deposit", () => {
  const { bot, blocks } = fixture({ bastion: false });
  const destination = new Vec3(6, 0, 0);
  for (let x = 1; x <= 3; x++) {
    blocks.set(new Vec3(x, 0, 0).toString(), "netherrack");
    blocks.set(new Vec3(x, 1, 0).toString(), "netherrack");
  }
  for (let x = 1; x <= 3; x++) {
    for (const y of [1, 0]) {
      const step = planNetherTunnelStep(bot, destination);
      assert.equal(step.type, "dig");
      assert.ok(step.block.position.equals(new Vec3(x, y, 0)));
      blocks.delete(step.block.position.toString());
    }
    const step = planNetherTunnelStep(bot, destination);
    assert.equal(step.type, "move");
    assert.ok(step.position.equals(new Vec3(x, 0, 0)));
    bot.entity.position = step.position.offset(0.5, 0, 0.5);
  }
});

test("Nether tunnel refuses lava, unknown terrain, and non-natural blocks", () => {
  const { bot, blocks } = fixture({ bastion: false });
  const destination = new Vec3(8, 0, 0);
  const feet = new Vec3(1, 0, 0);
  blocks.set(feet.toString(), "netherrack");
  blocks.set(feet.offset(1, 0, 0).toString(), "lava");
  assert.equal(planNetherTunnelStep(bot, destination).type, "blocked");
  blocks.delete(feet.offset(1, 0, 0).toString());
  blocks.set(feet.toString(), "chest");
  assert.equal(planNetherTunnelStep(bot, destination).type, "blocked");
  blocks.delete(feet.toString());
  const original = bot.blockAt;
  bot.blockAt = (pos) =>
    pos.equals(feet.offset(0, -1, 0)) ? null : original(pos);
  assert.equal(planNetherTunnelStep(bot, destination).type, "blocked");
  assert.equal(planNetherTunnelStep(bot, new Vec3(0, 8, 0)).type, "blocked");
});

test("cancelling while looking at a block does not start digging", async () => {
  const { bot } = fixture();
  const controller = new AbortController();
  const block = { position: new Vec3(1, 0, 0), name: "netherrack", type: 1 };
  bot.blockAt = () => block;
  let release;
  let digs = 0;
  bot.lookAt = () => new Promise((resolve) => (release = resolve));
  bot.dig = async () => digs++;
  const running = smartDig(bot, block, {
    autoTool: false,
    signal: controller.signal,
  });
  controller.abort();
  release();
  assert.equal(await running, false);
  assert.equal(digs, 0);
});

test("cancelling a dig does not stop another dig operation", async () => {
  const { bot } = fixture();
  const controller = new AbortController();
  const block = { position: new Vec3(1, 0, 0), name: "netherrack", type: 1 };
  bot.blockAt = () => block;
  bot.lookAt = async () => {};
  let release;
  let stops = 0;
  bot.dig = () => new Promise((resolve) => (release = resolve));
  bot.stopDigging = () => stops++;
  const running = smartDig(bot, block, {
    autoTool: false,
    signal: controller.signal,
  });
  await Promise.resolve();
  bot.targetDigBlock = { ...block };
  controller.abort();
  release();
  assert.equal(await running, false);
  assert.equal(stops, 0);
});
