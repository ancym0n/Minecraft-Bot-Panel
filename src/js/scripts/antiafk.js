let info = {
  name: "AntiAFK",
  default: { interval: 1000 },
  options: [
    {
      type: "checkbox",
      label: "Jump",
      id: "jump",
    },
    {
      type: "checkbox",
      label: "Move",
      id: "move",
    },
    {
      type: "checkbox",
      label: "Rotate",
      id: "rotate",
    },
    {
      type: "checkbox",
      label: "Sneak",
      id: "sneak",
    },
  ],
};

function script(bot, log, clearLog, getOption, scriptRepeater) {
  let jump;
  let move;
  let rotate;
  let sneak;

  function doJump() {
    bot.setControlState("jump", true);
    setTimeout(() => {
      bot.setControlState("jump", false);
    }, 100);
  }

  function doMove() {
    bot.setControlState("forward", true);
    setTimeout(() => {
      bot.setControlState("forward", false);
      bot.setControlState("back", true);
      setTimeout(() => {
        bot.setControlState("back", false);
      }, 250);
    }, 250);
  }

  function doSneak() {
    bot.setControlState("sneak", true);
    setTimeout(() => {
      bot.setControlState("sneak", false);
    }, 500);
  }

  function doRotate() {
    const randomYaw = Math.random() * Math.PI * 2;
    const randomPitch = (Math.random() - 0.5) * Math.PI;
    bot.look(randomYaw, randomPitch, true);
  }

  function getRandomNumber(num) {
    return Math.floor(Math.random() * num);
  }
  getOption("jump", info.name).then((jumpSetting) => {
    getOption("move", info.name).then((moveSetting) => {
      getOption("rotate", info.name).then((rotateSetting) => {
        getOption("sneak", info.name).then((sneakSetting) => {
          let selectedActions = [];
          clearLog("AntiAFK: J(");
          log(
            `AntiAFK: J(${jumpSetting}), M(${moveSetting}), R(${rotateSetting}), S(${sneakSetting})`
          );
          if (jumpSetting === "on") selectedActions.push(doJump);
          if (moveSetting === "on") selectedActions.push(doMove);
          if (rotateSetting === "on") selectedActions.push(doRotate);
          if (sneakSetting === "on") selectedActions.push(doSneak);
          function antiAfk() {
            selectedActions[getRandomNumber(selectedActions.length)]();
          }
          scriptRepeater(antiAfk, info.default.interval).then(() => {
            return;
          });
        });
      });
    });
  });
}

module.exports = {
  info,
  script,
};
