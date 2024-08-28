let info = {
  name: "Follow",
  default: { interval: 1000 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
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

function script(bot, log, clearLog, getOption, scriptRepeater) {
  const { goals } = require("mineflayer-pathfinder");
  let playerName;
  let realDelay;
  function toNumber(num) {
    let parsed = parseInt(num);
    if (!isNaN(parsed)) return parsed;
    else return false;
  }
  getOption("playername", info.name).then((playername) => {
    playerName = playername;
  });
  getOption("delay", info.name).then((delay) => {
    if (toNumber(delay) === false) realDelay = info.default.interval;
    else realDelay = toNumber(delay);
  });

  getOption("repeat", info.name).then((r) => {
    function follow() {
      const player = bot.players[playerName]?.entity;
      if (!player) {
        clearLog(`Couldn't find player "`);
        log(`Couldn't find player "${playerName}"`);
        return;
      }

      const { x, y, z } = player.position;
      clearLog("Following player: ");
      log(
        `Following player: ${playerName} (${
          parseInt(x) + ", " + parseInt(y) + ", " + parseInt(z)
        })`
      );

      bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
    }
    if (r === "on") {
      scriptRepeater(follow, realDelay).then(() => {
        return;
      });
    } else follow();
  });
}

module.exports = {
  info,
  script,
};
