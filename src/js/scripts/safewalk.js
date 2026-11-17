const { loadLibraries } = require("../runtime");
const { configureSmartMovements } = require("../botUtils");

const info = {
  name: "SafeWalk",
  default: { interval: 1000 },
  options: [
    {
      type: "checkbox",
      label: "Sneak at Edges",
      id: "edges",
    },
    {
      type: "checkbox",
      label: "Avoid Lava/Fire",
      id: "hazards",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity) {
    clearLog("SafeWalk:");
    log("SafeWalk: Connect a bot first");
    return;
  }

  const { mcData, Movements } = loadLibraries();
  bot._mcbpSafeWalk = true;

  configureSmartMovements(bot, mcData, Movements, {
    allowSprinting: true,
    allowParkour: false,
    maxDropDown: 2,
  });

  clearLog("SafeWalk:");
  log("SafeWalk: Active (edge crouch & hazard avoidance)");

  async function safeWalkTick() {
    if (!bot || !bot.entity) return;
    const [edgesOpt, hazardsOpt] = await Promise.all([
      getOption("edges", info.name),
      getOption("hazards", info.name),
    ]);
    bot._mcbpSafeWalk = edgesOpt !== "off" || hazardsOpt !== "off";
  }

  try {
    await safeWalkTick();
    await scriptRepeater(safeWalkTick, info.default.interval);
  } finally {
    if (bot) {
      bot._mcbpSafeWalk = false;
      if (bot.controlState?.sneak) {
        bot.setControlState("sneak", false);
      }
      configureSmartMovements(bot, mcData, Movements);
    }
  }
}

module.exports = {
  info,
  script,
};
