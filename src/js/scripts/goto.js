const { loadLibraries } = require("../runtime");
const { configureSmartMovements, clearPathfinderGoal } = require("../botUtils");

const info = {
  name: "GoTo",
  default: { interval: 2500 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
    },
    {
      type: "checkbox",
      label: "Dig Obstacles",
      id: "dig",
    },
    {
      type: "checkbox",
      label: "Pillar / Bridge",
      id: "bridge",
    },
    {
      type: "input",
      label: "X",
      id: "x",
    },
    {
      type: "input",
      label: "Y (optional)",
      id: "y",
    },
    {
      type: "input",
      label: "Z",
      id: "z",
    },
  ],
};

function toNumber(num) {
  if (num === undefined || num === null || String(num).trim() === "") {
    return null;
  }
  const parsed = Number(num);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.pathfinder) {
    clearLog("GoTo:");
    log("GoTo: Connect a bot first");
    return;
  }

  const { goals, mcData, Movements } = loadLibraries();
  const [inputX, inputY, inputZ, repeat, digOpt, bridgeOpt] = await Promise.all(
    [
      getOption("x", info.name),
      getOption("y", info.name),
      getOption("z", info.name),
      getOption("repeat", info.name),
      getOption("dig", info.name),
      getOption("bridge", info.name),
    ],
  );

  const x = toNumber(inputX);
  const z = toNumber(inputZ);
  let y = toNumber(inputY);

  if (x === null || z === null) {
    clearLog("is not a valid coordinate");
    log(`GoTo: X and Z coordinates are required`);
    return;
  }

  if (y === null) {
    y = Math.floor(bot.entity.position.y);
  }

  configureSmartMovements(bot, mcData, Movements, {
    allowSprinting: true,
    allowParkour: bridgeOpt === "on",
    canDig: digOpt === "on",
    allowPillaring: bridgeOpt === "on",
    allowBridging: bridgeOpt === "on",
  });

  function goTo() {
    if (!bot || !bot.entity || !bot.pathfinder) return;
    clearLog("Going to XYZ: ");
    log(`Going to XYZ: ${x}, ${y}, ${z}`);
    bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
  }

  try {
    goTo();
    if (repeat === "on") {
      await scriptRepeater(goTo, info.default.interval);
    }
  } finally {
    if (bot && bot.pathfinder) {
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
