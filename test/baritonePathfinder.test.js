const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { Vec3 } = require("vec3");

const { loadLibraries } = require("../src/js/runtime");
const {
  ActionCosts,
  BacktrackMemory,
  BaritoneAStar,
  BaritoneMovements,
  Move,
  injectBaritonePathfinder,
  runWithPathOwner,
  splicePaths,
  areGoalsEquivalent,
} = require("../src/js/baritone");

const libs = loadLibraries();
const mcData261 = libs.mcData("26.1");
const { goals } = libs;

// Helper: creates a lightweight synthetic 3D Minecraft world + mock bot backed by real mcData 26.1 registry
function createMockWorldBot(blockMapFn, { pos = new Vec3(0.5, 1, 0.5), food = 20, inventory = [] } = {}) {
  const bot = new EventEmitter();
  bot.version = "26.1";
  bot.registry = mcData261;
  bot.game = { minY: -64 };
  bot.food = food;
  bot.entity = {
    position: pos.clone(),
    velocity: new Vec3(0, 0, 0),
    onGround: true,
    isInWater: false,
    yaw: 0,
    pitch: 0,
    effects: {},
  };
  bot.entities = {};
  bot.inventory = {
    slots: new Array(46).fill(null),
    items: () => inventory,
  };
  bot.controlState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false,
  };
  bot._controls = bot.controlState;
  bot.setControlState = (k, v) => {
    bot.controlState[k] = Boolean(v);
  };
  bot.clearControlStates = () => {
    for (const k of Object.keys(bot.controlState)) bot.controlState[k] = false;
  };
  bot.look = (yaw, pitch) => {
    bot.entity.yaw = yaw;
    bot.entity.pitch = pitch;
  };
  bot.lookAt = () => {};
  bot.stopDigging = () => {};

  const blocksByName = mcData261.blocksByName;

  bot.blockAt = (vec) => {
    if (!vec) return null;
    const x = Math.floor(vec.x);
    const y = Math.floor(vec.y);
    const z = Math.floor(vec.z);
    const spec = blockMapFn(x, y, z);
    if (spec === null) return null; // unloaded chunk
    const name = typeof spec === "string" ? spec : spec?.name || "air";
    const props = typeof spec === "object" && spec?.props ? spec.props : {};
    const def = blocksByName[name] || blocksByName.air;
    const isEmpty =
      def.boundingBox === "empty" ||
      name === "air" ||
      name === "water" ||
      name === "lava" ||
      name === "fire" ||
      name === "ladder" ||
      name === "vine" ||
      name === "sweet_berry_bush";
    const isOpenGate = name.endsWith("_fence_gate") && props.open === true;
    const shapes =
      isEmpty || isOpenGate
        ? []
        : name.includes("fence") && !name.includes("gate")
          ? [[0.375, 0, 0.375, 0.625, 1.5, 0.625]]
          : [[0, 0, 0, 1, 1, 1]];

    return {
      type: def.id,
      name: def.name,
      boundingBox: isEmpty ? "empty" : "block",
      position: new Vec3(x, y, z),
      shapes,
      metadata: typeof spec === "object" && typeof spec.metadata === "number" ? spec.metadata : 0,
      getProperties: () => props,
      digTime: () => (def.diggable === false ? Infinity : 250),
    };
  };

  injectBaritonePathfinder(bot);
  return bot;
}

test("ActionCosts uses accurate Minecraft tick physics and monotonic gravity fall table", () => {
  assert.ok(ActionCosts.SPRINT_ONE_BLOCK_COST < ActionCosts.WALK_ONE_BLOCK_COST);
  assert.ok(ActionCosts.WALK_ONE_BLOCK_COST < ActionCosts.WALK_ONE_IN_WATER_COST);
  assert.ok(ActionCosts.WALK_ONE_BLOCK_COST < ActionCosts.WALK_ONE_OVER_SOUL_SAND_COST);

  // Falling 1 -> 2 -> 4 -> 10 blocks should increase ticks monotonically with gravity acceleration
  const f1 = ActionCosts.fallCost(1);
  const f2 = ActionCosts.fallCost(2);
  const f4 = ActionCosts.fallCost(4);
  const f10 = ActionCosts.fallCost(10);
  assert.ok(f1 > 4 && f1 < 7, `1-block fall ~5 ticks, got ${f1}`);
  assert.ok(f2 > f1 && f4 > f2 && f10 > f4);
  // Acceleration: falling from 4->10 (6 blocks) takes less time per block than 0->1
  assert.ok((f10 - f4) / 6 < f1);

  const est = ActionCosts.estimateTicksBetween(0, 0, 0, 10, 0, 0);
  assert.ok(Math.abs(est - 10 * ActionCosts.SPRINT_ONE_BLOCK_COST) < 0.01);
});

test("BaritoneMovements forbids illegal double-solid and cactus/fence diagonal corner squeezes", () => {
  // Flat floor at y=0, two stone pillars at (1,1,0)/(1,2,0) and (0,1,1)/(0,2,1) forming a tight diagonal gap
  const bot = createMockWorldBot((x, y, z) => {
    if (y === 0) return "stone";
    if (y >= 1 && y <= 2) {
      if (x === 1 && z === 0) return "stone";
      if (x === 0 && z === 1) return "stone";
    }
    return "air";
  });

  const m = new BaritoneMovements(bot);
  m.canDig = false;
  m.allow1by1towers = false;
  m.scafoldingBlocks = [];
  m.prepareForSearch();

  const start = new Move(0, 1, 0, 0, 0);
  const neighbors = m.getNeighbors(start);
  const squeezedDiag = neighbors.find((n) => n.x === 1 && n.y === 1 && n.z === 1);
  assert.equal(
    squeezedDiag,
    undefined,
    "Must NEVER squeeze diagonally between two solid corner blocks",
  );

  // Single cactus on one diagonal corner must also forbid diagonal move
  const botCactus = createMockWorldBot((x, y, z) => {
    if (y === 0) return x === 1 && z === 0 ? "sand" : "stone";
    if (y === 1 && x === 1 && z === 0) return "cactus";
    return "air";
  });
  const mCactus = new BaritoneMovements(botCactus);
  mCactus.canDig = false;
  mCactus.prepareForSearch();
  const cNeighbors = mCactus.getNeighbors(new Move(0, 1, 0, 0, 0));
  assert.equal(
    cNeighbors.find((n) => n.x === 1 && n.y === 1 && n.z === 1),
    undefined,
    "Must NEVER clip diagonally past a cactus",
  );
});

test("Baritone avoidBreaking protects gravity blocks (gravel/red_sand/anvil), liquids, and valuable chests", () => {
  const bot = createMockWorldBot((x, y, z) => {
    if (y === 0) return "stone";
    // Wall along x=2:
    // z=0 has gravel at y=3 (above head) -> unsafe to break y=2
    // z=1 has lava at x=3,y=1 -> unsafe to break x=2,y=1
    // z=2 is a chest -> valuable, must not break
    // z=3 is plain stone -> safe to break!
    if (x === 2 && (y === 1 || y === 2)) {
      if (z === 2 && y === 1) return "chest";
      return "stone";
    }
    if (x === 2 && y === 3 && z === 0) return "gravel";
    if (x === 3 && y === 1 && z === 1) return "lava";
    return "air";
  });

  const m = new BaritoneMovements(bot);
  m.canDig = true;
  m.prepareForSearch();

  assert.equal(m.safeToBreak(m.getBlock(new Vec3(2, 2, 0))), false, "Should not mine under gravel");
  assert.equal(m.safeToBreak(m.getBlock(new Vec3(2, 1, 1))), false, "Should not mine next to lava");
  assert.equal(m.safeToBreak(m.getBlock(new Vec3(2, 1, 2))), false, "Should not break chests");
  assert.equal(m.safeToBreak(m.getBlock(new Vec3(2, 1, 3))), true, "Plain stone should be safe to break");
});

test("Baritone avoidAdjacent routes away from cactus walls when open space is available", () => {
  // Corridor x=0..6, z=0..2. Cactus placed at (3, 1, -1) right next to z=0 lane.
  const bot = createMockWorldBot((x, y, z) => {
    if (x < -1 || x > 8 || z < -2 || z > 3) return "stone";
    if (y === 0) return "stone";
    if (x === 3 && y === 1 && z === -1) return "cactus";
    return "air";
  });

  const m = new BaritoneMovements(bot);
  m.canDig = false;
  m.scafoldingBlocks = [];
  bot.pathfinder.setMovements(m);

  const res = bot.pathfinder.getPathTo(m, new goals.GoalBlock(6, 1, 0), 2000);
  assert.equal(res.status, "success");
  const huggedCactus = res.path.some(
    (n) => Math.floor(n.x) === 3 && Math.floor(n.z) === 0,
  );
  assert.equal(
    huggedCactus,
    false,
    "A* should step 1 block away from adjacent cactus at (3,1,-1)",
  );
});

test("Baritone parkour crosses a 2-block chasm safely and refuses takeoff from soul sand", () => {
  // Bridge along z=0: solid at x=0..2 and x=5..7, 2-block air chasm at x=3..4
  const bot = createMockWorldBot((x, y, z) => {
    if (z !== 0) return "air";
    if (y === 0 && ((x >= 0 && x <= 2) || (x >= 5 && x <= 7))) return "stone";
    return "air";
  });

  const m = new BaritoneMovements(bot);
  m.canDig = false;
  m.scafoldingBlocks = [];
  m.allowParkour = true;
  m.allowSprinting = true;
  bot.pathfinder.setMovements(m);

  const res = bot.pathfinder.getPathTo(m, new goals.GoalBlock(6, 1, 0), 2000);
  assert.equal(res.status, "success");
  assert.ok(
    res.path.some((n) => n.parkour === true),
    "Should use a parkour jump across the 2-block gap",
  );

  // Replace takeoff block (2,0,0) with soul_sand -> must refuse risky soul-sand parkour!
  const botSoul = createMockWorldBot((x, y, z) => {
    if (z !== 0) return "air";
    if (y === 0 && x === 2) return "soul_sand";
    if (y === 0 && ((x >= 0 && x <= 1) || (x >= 5 && x <= 7))) return "stone";
    return "air";
  });
  const mSoul = new BaritoneMovements(botSoul);
  mSoul.canDig = false;
  mSoul.scafoldingBlocks = [];
  mSoul.allowParkour = true;
  mSoul.prepareForSearch();
  const soulMoves = mSoul.getNeighbors(new Move(2, 1, 0, 0, 0));
  assert.equal(
    soulMoves.some((n) => n.parkour),
    false,
    "Should refuse parkour takeoff from soul_sand",
  );
});

test("Baritone wooden door handling opens closed doors and walks straight through open doors", () => {
  // Wall at x=2 with a closed oak_door at (2, 1..2, 0)
  const makeDoorBot = (isOpen) =>
    createMockWorldBot((x, y, z) => {
      if (y === 0) return "stone";
      if (x === 2 && y >= 1 && y <= 3) {
        if (z === 0 && (y === 1 || y === 2)) {
          return { name: "oak_door", props: { open: isOpen } };
        }
        return "stone";
      }
      return "air";
    });

  const botClosed = makeDoorBot(false);
  const mClosed = new BaritoneMovements(botClosed);
  mClosed.canDig = false;
  mClosed.canOpenDoors = true;
  const resClosed = botClosed.pathfinder.getPathTo(
    mClosed,
    new goals.GoalBlock(4, 1, 0),
    2000,
  );
  assert.equal(resClosed.status, "success");
  const doorStep = resClosed.path.find((n) =>
    n.toPlace.some((p) => p.useOne && p.isDoor),
  );
  assert.ok(doorStep, "Closed wooden door should include a single useOne activation");

  const botOpen = makeDoorBot(true);
  const mOpen = new BaritoneMovements(botOpen);
  mOpen.canDig = false;
  mOpen.canOpenDoors = true;
  const resOpen = botOpen.pathfinder.getPathTo(
    mOpen,
    new goals.GoalBlock(4, 1, 0),
    2000,
  );
  assert.equal(resOpen.status, "success");
  const unwantedClick = resOpen.path.find((n) => n.toPlace.length > 0);
  assert.equal(
    unwantedClick,
    undefined,
    "Already-open wooden door must NOT be clicked (would close it!)",
  );
});

test("BacktrackMemory forces A* to detour around recently stuck or failed nodes", () => {
  // Two corridors from (0,1,0) to (6,1,0): direct lane z=0 and side lane z=2 (sealed ceiling & outer walls)
  const bot = createMockWorldBot((x, y, z) => {
    if (x < 0 || x > 6 || z < 0 || z > 2) return "stone";
    if (y === 0 || y === 3) return "stone";
    if (y >= 1 && y <= 2 && z === 1 && x >= 1 && x <= 5) return "stone"; // divider wall
    return "air";
  });

  const m = new BaritoneMovements(bot);
  m.canDig = false;
  m.scafoldingBlocks = [];
  bot.pathfinder.setMovements(m);

  const first = bot.pathfinder.getPathTo(m, new goals.GoalBlock(6, 1, 0), 2000);
  assert.equal(first.status, "success");
  assert.ok(
    first.path.some((n) => Math.floor(n.x) === 3 && Math.floor(n.z) === 0),
    "Initially chooses the shorter direct z=0 lane",
  );

  // Penalize the stuck node in z=0 lane
  bot.pathfinder.penalizeNode(new Vec3(3, 1, 0), 120);
  const second = bot.pathfinder.getPathTo(m, new goals.GoalBlock(6, 1, 0), 2000);
  assert.equal(second.status, "success");
  assert.equal(
    second.path.some((n) => Math.floor(n.x) === 3 && Math.floor(n.z) === 0),
    false,
    "After penalizing (3,1,0), A* should detour through z=2 lane",
  );
  assert.ok(
    second.path.some((n) => Math.floor(n.z) === 2),
    "Detour should travel along z=2 corridor",
  );
});

test("BaritoneAStar multi-coefficient bestSoFar returns progress segment on node/time budget limit", () => {
  // Open flat plane, goal far away at x=400, cap maxNodes=90 so search returns timeout/segment
  const bot = createMockWorldBot((x, y, z) => (y === 0 ? "stone" : "air"));
  const m = new BaritoneMovements(bot);
  m.canDig = false;
  m.scafoldingBlocks = [];
  m.prepareForSearch();

  const astar = new BaritoneAStar(
    new Move(0, 1, 0, 0, 0),
    m,
    new goals.GoalBlock(400, 1, 0),
    2000,
    2000, // generous per-tick budget so only maxNodes ends the search (no load flakiness)
    -1,
    { maxNodes: 90, primaryTimeout: 2000 },
  );
  const res = astar.compute();
  assert.equal(res.status, "timeout");
  assert.equal(res.isSegment, true);
  assert.ok(res.path.length >= 5, "Segment should advance at least MIN_DIST_PATH blocks");
  const last = res.path[res.path.length - 1];
  assert.ok(last.x > 4, "Segment should make real forward progress toward x=400");
});

test("splicePaths stitches overlapping long-distance path segments seamlessly", () => {
  const seg1 = [
    new Move(1, 1, 0, 0, 4),
    new Move(2, 1, 0, 0, 4),
    new Move(3, 1, 0, 0, 4),
    new Move(4, 1, 0, 0, 4),
    new Move(5, 1, 0, 0, 4),
  ];
  const seg2 = [
    new Move(3, 1, 0, 0, 4),
    new Move(4, 1, 0, 0, 4),
    new Move(5, 1, 1, 0, 4),
    new Move(6, 1, 1, 0, 4),
    new Move(7, 1, 1, 0, 4),
  ];
  const merged = splicePaths(seg1, seg2);
  assert.deepEqual(
    merged.map((n) => `${n.x},${n.y},${n.z}`),
    ["1,1,0", "2,1,0", "3,1,0", "4,1,0", "5,1,1", "6,1,1", "7,1,1"],
  );
});

test("BaritonePathfinder legalStop never teleports X/Z, deduplicates goals, gates sprint on food, and swims smartly", () => {
  const bot = createMockWorldBot(
    (x, y, z) => (y === 0 ? "stone" : "air"),
    { pos: new Vec3(0.18, 1, 0.82), food: 4 },
  );
  bot.entity.velocity.set(0.25, 0.1, -0.15);

  const m = new BaritoneMovements(bot);
  m.canDig = false;
  m.scafoldingBlocks = [];
  bot.pathfinder.setMovements(m);

  let resetCount = 0;
  bot.on("path_reset", () => {
    resetCount += 1;
  });

  const g1 = new goals.GoalBlock(5, 1, 0);
  bot.pathfinder.setGoal(g1, false);
  // Run one physicsTick to compute path & drive controls
  bot.emit("physicsTick");
  assert.equal(bot.pathfinder.isMoving(), true);
  // Food is 4 (<= 6), so sprint MUST be false!
  assert.equal(bot._controls.sprint, false, "Must not sprint when food <= 6");

  // Re-issuing an equivalent GoalBlock must NOT trigger path_reset, while updating reference
  const g2 = new goals.GoalBlock(5, 1, 0);
  assert.equal(areGoalsEquivalent(g1, g2), true);
  const resetsBefore = resetCount;
  bot.pathfinder.setGoal(g2, false);
  assert.equal(resetCount, resetsBefore, "Equivalent goal must not thrash/reset active path");
  assert.equal(bot.pathfinder.goal, g2, "bot.pathfinder.goal reference should stay synced");

  // Stopping must NOT teleport position.x/z or wipe velocity!
  bot.pathfinder.setGoal(null);
  assert.equal(bot.entity.position.x, 0.18, "legalStop must NEVER teleport X");
  assert.equal(bot.entity.position.z, 0.82, "legalStop must NEVER teleport Z");
  assert.equal(bot.entity.velocity.x, 0.25, "legalStop must NEVER wipe velocity");

  // Smart water navigation: must NOT hold jump when ceiling is directly overhead!
  const waterBot = createMockWorldBot(
    (x, y, z) => {
      if (y === 0) return "stone";
      if (y === 3) return "stone"; // solid ceiling above head in water
      if (y === 1 || y === 2) return "water";
      return "air";
    },
    { pos: new Vec3(0.5, 1, 0.5), food: 20 },
  );
  waterBot.entity.isInWater = true;
  const mw = new BaritoneMovements(waterBot);
  mw.canDig = false;
  mw.scafoldingBlocks = [];
  waterBot.pathfinder.setMovements(mw);
  waterBot.pathfinder.setGoal(new goals.GoalBlock(4, 1, 0), false);
  waterBot.emit("physicsTick");
  assert.equal(
    waterBot.controlState.jump,
    false,
    "In water under a solid ceiling, must NOT blindly hold jump and head-bang ceiling",
  );
});

// --- Path ownership: AI, GearUp and other scripts sharing one pathfinder ---------------

function flatBot() {
  const bot = createMockWorldBot((x, y, z) => (y === 0 ? "stone" : "air"));
  const m = new BaritoneMovements(bot);
  m.canDig = false;
  m.scafoldingBlocks = [];
  bot.pathfinder.setMovements(m);
  return bot;
}

const tick = () => new Promise((r) => setImmediate(r));

test("Path ownership: the AI takes the pathfinder from GearUp, GearUp cannot fight back, and its route resumes afterwards", async () => {
  const bot = flatBot();
  const gearGoal = new goals.GoalBlock(8, 1, 0);
  const aiGoal = new goals.GoalBlock(0, 1, 8);
  const denied = [];
  bot.on("path_denied", (who, holder) => denied.push([who, holder]));

  runWithPathOwner("GearUp", "script", () => bot.pathfinder.setGoal(gearGoal));
  assert.equal(bot.pathfinder.goal, gearGoal);
  assert.equal(bot.pathfinder.getPathOwner(), "GearUp");

  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(aiGoal));
  assert.equal(bot.pathfinder.goal, aiGoal, "AI preempts the script");
  assert.equal(bot.pathfinder.getPathOwner(), "AI");

  // The script keeps issuing goals and stop requests; none of it may disturb the AI.
  runWithPathOwner("GearUp", "script", () => bot.pathfinder.stop());
  runWithPathOwner("GearUp", "script", () => bot.pathfinder.setGoal(gearGoal));
  bot.emit("physicsTick");
  assert.equal(bot.pathfinder.goal, aiGoal);
  assert.equal(bot.pathfinder.isMoving(), true, "AI path keeps running");
  assert.ok(denied.length >= 1 && denied[0][1] === "AI");

  // AI finishes: GearUp's latest goal is resumed without GearUp having to retry.
  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(null));
  await tick();
  await tick();
  assert.equal(bot.pathfinder.goal, gearGoal, "GearUp resumes after the AI is done");
  assert.equal(bot.pathfinder.getPathOwner(), "GearUp");
});

test("Path ownership: scripts of equal priority still replace each other, and unattributed helpers act for the holder", () => {
  const bot = flatBot();
  const a = new goals.GoalBlock(6, 1, 0);
  const b = new goals.GoalBlock(0, 1, 6);
  runWithPathOwner("Mine", "script", () => bot.pathfinder.setGoal(a));
  runWithPathOwner("GearUp", "script", () => bot.pathfinder.setGoal(b));
  assert.equal(bot.pathfinder.goal, b);

  // Setback recovery / the panel's Stop button carry no owner; they act for whoever holds the path.
  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(a));
  bot.pathfinder.setGoal(null);
  assert.equal(bot.pathfinder.goal, null, "unattributed stop is honoured");
  // A helper that clears and restores a goal keeps the holder's claim for a moment...
  runWithPathOwner("GearUp", "script", () => bot.pathfinder.setGoal(b));
  assert.equal(bot.pathfinder.goal, null, "claim survives a helper's clear/restore window");
  bot.pathfinder.setGoal(a);
  assert.equal(bot.pathfinder.goal, a, "...and the helper can restore the holder's goal");
  // ...and is released for good once the owner clears the goal itself.
  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(null));
  runWithPathOwner("GearUp", "script", () => bot.pathfinder.setGoal(b));
  assert.equal(bot.pathfinder.goal, b, "lease is free again after an explicit release");
});

test("Path ownership: stopping a displaced script preserves the current script's goal", () => {
  const bot = flatBot();
  const mineGoal = new goals.GoalBlock(6, 1, 0);
  const gearGoal = new goals.GoalBlock(0, 1, 6);
  runWithPathOwner("Mine", "script", () => bot.pathfinder.setGoal(mineGoal));
  runWithPathOwner("GearUp", "script", () => bot.pathfinder.setGoal(gearGoal));
  runWithPathOwner("Mine", "script", () => bot.pathfinder.setGoal(null));
  assert.equal(bot.pathfinder.goal, gearGoal);
  assert.equal(bot.pathfinder.getPathOwner(), "GearUp");
});

test("Path ownership: a held-back goto waits for the AI instead of failing, then runs", async () => {
  const bot = flatBot();
  const aiGoal = new goals.GoalBlock(0, 1, 8);
  const gearGoal = new goals.GoalBlock(8, 1, 0);
  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(aiGoal));

  let settled = false;
  const pending = runWithPathOwner("GearUp", "script", () =>
    bot.pathfinder.goto(gearGoal).then(
      () => (settled = "reached"),
      (e) => (settled = e.message),
    ),
  );
  await tick();
  assert.equal(settled, false, "goto waits while the AI owns the path");
  assert.equal(bot.pathfinder.goal, aiGoal);

  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(null));
  await tick();
  await tick();
  assert.equal(bot.pathfinder.goal, gearGoal, "waiting goto starts once the AI is done");
  bot.pathfinder.setGoal(null);
  void pending;
});

test("Path ownership: a cancelled waiting goto cannot resume after the AI", async () => {
  const bot = flatBot();
  const aiGoal = new goals.GoalBlock(0, 1, 8);
  const gearGoal = new goals.GoalBlock(8, 1, 0);
  const controller = new AbortController();
  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(aiGoal));
  const pending = runWithPathOwner(
    "GearUp",
    "script",
    () => bot.pathfinder.goto(gearGoal),
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(bot.pathfinder.goal, aiGoal);
  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(null));
  await tick();
  assert.equal(bot.pathfinder.goal, null);
});

test("Path ownership: aborting an active goto releases its goal", async () => {
  const bot = flatBot();
  const goal = new goals.GoalBlock(8, 1, 0);
  const controller = new AbortController();
  const pending = runWithPathOwner(
    "Mine",
    "script",
    () => bot.pathfinder.goto(goal),
    controller.signal,
  );
  assert.equal(bot.pathfinder.goal, goal);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(bot.pathfinder.goal, null);
});

test("Path ownership: a cancelled preempted goal is not resumed", async () => {
  const bot = flatBot();
  const controller = new AbortController();
  const gearGoal = new goals.GoalBlock(8, 1, 0);
  const aiGoal = new goals.GoalBlock(0, 1, 8);
  runWithPathOwner(
    "GearUp",
    "script",
    () => bot.pathfinder.setGoal(gearGoal),
    controller.signal,
  );
  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(aiGoal));
  controller.abort();
  runWithPathOwner("AI", "ai", () => bot.pathfinder.setGoal(null));
  await tick();
  assert.equal(bot.pathfinder.goal, null);
});
