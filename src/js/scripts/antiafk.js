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

  const signal = scriptRepeater.signal;
  const timers = new Set();
  const activeControls = new Set();
  const setControl = (state, active) => {
    if (!bot.entity) return;
    bot.setControlState(state, active);
    if (active) activeControls.add(state);
    else activeControls.delete(state);
  };
  const schedule = (fn, delay) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!signal?.aborted) fn();
    }, delay);
    timers.add(timer);
  };
  const cleanup = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const state of activeControls) setControl(state, false);
    activeControls.clear();
  };
  signal?.addEventListener("abort", cleanup, { once: true });

  function doJump() {
    if (!bot || !bot.entity) return;
    setControl("jump", true);
    schedule(() => {
      setControl("jump", false);
    }, 150);
  }

  function doMove() {
    if (!bot || !bot.entity) return;
    setControl("forward", true);
    schedule(() => {
      if (!bot || !bot.entity) return;
      setControl("forward", false);
      setControl("back", true);
      schedule(() => {
        setControl("back", false);
      }, 250);
    }, 250);
  }

  function doSneak() {
    if (!bot || !bot.entity) return;
    setControl("sneak", true);
    schedule(() => {
      setControl("sneak", false);
    }, 450);
  }

  function doRotate() {
    if (!bot || !bot.entity) return;
    const randomYaw = Math.random() * Math.PI * 2;
    const randomPitch = (Math.random() - 0.5) * Math.PI;
    bot.look(randomYaw, randomPitch, true);
  }

  try {
    const [jumpSetting, moveSetting, rotateSetting, sneakSetting] =
      await Promise.all([
        getOption("jump", info.name),
        getOption("move", info.name),
        getOption("rotate", info.name),
        getOption("sneak", info.name),
      ]);
    if (signal?.aborted) return;

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
      if (
        signal?.aborted ||
        !bot ||
        !bot.entity ||
        selectedActions.length === 0
      )
        return;
      const action =
        selectedActions[Math.floor(Math.random() * selectedActions.length)];
      if (typeof action === "function") action();
    }

    antiAfk();
    await scriptRepeater(antiAfk, info.default.interval);
  } finally {
    signal?.removeEventListener("abort", cleanup);
    cleanup();
  }
}

module.exports = {
  info,
  script,
};
