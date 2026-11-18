// Watches every pathfinder goal (from any module or the AI Agent) and helps
// the bot when it stops making progress: jump, strafe, re-path, allow
// digging/bridging, back off. It keeps trying for as long as the goal is
// set, and calls onStuck after several failed rounds so the AI can step in.
const { configureSmartMovements } = require("./botUtils");

const TICK_MS = 1000;
const STILL_MS = 4000; // no progress for this long = stuck
const MIN_MOVE = 0.6;

function attachStuckWatchdog(bot, { log, loadLibraries, onStuck } = {}) {
  if (!bot || bot._mcbpStuckWatch) return () => {};
  const state = {
    lastPos: null,
    lastProgressAt: Date.now(),
    level: 0,
    goal: null,
    savedMovements: null,
    hardSince: 0,
    lastLogAt: 0,
    lastAiAt: 0,
  };

  const say = (text) => {
    const now = Date.now();
    if (now - state.lastLogAt < 2500) return;
    state.lastLogAt = now;
    if (log) log(text);
  };

  const pulse = (control, ms) => {
    try {
      bot.setControlState(control, true);
      setTimeout(() => {
        try {
          bot.setControlState(control, false);
        } catch (_) {}
      }, ms);
    } catch (_) {}
  };

  const repath = (goal) => {
    try {
      bot.pathfinder.setGoal(goal, Boolean(goal && goal.entity));
    } catch (_) {}
  };

  const restoreMovements = () => {
    if (!state.savedMovements) return;
    try {
      bot.pathfinder.setMovements(state.savedMovements);
    } catch (_) {}
    state.savedMovements = null;
    state.hardSince = 0;
  };

  const allowDigAndBridge = () => {
    if (state.savedMovements) return;
    try {
      const { mcData, Movements } = loadLibraries();
      state.savedMovements = bot.pathfinder.movements || null;
      configureSmartMovements(bot, mcData, Movements, {
        canDig: true,
        allowPillaring: true,
        allowBridging: true,
        allowParkour: true,
      });
      state.hardSince = Date.now();
    } catch (_) {}
  };

  const reset = (pos) => {
    state.lastPos = pos ? pos.clone() : null;
    state.lastProgressAt = Date.now();
    if (state.level > 0 && log) log("Unstuck: moving again");
    state.level = 0;
  };

  const timer = setInterval(() => {
    if (!bot.entity || !bot.pathfinder) return;
    const goal = bot.pathfinder.goal;
    const pos = bot.entity.position;

    // The AI Agent runs its own recovery for its moves.
    if (!goal || bot._mcbpAiWatch) {
      if (state.goal) reset(pos);
      state.goal = null;
      // Go back to normal movements a while after recovering.
      if (state.savedMovements && Date.now() - state.hardSince > 15000) {
        restoreMovements();
      }
      return;
    }
    if (goal !== state.goal) {
      state.goal = goal;
      reset(pos);
      return;
    }

    let done = false;
    try {
      done = goal.isEnd(pos.floored());
    } catch (_) {}
    // Following/escorting: standing next to the target is fine.
    if (
      done ||
      (goal.entity &&
        goal.entity.position &&
        goal.entity.position.distanceTo(pos) < 4)
    ) {
      state.lastPos = pos.clone();
      state.lastProgressAt = Date.now();
      return;
    }

    if (!state.lastPos || pos.distanceTo(state.lastPos) > MIN_MOVE) {
      if (state.level > 0) reset(pos);
      state.lastPos = pos.clone();
      state.lastProgressAt = Date.now();
      return;
    }
    if (Date.now() - state.lastProgressAt < STILL_MS) return;

    // Stuck: escalate, then keep cycling through the stronger steps.
    state.level += 1;
    state.lastProgressAt = Date.now();
    const step = state.level <= 5 ? state.level : 2 + ((state.level - 6) % 4);
    if (step === 1) {
      say("Stuck: jumping forward");
      pulse("jump", 450);
      pulse("forward", 500);
    } else if (step === 2) {
      const side = Math.random() < 0.5 ? "left" : "right";
      say(`Stuck: strafing ${side} and re-pathing`);
      pulse(side, 600);
      pulse("jump", 450);
      setTimeout(() => repath(goal), 650);
    } else if (step === 3) {
      say("Stuck: allowing digging and bridging");
      allowDigAndBridge();
      repath(goal);
    } else if (step === 4) {
      say("Stuck: backing off and trying another way");
      pulse("back", 800);
      pulse(Math.random() < 0.5 ? "left" : "right", 500);
      setTimeout(() => repath(goal), 900);
    } else {
      say("Stuck: still no progress, re-pathing");
      pulse("jump", 450);
      repath(goal);
      // Hand it to the AI every so often.
      if (onStuck && Date.now() - state.lastAiAt > 45000) {
        state.lastAiAt = Date.now();
        const target = goal.entity
          ? goal.entity.username || goal.entity.name
          : ["x", "y", "z"]
              .map((k) =>
                typeof goal[k] === "number" ? Math.floor(goal[k]) : "~",
              )
              .join(" ");
        Promise.resolve()
          .then(() => onStuck({ target, level: state.level }))
          .catch(() => {});
      }
    }
  }, TICK_MS);

  const stop = () => {
    clearInterval(timer);
    restoreMovements();
    bot._mcbpStuckWatch = null;
  };
  bot._mcbpStuckWatch = { stop, state };
  bot.once("end", stop);
  return stop;
}

module.exports = { attachStuckWatchdog };
