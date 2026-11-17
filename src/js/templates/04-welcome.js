// @template Welcome players | Greets players when they join the server
const info = {
  name: "Welcome",
  default: { interval: 1000 },
  options: [
    { type: "input", label: "Greeting ({name} = player)", id: "greeting" },
    { type: "input", label: "Delay [sec]", id: "delay" },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity) return log(`${info.name}: Connect a bot first`);
  const greeted = new Map();

  const onJoin = async (player) => {
    if (!player || player.username === bot.username) return;
    const last = greeted.get(player.username) || 0;
    if (Date.now() - last < 5 * 60 * 1000) return;
    greeted.set(player.username, Date.now());

    const template =
      (await getOption("greeting", info.name)) || "Welcome back, {name}!";
    const delay = Math.max(1, Number(await getOption("delay", info.name)) || 3);
    setTimeout(() => {
      if (bot.players[player.username]) {
        bot.chat(template.replace(/\{name\}/g, player.username));
      }
    }, delay * 1000);
  };

  bot.on("playerJoined", onJoin);
  log(`${info.name}: Greeting new players`);
  try {
    await scriptRepeater(() => {}, info.default.interval);
  } finally {
    bot.removeListener("playerJoined", onJoin);
  }
}

module.exports = { info, script };
