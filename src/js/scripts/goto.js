let info = {
  name: "GoTo",
  default: { interval: 2500 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
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

function script(bot, log, clearLog, getOption, scriptRepeater) {
  const { goals } = require("mineflayer-pathfinder");
  let x;
  let y;
  let z;

  function toNumber(num) {
    let parsed = parseInt(num);
    if (!isNaN(parsed)) return parsed;
    else return false;
  }
  getOption("x", info.name).then((inputX) => {
    x = toNumber(inputX);
  });
  getOption("z", info.name).then((inputZ) => {
    z = toNumber(inputZ);
  });
  getOption("y", info.name).then((inputY) => {
    y = toNumber(inputY);
  });

  getOption("repeat", info.name).then((r) => {
    if (x === false || z === false) {
      let logMsg = " is not a number";
      clearLog(logMsg);
      if (z === false) log(z + logMsg);
      else if (x === false) log(x + logMsg);
      else log("ERROR: " + info.name + " crashed");
    }
    if (y === false) y = bot.entity.position.y;
    function goTo() {
      clearLog("Going to XYZ: ");
      log(`Going to XYZ: ${x}, ${y}, ${z}`);
      bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
    }
    if (r === "on") {
      scriptRepeater(goTo, info.default.interval).then(() => {
        return;
      });
    } else goTo();
  });
}

module.exports = {
  info,
  script,
};
