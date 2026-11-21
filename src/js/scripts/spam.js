const info = {
  name: "Spam",
  default: { interval: 5000 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
    },
    {
      type: "checkbox",
      label: "AntiKick",
      id: "antikick",
    },
    {
      type: "input",
      label: "Message",
      id: "message",
    },
    {
      type: "input",
      label: "Delay [ms]",
      id: "delay",
    },
  ],
};

function antiKickString() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 5; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }
  return result;
}

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || typeof bot.chat !== "function") {
    clearLog("Spam:");
    log("Spam: Connect a bot first");
    return;
  }

  const [rawMessage, antikick, rawDelay, repeat] = await Promise.all([
    getOption("message", info.name),
    getOption("antikick", info.name),
    getOption("delay", info.name),
    getOption("repeat", info.name),
  ]);
  const signal = scriptRepeater.signal;
  if (signal?.aborted) return;

  const spamMessage = String(rawMessage || "").trim();
  if (!spamMessage) {
    clearLog("Spam:");
    log("Spam: Enter a message first");
    return;
  }

  const antiKickStatus = antikick === "on";
  const parsedDelay = parseInt(rawDelay, 10);
  const realDelay =
    Number.isFinite(parsedDelay) && parsedDelay >= 100
      ? parsedDelay
      : info.default.interval;

  clearLog("Spam delay set to ");
  log(`Spam delay set to ${realDelay}ms`);

  let totalMessageCount = 0;

  function spam() {
    if (signal?.aborted || !bot || typeof bot.chat !== "function") return;
    const formattedMessage = antiKickStatus
      ? `${spamMessage} | ${antiKickString()}`
      : spamMessage;
    bot.chat(formattedMessage);
    totalMessageCount += 1;
    clearLog("Spam amount: ");
    log(`Spam amount: ${totalMessageCount} message(s) sent`);
  }

  spam();
  if (!signal?.aborted && repeat === "on") {
    await scriptRepeater(spam, realDelay);
  }
}

module.exports = {
  info,
  script,
};
