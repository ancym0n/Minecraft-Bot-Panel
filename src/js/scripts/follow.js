const { loadLibraries } = require("../runtime");
const {
  setDynamicFollowGoal,
  clearPathfinderGoal,
  configureSmartMovements,
} = require("../botUtils");

const info = {
  name: "Follow",
  default: { interval: 750 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
    },
    {
      type: "checkbox",
      label: "Sprint Jump",
      id: "sprintjump",
    },
    {
      type: "checkbox",
      label: "Pillar / Bridge",
      id: "bridge",
    },
    {
      type: "input",
      label: "Player Name",
      id: "playername",
    },
    {
      type: "input",
      label: "Delay (optional)",
      id: "delay",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.players || !bot.pathfinder) {
    clearLog("Follow:");
    log("Follow: Connect a bot first");
    return;
  }

  const { goals, mcData, Movements } = loadLibraries();
  const [rawPlayerName, rawDelay, repeat, sprintJumpOpt, bridgeOpt] =
    await Promise.all([
      getOption("playername", info.name),
      getOption("delay", info.name),
      getOption("repeat", info.name),
      getOption("sprintjump", info.name),
      getOption("bridge", info.name),
    ]);

  const initialName = String(rawPlayerName || "").trim();
  if (!initialName) {
    clearLog("Follow:");
    log("Follow: Enter a target player name");
    return;
  }

  const parsedDelay = parseInt(rawDelay, 10);
  const realDelay =
    Number.isFinite(parsedDelay) && parsedDelay >= 100
      ? parsedDelay
      : info.default.interval;

  bot._mcbpSprintJump = sprintJumpOpt !== "off";
  configureSmartMovements(bot, mcData, Movements, {
    allowSprinting: true,
    allowPillaring: bridgeOpt === "on",
    allowBridging: bridgeOpt === "on",
  });

  async function follow() {
    if (!bot || !bot.players || !bot.pathfinder) return;
    const liveName =
      String(
        (await getOption("playername", info.name)) || initialName,
      ).trim() || initialName;
    const liveSprintJump = await getOption("sprintjump", info.name);
    bot._mcbpSprintJump = liveSprintJump !== "off";

    const exact = bot.players[liveName]?.entity;
    const lower = liveName.toLowerCase();
    const player =
      exact ||
      Object.values(bot.players).find(
        (p) => p && p.username && p.username.toLowerCase() === lower,
      )?.entity;

    if (!player) {
      clearLog("Couldn't find player \"");
      log(`Couldn't find player "${liveName}"`);
      return;
    }

    const { x, y, z } = player.position;
    clearLog("Following player: ");
    log(
      `Following player: ${player.username || liveName} (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})`,
    );

    if (repeat === "on") {
      setDynamicFollowGoal(bot, goals, player, 2);
    } else {
      bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2));
    }
  }

  try {
    await follow();
    if (repeat === "on") {
      await scriptRepeater(follow, realDelay);
    }
  } finally {
    if (bot) {
      bot._mcbpSprintJump = false;
      if (repeat === "on") {
        clearPathfinderGoal(bot);
      }
      configureSmartMovements(bot, mcData, Movements);
    }
  }
}

module.exports = {
  info,
  script,
};
