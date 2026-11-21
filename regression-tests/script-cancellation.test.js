const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Vec3 } = require("vec3");
const { createScriptRepeater } = require("../src/js/scriptRepeater");
const autoFarm = require("../src/js/scripts/autofarm");
const chestStealer = require("../src/js/scripts/chesttransfer");
const autoArmor = require("../src/js/scripts/autoarmor");
const autoTotem = require("../src/js/scripts/autototem");
const autoTool = require("../src/js/scripts/autotool");
const autoFish = require("../src/js/scripts/autofish");
const autoEat = require("../src/js/scripts/autoeat");
const invManager = require("../src/js/scripts/invmanager");
const goTo = require("../src/js/scripts/goto");
const follow = require("../src/js/scripts/follow");
const { prepareOllama } = require("../src/js/scripts/chatai");
const { ollamaManager } = require("../src/js/ollamaManager");

const noop = () => {};
const options = (values) => async (key) => values[key] ?? "off";
function gate() {
  let release, started;
  const pending = new Promise((resolve) => (release = resolve));
  const entered = new Promise((resolve) => (started = resolve));
  return {
    entered,
    release,
    wait: async () => {
      started();
      await pending;
    },
  };
}
function repeater(controller) {
  return createScriptRepeater(controller.signal, (error) => {
    throw error;
  });
}

test("AutoFarm stops after a pending approach", async () => {
  const controller = new AbortController();
  const approach = gate();
  const pos = new Vec3(8, 64, 0);
  let digCalls = 0;
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { goto: approach.wait, setGoal: noop },
    findBlocks: () => [pos],
    blockAt: () => ({ name: "wheat", metadata: 7, position: pos }),
    dig: () => digCalls++,
  };
  const running = autoFarm.script(
    bot,
    noop,
    noop,
    options({}),
    repeater(controller),
  );
  await approach.entered;
  controller.abort();
  approach.release();
  await running;
  assert.equal(digCalls, 0);
});

test("AutoFarm stops before planting when equip is cancelled", async () => {
  const controller = new AbortController();
  const equip = gate();
  const pos = new Vec3(1, 64, 0);
  let placements = 0;
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: "wheat_seeds" }] },
    pathfinder: { setGoal: noop },
    findBlocks: ({ matching }) => (matching({ name: "farmland" }) ? [pos] : []),
    blockAt: (p) => (p.y === 65 ? { name: "air" } : { name: "farmland" }),
    equip: equip.wait,
    placeBlock: () => placements++,
  };
  const running = autoFarm.script(
    bot,
    noop,
    noop,
    options({ replant: "on" }),
    repeater(controller),
  );
  await equip.entered;
  controller.abort();
  equip.release();
  await running;
  assert.equal(placements, 0);
});

test("ChestStealer closes a container opened after cancellation", async () => {
  const controller = new AbortController();
  const open = gate();
  let closed = 0,
    withdrawals = 0;
  const pos = new Vec3(1, 64, 0);
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { setGoal: noop },
    findBlocks: () => [pos],
    blockAt: () => ({ name: "chest", position: pos }),
    openContainer: async () => {
      await open.wait();
      return {
        containerItems: () => [{ name: "diamond", type: 1, count: 1 }],
        withdraw: () => withdrawals++,
        close: () => closed++,
      };
    },
  };
  const running = chestStealer.script(
    bot,
    noop,
    noop,
    options({ steal: "on", filter: "" }),
    repeater(controller),
  );
  await open.entered;
  controller.abort();
  open.release();
  await running;
  assert.equal(withdrawals, 0);
  assert.equal(closed, 1);
});

test("ChestStealer finishes its in-flight transfer but does not start another", async () => {
  const controller = new AbortController();
  const transfer = gate();
  let withdrawals = 0,
    closed = 0;
  const pos = new Vec3(1, 64, 0);
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { setGoal: noop },
    findBlocks: () => [pos],
    blockAt: () => ({ name: "chest", position: pos }),
    openContainer: async () => ({
      containerItems: () => [
        { name: "diamond", type: 1, count: 1 },
        { name: "iron_ingot", type: 2, count: 1 },
      ],
      withdraw: async () => {
        withdrawals++;
        await transfer.wait();
      },
      close: () => closed++,
    }),
  };
  const running = chestStealer.script(
    bot,
    noop,
    noop,
    options({ steal: "on", filter: "" }),
    repeater(controller),
  );
  await transfer.entered;
  controller.abort();
  transfer.release();
  await running;
  assert.equal(withdrawals, 1);
  assert.equal(closed, 1);
});

test("AutoArmor does not equip further pieces after cancellation", async () => {
  const controller = new AbortController();
  const equip = gate();
  const calls = [];
  const bot = {
    inventory: {
      slots: [],
      items: () => [{ name: "iron_helmet" }, { name: "iron_chestplate" }],
    },
    equip: async (item) => {
      calls.push(item.name);
      await equip.wait();
    },
  };
  const running = autoArmor.script(
    bot,
    noop,
    noop,
    options({}),
    repeater(controller),
  );
  await equip.entered;
  controller.abort();
  equip.release();
  await running;
  assert.deepEqual(calls, ["iron_helmet"]);
});

test("AutoTotem does not disconnect after cancellation during equip", async () => {
  const controller = new AbortController();
  const equip = gate();
  let quits = 0;
  const bot = {
    health: 2,
    inventory: { slots: [], items: () => [{ name: "totem_of_undying" }] },
    equip: equip.wait,
    quit: () => quits++,
  };
  const running = autoTotem.script(
    bot,
    noop,
    noop,
    options({ autolog: "on" }),
    repeater(controller),
  );
  await equip.entered;
  controller.abort();
  equip.release();
  await running;
  assert.equal(quits, 0);
});

test("AutoTool does not restart a dig after cancellation during aiming", async () => {
  const controller = new AbortController();
  const aiming = gate();
  const bot = new EventEmitter();
  const tool = { name: "iron_pickaxe", slot: 10 };
  const block = { name: "stone", position: new Vec3(1, 64, 0) };
  let digs = 0;
  bot.entity = { position: new Vec3(0, 64, 0) };
  bot.inventory = { items: () => [tool] };
  bot.pathfinder = { bestHarvestTool: () => tool };
  bot.heldItem = { name: "wooden_pickaxe", slot: 9 };
  bot.targetDigBlock = block;
  bot.equip = async (item) => {
    bot.heldItem = item;
  };
  bot.lookAt = aiming.wait;
  bot.dig = async () => {
    digs++;
  };
  const running = autoTool.script(
    bot,
    noop,
    noop,
    options({ minetool: "on" }),
    repeater(controller),
  );
  await aiming.entered;
  controller.abort();
  aiming.release();
  await running;
  assert.equal(digs, 0);
});

test("AutoTool restarts a dig with the equipped tool after aiming", async () => {
  const bot = new EventEmitter();
  const tool = { name: "iron_pickaxe", slot: 10 };
  const block = { name: "stone", position: new Vec3(1, 64, 0) };
  const actions = [];
  bot.entity = { position: new Vec3(0, 64, 0) };
  bot.inventory = { items: () => [tool] };
  bot.pathfinder = { bestHarvestTool: () => tool };
  bot.heldItem = { name: "wooden_pickaxe", slot: 9 };
  bot.targetDigBlock = block;
  bot.equip = async (item) => {
    bot.heldItem = item;
  };
  bot.lookAt = async () => {
    actions.push("look");
  };
  bot.dig = async (_block, forceLook) => {
    actions.push(forceLook);
  };
  await autoTool.script(
    bot,
    noop,
    noop,
    options({ minetool: "on" }),
    async () => {},
  );
  assert.deepEqual(actions, ["look", "ignore"]);
});

test("AutoFish does not activate a different item when stopped", async () => {
  const controller = new AbortController();
  let cast;
  const castStarted = new Promise((resolve) => (cast = resolve));
  const rod = { name: "fishing_rod" };
  const logs = [];
  let uses = 0;
  const bot = new EventEmitter();
  bot.entity = { id: 1, position: new Vec3(0, 0, 0) };
  bot.inventory = { items: () => [rod] };
  bot.heldItem = rod;
  bot._client = new EventEmitter();
  bot.registry = require("prismarine-registry")("1.20.1");
  bot.supportFeature = (feature) => bot.registry.supportFeature(feature);
  bot.activateItem = () => {
    uses++;
    cast();
  };
  const running = autoFish.script(
    bot,
    (line) => logs.push(line),
    noop,
    options({}),
    repeater(controller),
  );
  await castStarted;
  bot._client.emit("spawn_entity", {
    entityId: 10,
    type: bot.registry.entitiesByName.fishing_bobber.id,
    objectData: 1,
  });
  bot.heldItem = { name: "bow" };
  controller.abort();
  await running;
  assert.equal(uses, 1);
  assert.ok(logs.some((line) => line.includes("reel in manually")));
  assert.equal(bot._client.listenerCount("world_particles"), 0);
});

test("AutoFish reports an equip failure instead of casting the held item", async () => {
  const rod = { name: "fishing_rod" };
  const logs = [];
  let casts = 0;
  const bot = {
    entity: { position: new Vec3(0, 0, 0) },
    inventory: { items: () => [rod] },
    heldItem: { name: "bow" },
    equip: async () => {
      throw new Error("equip rejected");
    },
    fish: async () => {
      casts++;
    },
  };
  await autoFish.script(
    bot,
    (line) => logs.push(line),
    noop,
    options({ autorod: "on" }),
    async () => {},
  );
  assert.equal(casts, 0);
  assert.ok(logs.some((line) => line.includes("equip rejected")));
});

test("AutoFish does not cast again when stopped before the bobber is confirmed", async () => {
  const controller = new AbortController();
  let cast;
  const started = new Promise((resolve) => (cast = resolve));
  const rod = { name: "fishing_rod" };
  const bot = new EventEmitter();
  bot.entity = { id: 1, position: new Vec3(0, 0, 0) };
  bot.inventory = { items: () => [rod] };
  bot.heldItem = rod;
  bot._client = new EventEmitter();
  bot.registry = require("prismarine-registry")("1.20.1");
  bot.supportFeature = (feature) => bot.registry.supportFeature(feature);
  let uses = 0;
  bot.activateItem = () => {
    uses++;
    cast();
  };
  const logs = [];
  const running = autoFish.script(
    bot,
    (line) => logs.push(line),
    noop,
    options({}),
    repeater(controller),
  );
  await started;
  controller.abort();
  await running;
  bot._client.emit("spawn_entity", {
    entityId: 10,
    type: bot.registry.entitiesByName.fishing_bobber.id,
    objectData: 1,
  });
  assert.equal(uses, 1);
  assert.ok(logs.some((line) => line.includes("reel in manually")));
  assert.equal(bot._client.listenerCount("spawn_entity"), 0);
});

test("AutoFish stops when another script changes the held item", async () => {
  let cast;
  const started = new Promise((resolve) => (cast = resolve));
  const rod = { name: "fishing_rod" };
  const bot = new EventEmitter();
  bot.entity = { id: 1, position: new Vec3(0, 0, 0) };
  bot.inventory = { items: () => [rod] };
  bot.heldItem = rod;
  bot._client = new EventEmitter();
  bot.registry = require("prismarine-registry")("1.20.1");
  bot.supportFeature = (feature) => bot.registry.supportFeature(feature);
  let uses = 0;
  bot.activateItem = () => {
    uses++;
    cast();
  };
  const logs = [];
  let repeated = false;
  const running = autoFish.script(
    bot,
    (line) => logs.push(line),
    noop,
    options({}),
    async () => {
      repeated = true;
    },
  );
  await started;
  bot.heldItem = { name: "bow" };
  bot.emit("heldItemChanged", bot.heldItem);
  await running;
  bot._client.emit("world_particles", { x: 0, z: 0 });
  assert.equal(uses, 1);
  assert.equal(repeated, false);
  assert.ok(logs.some((line) => line.includes("reel in manually")));
});

test("AutoFish stops instead of recasting when its bobber is never confirmed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cast;
  const started = new Promise((resolve) => (cast = resolve));
  const rod = { name: "fishing_rod" };
  const bot = new EventEmitter();
  bot.entity = { id: 1, position: new Vec3(0, 0, 0) };
  bot.inventory = { items: () => [rod] };
  bot.heldItem = rod;
  bot._client = new EventEmitter();
  bot.registry = require("prismarine-registry")("1.20.1");
  bot.supportFeature = (feature) => bot.registry.supportFeature(feature);
  let uses = 0;
  bot.activateItem = () => {
    uses++;
    cast();
  };
  const logs = [];
  let repeated = false;
  const running = autoFish.script(
    bot,
    (line) => logs.push(line),
    noop,
    options({}),
    async () => {
      repeated = true;
    },
  );
  await started;
  t.mock.timers.tick(15000);
  await running;
  assert.equal(uses, 1);
  assert.equal(repeated, false);
  assert.ok(logs.some((line) => line.includes("Bobber was not confirmed")));
  assert.equal(bot._client.listenerCount("spawn_entity"), 0);
});

test("AutoFish does not claim a catch or recast when reeling fails", async () => {
  let cast;
  const started = new Promise((resolve) => (cast = resolve));
  const rod = { name: "fishing_rod" };
  const bot = new EventEmitter();
  bot.entity = { id: 1, position: new Vec3(0, 0, 0) };
  bot.entities = { 10: { position: new Vec3(3, 0, 0) } };
  bot.inventory = { items: () => [rod] };
  bot.heldItem = rod;
  bot._client = new EventEmitter();
  bot.registry = require("prismarine-registry")("1.20.1");
  bot.supportFeature = (feature) => bot.registry.supportFeature(feature);
  let uses = 0;
  bot.activateItem = () => {
    if (++uses === 2) throw new Error("reel failed");
    cast();
  };
  const logs = [];
  let repeated = false;
  const running = autoFish.script(
    bot,
    (line) => logs.push(line),
    noop,
    options({}),
    async () => {
      repeated = true;
    },
  );
  await started;
  bot._client.emit("spawn_entity", {
    entityId: 10,
    type: bot.registry.entitiesByName.fishing_bobber.id,
    objectData: 1,
  });
  bot._client.emit("world_particles", {
    particleId: bot.registry.particlesByName.fishing.id,
    particles: 6,
    x: 3,
    z: 0,
  });
  await running;
  assert.equal(uses, 2);
  assert.equal(repeated, false);
  assert.ok(logs.some((line) => line.includes("reel failed")));
  assert.ok(!logs.some((line) => line.includes("catch #1")));
});

for (const version of ["1.8", "1.20.1", "1.21.4"]) {
  test(`AutoFish reels only its own bobber and cleans up on ${version}`, async () => {
    let cast;
    const castStarted = new Promise((resolve) => (cast = resolve));
    const rod = { name: "fishing_rod" };
    const bot = new EventEmitter();
    bot.entity = { id: 1, position: new Vec3(0, 0, 0) };
    bot.entities = { 10: { id: 10, position: new Vec3(3, 0, 0) } };
    bot.inventory = { items: () => [rod] };
    bot.heldItem = rod;
    bot._client = new EventEmitter();
    bot.registry = require("prismarine-registry")(version);
    bot.supportFeature = (feature) => bot.registry.supportFeature(feature);
    let uses = 0;
    bot.activateItem = () => {
      uses++;
      cast();
    };
    require("mineflayer/lib/plugins/fishing")(bot);
    const baseline = bot._client.listenerCount("world_particles");
    const logs = [];
    const running = autoFish.script(
      bot,
      (line) => logs.push(line),
      noop,
      options({}),
      async () => {},
    );
    await castStarted;
    const type = bot.supportFeature("fishingBobberCorrectlyNamed")
      ? bot.registry.entitiesByName.fishing_bobber.id
      : 90;
    bot._client.emit("spawn_entity", { entityId: 10, type, objectData: 2 });
    const modern = bot.registry.supportFeature("updatedParticlesPacket");
    const packet = modern
      ? { particle: { type: "fishing" }, amount: 6, x: 3, z: 0 }
      : {
          particleId:
            bot.registry.particlesByName.fishing?.id ??
            bot.registry.particlesByName.bubble.id,
          particles: 6,
          x: 3,
          z: 0,
        };
    bot._client.emit("world_particles", packet);
    assert.equal(uses, 1);
    bot._client.emit("spawn_entity", { entityId: 10, type, objectData: 1 });
    bot._client.emit("world_particles", { ...packet, x: 100 });
    assert.equal(uses, 1);
    bot._client.emit("world_particles", packet);
    await running;
    assert.equal(uses, 2);
    assert.ok(logs.some((line) => line.includes("catch #1")));
    assert.equal(bot._client.listenerCount("world_particles"), baseline);
    bot._client.emit("world_particles", packet);
    assert.equal(uses, 2);
  });
}

test("InvManager does not start another drop after cancellation", async () => {
  const controller = new AbortController();
  const drop = gate();
  let drops = 0;
  const bot = {
    inventory: {
      items: () => [
        { name: "gravel", slot: 9 },
        { name: "gravel", slot: 10 },
      ],
    },
    tossStack: async () => {
      drops++;
      await drop.wait();
    },
  };
  const running = invManager.script(
    bot,
    noop,
    noop,
    options({ dropjunk: "on", junklist: "gravel" }),
    repeater(controller),
  );
  await drop.entered;
  controller.abort();
  drop.release();
  await running;
  assert.equal(drops, 1);
});

test("AutoEat releases its item use and listener when cancelled", async () => {
  const controller = new AbortController();
  let activated,
    deactivated = 0;
  const started = new Promise((resolve) => (activated = resolve));
  const food = { name: "bread", slot: 10, count: 3 };
  const client = new EventEmitter();
  const bot = {
    entity: { id: 1 },
    food: 10,
    heldItem: food,
    inventory: { slots: [], items: () => [food] },
    _client: client,
    activateItem: () => activated(),
    deactivateItem: () => deactivated++,
  };
  const running = autoEat.script(
    bot,
    noop,
    noop,
    options({}),
    repeater(controller),
  );
  await started;
  controller.abort();
  await running;
  assert.equal(deactivated, 1);
  assert.equal(client.listenerCount("entity_status"), 0);
  assert.equal(bot._mcbpEating, false);
});

test("DeepSeek without an API key reports an error without starting Ollama", async () => {
  const old = {
    getStatus: ollamaManager.getStatus,
    isRemote: ollamaManager.isRemote,
    autoSetup: ollamaManager.autoSetup,
  };
  const logs = [];
  let setups = 0;
  try {
    ollamaManager.getStatus = async () => ({
      serverRunning: false,
      installedModels: [],
    });

    ollamaManager.isRemote = () => true;
    ollamaManager.autoSetup = async () => {
      setups++;
    };
    const result = await prepareOllama(
      (line) => logs.push(line),
      noop,
      "AIChat",
      {
        model: () => "deepseek-v4-pro",
        isActive: () => true,
      },
    );
    assert.equal(result.ok, false);
    assert.match(logs.join(" "), /API key is missing/);
    assert.equal(setups, 0);
  } finally {
    Object.assign(ollamaManager, old);
  }
});

test("GoTo keeps one-shot movement options until the destination is reached", async () => {
  const approach = gate();
  const moves = [];
  const bot = {
    version: "1.20.1",
    registry: require("prismarine-registry")("1.20.1"),
    entity: { position: new Vec3(0, 64, 0) },
    pathfinder: {
      setMovements: (movement) => moves.push(movement),
      setGoal: noop,
      goto: approach.wait,
    },
  };
  const running = goTo.script(
    bot,
    noop,
    noop,
    options({ x: "5", y: "64", z: "0", dig: "on", bridge: "on" }),
    async () => {},
  );
  await approach.entered;
  assert.equal(moves.length, 1);
  assert.equal(moves[0].canDig, true);
  assert.equal(moves[0].allow1by1towers, true);
  approach.release();
  await running;
  assert.equal(moves.length, 2);
  assert.equal(moves[1].canDig, false);
});

test("Follow keeps a one-shot path active until it reaches the target", async () => {
  const approach = gate();
  const player = { username: "Target", position: new Vec3(5, 64, 0) };
  let goal;
  const bot = {
    version: "1.20.1",
    registry: require("prismarine-registry")("1.20.1"),
    entity: { position: new Vec3(0, 64, 0) },
    players: { Target: { entity: player } },
    pathfinder: {
      setMovements: noop,
      setGoal: noop,
      goto: async (target) => {
        goal = target;
        await approach.wait();
      },
    },
  };
  let complete = false;
  const running = follow
    .script(bot, noop, noop, options({ playername: "Target" }), async () => {})
    .then(() => {
      complete = true;
    });
  await approach.entered;
  assert.equal(complete, false);
  assert.equal(goal.x, 5);
  approach.release();
  await running;
  assert.equal(complete, true);
});
