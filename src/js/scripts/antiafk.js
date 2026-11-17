const info = {
  name: "AntiAFK",
  default: { interval: 1200 },
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

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity) {
    clearLog("AntiAFK:");
    log("AntiAFK: Connect a bot first");
    return;
  }

  function doJump() {
    if (!bot || !bot.entity) return;
    bot.setControlState("jump", true);
    setTimeout(() => {
      if (bot && bot.entity) bot.setControlState("jump", false);
    }, 150);
  }

  function doMove() {
    if (!bot || !bot.entity) return;
    bot.setControlState("forward", true);
    setTimeout(() => {
      if (!bot || !bot.entity) return;
      bot.setControlState("forward", false);
      bot.setControlState("back", true);
      setTimeout(() => {
        if (bot && bot.entity) bot.setControlState("back", false);
      }, 250);
    }, 250);
  }

  function doSneak() {
    if (!bot || !bot.entity) return;
    bot.setControlState("sneak", true);
    setTimeout(() => {
      if (bot && bot.entity) bot.setControlState("sneak", false);
    }, 450);
  }

  function doRotate() {
    if (!bot || !bot.entity) return;
    const randomYaw = Math.random() * Math.PI * 2;
    const randomPitch = (Math.random() - 0.5) * Math.PI;
    bot.look(randomYaw, randomPitch, true);
  }

  const [jumpSetting, moveSetting, rotateSetting, sneakSetting] =
    await Promise.all([
      getOption("jump", info.name),
      getOption("move", info.name),
      getOption("rotate", info.name),
      getOption("sneak", info.name),
    ]);

  const selectedActions = [];
  if (jumpSetting === "on") selectedActions.push(doJump);
  if (moveSetting === "on") selectedActions.push(doMove);
  if (rotateSetting === "on") selectedActions.push(doRotate);
  if (sneakSetting === "on") selectedActions.push(doSneak);

  if (selectedActions.length === 0) {
    selectedActions.push(doRotate);
  }

  clearLog("AntiAFK: J(");
  log(
    `AntiAFK: J(${jumpSetting}), M(${moveSetting}), R(${rotateSetting}), S(${sneakSetting})`,
  );

  function antiAfk() {
    if (!bot || !bot.entity || selectedActions.length === 0) return;
    const action =
      selectedActions[Math.floor(Math.random() * selectedActions.length)];
    if (typeof action === "function") action();
  }

  antiAfk();
  await scriptRepeater(antiAfk, info.default.interval);

  if (bot && bot.entity) {
    ["jump", "forward", "back", "sneak"].forEach((state) => {
      bot.setControlState(state, false);
    });
  }
}

module.exports = {
  info,
  script,
};
