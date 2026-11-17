// @template Timed announcer | Rotates through chat messages on a safe, randomized interval
const info = {
  name: "Announcer",
  default: { interval: 1000 },
  options: [
    { type: "input", label: "Messages (separate with |)", id: "messages" },
    { type: "input", label: "Every [sec] (min 15)", id: "every" },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity) return log(`${info.name}: Connect a bot first`);
  let index = 0;
  let nextAt = 0;

  async function tick() {
    if (Date.now() < nextAt) return;
    const raw = (await getOption("messages", info.name)) || "Hello everyone!";
    const messages = raw
      .split("|")
      .map((m) => m.trim())
      .filter(Boolean);
    const everySec = Math.max(
      15,
      Number(await getOption("every", info.name)) || 60,
    );
    if (!messages.length) return;

    bot.chat(messages[index % messages.length]);
    index += 1;
    // Random jitter so anti-spam plugins don't flag a fixed rhythm.
    nextAt = Date.now() + everySec * 1000 * (0.9 + Math.random() * 0.25);
  }

  log(`${info.name}: Started`);
  await scriptRepeater(tick, info.default.interval);
}

module.exports = { info, script };
