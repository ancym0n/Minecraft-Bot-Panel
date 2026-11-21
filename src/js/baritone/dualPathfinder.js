// Stock mineflayer-pathfinder as a hot-standby engine for the Baritone pathfinder.
//
// Baritone stays the public `bot.pathfinder` (it owns goals, path leases and
// events). When Baritone hits a problem (noPath, empty timeout, repeated
// stuck/dig/place resets) it hands the SAME goal object to this engine, which
// then drives the bot until it reaches the goal or hits a problem itself, at
// which point Baritone takes over again. Every default script, the AI agent
// and goto() promises keep working because they only ever talk to Baritone.

let defaultPkg = null;
function loadDefaultStockPkg() {
  if (defaultPkg !== null) return defaultPkg;
  try {
    defaultPkg = require("mineflayer-pathfinder");
  } catch (_) {
    defaultPkg = false;
  }
  return defaultPkg;
}

const SCALAR_KEYS = [
  "canDig",
  "digCost",
  "placeCost",
  "liquidCost",
  "entityCost",
  "dontCreateFlow",
  "dontMineUnderFallingBlock",
  "allow1by1towers",
  "allowFreeMotion",
  "allowParkour",
  "allowSprinting",
  "allowEntityDetection",
  "canOpenDoors",
  "maxDropDown",
  "infiniteLiquidDropdownDistance",
];

function copyScalars(src, dst) {
  if (!src || !dst) return;
  for (const k of SCALAR_KEYS) {
    if (k in src && src[k] !== undefined && dst[k] !== src[k]) dst[k] = src[k];
  }
}

function copyMovementSettings(src, bot, TargetCtor) {
  if (!src || !TargetCtor) return null;
  let dst;
  try {
    dst = new TargetCtor(bot);
  } catch (_) {
    return null;
  }
  copyScalars(src, dst);
  const copySet = (key) => {
    if (src[key] instanceof Set && dst[key] instanceof Set)
      dst[key] = new Set(src[key]);
  };
  copySet("blocksToAvoid");
  copySet("blocksCantBreak");
  copySet("entitiesToAvoid");
  for (const key of [
    "scafoldingBlocks",
    "exclusionAreasStep",
    "exclusionAreasBreak",
    "exclusionAreasPlace",
  ]) {
    if (Array.isArray(src[key]) && Array.isArray(dst[key]))
      dst[key] = [...src[key]];
  }
  return dst;
}

const PATH_EVENTS = new Set([
  "goal_updated",
  "goal_reached",
  "path_update",
  "path_reset",
  "path_stop",
]);

// Creates the stock engine for `bot`. Returns null if it cannot be created
// (package missing, registry not ready yet, unsupported version...).
// `getFacade` returns the public Baritone `bot.pathfinder` so event listeners
// that run while the stock engine is ticking still see the real API.
function createStockFallbackEngine(
  bot,
  { pkg = null, getFacade = () => bot.pathfinder } = {},
) {
  const stockPkg = pkg || loadDefaultStockPkg();
  if (!stockPkg || typeof stockPkg.pathfinder !== "function") return null;
  if (!bot?.registry?.blocksByName?.water || !bot.registry.blocksByName.ladder)
    return null;
  if (typeof bot.listeners !== "function") return null;

  const facade = getFacade();
  const beforeTicks = new Set(bot.listeners("physicsTick"));
  let api = null;
  let tick = null;
  try {
    stockPkg.pathfinder(bot);
    api = bot.pathfinder;
  } catch (_) {
    api = null;
  } finally {
    bot.pathfinder = facade;
  }
  for (const fn of bot.listeners("physicsTick")) {
    if (!beforeTicks.has(fn)) {
      bot.removeListener("physicsTick", fn);
      if (!tick) tick = fn;
    }
  }
  if (!api || typeof api.setGoal !== "function" || !tick) return null;
  api.thinkTimeout = 4000;
  api.tickTimeout = 30;

  // Runs `fn` with bot.pathfinder pointing at the stock API (it calls
  // bot.pathfinder.getPathTo() etc. on itself), filters its events, and undoes
  // its fullStop() position snap / velocity zeroing so we never teleport.
  function run(fn, filter = null) {
    const prevPf = bot.pathfinder;
    const realEmit = bot.emit;
    const ent = bot.entity;
    const px = ent?.position?.x;
    const pz = ent?.position?.z;
    const vx = ent?.velocity?.x;
    const vz = ent?.velocity?.z;
    bot.emit = function (name, ...args) {
      if (!PATH_EVENTS.has(name)) return realEmit.call(bot, name, ...args);
      const emitReal = () => {
        const inner = bot.pathfinder;
        bot.pathfinder = getFacade();
        bot.emit = realEmit;
        try {
          return realEmit.call(bot, name, ...args);
        } finally {
          bot.emit = wrapped;
          bot.pathfinder = inner;
        }
      };
      if (filter) return filter(name, args, emitReal);
      return emitReal();
    };
    const wrapped = bot.emit;
    bot.pathfinder = api;
    try {
      return fn();
    } finally {
      bot.emit = realEmit;
      // A listener may have replaced bot.pathfinder (re-inject); keep that.
      if (bot.pathfinder === api) bot.pathfinder = prevPf;
      if (ent?.position && typeof px === "number" && typeof pz === "number") {
        if (ent.position.x !== px || ent.position.z !== pz) {
          ent.position.x = px;
          ent.position.z = pz;
          if (ent.velocity && typeof vx === "number") {
            ent.velocity.x = vx;
            ent.velocity.z = vz;
          }
        }
      }
    }
  }

  const swallowAll = () => true;

  return {
    api,
    // Hand `goal` (same object, so goto() promises keep matching) to stock.
    start(goal, dynamic, movements, MovementsCtor = stockPkg.Movements) {
      run(() => {
        const m = copyMovementSettings(movements, bot, MovementsCtor);
        if (m) api.setMovements(m);
        api.setGoal(goal, Boolean(dynamic));
      }, swallowAll);
    },
    // Stop the stock engine without emitting goal_updated(null)/path_stop,
    // which would make waiting goto() calls reject.
    halt() {
      run(() => {
        try {
          api.setGoal(null);
        } catch (_) {}
      }, swallowAll);
    },
    syncMovements(src) {
      copyScalars(src, api.movements);
    },
    tick(filter) {
      run(() => tick(), filter);
    },
    isMoving: () => Boolean(api.isMoving?.()),
    isMining: () => Boolean(api.isMining?.()),
    isBuilding: () => Boolean(api.isBuilding?.()),
  };
}

module.exports = {
  createStockFallbackEngine,
  copyMovementSettings,
};
