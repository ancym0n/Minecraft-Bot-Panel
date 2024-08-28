let info = {
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

function script(bot, log, clearLog, getOption, scriptRepeater) {
  let totalMessageCount = 0;
  let formattedMessage;
  let antiKickStatus;
  let realDelay;
  let spamMessage;

  getOption("message", info.name).then((message) => {
    spamMessage = message;
  });
  getOption("antikick", info.name).then((antikick) => {
    if (antikick === "on") antiKickStatus = true;
    else antiKickStatus = false;
  });
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
  getOption("delay", info.name).then((delay) => {
    let parsed = parseInt(delay);
    if (!isNaN(parsed)) realDelay = parsed;
    else realDelay = info.default.interval;
    clearLog("Spam delay set to ");
    log("Spam delay set to " + realDelay);
  });
  function spam() {
    formattedMessage = spamMessage;
    if (antiKickStatus) formattedMessage += " | " + antiKickString();
    bot.chat(formattedMessage);
    totalMessageCount += 1;
    clearLog("Spam amount: ");
    log(`Spam amount: ${totalMessageCount} message(s) sent`);
  }
  getOption("repeat", info.name).then((r) => {
    if (r === "on") {
      scriptRepeater(spam, realDelay).then(() => {
        return;
      });
    } else spam();
  });
}

module.exports = {
  info,
  script,
};
