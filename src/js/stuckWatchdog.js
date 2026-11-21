// Watches every pathfinder goal (from any module or the AI Agent), logs
// walking/pathfinding problems, and recovers when the bot stops making progress:
// verified physics-locked jump (checking if Y actually rose on the server!),
// horizontal un-wedge when jumping is blocked on the server, strafing,
// backing off, and safe re-pathing without triggering anti-cheat kicks.
const {
  configureSmartMovements,
  clearPathfinderGoal,
  setBotControlOverride,
  diagnoseWalkingObstruction,
  performVerifiedJumpOrUnwedge,
  escapeHazardsAndObstructions,
} = require("./botUtils");

const TICK_MS = 1000;
const STILL_MS = 3800; // no progress for this long = stuck
const MIN_MOVE = 0.6;

function describeGoal(goal) {
  if (!goal) return "none";
  if (goal.entity) {
    return goal.entity.username || goal.entity.name || "entity";
  }
  const coords = ["x", "y", "z"]
    .map((k) => (typeof goal[k] === "number" ? Math.floor(goal[k]) : null))
    .filter((v) => v !== null);
  return coords.length ? `(${coords.join(", ")})` : "target";
}

function attachStuckWatchdog(
  bot,
  { log, loadLibraries, onStuck, onLogMovement } = {},
) {
  if (!bot || bot._mcbpStuckWatch) return () => {};
  const state = {
    lastPos: null,
    lastProgressAt: Date.now(),
    level: 0,
    goal: null,
    savedMovements: null,
    hardSince: 0,
    lastLogAt: 0,
    lastPathWarnAt: 0,
    lastRubberbandWarnAt: 0,
    lastAiAt: 0,
    recovering: false,
  };

  const recordMovementEvent = (action, details) => {
    if (typeof onLogMovement === "function") {
      try {
        onLogMovement(action, details);
      } catch (_) {}
    }
  };

  const say = (text, movementAction = "", movementDetails = "") => {
    const now = Date.now();
    if (now - state.lastLogAt < 2200) return;
    state.lastLogAt = now;
    if (log) log(text);
    if (movementAction) {
      recordMovementEvent(movementAction, movementDetails || text);
    }
  };

  const repath = (goal, stuckPos = null) => {
    if (!bot || !bot.pathfinder || !goal) return;
    try {
      if (stuckPos && typeof bot.pathfinder.penalizeNode === "function") {
        bot.pathfinder.penalizeNode(stuckPos, 55);
      }
      if (bot.pathfinder.goal === goal && typeof bot.pathfinder.repath === "function") {
        bot.pathfinder.repath();
      } else {
        bot.pathfinder.setGoal(goal, Boolean(goal && goal.entity));
      }
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

  const allowSafeDig = () => {
    if (state.savedMovements) return false;
    // Never enable digging inside a server spawn-protected zone!
    if (
      bot._mcbpProtectedZoneUntil &&
      Date.now() < bot._mcbpProtectedZoneUntil
    ) {
      return false;
    }
    try {
      const { mcData, Movements } = loadLibraries();
      state.savedMovements = bot.pathfinder.movements || null;
      configureSmartMovements(bot, mcData, Movements, {
        canDig: true,
        allowPillaring: false,
        allowBridging: false,
        allowParkour: true,
      });
      state.hardSince = Date.now();
      return true;
    } catch (_) {
      return false;
    }
  };

  const reset = (pos) => {
    const wasLevel = state.level;
    state.lastPos = pos ? pos.clone() : null;
    state.lastProgressAt = Date.now();
    state.level = 0;
    if (wasLevel > 0) {
      const p = pos
        ? `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`
        : "";
      if (log) log(`Unstuck: moving again ${p}`.trim());
      recordMovementEvent(
        "Recovered / Moving Again",
        `Resumed progress at ${p} after stuck level ${wasLevel}`,
      );
    }
  };

  // 1. Log pathfinding failures (`noPath` / `timeout`) during walking
  const onPathUpdate = (results) => {
    if (!bot || !bot.entity || !results) return;
    if (results.status !== "noPath" && results.status !== "timeout") return;
    const now = Date.now();
    if (now - state.lastPathWarnAt < 4500) return;
    state.lastPathWarnAt = now;
    const goal = bot.pathfinder?.goal || state.goal;
    const targetDesc = describeGoal(goal);
    const diag = diagnoseWalkingObstruction(bot);
    const msg = `Walking problem: Pathfinding ${results.status} to ${targetDesc} (${diag.summary})`;
    if (log) log(msg);
    recordMovementEvent(
      `Pathfinding ${results.status === "noPath" ? "No Path" : "Timeout"}`,
      `Target: ${targetDesc} | ${diag.summary}`,
    );
  };

  // 2. Log server position setbacks / rubberbands (`forcedMove`) while walking
  const onForcedMove = () => {
    if (!bot || !bot.entity) return;
    const goal = bot.pathfinder?.goal || state.goal;
    if (!goal && !bot._mcbpControlOverride) return;
    const recent = (bot._mcbpForcedMoveTimes || []).filter(
      (t) => Date.now() - t < 4500,
    );
    if (recent.length < 2) return;
    const now = Date.now();
    if (now - state.lastRubberbandWarnAt < 4000) return;
    state.lastRubberbandWarnAt = now;
    const diag = diagnoseWalkingObstruction(bot);
    const targetDesc = describeGoal(goal);
    const msg = `Walking problem: Server setback/rubberband (${recent.length}x) while moving to ${targetDesc} (${diag.summary})`;
    if (log) log(msg);
    recordMovementEvent(
      "Server Rubberband / Setback",
      `Setback ${recent.length}x toward ${targetDesc} | ${diag.summary}`,
    );
    bot._mcbpForcedMoveTimes = [];
  };

  bot.on("path_update", onPathUpdate);
  bot.on("forcedMove", onForcedMove);

  const timer = setInterval(async () => {
    if (!bot.entity || !bot.pathfinder || state.recovering) return;
    const goal = bot.pathfinder.goal;
    const pos = bot.entity.position;

    // The AI Agent runs its own recovery for its moves.
    if (!goal || bot._mcbpAiWatch) {
      if (state.goal) reset(pos);
      state.goal = null;
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

    // If pathfinder is actively mining a block, wait for digging to finish
    if (
      typeof bot.pathfinder.isMining === "function" &&
      bot.pathfinder.isMining()
    ) {
      state.lastProgressAt = Date.now();
      return;
    }

    let done = false;
    try {
      done = goal.isEnd(pos.floored());
    } catch (_) {}
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

    // Stuck: escalate with physics-locked controls and server jump verification
    state.level += 1;
    state.lastProgressAt = Date.now();
    state.recovering = true;

    try {
      const step = state.level <= 5 ? state.level : 2 + ((state.level - 6) % 4);
      const targetDesc = describeGoal(goal);
      const diag = diagnoseWalkingObstruction(bot);

      if (step === 1) {
        say(
          `Stuck: jumping forward (${diag.summary})`,
          "Stuck (Step 1: Jump / Un-wedge)",
          `Target: ${targetDesc} | ${diag.summary}`,
        );
        await performVerifiedJumpOrUnwedge(bot, {
          log,
          onLogMovement: recordMovementEvent,
          reason: "Stuck",
        });
      } else if (step === 2) {
        const side = Math.random() < 0.5 ? "left" : "right";
        say(
          `Stuck: strafing ${side} along open angle and re-pathing (${diag.summary})`,
          `Stuck (Step 2: Strafe ${side})`,
          `Target: ${targetDesc} | ${diag.summary}`,
        );
        clearPathfinderGoal(bot);
        setBotControlOverride(bot, {
          durationMs: 650,
          controls: {
            forward: true,
            [side]: true,
            jump: !diag.ceilingBlocked && !diag.serverRubberband,
            sprint: false,
          },
          yaw: diag.openYaw,
        });
        await new Promise((r) => setTimeout(r, 680));
        repath(goal, pos);
      } else if (step === 3) {
        if (allowSafeDig()) {
          say(
            `Stuck: allowing block clearing and re-pathing (${diag.summary})`,
            "Stuck (Step 3: Allow Digging)",
            `Target: ${targetDesc} | ${diag.summary}`,
          );
          repath(goal, pos);
        } else {
          say(
            `Stuck: protected zone or digging unavailable - detouring around (${diag.summary})`,
            "Stuck (Step 3: Detour in Protected Zone)",
            `Target: ${targetDesc} | ${diag.summary}`,
          );
          clearPathfinderGoal(bot);
          setBotControlOverride(bot, {
            durationMs: 750,
            controls: { forward: true, jump: false, sprint: false },
            yaw: diag.openYaw,
          });
          await new Promise((r) => setTimeout(r, 780));
          repath(goal, pos);
        }
      } else if (step === 4) {
        const side = Math.random() < 0.5 ? "left" : "right";
        say(
          `Stuck: backing off and trying another way (${diag.summary})`,
          "Stuck (Step 4: Back Off & Detour)",
          `Target: ${targetDesc} | ${diag.summary}`,
        );
        clearPathfinderGoal(bot);
        setBotControlOverride(bot, {
          durationMs: 800,
          controls: {
            back: true,
            [side]: true,
            forward: false,
            jump: false,
            sprint: false,
          },
          yaw: bot.entity.yaw,
        });
        await new Promise((r) => setTimeout(r, 830));
        repath(goal, pos);
      } else {
        say(
          `Stuck: still no progress after ${state.level} attempts, running full escape (${diag.summary})`,
          "Stuck (Step 5: Full Escape)",
          `Target: ${targetDesc} | ${diag.summary}`,
        );
        await escapeHazardsAndObstructions(bot, {
          log,
          onLogMovement: recordMovementEvent,
        }).catch(() => {});
        repath(goal, pos);
        if (onStuck && Date.now() - state.lastAiAt > 45000) {
          state.lastAiAt = Date.now();
          Promise.resolve()
            .then(() => onStuck({ target: targetDesc, level: state.level }))
            .catch(() => {});
        }
      }
    } finally {
      state.recovering = false;
      state.lastProgressAt = Date.now();
    }
  }, TICK_MS);

  const stop = () => {
    clearInterval(timer);
    bot.removeListener("path_update", onPathUpdate);
    bot.removeListener("forcedMove", onForcedMove);
    restoreMovements();
    bot._mcbpStuckWatch = null;
  };
  bot._mcbpStuckWatch = { stop, state };
  bot.once("end", stop);
  return stop;
}

module.exports = { attachStuckWatchdog };
