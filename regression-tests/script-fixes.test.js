const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Vec3 } = require("vec3");
const {
  createScriptRepeater,
  createScriptRunScheduler,
} = require("../src/js/scriptRepeater");
const guard = require("../src/js/scripts/guard");
const autoBuild = require("../src/js/scripts/autobuild");
const invManager = require("../src/js/scripts/invmanager");
const autoFish = require("../src/js/scripts/autofish");
const autoReconnect = require("../src/js/scripts/autoreconnect");
const antiAfk = require("../src/js/scripts/antiafk");
const autoRespawn = require("../src/js/scripts/autorespawn");
const survival = require("../src/js/scripts/survival");
const clearInv = require("../src/js/scripts/clearinv");
const gearUp = require("../src/js/scripts/gearup");
const { buildGearUpPlanSnapshot } = gearUp;
const planner = require("../src/js/wasmPlanner");
const { SessionLogger } = require("../src/js/sessionLogger");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const optionReader = (options) => async (key) => options[key] ?? "off";
const ignore = () => {};

test("Rust planner produces exact quarry dimensions and original tunnel order", () => {
  for (let size = 1; size <= 16; size++) {
    const points = planner.quarry(size, 2);
    assert.equal(points.length, size * size * 2);
    assert.equal(
      new Set(points.map((p) => `${p.dx},${p.dy},${p.dz}`)).size,
      points.length,
    );
  }
  assert.deepEqual(planner.tunnel(2, 1, { fx: 0, fz: -1, rx: 1, rz: 0 }), [
    { dx: 0, dy: 1, dz: -1 },
    { dx: 1, dy: 1, dz: -1 },
    { dx: 0, dy: 0, dz: -1 },
    { dx: 1, dy: 0, dz: -1 },
  ]);
  assert.equal(planner.template("hut", 3).length, 55);
  assert.throws(() => planner.quarry(0, 1), /Invalid spatial planner/);
});

test("repeater waits for an unfinished tick before completing cancellation", async () => {
  const controller = new AbortController();
  let calls = 0;
  let finish;
  const blocker = new Promise((resolve) => {
    finish = resolve;
  });
  const repeater = createScriptRepeater(controller.signal, (err) => {
    throw err;
  });
  const running = repeater(async () => {
    calls++;
    await blocker;
  }, 50);
  await delay(175);
  assert.equal(calls, 1);
  let stopped = false;
  running.then(() => {
    stopped = true;
  });
  controller.abort();
  await delay(0);
  assert.equal(stopped, false);
  finish();
  await running;
  await delay(70);
  assert.equal(calls, 1);
});

test("script restarts wait for old cleanup and cancelled queued runs stay cancelled", async () => {
  const events = [];
  let finishOld;
  const scheduler = createScriptRunScheduler({
    onWaiting: (name) => events.push(`waiting ${name}`),
    onError: (_name, err) => {
      throw err;
    },
  });
  scheduler.start("Guard", async () => {
    events.push("old start");
    await new Promise((resolve) => {
      finishOld = resolve;
    });
    events.push("old cleanup");
  });
  scheduler.cancel("Guard");
  scheduler.start("Guard", () => events.push("cancelled restart"));
  scheduler.cancel("Guard");
  scheduler.start("Guard", () => events.push("new start"));
  assert.deepEqual(events, ["old start", "waiting Guard", "waiting Guard"]);
  finishOld();
  await delay(0);
  assert.deepEqual(events, [
    "old start",
    "waiting Guard",
    "waiting Guard",
    "old cleanup",
    "new start",
  ]);
});

test("AntiAFK cancels pending movement and does not start reverse after stop", async () => {
  const controller = new AbortController();
  const controls = [];
  const bot = {
    entity: {},
    setControlState: (state, active) => controls.push([state, active]),
  };
  const repeater = createScriptRepeater(controller.signal, (err) => {
    throw err;
  });
  const running = antiAfk.script(
    bot,
    ignore,
    ignore,
    optionReader({ move: "on" }),
    repeater,
  );
  await delay(0);
  assert.deepEqual(controls, [["forward", true]]);
  controller.abort();
  await running;
  await delay(300);
  assert.deepEqual(controls, [
    ["forward", true],
    ["forward", false],
  ]);
});

test("AntiAFK does not act when stopped during its option reads", async () => {
  const controller = new AbortController();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const controls = [];
  const bot = {
    entity: {},
    setControlState: (state, active) => controls.push([state, active]),
    look: () => controls.push(["look"]),
  };
  const repeater = createScriptRepeater(controller.signal, (err) => {
    throw err;
  });
  const running = antiAfk.script(bot, ignore, ignore, () => pending, repeater);
  controller.abort();
  release("on");
  await running;
  assert.deepEqual(controls, []);
});

test("AutoRespawn removes pending spawn listener and does not navigate after stop", async () => {
  const controller = new AbortController();
  const bot = new EventEmitter();
  const goals = [];
  let respawns = 0;
  bot.entity = { position: new Vec3(1, 64, 1) };
  bot.health = 20;
  bot.respawn = () => respawns++;
  bot.pathfinder = { setGoal: (goal) => goals.push(goal) };
  const repeater = createScriptRepeater(controller.signal, (err) => {
    throw err;
  });
  const running = autoRespawn.script(
    bot,
    ignore,
    ignore,
    optionReader({ returnback: "on", workpos: "10 64 10" }),
    repeater,
  );
  await delay(0);
  bot.emit("death");
  assert.equal(respawns, 1);
  assert.equal(bot.listenerCount("spawn"), 1);
  controller.abort();
  await running;
  bot.emit("spawn");
  await delay(0);
  assert.equal(bot.listenerCount("spawn"), 0);
  assert.equal(bot.listenerCount("death"), 0);
  assert.equal(goals.some(Boolean), false);
});

test("Guard attacks only the identified player responsible for damage", async () => {
  const bot = new EventEmitter();
  const protectedPlayer = {
    id: 2,
    type: "player",
    username: "Protected",
    position: new Vec3(3, 0, 0),
  };
  const neighbor = {
    id: 3,
    type: "player",
    username: "Neighbor",
    position: new Vec3(5, 0, 0),
  };
  bot.entity = { id: 1, position: new Vec3(0, 0, 0) };
  bot.username = "Bot";
  bot.players = {
    Protected: { username: "Protected", entity: protectedPlayer },
  };
  bot.entities = { 1: bot.entity, 2: protectedPlayer, 3: neighbor };
  bot.pathfinder = { setGoal: ignore };
  bot.inventory = { items: () => [] };
  const logs = [];
  let tick;
  let finish;
  const running = guard.script(
    bot,
    (s) => logs.push(s),
    ignore,
    optionReader({
      playername: "Protected",
      pvp: "on",
      hostiles: "off",
      autoweapon: "off",
    }),
    (fn) => {
      tick = fn;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  while (!tick) await delay(0);
  assert.equal(
    logs.some((s) => s.includes("Engaging")),
    false,
  );
  bot.emit("entityHurt", protectedPlayer);
  await tick();
  assert.equal(
    logs.some((s) => s.includes("Engaging")),
    false,
  );
  assert.ok(logs.some((s) => s.includes("Cannot identify the attacker")));
  bot.emit("entityHurt", protectedPlayer, neighbor);
  await tick();
  assert.ok(logs.some((s) => s.includes("Engaging Neighbor")));
  finish();
  await running;
});

test("Survival does not target a nearby player without identified damage", async () => {
  const bot = new EventEmitter();
  const neighbor = {
    id: 2,
    type: "player",
    username: "Neighbor",
    position: new Vec3(3, 0, 0),
  };
  bot.entity = { id: 1, position: new Vec3(0, 0, 0) };
  bot.entities = { 1: bot.entity, 2: neighbor };
  bot.pathfinder = { setGoal: ignore };
  bot.inventory = { items: () => [], slots: [] };
  const logs = [];
  let tick;
  let finish;
  const running = survival.script(
    bot,
    (line) => logs.push(line),
    ignore,
    optionReader({ defend: "on" }),
    (fn) => {
      tick = fn;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  while (!tick) await delay(0);
  bot.emit("entityHurt", bot.entity);
  await tick();
  assert.ok(logs.some((line) => line.includes("Cannot identify the attacker")));
  assert.equal(
    logs.some((line) => line.includes("Defending against")),
    false,
  );
  bot.emit("entityHurt", bot.entity, neighbor);
  await tick();
  assert.ok(logs.some((line) => line.includes("Defending against Neighbor")));
  finish();
  await running;
});

test("ClearInv stops dropping after cancellation and reports rejected drops", async () => {
  const controller = new AbortController();
  const items = [{ name: "diamond" }, { name: "stone" }];
  const attempts = [];
  let release;
  let started;
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  const bot = {
    inventory: { items: () => items, slots: [] },
    tossStack: async (item) => {
      attempts.push(item.name);
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  const repeater = createScriptRepeater(controller.signal, (err) => {
    throw err;
  });
  const running = clearInv.script(
    bot,
    ignore,
    ignore,
    optionReader({}),
    repeater,
  );
  await waiting;
  controller.abort();
  release();
  await running;
  assert.deepEqual(attempts, ["diamond"]);

  const logs = [];
  bot.tossStack = async () => {
    throw new Error("server rejected drop");
  };
  await clearInv.script(
    bot,
    (line) => logs.push(line),
    ignore,
    optionReader({}),
    async () => {},
  );
  assert.ok(logs.some((line) => line.includes("server rejected drop")));
  assert.ok(logs.some((line) => line.includes("Dropped 0/2")));
});

test("AutoBuild retains failed placements and never reports completion", async () => {
  const logs = [];
  let attempts = 0;
  const bot = {
    entity: { position: new Vec3(0, 10, 0) },
    inventory: { items: () => [{ name: "stone" }] },
    pathfinder: { setGoal: ignore, goto: async () => {} },
    blockAt: (pos) => ({
      name: pos.y === 8 ? "stone" : "air",
      boundingBox: pos.y === 8 ? "block" : "empty",
      position: pos,
    }),
    equip: async () => {},
    placeBlock: async () => {
      attempts++;
      throw new Error("server rejected placement");
    },
  };
  await autoBuild.script(
    bot,
    (s) => logs.push(s),
    ignore,
    optionReader({ template: "bridge", size: "2" }),
    async (tick) => tick(),
  );
  assert.equal(attempts, 2);
  assert.ok(logs.some((s) => s.includes("server rejected placement")));
  assert.equal(
    logs.some((s) => s.includes("Completed")),
    false,
  );
});

test("AutoBuild does not claim completion when no supporting block exists", async () => {
  const logs = [];
  const bot = {
    entity: { position: new Vec3(0, 10, 0) },
    inventory: { items: () => [{ name: "stone" }] },
    pathfinder: { setGoal: ignore, goto: async () => {} },
    blockAt: (pos) => ({ name: "air", boundingBox: "empty", position: pos }),
    equip: async () => {},
    placeBlock: async () => {
      assert.fail("placement needs a supporting block");
    },
  };
  await autoBuild.script(
    bot,
    (s) => logs.push(s),
    ignore,
    optionReader({ template: "bridge", size: "2" }),
    async () => {},
  );
  assert.ok(logs.some((s) => s.includes("No reachable support")));
  assert.equal(
    logs.some((s) => s.includes("Completed")),
    false,
  );
});

test("AutoBuild reports a missing custom template instead of building a platform", async () => {
  const logs = [];
  let placed = false;
  const bot = {
    entity: { position: new Vec3(0, 10, 0) },
    inventory: { items: () => [{ name: "stone" }] },
    pathfinder: { setGoal: ignore },
    placeBlock: async () => {
      placed = true;
    },
  };
  await autoBuild.script(
    bot,
    (line) => logs.push(line),
    ignore,
    optionReader({
      template: "nonexistent-mcbp-test-template.json",
      size: "2",
    }),
    async () => {},
  );
  assert.ok(logs.some((line) => line.includes("Cannot read template")));
  assert.equal(placed, false);
});

test("AutoBuild does not place a block after being stopped during equip", async () => {
  const controller = new AbortController();
  let release;
  let equipped;
  const equipStarted = new Promise((resolve) => {
    equipped = resolve;
  });
  const equipPending = new Promise((resolve) => {
    release = resolve;
  });
  let placements = 0;
  const bot = {
    entity: { position: new Vec3(0, 10, 0) },
    inventory: { items: () => [{ name: "stone" }] },
    pathfinder: { setGoal: ignore, goto: async () => {} },
    blockAt: (pos) => ({
      name: pos.y === 8 ? "stone" : "air",
      boundingBox: pos.y === 8 ? "block" : "empty",
      position: pos,
    }),
    equip: async () => {
      equipped();
      await equipPending;
    },
    placeBlock: async () => {
      placements++;
    },
  };
  const repeat = createScriptRepeater(controller.signal, (err) => {
    throw err;
  });
  const running = autoBuild.script(
    bot,
    ignore,
    ignore,
    optionReader({ template: "bridge", size: "2" }),
    repeat,
  );
  await equipStarted;
  controller.abort();
  release();
  await running;
  assert.equal(placements, 0);
});

test("InvManager only drops enough default junk and ignores equipped slots", async () => {
  const items = Array.from({ length: 32 }, (_, i) => ({
    name: i < 6 ? "gravel" : "diamond",
    slot: 9 + i,
    count: 64,
  }));
  items.push({ name: "iron_helmet", slot: 5, count: 1 });
  const dropped = [];
  const bot = {
    inventory: { items: () => items },
    tossStack: async (item) => {
      dropped.push(item);
    },
  };
  await invManager.script(
    bot,
    ignore,
    ignore,
    optionReader({ dropjunk: "on", sortgear: "off", freeslots: "6" }),
    async () => {},
  );
  assert.equal(dropped.length, 2);
});

test("InvManager does not count a rejected drop as a freed slot", async () => {
  const items = Array.from({ length: 32 }, (_, i) => ({
    name: i < 6 ? "gravel" : "diamond",
    slot: 9 + i,
    count: 64,
  }));
  let attempts = 0;
  const logs = [];
  const bot = {
    inventory: { items: () => items },
    tossStack: async () => {
      attempts++;
      if (attempts === 1) throw new Error("cannot drop");
    },
  };
  await invManager.script(
    bot,
    (s) => logs.push(s),
    ignore,
    optionReader({ dropjunk: "on", sortgear: "off", freeslots: "6" }),
    async () => {},
  );
  assert.equal(attempts, 3);
  assert.ok(logs.some((s) => s.includes("cannot drop")));
});

test("AutoFish can be stopped while waiting for a bite", async () => {
  const controller = new AbortController();
  const events = [];
  const rod = { name: "fishing_rod" };
  const bot = new EventEmitter();
  bot.entity = { id: 1, position: new Vec3(0, 0, 0), yaw: 0, pitch: 0 };
  bot.inventory = { items: () => [rod] };
  bot.heldItem = rod;
  bot._client = new EventEmitter();
  bot.registry = require("prismarine-registry")("1.20.1");
  bot.supportFeature = (feature) => bot.registry.supportFeature(feature);
  bot.activateItem = () => events.push(events.length ? "reel" : "cast");
  const repeat = createScriptRepeater(controller.signal, (err) => {
    throw err;
  });
  const running = autoFish.script(
    bot,
    ignore,
    ignore,
    optionReader({}),
    repeat,
  );
  await delay(20);
  assert.deepEqual(events, ["cast"]);
  bot._client.emit("spawn_entity", {
    entityId: 10,
    type: bot.registry.entitiesByName.fishing_bobber.id,
    objectData: 1,
  });
  controller.abort();
  await running;
  await delay(70);
  assert.deepEqual(events, ["cast", "reel"]);
  assert.equal(bot._client.listenerCount("world_particles"), 0);
});

test("AutoReconnect does not re-arm after a delayed option read is cancelled", async () => {
  const controller = new AbortController();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const bot = {};
  const repeat = createScriptRepeater(controller.signal, (err) => {
    throw err;
  });
  const running = autoReconnect.script(
    bot,
    ignore,
    ignore,
    () => pending,
    repeat,
  );
  controller.abort();
  release("on");
  await running;
  assert.equal(bot._mcbpAutoReconnect, undefined);
});

test("GearUp does not mark a diamond set as completed Netherite", () => {
  const items = [
    "diamond_sword",
    "diamond_pickaxe",
    "diamond_axe",
    "diamond_shovel",
    "diamond_helmet",
    "diamond_chestplate",
    "diamond_leggings",
    "diamond_boots",
  ].map((name) => ({ name, count: 1 }));
  const bot = { inventory: { items: () => items, slots: [] } };
  const plan = buildGearUpPlanSnapshot(bot, "netherite", {
    wantTools: true,
    wantArmor: true,
    wantShield: false,
  });
  const upgrade = plan.steps.find((step) => step.label.includes("Netherite"));
  assert.ok(upgrade);
  assert.notEqual(upgrade.status, "done");
  assert.doesNotMatch(plan.currentStep, /Completed NETHERITE/);
});

test("GearUp does not place a workstation after cancellation during equip", async () => {
  const controller = new AbortController();
  const item = { name: "smithing_table" };
  let release;
  let placements = 0;
  const bot = {
    entity: { position: new Vec3(0.5, 0, 0.5) },
    inventory: { items: () => [item] },
    blockAt: (position) => ({
      position,
      name: position.y < 0 ? "stone" : "air",
      boundingBox: position.y < 0 ? "block" : "empty",
    }),
    equip: () => new Promise((resolve) => (release = resolve)),
    lookAt: async () => {},
    placeBlock: async () => placements++,
  };
  const running = gearUp.placeBlockNearby(
    bot,
    item,
    "smithing_table",
    () => {},
    controller.signal,
  );
  controller.abort();
  release();
  assert.equal(await running, false);
  assert.equal(placements, 0);
});

test("combat does not attack after cancellation while aiming", async () => {
  const { performPvpAttack } = require("../src/js/botUtils");
  const controller = new AbortController();
  let release;
  let attacks = 0;
  const bot = {
    entity: { position: new Vec3(0, 0, 0), onGround: true },
    look: () => new Promise((resolve) => (release = resolve)),
    attack: () => attacks++,
  };
  const target = { name: "cow", position: new Vec3(1, 0, 0) };
  const running = performPvpAttack(bot, target, {
    useCrits: false,
    signal: controller.signal,
  });
  controller.abort();
  release();
  assert.equal(await running, false);
  assert.equal(attacks, 0);
});

test("GearUp reports Netherite as incomplete instead of finishing at diamond", async () => {
  const items = [
    "diamond_sword",
    "diamond_pickaxe",
    "diamond_axe",
    "diamond_shovel",
    "diamond_helmet",
    "diamond_chestplate",
    "diamond_leggings",
    "diamond_boots",
    "oak_log",
  ].map((name) => ({ name, count: name === "oak_log" ? 2 : 1 }));
  const logs = [];
  const bot = {
    entity: { position: new Vec3(0, 0, 0) },
    inventory: { items: () => items, slots: [] },
    pathfinder: { setGoal: ignore },
    equip: async () => {},
  };
  await gearUp.script(
    bot,
    (line) => logs.push(line),
    ignore,
    optionReader({
      tier: "netherite",
      tools: "on",
      armor: "on",
      shield: "off",
    }),
    async () => {},
  );
  assert.equal(bot._mcbpGearUpDone, false);
  assert.ok(
    logs.some((line) => line.includes("Netherite smithing is not supported")),
    logs.join("\n"),
  );
  assert.equal(
    logs.some((line) => line.includes("Completed Diamond")),
    false,
  );
});

test("GearUp explores safe Nether terrain when it needs gold and none is visible", async () => {
  const items = [
    "diamond_sword",
    "diamond_pickaxe",
    "diamond_axe",
    "diamond_shovel",
  ].map((name) => ({ name, count: 1 }));
  items.push({ name: "netherite_scrap", count: 4 });
  const goals = [];
  const logs = [];
  const registry = require("prismarine-registry")("1.20.1");
  const bot = {
    version: "1.20.1",
    registry,
    game: { dimension: "the_nether" },
    entity: { position: new Vec3(0, 64, 0) },
    entities: {},
    inventory: { items: () => items, slots: [] },
    pathfinder: {
      setGoal: (goal) => goals.push(goal),
      setMovements(movement) {
        this.movements = movement;
      },
    },
    findBlocks: () => [],
    blockAt: (pos) => ({
      name: pos.y === 63 ? "netherrack" : "air",
      boundingBox: pos.y === 63 ? "block" : "empty",
      position: pos,
    }),
    equip: async () => {},
  };
  await gearUp.script(
    bot,
    (line) => logs.push(line),
    ignore,
    optionReader({
      tier: "netherite",
      tools: "on",
      armor: "off",
      shield: "off",
    }),
    async () => {},
  );
  assert.ok(
    logs.some((line) => line.includes("Exploring loaded Nether terrain")),
    logs.join("\n"),
  );
  assert.ok(
    goals.some((goal) => goal && Math.abs(goal.x) + Math.abs(goal.z) >= 8),
  );
  assert.equal(bot._mcbpGearUpDone, false);
});

test("history pagination retains the next file when a page ends at a file boundary", () => {
  const logger = new SessionLogger();
  logger.listLogFiles = () => [
    { path: "new", name: "new" },
    { path: "old", name: "old" },
  ];
  logger.parseEntriesFromFile = (file) =>
    (file === "new" ? ["new1", "new2"] : ["old1", "old2"]).map((raw) => ({
      raw,
    }));
  const first = logger.readHistoricalEntries({ limit: 2 });
  assert.deepEqual(
    first.entries.map((entry) => entry.raw),
    ["new1", "new2"],
  );
  const second = logger.readHistoricalEntries({
    limit: 2,
    fileIndex: first.nextFileIndex,
    beforeIndex: first.nextBeforeIndex,
  });
  assert.deepEqual(
    second.entries.map((entry) => entry.raw),
    ["old1", "old2"],
  );
});
