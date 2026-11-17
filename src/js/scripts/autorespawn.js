const { loadLibraries } = require("../runtime");
const { clearPathfinderGoal } = require("../botUtils");

const info = {
  name: "AutoRespawn",
  default: { interval: 1000 },
  options: [
    {
      type: "checkbox",
      label: "Return to Area",
      id: "returnback",
    },
    {
      type: "input",
      label: "Work Area [X Y Z]",
      id: "workpos",
    },
  ],
};

function parseCoords(raw, fallbackPos) {
  const parts = String(raw || "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length >= 3 && parts.every(Number.isFinite)) {
    return {
      x: Math.floor(parts[0]),
      y: Math.floor(parts[1]),
      z: Math.floor(parts[2]),
    };
  }
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return {
      x: Math.floor(parts[0]),
      y: Math.floor(fallbackPos?.y ?? 64),
      z: Math.floor(parts[1]),
    };
  }
  return fallbackPos
    ? {
        x: Math.floor(fallbackPos.x),
        y: Math.floor(fallbackPos.y),
        z: Math.floor(fallbackPos.z),
      }
    : null;
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot) {
    clearLog("AutoRespawn:");
    log("AutoRespawn: Connect a bot first");
    return;
  }

  const { goals } = loadLibraries();
  let lastSavedPos = bot.entity?.position ? bot.entity.position.clone() : null;
  let respawning = false;

  async function triggerRespawnAndReturn() {
    if (!bot || respawning) return;
    respawning = true;
    try {
      clearLog("AutoRespawn:");
      log("AutoRespawn: Bot died — sending respawn packet...");
      bot.respawn();

      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2200);
        bot.once("spawn", () => {
          clearTimeout(timer);
          resolve();
        });
      });

      const [returnOpt, rawWorkPos] = await Promise.all([
        getOption("returnback", info.name),
        getOption("workpos", info.name),
      ]);

      if (returnOpt !== "off" && bot && bot.entity && bot.pathfinder) {
        const dest = parseCoords(rawWorkPos, lastSavedPos);
        if (dest) {
          clearLog("AutoRespawn:");
          log(
            `AutoRespawn: Respawned — returning to (${dest.x}, ${dest.y}, ${dest.z})`,
          );
          bot.pathfinder.setGoal(new goals.GoalNear(dest.x, dest.y, dest.z, 2));
        }
      } else {
        clearLog("AutoRespawn:");
        log("AutoRespawn: Respawned successfully");
      }
    } catch (_) {
    } finally {
      respawning = false;
    }
  }

  function onDeath() {
    triggerRespawnAndReturn();
  }

  bot.on("death", onDeath);
  clearLog("AutoRespawn:");
  log("AutoRespawn: Monitoring bot health & death events");

  async function checkTick() {
    if (!bot || !bot.entity) return;
    if ((bot.health ?? 20) > 0 && bot.entity.position) {
      lastSavedPos = bot.entity.position.clone();
    } else if ((bot.health ?? 20) <= 0) {
      await triggerRespawnAndReturn();
    }
  }

  try {
    await checkTick();
    await scriptRepeater(checkTick, info.default.interval);
  } finally {
    if (bot) {
      bot.removeListener("death", onDeath);
      clearPathfinderGoal(bot);
    }
  }
}

module.exports = {
  info,
  script,
};
