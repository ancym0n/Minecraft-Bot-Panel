const info = {
  name: "AutoReconnect",
  default: { interval: 2000 },
  options: [
    {
      type: "checkbox",
      label: "Resume Scripts",
      id: "resumescripts",
    },
    {
      type: "input",
      label: "Delay [sec]",
      id: "delay",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  const [resumeOpt, rawDelay] = await Promise.all([
    getOption("resumescripts", info.name),
    getOption("delay", info.name),
  ]);
  if (scriptRepeater.signal?.aborted) return;

  const parsedDelay = parseFloat(rawDelay);
  const delaySec =
    Number.isFinite(parsedDelay) && parsedDelay >= 1 && parsedDelay <= 300
      ? parsedDelay
      : 5;

  clearLog("AutoReconnect:");
  log(
    `AutoReconnect: Armed (rejoin after ${delaySec}s${resumeOpt !== "off" ? ", resume scripts" : ""})`,
  );

  async function keepArmed() {
    if (!bot) return;
    const [liveResume, liveDelay] = await Promise.all([
      getOption("resumescripts", info.name),
      getOption("delay", info.name),
    ]);
    if (scriptRepeater.signal?.aborted) return;
    const d = parseFloat(liveDelay);
    bot._mcbpAutoReconnect = {
      enabled: true,
      resumeScripts: liveResume !== "off",
      delayMs: (Number.isFinite(d) && d >= 1 && d <= 300 ? d : delaySec) * 1000,
    };
  }

  await keepArmed();
  await scriptRepeater(keepArmed, info.default.interval);
}

module.exports = {
  info,
  script,
};
