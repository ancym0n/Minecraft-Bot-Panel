// Dual-engine failover: Baritone <-> stock mineflayer-pathfinder, and
// reach-based mining helpers.
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { Vec3 } = require("vec3");

const { loadLibraries } = require("../src/js/runtime");
const {
  BaritoneMovements,
  injectBaritonePathfinder,
  runWithPathOwner,
} = require("../src/js/baritone");
const {
  MiningSkipList,
  canMineFromHere,
  pickMiningTarget,
  isExposed,
  miningGoalFor,
} = require("../src/js/miningReach");
const { AiBrain } = require("../src/js/aiBrain");

const libs = loadLibraries();
const mcData = libs.mcData("26.1");
const { goals } = libs;
const tick = () => new Promise((r) => setImmediate(r));

function createBot(blockMapFn, { pos = new Vec3(0.5, 1, 0.5), stockPkg = null } = {}) {
  const bot = new EventEmitter();
  bot.setMaxListeners(50);
  bot.version = "26.1";
  bot.registry = mcData;
  bot.game = { minY: -64 };
  bot.food = 20;
  bot.entity = {
    position: pos.clone(),
    velocity: new Vec3(0, 0, 0),
    onGround: true,
    isInWater: false,
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62,
    effects: {},
  };
  bot.entities = {};
  bot.inventory = { slots: new Array(46).fill(null), items: () => [] };
  bot.controlState = {};
  bot.setControlState = (k, v) => {
    bot.controlState[k] = Boolean(v);
  };
  bot.clearControlStates = () => {
    for (const k of Object.keys(bot.controlState)) bot.controlState[k] = false;
  };
  bot.look = () => {};
  bot.lookAt = () => {};
  bot.stopDigging = () => {};
  const byName = mcData.blocksByName;
  bot.blockAt = (vec) => {
    if (!vec) return null;
    const x = Math.floor(vec.x);
    const y = Math.floor(vec.y);
    const z = Math.floor(vec.z);
    const name = blockMapFn(x, y, z);
    if (name === null) return null;
    const def = byName[name] || byName.air;
    const empty = def.boundingBox === "empty" || name === "air" || name === "water";
    return {
      type: def.id,
      name: def.name,
      diggable: def.diggable,
      boundingBox: empty ? "empty" : "block",
      position: new Vec3(x, y, z),
      shapes: empty ? [] : [[0, 0, 0, 1, 1, 1]],
      metadata: 0,
      getProperties: () => ({}),
      digTime: () => (def.diggable === false ? Infinity : 250),
    };
  };
  // Minimal voxel raycast (enough for line-of-sight checks in tests).
  bot.world = {
    raycast(from, dir, maxDist) {
      const step = 0.05;
      for (let d = 0; d <= maxDist; d += step) {
        const p = from.plus(dir.scaled(d));
        const b = bot.blockAt(p);
        if (b && b.boundingBox === "block") {
          return { position: b.position, face: 1 };
        }
      }
      return null;
    },
  };
  injectBaritonePathfinder(bot, stockPkg ? { mcbpStockPathfinder: stockPkg } : {});
  const m = new BaritoneMovements(bot);
  m.canDig = false;
  m.scafoldingBlocks = [];
  bot.pathfinder.setMovements(m);
  return bot;
}

// Fake mineflayer-pathfinder package whose behaviour the test controls.
function createFakeStockPkg() {
  const state = { mode: "reach", goals: [], ticks: 0, api: null, movementsSet: 0 };
  class Movements {
    constructor() {
      this.canDig = true;
      this.allowParkour = true;
    }
  }
  function pathfinder(bot) {
    let goal = null;
    const api = {
      thinkTimeout: 5000,
      tickTimeout: 40,
      movements: new Movements(bot),
      setGoal(g) {
        goal = g;
        state.goals.push(g);
        bot.emit("goal_updated", g);
      },
      setMovements(m) {
        api.movements = m;
        state.movementsSet += 1;
      },
      isMoving: () => Boolean(goal),
      isMining: () => false,
      isBuilding: () => false,
      getPathTo: () => ({ status: "success", path: [] }),
    };
    Object.defineProperty(api, "goal", { get: () => goal });
    state.api = api;
    bot.pathfinder = api;
    bot.on("physicsTick", function monitorMovement() {
      state.ticks += 1;
      // The stock engine must see itself as bot.pathfinder while ticking.
      state.sawSelf = bot.pathfinder === api;
      if (!goal) return;
      if (state.mode === "reach") {
        const g = goal;
        bot.emit("goal_reached", g);
        goal = null;
        // stock fullStop(): snaps x/z to the block centre and zeroes velocity
        bot.entity.position.x = Math.floor(bot.entity.position.x) + 0.5;
        bot.entity.velocity.x = 0;
      } else if (state.mode === "noPath") {
        bot.emit("path_update", { status: "noPath", path: [] });
      } else if (state.mode === "stuck") {
        bot.emit("path_reset", "stuck");
      }
    });
  }
  return { pkg: { pathfinder, Movements }, state };
}

// Bot boxed in by bedrock so Baritone can never reach (8, 1, 0).
function boxedWorld(x, y, z) {
  if (y === 0) return "stone";
  if (y >= 1 && y <= 3 && (Math.abs(x) === 2 || Math.abs(z) === 2) && Math.abs(x) <= 2 && Math.abs(z) <= 2) {
    return "bedrock";
  }
  if (y === 4 && Math.abs(x) <= 2 && Math.abs(z) <= 2) return "bedrock";
  return "air";
}

test("Failover: Baritone noPath hands the same goal to the stock engine and goto() resolves on its goal_reached", async () => {
  const { pkg, state } = createFakeStockPkg();
  const bot = createBot(boxedWorld, { stockPkg: pkg, pos: new Vec3(0.3, 1, 0.3) });
  const switches = [];
  bot.on("pathfinder_engine_switched", (info) => switches.push(info));
  const goal = new goals.GoalBlock(8, 1, 0);
  let rejected = null;
  let resolved = false;
  const p = bot.pathfinder.goto(goal).then(
    () => {
      resolved = true;
    },
    (e) => {
      rejected = e;
    },
  );
  bot.emit("physicsTick"); // baritone: noPath -> switch
  assert.equal(bot.pathfinder.getActiveEngine(), "stock");
  assert.equal(state.goals[state.goals.length - 1], goal, "same goal object handed over");
  assert.equal(switches[0].from, "baritone");
  assert.equal(switches[0].to, "stock");
  assert.equal(bot.pathfinder.goal, goal, "public goal unchanged");

  const vx = (bot.entity.velocity.x = 0.12);
  const px = bot.entity.position.x;
  bot.emit("physicsTick"); // stock reaches the goal
  assert.equal(state.sawSelf, true, "stock ticks with itself as bot.pathfinder");
  assert.ok(bot.pathfinder.isBaritone, "facade restored after the stock tick");
  assert.equal(bot.entity.position.x, px, "stock fullStop snap is undone (no teleport)");
  assert.equal(bot.entity.velocity.x, vx, "velocity is not zeroed");
  await p;
  await tick();
  assert.equal(rejected, null);
  assert.equal(resolved, true);
  assert.equal(bot.pathfinder.goal, null);
  assert.equal(bot.pathfinder.getActiveEngine(), "baritone");
});

test("Failover: when both engines report noPath the failure is passed through instead of ping-ponging", async () => {
  const { pkg, state } = createFakeStockPkg();
  state.mode = "noPath";
  const bot = createBot(boxedWorld, { stockPkg: pkg, pos: new Vec3(0.3, 1, 0.3) });
  const updates = [];
  bot.on("path_update", (r) => updates.push(r.status));
  bot.pathfinder.setGoal(new goals.GoalBlock(8, 1, 0));
  bot.emit("physicsTick"); // baritone noPath -> stock
  assert.equal(bot.pathfinder.getActiveEngine(), "stock");
  assert.deepEqual(updates, [], "baritone failure swallowed during hand-over");
  bot.emit("physicsTick"); // stock noPath: baritone already failed -> pass through
  assert.deepEqual(updates, ["noPath"]);
  for (let i = 0; i < 5; i++) bot.emit("physicsTick");
  assert.ok(bot.pathfinder.getEngineStats().totalSwitches <= 1);
});

test("Failover: repeated stuck resets on the stock engine switch back to Baritone, and a new goal starts on Baritone", async () => {
  const { pkg, state } = createFakeStockPkg();
  const bot = createBot(boxedWorld, { stockPkg: pkg, pos: new Vec3(0.3, 1, 0.3) });
  state.mode = "stuck";
  bot.pathfinder.setGoal(new goals.GoalBlock(8, 1, 0));
  bot.emit("physicsTick");
  assert.equal(bot.pathfinder.getActiveEngine(), "stock");
  await new Promise((r) => setTimeout(r, 1250)); // min interval between switches
  bot.emit("physicsTick"); // stuck #1
  bot.emit("physicsTick"); // stuck #2 -> pending switch
  bot.emit("physicsTick"); // switch applied
  assert.equal(bot.pathfinder.getActiveEngine(), "baritone");
  assert.equal(state.api.goal, null, "stock engine halted");

  // New goal while on stock: back to Baritone without goal_updated(null) noise.
  bot.pathfinder.switchEngine("manual");
  assert.equal(bot.pathfinder.getActiveEngine(), "stock");
  const updated = [];
  bot.on("goal_updated", (g) => updated.push(g));
  const next = new goals.GoalBlock(0, 1, 1);
  bot.pathfinder.setGoal(next);
  assert.equal(bot.pathfinder.getActiveEngine(), "baritone");
  assert.deepEqual(updated, [next]);
});

test("Failover keeps path ownership: a script cannot take the path from the AI while the stock engine drives", () => {
  const { pkg } = createFakeStockPkg();
  const bot = createBot(boxedWorld, { stockPkg: pkg, pos: new Vec3(0.3, 1, 0.3) });
  const aiGoal = new goals.GoalBlock(8, 1, 0);
  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(aiGoal));
  bot.emit("physicsTick");
  assert.equal(bot.pathfinder.getActiveEngine(), "stock");
  runWithPathOwner("GearUp", "script", () => bot.pathfinder.setGoal(new goals.GoalBlock(1, 1, 1)));
  runWithPathOwner("GearUp", "script", () => bot.pathfinder.stop());
  assert.equal(bot.pathfinder.goal, aiGoal);
  assert.equal(bot.pathfinder.getActiveEngine(), "stock");
  runWithPathOwner("AI", "ai", () => bot.pathfinder.stop());
  assert.equal(bot.pathfinder.goal, null);
  assert.equal(bot.pathfinder.getActiveEngine(), "baritone");
});

test("Failover with the real mineflayer-pathfinder package creates a working stock engine", () => {
  const bot = createBot(boxedWorld, { pos: new Vec3(0.3, 1, 0.3) });
  assert.equal(bot.pathfinder.hasFallbackEngine(), true);
  bot.pathfinder.setGoal(new goals.GoalBlock(8, 1, 0));
  bot.emit("physicsTick");
  assert.equal(bot.pathfinder.getActiveEngine(), "stock");
  assert.ok(bot.pathfinder.isBaritone, "Baritone stays the public API");
  // The mock bot has no prismarine-physics state, so the real stock engine
  // throws mid-tick: that must hand the goal back to Baritone, never crash.
  assert.doesNotThrow(() => {
    for (let i = 0; i < 4; i++) bot.emit("physicsTick");
  });
  assert.ok(bot.pathfinder.isBaritone);
  bot.pathfinder.setGoal(null);
  assert.equal(bot.pathfinder.getActiveEngine(), "baritone");
});

// --- Reach-based mining -------------------------------------------------------

// A tree: trunk at (3, 1..6, 0) on a grass floor.
function treeWorld(x, y, z) {
  if (y === 0) return "grass_block";
  if (x === 3 && z === 0 && y >= 1 && y <= 6) return "oak_log";
  return "air";
}

test("Mining reach: logs 1-4 blocks up the trunk are mineable from the ground 2.5m away; the top is not", () => {
  const bot = createBot(treeWorld, { pos: new Vec3(0.5, 1, 0.5) });
  for (const y of [1, 2, 3, 4]) {
    assert.equal(canMineFromHere(bot, new Vec3(3, y, 0)), true, `log at y=${y} in reach`);
  }
  assert.equal(canMineFromHere(bot, new Vec3(3, 7, 0)), false, "out of reach");
  const far = createBot(treeWorld, { pos: new Vec3(-6.5, 1, 0.5) });
  assert.equal(canMineFromHere(far, new Vec3(3, 1, 0)), false);
});

test("Mining reach: buried stone is not exposed, picks prefer reachable exposed blocks and never the block under our feet", () => {
  const world = (x, y, z) => {
    if (y <= 0) return "stone";
    if (x === 2 && z === 0 && y === 1) return "stone"; // exposed boulder
    return "air";
  };
  const bot = createBot(world, { pos: new Vec3(0.5, 1, 0.5) });
  assert.equal(isExposed(bot, new Vec3(0, -3, 0)), false);
  assert.equal(isExposed(bot, new Vec3(2, 1, 0)), true);
  const pick = pickMiningTarget(bot, [new Vec3(0, 0, 0), new Vec3(0, -3, 0), new Vec3(2, 1, 0)]);
  assert.deepEqual([pick.x, pick.y, pick.z], [2, 1, 0]);
  const g = miningGoalFor(bot, goals, new Vec3(2, 1, 0));
  assert.equal(g.constructor.name, "GoalMineBlock");
  const buried = miningGoalFor(bot, goals, new Vec3(0, -3, 0));
  assert.equal(buried.constructor.name, "GoalMineBlock");
  assert.equal(buried.allowBlocker, true);
  assert.equal(g.allowBlocker, false);
});

test("MiningSkipList skips a failed log and the logs above it, but keeps the lower ones", () => {
  const s = new MiningSkipList();
  s.skip(new Vec3(3, 5, 0));
  assert.equal(s.has(new Vec3(3, 5, 0)), true);
  assert.equal(s.has(new Vec3(3, 6, 0)), true);
  assert.equal(s.has(new Vec3(3, 4, 0)), false, "lower log still minable");
  assert.equal(s.has(new Vec3(4, 5, 0)), false, "neighbour column untouched");
});

test("AI Brain exposes objective, sub-objective with reason, module activity and engine switches to the prompt", () => {
  const brain = new AiBrain();
  brain.setGoal("Mine 5 oak_log", "Steve");
  brain.setSubObjective("Get within reach of oak_log at (3, 4, 0)", { reason: "2/5 mined" });
  brain.recordScriptActivity("GearUp", "Walking to oak_log at (1, 2, 3)");
  brain.recordEngineSwitch({ from: "baritone", to: "stock", reason: "baritone noPath", totalSwitches: 1 });
  brain.setAiObjective({ objective: "craft wooden tools", plan: "logs -> planks -> table" });
  const prompt = brain.buildBrainPromptSection(null, "Steve", []);
  assert.match(prompt, /Objective: Mine 5 oak_log \(for Steve\)/);
  assert.match(prompt, /Sub-objective \(doing now\): Get within reach of oak_log at \(3, 4, 0\) - because 2\/5 mined/);
  assert.match(prompt, /Module GearUp: .*Walking to oak_log/);
  assert.match(prompt, /Your own objective: craft wooden tools/);
  assert.match(prompt, /pathfinder switched to stock/);
  const snap = brain.getSnapshot();
  assert.equal(snap.subObjective, "Get within reach of oak_log at (3, 4, 0)");
  assert.equal(snap.pathfinder.engine, "stock");
  brain.clearScriptActivity("GearUp");
  assert.equal(brain.getSnapshot().scriptActivity.length, 0);
});

test("Mining goal: Baritone paths to a spot from which a log 4 blocks up the trunk can be broken", () => {
  const bot = createBot(treeWorld, { pos: new Vec3(-8.5, 1, 0.5) });
  const logPos = new Vec3(3, 4, 0);
  assert.equal(canMineFromHere(bot, logPos), false);
  const goal = miningGoalFor(bot, goals, logPos);
  let res = null;
  for (const step of bot.pathfinder.getPathFromTo(
    bot.pathfinder.movements,
    bot.entity.position,
    goal,
    { timeout: 4000, tickTimeout: 4000 },
  )) {
    res = step.result;
  }
  assert.equal(res.status, "success");
  const end = res.path[res.path.length - 1];
  bot.entity.position = new Vec3(Math.floor(end.x) + 0.5, Math.floor(end.y), Math.floor(end.z) + 0.5);
  assert.equal(canMineFromHere(bot, logPos), true, "end of path is within reach of the log");
  const feetToLog = bot.entity.position.distanceTo(logPos);
  assert.ok(feetToLog > 1.5, "no need to stand right next to the block");
});

test("Mining target stays locked: a slightly closer stone does not steal the block the bot is walking to", () => {
  const world = (x, y, z) => {
    if (y <= 0) return "grass_block";
    if (y === 1 && ((x === 10 && z === 2) || (x === 11 && z === 0))) return "stone";
    return "air";
  };
  const bot = createBot(world, { pos: new Vec3(0.5, 1, 0.5) });
  const near = new Vec3(10, 1, 2);
  const current = new Vec3(11, 1, 0);
  assert.deepEqual(pickMiningTarget(bot, [near, current]).toArray(), near.toArray());
  const kept = pickMiningTarget(bot, [near, current], () => true, { prefer: { x: 11, y: 1, z: 0 } });
  assert.deepEqual(kept.toArray(), current.toArray());
  const goal = miningGoalFor(bot, goals, current);
  assert.equal(goal.isEnd(new Vec3(8, 1, 0)), true, "4m away with line of sight is enough");
  assert.equal(goal.isEnd(new Vec3(0, 1, 0)), false, "out of reach");
  assert.equal(goal.isEnd(new Vec3(11, 2, 0)), false, "never on top of the target");
});

test("Buried stone 5 blocks under dirt: with digging allowed Baritone digs down to a spot it can mine from", () => {
  const world = (x, y, z) => {
    if (y <= 0) return "stone";
    if (y <= 4) return "dirt";
    return "air";
  };
  const bot = createBot(world, { pos: new Vec3(0.5, 5, 0.5) });
  const target = new Vec3(2, 0, 0);
  assert.equal(isExposed(bot, target), false);
  const { GoalMineBlock } = require("../src/js/miningReach");
  const goal = new GoalMineBlock(bot, target, { allowBlocker: true });
  const run = () => {
    let res = null;
    for (const step of bot.pathfinder.getPathFromTo(bot.pathfinder.movements, bot.entity.position, goal, {
      timeout: 4000,
      tickTimeout: 4000,
    })) {
      res = step.result;
    }
    return res;
  };
  bot.pathfinder.movements.canDig = false;
  const noDig = run();
  assert.notEqual(noDig.status, "success", "cannot reach it without digging");
  bot.pathfinder.movements.canDig = true;
  const res = run();
  assert.equal(res.status, "success");
  const end = res.path[res.path.length - 1];
  bot.entity.position = new Vec3(Math.floor(end.x) + 0.5, Math.floor(end.y), Math.floor(end.z) + 0.5);
  assert.ok(require("../src/js/miningReach").eyeDistance(bot, target) <= 4.3, "ends within reach");
});

test("Pit escape: walking only gives noPath out of a 5-deep 1x1 pit; climb mode (dig + pillar with junk) reaches a surface log", () => {
  const { setClimbMode, isUnderCover } = require("../src/js/miningReach");
  // Stone up to y=5, a 1x1 shaft at x=0,z=0 down to y=1, a log on the surface.
  const world = (x, y, z) => {
    if (y <= 0) return "stone";
    if (x === 0 && z === 0 && y >= 1 && y <= 5) return "air";
    if (y <= 5) return "stone";
    if (x === 8 && z === 0 && y >= 6 && y <= 9) return "oak_log";
    return "air";
  };
  const bot = createBot(world, { pos: new Vec3(0.5, 1, 0.5) });
  const dirt = mcData.itemsByName.dirt;
  bot.inventory.items = () => [{ type: dirt.id, name: "dirt", count: 32 }];
  const target = new Vec3(8, 6, 0);
  const goal = miningGoalFor(bot, goals, target);
  const run = () => {
    let res = null;
    for (const step of bot.pathfinder.getPathFromTo(bot.pathfinder.movements, bot.entity.position, goal, {
      timeout: 4000,
      tickTimeout: 4000,
    })) {
      res = step.result;
    }
    return res;
  };
  assert.equal(isUnderCover(bot), false, "an open shaft has sky above");
  setClimbMode(bot, false);
  assert.notEqual(run().status, "success", "cannot walk out of the shaft");
  assert.equal(setClimbMode(bot, true), true);
  assert.equal(bot.pathfinder.movements.allow1by1towers, true);
  assert.ok(!bot.pathfinder.movements.scafoldingBlocks.includes(mcData.itemsByName.oak_planks.id), "never pillars with planks");
  const res = run();
  assert.equal(res.status, "success");
  const end = res.path[res.path.length - 1];
  assert.ok(end.y >= 3, `climbs up (ends at y=${end.y})`);
  setClimbMode(bot, false);
  assert.equal(bot.pathfinder.movements.canDig, false);
});
