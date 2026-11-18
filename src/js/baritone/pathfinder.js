// Baritone / Fabritone-inspired PathExecutor & drop-in Mineflayer pathfinder plugin.
// Improvements over stock mineflayer-pathfinder:
// - Legal anti-cheat-safe stopping (never teleports X/Z position or wipes knockback velocity)
// - Smart goal deduplication (prevents path thrashing when scripts re-issue identical goals)
// - Long-distance segmented pathing with early path splicing (splicePaths)
// - Smart sprint gating (food > 6, anti-cheat cooldown, turn-angle check, hazard awareness)
// - Smart water navigation (surfaces when rising/swimming, dives when descending, avoids ceiling head-banging)
// - Smart ladder/vine climbing and safe wooden door/gate opening (checks live `open` state)
// - Integrated BacktrackMemory: stuck nodes & failed dig/place edges are penalized so replans detour cleanly

const { performance } = require("perf_hooks");
const { AsyncLocalStorage } = require("async_hooks");
const { Vec3 } = require("vec3");
const { BaritoneAStar } = require("./astar");
const { BacktrackMemory } = require("./calculationContext");
const { BaritoneMovements, Move, isDoorOrGateOpen } = require("./movements");

let PhysicsClass = null;
let LockClass = null;
let gotoUtil = null;
let interactableBlocks = [];

function loadPathfinderHelpers() {
  if (PhysicsClass) return;
  try {
    PhysicsClass = require("mineflayer-pathfinder/lib/physics");
    LockClass = require("mineflayer-pathfinder/lib/lock");
    gotoUtil = require("mineflayer-pathfinder/lib/goto");
    interactableBlocks = require("mineflayer-pathfinder/lib/interactable.json");
  } catch (_) {
    // Fallback lightweight Lock if mineflayer-pathfinder internals are unavailable in unit tests
    LockClass = class SimpleLock {
      constructor() {
        this.locked = false;
      }
      tryAcquire() {
        if (this.locked) return false;
        this.locked = true;
        return true;
      }
      release() {
        this.locked = false;
      }
    };
  }
}

function areGoalsEquivalent(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.constructor !== b.constructor) return false;
  if (a.entity || b.entity) {
    return a.entity === b.entity && a.rangeSq === b.rangeSq;
  }
  const keys = ["x", "y", "z", "rangeSq", "range", "xz", "yMin", "yMax"];
  let compared = false;
  for (const k of keys) {
    if (k in a || k in b) {
      compared = true;
      if (a[k] !== b[k]) return false;
    }
  }
  return compared;
}

// Baritone-style path splicing: stitches `nextSegment` onto `currentPath` at the earliest
// matching coordinate so the bot transitions smoothly across long-distance segments without stopping.
function splicePaths(currentPath, nextSegment) {
  if (!Array.isArray(nextSegment) || nextSegment.length === 0) {
    return Array.isArray(currentPath) ? currentPath : [];
  }
  if (!Array.isArray(currentPath) || currentPath.length === 0) {
    return nextSegment.slice();
  }

  const nextIndexByHash = new Map();
  for (let j = 0; j < nextSegment.length; j++) {
    const n = nextSegment[j];
    const key = `${Math.floor(n.x)},${Math.floor(n.y)},${Math.floor(n.z)}`;
    if (!nextIndexByHash.has(key)) nextIndexByHash.set(key, j);
  }

  // Find earliest overlap in currentPath (preserving any pending dig/place nodes before it)
  for (let i = 0; i < currentPath.length; i++) {
    const c = currentPath[i];
    const key = `${Math.floor(c.x)},${Math.floor(c.y)},${Math.floor(c.z)}`;
    if (nextIndexByHash.has(key)) {
      const j = nextIndexByHash.get(key);
      return [...currentPath.slice(0, i), ...nextSegment.slice(j)];
    }
  }

  // No direct overlap: append if contiguous (within 2 blocks of tail)
  const tail = currentPath[currentPath.length - 1];
  const head = nextSegment[0];
  const distSq =
    (tail.x - head.x) ** 2 + (tail.y - head.y) ** 2 + (tail.z - head.z) ** 2;
  if (distSq <= 4.5) {
    return [...currentPath, ...nextSegment];
  }
  return nextSegment.slice();
}

function getTurnAngleRad(p, n1, n2) {
  if (!p || !n1 || !n2) return 0;
  const v1x = n1.x - p.x;
  const v1z = n1.z - p.z;
  const v2x = n2.x - n1.x;
  const v2z = n2.z - n1.z;
  const m1 = Math.hypot(v1x, v1z);
  const m2 = Math.hypot(v2x, v2z);
  if (m1 < 0.05 || m2 < 0.05) return 0;
  const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1z * v2z) / (m1 * m2)));
  return Math.acos(dot);
}

// --- Path ownership -----------------------------------------------------------
// Several things drive the one pathfinder at once (GearUp and other scripts, the AI
// agent, the panel). Each caller can run inside runWithPathOwner(name, priority, fn).
// A higher-priority owner (the AI answering a player) takes the path over; a
// lower-priority one (a script) is held back instead of fighting for the goal, and
// its latest goal is resumed when the higher-priority owner is done.
const ownerStore = new AsyncLocalStorage();
const PATH_PRIORITY = { system: 1, script: 1, ai: 2, user: 3 };

function runWithPathOwner(owner, priority, fn) {
  const prio =
    typeof priority === "number"
      ? priority
      : PATH_PRIORITY[String(priority || "").toLowerCase()] || 1;
  return ownerStore.run({ owner: String(owner || "system"), priority: prio }, fn);
}

const LEASE_TTL_MS = 45000; // a static goal that never finishes stops blocking after this
const LEASE_GRACE_MS = 4000; // internal helpers may clear and restore a goal briefly
const DEFERRED_TTL_MS = 60000;
const BUSY_WAIT_MS = 30000;

function injectBaritonePathfinder(bot) {
  loadPathfinderHelpers();

  // Remove any previously registered stock monitorMovement listener before injecting ours
  if (bot._mcbpBaritoneMonitor && typeof bot.removeListener === "function") {
    bot.removeListener("physicsTick", bot._mcbpBaritoneMonitor);
  }
  if (bot._mcbpStockPathfinderMonitor && typeof bot.removeListener === "function") {
    bot.removeListener("physicsTick", bot._mcbpStockPathfinderMonitor);
  }
  // If stock mineflayer-pathfinder was loaded earlier, detach its `monitorMovement` listener
  if (typeof bot.listeners === "function") {
    for (const fn of bot.listeners("physicsTick")) {
      if (fn && fn.name === "monitorMovement") {
        bot.removeListener("physicsTick", fn);
      }
    }
  }

  const registry = bot.registry || {};
  const blocksByName = registry.blocksByName || {};
  const waterType = blocksByName.water?.id ?? -1;
  const ladderId = blocksByName.ladder?.id ?? -1;
  const vineId = blocksByName.vine?.id ?? -1;

  const backtrackMemory = new BacktrackMemory();
  let stateMovements = new BaritoneMovements(bot);
  stateMovements.context.backtrackMemory = backtrackMemory;

  let stateGoal = null;
  let astarContext = null;
  let astarPartial = false;
  let dynamicGoal = false;
  let path = [];
  let pathUpdated = false;
  let pathIsSegment = false;
  let digging = false;
  let placing = false;
  let placingBlock = null;
  let lastNodeTime = performance.now();
  let returningPos = null;
  let stopPathing = false;
  let lastSpliceAttemptAt = 0;

  const physics = PhysicsClass && bot.registry ? new PhysicsClass(bot) : null;
  const lockPlaceBlock = new LockClass();
  const lockEquipItem = new LockClass();
  const lockUseBlock = new LockClass();

  bot.pathfinder = {};
  bot.pathfinder.isBaritone = true;
  bot.pathfinder.backtrackMemory = backtrackMemory;

  bot.pathfinder.thinkTimeout = 3500; // failure timeout ms
  bot.pathfinder.primaryTimeout = 650; // Baritone primary segment timeout ms
  bot.pathfinder.tickTimeout = 35; // ms per tick (keeps event loop & keepalives snappy)
  bot.pathfinder.searchRadius = -1;
  bot.pathfinder.enablePathShortcut = false;
  bot.pathfinder.LOSWhenPlacingBlocks = true;

  bot.pathfinder.penalizeNode = (pos, amount = 45, ttlMs = 25000) => {
    backtrackMemory.penalizeNode(pos, amount, ttlMs);
  };
  bot.pathfinder.penalizeEdge = (fromPos, toPos, amount = 65, ttlMs = 25000) => {
    backtrackMemory.penalizeEdge(fromPos, toPos, amount, ttlMs);
  };
  bot.pathfinder.clearPenalties = () => {
    backtrackMemory.clear();
  };
  bot.pathfinder.repath = () => {
    if (stateGoal) resetPath("repath", false);
  };
  bot.pathfinder.splicePaths = splicePaths;

  bot.pathfinder.bestHarvestTool = (block) => {
    if (stateMovements?.context?.toolSet) {
      stateMovements.context.toolSet.refresh();
      return stateMovements.context.toolSet.bestHarvestTool(block);
    }
    return null;
  };

  function getPositionOnTopOf(block) {
    if (!block || !Array.isArray(block.shapes) || block.shapes.length === 0) {
      return null;
    }
    const p = new Vec3(0.5, 0, 0.5);
    let n = 1;
    for (const shape of block.shapes) {
      const h = shape[4];
      if (h === p.y) {
        p.x += (shape[0] + shape[3]) / 2;
        p.z += (shape[2] + shape[5]) / 2;
        n++;
      } else if (h > p.y) {
        n = 2;
        p.x = 0.5 + (shape[0] + shape[3]) / 2;
        p.y = h;
        p.z = 0.5 + (shape[2] + shape[5]) / 2;
      }
    }
    p.x /= n;
    p.z /= n;
    return block.position ? block.position.plus(p) : p;
  }

  function postProcessPath(rawPath) {
    if (!Array.isArray(rawPath) || rawPath.length === 0) return [];
    for (let i = 0; i < rawPath.length; i++) {
      const curPoint = rawPath[i];
      if (curPoint.toBreak.length > 0 || curPoint.toPlace.length > 0) break;
      const b =
        typeof bot.blockAt === "function"
          ? bot.blockAt(new Vec3(curPoint.x, curPoint.y, curPoint.z))
          : null;
      if (
        b &&
        (b.type === waterType ||
          ((b.type === ladderId || b.type === vineId) &&
            i + 1 < rawPath.length &&
            rawPath[i + 1].y < curPoint.y))
      ) {
        curPoint.x = Math.floor(curPoint.x) + 0.5;
        curPoint.y = Math.floor(curPoint.y);
        curPoint.z = Math.floor(curPoint.z) + 0.5;
        continue;
      }
      let np = getPositionOnTopOf(b);
      if (np === null && typeof bot.blockAt === "function") {
        np = getPositionOnTopOf(
          bot.blockAt(new Vec3(curPoint.x, curPoint.y - 1, curPoint.z)),
        );
      }
      if (np) {
        curPoint.x = np.x;
        curPoint.y = np.y;
        curPoint.z = np.z;
      } else {
        curPoint.x = Math.floor(curPoint.x) + 0.5;
        curPoint.y = curPoint.y;
        curPoint.z = Math.floor(curPoint.z) + 0.5;
      }
    }

    if (
      !bot.pathfinder.enablePathShortcut ||
      !physics ||
      stateMovements.exclusionAreasStep.length !== 0 ||
      rawPath.length === 0
    ) {
      return rawPath;
    }

    const newPath = [];
    let lastNode = bot.entity.position;
    for (let i = 1; i < rawPath.length; i++) {
      const node = rawPath[i];
      if (
        Math.abs(node.y - lastNode.y) > 0.5 ||
        node.toBreak.length > 0 ||
        node.toPlace.length > 0 ||
        node.parkour ||
        !physics.canStraightLineBetween(lastNode, node)
      ) {
        newPath.push(rawPath[i - 1]);
        lastNode = rawPath[i - 1];
      }
    }
    newPath.push(rawPath[rawPath.length - 1]);
    return newPath;
  }

  function pathFromPlayer(targetPath) {
    if (!Array.isArray(targetPath) || targetPath.length === 0 || !bot.entity?.position) {
      return;
    }
    let minI = 0;
    let minDistance = 1000;
    for (let i = 0; i < targetPath.length; i++) {
      const node = targetPath[i];
      if (node.toBreak.length !== 0 || node.toPlace.length !== 0) break;
      const dist = bot.entity.position.distanceSquared(node);
      if (dist < minDistance) {
        minDistance = dist;
        minI = i;
      }
    }
    const n1 = targetPath[minI];
    const dx = n1.x - bot.entity.position.x;
    const dy = n1.y - bot.entity.position.y;
    const dz = n1.z - bot.entity.position.z;
    const reached = Math.abs(dx) <= 0.35 && Math.abs(dz) <= 0.35 && Math.abs(dy) < 1;
    if (
      minI + 1 < targetPath.length &&
      n1.toBreak.length === 0 &&
      n1.toPlace.length === 0
    ) {
      const n2 = targetPath[minI + 1];
      const d2 = bot.entity.position.distanceSquared(n2);
      const d12 = n1.distanceSquared(n2);
      minI += d12 > d2 || reached ? 1 : 0;
    }
    targetPath.splice(0, minI);
  }

  function makeStartMove(movements, startPos) {
    const p = startPos.floored();
    const dy = startPos.y - p.y;
    const b = typeof bot.blockAt === "function" ? bot.blockAt(p) : null;
    const emptyBlocks = movements.emptyBlocks || stateMovements.emptyBlocks;
    const offset =
      b &&
      dy > 0.001 &&
      bot.entity?.onGround &&
      emptyBlocks &&
      !emptyBlocks.has(b.type)
        ? 1
        : 0;
    return new Move(
      p.x,
      p.y + offset,
      p.z,
      typeof movements.countScaffoldingItems === "function"
        ? movements.countScaffoldingItems()
        : 0,
      0,
    );
  }

  bot.pathfinder.getPathFromTo = function* (
    movements,
    startPos,
    goal,
    options = {},
  ) {
    const optimizePath = options.optimizePath ?? true;
    const resetEntityIntersects = options.resetEntityIntersects ?? true;
    const timeout = options.timeout ?? bot.pathfinder.thinkTimeout;
    const primaryTimeout =
      options.primaryTimeout ?? bot.pathfinder.primaryTimeout;
    const tickTimeout = options.tickTimeout ?? bot.pathfinder.tickTimeout;
    const searchRadius = options.searchRadius ?? bot.pathfinder.searchRadius;

    if (typeof movements.prepareForSearch === "function") {
      movements.prepareForSearch(backtrackMemory);
    }
    if (movements.allowEntityDetection) {
      if (resetEntityIntersects && typeof movements.clearCollisionIndex === "function") {
        movements.clearCollisionIndex();
      }
      if (typeof movements.updateCollisionIndex === "function") {
        movements.updateCollisionIndex();
      }
    }

    const start = options.startMove || makeStartMove(movements, startPos);
    const ctx = new BaritoneAStar(
      start,
      movements,
      goal,
      timeout,
      tickTimeout,
      searchRadius,
      {
        primaryTimeout,
        heuristicWeight: options.heuristicWeight ?? 1.15,
      },
    );

    let result = ctx.compute();
    if (optimizePath) result.path = postProcessPath(result.path);
    yield { result, astarContext: ctx };
    while (result.status === "partial") {
      result = ctx.compute();
      if (optimizePath) result.path = postProcessPath(result.path);
      yield { result, astarContext: ctx };
    }
  };

  bot.pathfinder.getPathTo = (movements, goal, timeout) => {
    const generator = bot.pathfinder.getPathFromTo(
      movements,
      bot.entity.position,
      goal,
      { timeout },
    );
    const {
      value: { result, astarContext: ctx },
    } = generator.next();
    astarContext = ctx;
    return result;
  };

  Object.defineProperties(bot.pathfinder, {
    goal: {
      get() {
        return stateGoal;
      },
    },
    movements: {
      get() {
        return stateMovements;
      },
    },
  });

  // Legal stop: NEVER teleports bot.entity.position.x/z or zeros server knockback velocity!
  function legalStop() {
    if (typeof bot.clearControlStates === "function") {
      bot.clearControlStates();
    }
  }

  function detectDiggingStopped() {
    digging = false;
    bot.removeAllListeners("diggingAborted", detectDiggingStopped);
    bot.removeAllListeners("diggingCompleted", detectDiggingStopped);
  }

  function resetPath(reason, clearStates = true) {
    if (!stopPathing && path.length > 0) bot.emit("path_reset", reason);
    path = [];
    pathIsSegment = false;
    if (digging) {
      bot.on("diggingAborted", detectDiggingStopped);
      bot.on("diggingCompleted", detectDiggingStopped);
      try {
        bot.stopDigging();
      } catch (_) {}
    }
    placing = false;
    placingBlock = null;
    pathUpdated = false;
    astarContext = null;
    astarPartial = false;
    lockEquipItem.release();
    lockPlaceBlock.release();
    lockUseBlock.release();
    if (typeof stateMovements?.clearCollisionIndex === "function") {
      stateMovements.clearCollisionIndex();
    }
    if (clearStates) legalStop();
    if (stopPathing) return stop();
  }

  function stop() {
    stopPathing = false;
    stateGoal = null;
    path = [];
    pathIsSegment = false;
    bot.emit("path_stop");
    legalStop();
    releaseLease();
  }

  function rawSetGoal(goal, dynamic = false) {
    const isDyn = Boolean(dynamic);
    // Avoid thrashing active path when scripts re-send an equivalent goal,
    // while keeping `bot.pathfinder.goal === goal` true for reference checks.
    if (
      goal &&
      stateGoal &&
      isDyn === dynamicGoal &&
      areGoalsEquivalent(goal, stateGoal) &&
      (path.length > 0 || astarPartial)
    ) {
      stateGoal = goal;
      return;
    }
    stateGoal = goal;
    dynamicGoal = isDyn;
    bot.emit("goal_updated", goal, isDyn);
    resetPath("goal_updated");
  }

  let lease = null; // { owner, priority, at, dynamic, graceUntil }
  const deferred = new Map(); // owner -> { ctx, goal, dynamic, at }

  function leaseActive() {
    if (!lease) return false;
    const now = Date.now();
    if (stateGoal) return lease.dynamic || now - lease.at < LEASE_TTL_MS;
    return Boolean(lease.graceUntil && now < lease.graceUntil);
  }

  // Unattributed callers (physics hooks, setback recovery) act for the current holder.
  function resolveCtx() {
    const stored = ownerStore.getStore();
    if (stored) return { ...stored, explicit: true };
    if (leaseActive()) {
      return { owner: lease.owner, priority: lease.priority, explicit: false };
    }
    return { owner: "system", priority: 1, explicit: false };
  }

  function isBlocked(ctx) {
    return leaseActive() && lease.owner !== ctx.owner && ctx.priority < lease.priority;
  }

  function releaseLease() {
    lease = null;
    const now = Date.now();
    let best = null;
    for (const d of deferred.values()) {
      if (now - d.at > DEFERRED_TTL_MS) continue;
      if (
        !best ||
        d.ctx.priority > best.ctx.priority ||
        (d.ctx.priority === best.ctx.priority && d.at > best.at)
      ) {
        best = d;
      }
    }
    deferred.clear();
    bot.emit("path_lease_released");
    if (best) {
      setImmediate(() => {
        if (leaseActive()) return;
        ownerStore.run({ owner: best.ctx.owner, priority: best.ctx.priority }, () =>
          bot.pathfinder.setGoal(best.goal, best.dynamic),
        );
      });
    }
  }

  bot.pathfinder.runAs = runWithPathOwner;
  bot.pathfinder.getPathOwner = () => (leaseActive() ? lease.owner : null);

  bot.pathfinder.setGoal = (goal, dynamic = false) => {
    const ctx = resolveCtx();
    const now = Date.now();
    if (isBlocked(ctx)) {
      if (goal) deferred.set(ctx.owner, { ctx, goal, dynamic: Boolean(dynamic), at: now });
      else deferred.delete(ctx.owner);
      bot.emit("path_denied", ctx.owner, lease.owner);
      return;
    }
    if (!goal) {
      rawSetGoal(null, false);
      if (lease && !ctx.explicit) lease.graceUntil = now + LEASE_GRACE_MS;
      else releaseLease();
      return;
    }
    if (leaseActive() && lease.owner !== ctx.owner && stateGoal && ctx.priority > lease.priority) {
      deferred.set(lease.owner, {
        ctx: { owner: lease.owner, priority: lease.priority },
        goal: stateGoal,
        dynamic: dynamicGoal,
        at: now,
      });
    }
    lease = {
      owner: ctx.owner,
      priority: ctx.priority,
      at: now,
      dynamic: Boolean(dynamic),
      graceUntil: 0,
    };
    deferred.delete(ctx.owner);
    rawSetGoal(goal, dynamic);
  };

  bot.pathfinder.setMovements = (movements) => {
    if (!movements) return;
    if (movements.context && !movements.context.backtrackMemory) {
      movements.context.backtrackMemory = backtrackMemory;
    }
    stateMovements = movements;
    resetPath("movements_updated");
  };

  bot.pathfinder.isMoving = () => path.length > 0;
  bot.pathfinder.isMining = () => digging;
  bot.pathfinder.isBuilding = () => placing;
  bot.pathfinder.stop = () => {
    if (isBlocked(resolveCtx())) return;
    stopPathing = true;
  };
  function gotoNow(goal) {
    if (gotoUtil) return gotoUtil(bot, goal);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        bot.removeListener("goal_reached", onReached);
        bot.removeListener("path_stop", onStop);
      };
      const onReached = () => {
        cleanup();
        resolve();
      };
      const onStop = () => {
        cleanup();
        reject(new Error("Path stopped"));
      };
      bot.once("goal_reached", onReached);
      bot.once("path_stop", onStop);
      bot.pathfinder.setGoal(goal, false);
    });
  }

  // Held-back callers wait for the current owner instead of failing or fighting.
  bot.pathfinder.goto = (goal) => {
    const ctx = resolveCtx();
    if (!isBlocked(ctx)) return gotoNow(goal);
    return new Promise((resolve, reject) => {
      const holder = lease ? lease.owner : "another task";
      const timer = setTimeout(() => {
        bot.removeListener("path_lease_released", onFree);
        reject(new Error(`Pathfinder busy: ${holder} is using it`));
      }, BUSY_WAIT_MS);
      const onFree = () => {
        if (isBlocked(ctx)) return;
        clearTimeout(timer);
        bot.removeListener("path_lease_released", onFree);
        const run = ctx.explicit
          ? () => ownerStore.run({ owner: ctx.owner, priority: ctx.priority }, () => gotoNow(goal))
          : () => gotoNow(goal);
        run().then(resolve, reject);
      };
      bot.on("path_lease_released", onFree);
    });
  };

  function isPositionNearPath(pos, targetPath) {
    for (const node of targetPath) {
      const dx = Math.abs(node.x - pos.x - 0.5);
      const dy = Math.abs(node.y - pos.y - 0.5);
      const dz = Math.abs(node.z - pos.z - 0.5);
      if (dx <= 1.2 && dy <= 2.2 && dz <= 1.2) return true;
    }
    return false;
  }

  function moveToEdge(refBlock, edge) {
    const targetBlockPos = refBlock.offset(edge.x + 0.5, edge.y, edge.z + 0.5);
    const delta = bot.entity.position.clone().subtract(targetBlockPos);
    const targetYaw = Math.atan2(-delta.x, -delta.z);
    const targetPitch = -1.421;
    const csPitch = Math.cos(targetPitch);
    const snPitch = Math.sin(targetPitch);
    const viewVec = new Vec3(
      -Math.sin(targetYaw) * csPitch,
      snPitch,
      -Math.cos(targetYaw) * csPitch,
    );
    if (
      bot.entity.position.distanceTo(
        refBlock.clone().offset(edge.x + 0.5, 1, edge.z + 0.5),
      ) > 0.4
    ) {
      bot.lookAt(bot.entity.position.offset(viewVec.x, viewVec.y, viewVec.z), false);
      bot.setControlState("sneak", true);
      bot.setControlState("back", true);
      return false;
    }
    bot.setControlState("back", false);
    return true;
  }

  function moveToBlock(pos) {
    const targetPos = pos.clone().offset(0.5, 0, 0.5);
    if (bot.entity.position.distanceSquared(targetPos) > 0.05) {
      bot.lookAt(targetPos);
      bot.setControlState("forward", true);
      bot.setControlState("sprint", false);
      return false;
    }
    bot.setControlState("forward", false);
    return true;
  }

  bot.on("blockUpdate", (oldBlock, newBlock) => {
    if (!oldBlock || !newBlock) return;
    if (
      path.length > 0 &&
      oldBlock.type !== newBlock.type &&
      isPositionNearPath(oldBlock.position, path)
    ) {
      resetPath("block_updated", false);
    }
  });

  bot.on("chunkColumnLoad", (chunk) => {
    if (!astarContext || !chunk) return;
    const cx = chunk.x >> 4;
    const cz = chunk.z >> 4;
    if (
      astarContext.visitedChunks.has(`${cx - 1},${cz}`) ||
      astarContext.visitedChunks.has(`${cx},${cz - 1}`) ||
      astarContext.visitedChunks.has(`${cx + 1},${cz}`) ||
      astarContext.visitedChunks.has(`${cx},${cz + 1}`)
    ) {
      resetPath("chunk_loaded", false);
    }
  });

  function tryPrecomputeAndSpliceNextSegment() {
    if (
      !stateGoal ||
      !stateMovements ||
      !pathIsSegment ||
      path.length === 0 ||
      path.length > 7 ||
      digging ||
      placing
    ) {
      return;
    }
    const now = performance.now();
    if (now - lastSpliceAttemptAt < 450) return;
    lastSpliceAttemptAt = now;

    const anchorIdx = Math.min(3, path.length - 1);
    const anchor = path[anchorIdx];
    const startPos = new Vec3(
      Math.floor(anchor.x),
      Math.floor(anchor.y),
      Math.floor(anchor.z),
    );
    const gen = bot.pathfinder.getPathFromTo(stateMovements, startPos, stateGoal, {
      timeout: bot.pathfinder.thinkTimeout,
      primaryTimeout: bot.pathfinder.primaryTimeout,
      tickTimeout: Math.min(25, bot.pathfinder.tickTimeout),
    });
    const nextStep = gen.next();
    const res = nextStep?.value?.result;
    if (res && res.path && res.path.length > 0) {
      path = splicePaths(path, res.path);
      pathIsSegment = Boolean(res.isSegment);
      astarContext = nextStep.value.astarContext;
      astarPartial = res.status === "partial";
      bot.emit("path_update", res);
    }
  }

  function monitorMovement() {
    if (!bot.entity || !bot.entity.position) return;

    // Free motion direct chase when enabled and straight line is clear
    if (
      stateMovements &&
      stateMovements.allowFreeMotion &&
      stateGoal &&
      stateGoal.entity &&
      physics
    ) {
      const target = stateGoal.entity;
      if (target.position && physics.canStraightLine([target.position])) {
        bot.lookAt(target.position.offset(0, 1.6, 0));
        if (target.position.distanceSquared(bot.entity.position) > stateGoal.rangeSq) {
          bot.setControlState("forward", true);
        } else {
          legalStop();
        }
        return;
      }
    }

    if (stateGoal) {
      if (typeof stateGoal.isValid === "function" && !stateGoal.isValid()) {
        stop();
        return;
      }
      if (typeof stateGoal.hasChanged === "function" && stateGoal.hasChanged()) {
        resetPath("goal_moved", false);
      }
    }

    if (astarContext && astarPartial && path.length === 0) {
      const results = astarContext.compute();
      results.path = postProcessPath(results.path);
      pathFromPlayer(results.path);
      bot.emit("path_update", results);
      path = results.path;
      pathIsSegment = Boolean(results.isSegment);
      astarPartial = results.status === "partial";
    }

    if (bot.pathfinder.LOSWhenPlacingBlocks && returningPos) {
      if (!moveToBlock(returningPos)) return;
      returningPos = null;
    }

    if (path.length === 0) {
      lastNodeTime = performance.now();
      if (stateGoal && stateMovements) {
        if (stateGoal.isEnd(bot.entity.position.floored())) {
          if (!dynamicGoal) {
            bot.emit("goal_reached", stateGoal);
            stateGoal = null;
            legalStop();
            releaseLease();
          }
        } else if (!pathUpdated) {
          const results = bot.pathfinder.getPathTo(stateMovements, stateGoal);
          bot.emit("path_update", results);
          path = results.path;
          pathIsSegment = Boolean(results.isSegment);
          astarPartial = results.status === "partial";
          pathUpdated = true;
        }
      }
    }

    if (path.length === 0) return;

    // Baritone long-distance segment pre-calculation & early splicing
    tryPrecomputeAndSpliceNextSegment();

    let nextPoint = path[0];
    const p = bot.entity.position;

    // 1. Digging phase
    if (digging || nextPoint.toBreak.length > 0) {
      if (!digging && bot.entity.onGround) {
        digging = true;
        const bPos = nextPoint.toBreak.shift();
        const block = bot.blockAt(new Vec3(bPos.x, bPos.y, bPos.z), false);
        if (!block || block.boundingBox === "empty") {
          digging = false;
          lastNodeTime = performance.now();
          return;
        }
        const tool = bot.pathfinder.bestHarvestTool(block);
        legalStop();

        const digBlock = () => {
          bot
            .dig(block, true)
            .catch(() => {
              backtrackMemory.penalizeNode(bPos, 60);
              resetPath("dig_error");
            })
            .then(() => {
              lastNodeTime = performance.now();
              digging = false;
            });
        };

        if (!tool) {
          digBlock();
        } else {
          bot
            .equip(tool, "hand")
            .catch(() => {})
            .then(() => digBlock());
        }
      }
      return;
    }

    // 2. Placement & Door/Gate Opening phase
    if (placing || nextPoint.toPlace.length > 0) {
      if (!placing) {
        placing = true;
        placingBlock = nextPoint.toPlace.shift();
        legalStop();
      }

      if (placingBlock?.useOne) {
        const doorBlock = bot.blockAt(
          new Vec3(placingBlock.x, placingBlock.y, placingBlock.z),
        );
        // Never slam an already-open wooden door or fence gate shut!
        if (!doorBlock || isDoorOrGateOpen(doorBlock)) {
          placingBlock = nextPoint.toPlace.shift() || null;
          if (!placingBlock) {
            placing = false;
            lastNodeTime = performance.now();
          }
          return;
        }
        if (!lockUseBlock.tryAcquire()) return;
        bot
          .activateBlock(doorBlock)
          .then(() => {
            lockUseBlock.release();
            placingBlock = nextPoint.toPlace.shift() || null;
            if (!placingBlock) {
              placing = false;
              lastNodeTime = performance.now();
            }
          })
          .catch(() => {
            lockUseBlock.release();
            backtrackMemory.penalizeNode(placingBlock, 55);
            placing = false;
            placingBlock = null;
            resetPath("door_error");
          });
        return;
      }

      const blockItem = stateMovements.getScaffoldingItem();
      if (!blockItem) {
        resetPath("no_scaffolding_blocks");
        return;
      }
      if (
        bot.pathfinder.LOSWhenPlacingBlocks &&
        placingBlock.y === p.floored().y - 1 &&
        placingBlock.dy === 0
      ) {
        if (
          !moveToEdge(
            new Vec3(placingBlock.x, placingBlock.y, placingBlock.z),
            new Vec3(placingBlock.dx, 0, placingBlock.dz),
          )
        ) {
          return;
        }
      }

      let canPlace = true;
      if (placingBlock.jump) {
        bot.setControlState("jump", true);
        canPlace = placingBlock.y + 1 < bot.entity.position.y;
      }
      if (canPlace) {
        if (!lockEquipItem.tryAcquire()) return;
        bot
          .equip(blockItem, "hand")
          .then(() => {
            lockEquipItem.release();
            const refBlock = bot.blockAt(
              new Vec3(placingBlock.x, placingBlock.y, placingBlock.z),
              false,
            );
            if (!refBlock || !lockPlaceBlock.tryAcquire()) {
              placing = false;
              return;
            }
            if (interactableBlocks.includes(refBlock.name)) {
              bot.setControlState("sneak", true);
            }
            bot
              .placeBlock(
                refBlock,
                new Vec3(placingBlock.dx, placingBlock.dy, placingBlock.dz),
              )
              .then(() => {
                bot.setControlState("sneak", false);
                if (bot.pathfinder.LOSWhenPlacingBlocks && placingBlock.returnPos) {
                  returningPos = placingBlock.returnPos.clone();
                }
              })
              .catch(() => {
                backtrackMemory.penalizeNode(placingBlock, 55);
                resetPath("place_error");
              })
              .then(() => {
                lockPlaceBlock.release();
                placing = false;
                placingBlock = null;
                lastNodeTime = performance.now();
              });
          })
          .catch(() => {
            lockEquipItem.release();
            placing = false;
          });
      }
      return;
    }

    // 3. Node Arrival Check
    let dx = nextPoint.x - p.x;
    let dy = nextPoint.y - p.y;
    let dz = nextPoint.z - p.z;
    const arriveTol = nextPoint.parkour ? 0.42 : 0.35;

    if (Math.abs(dx) <= arriveTol && Math.abs(dz) <= arriveTol && Math.abs(dy) < 1) {
      lastNodeTime = performance.now();
      if (stopPathing) {
        stop();
        return;
      }
      path.shift();
      if (path.length === 0) {
        if (
          !dynamicGoal &&
          stateGoal &&
          (stateGoal.isEnd(p.floored()) ||
            stateGoal.isEnd(p.floored().offset(0, 1, 0)))
        ) {
          bot.emit("goal_reached", stateGoal);
          stateGoal = null;
          legalStop();
          releaseLease();
        } else if (pathIsSegment && stateGoal) {
          // Reached end of segment: immediately compute next segment without halting
          pathUpdated = false;
        } else {
          legalStop();
        }
        return;
      }
      nextPoint = path[0];
      if (nextPoint.toBreak.length > 0 || nextPoint.toPlace.length > 0) {
        legalStop();
        return;
      }
      dx = nextPoint.x - p.x;
      dy = nextPoint.y - p.y;
      dz = nextPoint.z - p.z;
    }

    // 4. Smart Baritone Steering, Sprint Gating, Water & Ladder Control
    bot.look(Math.atan2(-dx, -dz), 0);
    bot.setControlState("forward", true);
    bot.setControlState("jump", false);
    bot.setControlState("sneak", false);

    const feetBlock =
      typeof bot.blockAt === "function" ? bot.blockAt(p.floored()) : null;
    const headAboveBlock =
      typeof bot.blockAt === "function"
        ? bot.blockAt(p.floored().offset(0, 2, 0))
        : null;
    const onClimbable = Boolean(
      feetBlock && stateMovements.climbables?.has(feetBlock.type),
    );

    const antiCheatSlow = Boolean(
      bot._mcbpAntiCheatSlowUntil && Date.now() < bot._mcbpAntiCheatSlowUntil,
    );
    const hasEnoughFood = (bot.food ?? 20) > 6;
    const sharpTurnAhead =
      path.length >= 2 && getTurnAngleRad(p, nextPoint, path[1]) > 0.96; // > ~55 deg
    const canSprintNow =
      stateMovements.allowSprinting &&
      hasEnoughFood &&
      !antiCheatSlow &&
      !onClimbable &&
      (!sharpTurnAhead || nextPoint.parkour);

    const canUsePhysicsSim = Boolean(
      physics &&
        physics.physics &&
        bot.world &&
        bot.controlState &&
        Array.isArray(bot.inventory?.slots),
    );
    if (bot.entity.isInWater) {
      const ceilingBlocked = Boolean(
        headAboveBlock && headAboveBlock.boundingBox === "block",
      );
      const shouldRise = dy > 0.15 || (dy >= -0.25 && !ceilingBlocked);
      bot.setControlState("jump", shouldRise && !ceilingBlocked);
      bot.setControlState("sprint", false);
    } else if (onClimbable) {
      bot.setControlState("sprint", false);
      if (dy > 0.15) {
        bot.setControlState("jump", true);
      } else if (dy < -0.2) {
        bot.setControlState("jump", false);
        bot.setControlState("forward", Math.hypot(dx, dz) > 0.25);
      }
    } else if (canUsePhysicsSim) {
      if (canSprintNow && physics.canStraightLine(path, true)) {
        bot.setControlState("jump", false);
        bot.setControlState("sprint", true);
      } else if (canSprintNow && physics.canSprintJump(path)) {
        bot.setControlState("jump", true);
        bot.setControlState("sprint", true);
      } else if (physics.canStraightLine(path)) {
        bot.setControlState("jump", false);
        bot.setControlState("sprint", false);
      } else if (physics.canWalkJump(path)) {
        bot.setControlState("jump", true);
        bot.setControlState("sprint", false);
      } else {
        bot.setControlState("forward", false);
        bot.setControlState("sprint", false);
      }
    } else {
      // Lightweight kinematic fallback (e.g. unit tests without prismarine-physics)
      bot.setControlState("sprint", canSprintNow && Math.abs(dy) < 0.2);
      bot.setControlState("jump", dy > 0.35 || Boolean(nextPoint.parkour));
    }

    // 5. Baritone Futility Check with BacktrackMemory Penalty
    if (performance.now() - lastNodeTime > 2800) {
      backtrackMemory.penalizeNode(nextPoint, 50);
      backtrackMemory.penalizeEdge(p.floored(), nextPoint, 70);
      resetPath("stuck");
    }
  }

  bot._mcbpBaritoneMonitor = monitorMovement;
  bot.on("physicsTick", monitorMovement);
}

module.exports = {
  runWithPathOwner,
  injectBaritonePathfinder,
  splicePaths,
  areGoalsEquivalent,
  getTurnAngleRad,
};
