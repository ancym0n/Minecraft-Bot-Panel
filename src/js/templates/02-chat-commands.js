// @template Chat commands | Players type !come, !pos, !stop in chat and the bot obeys
const info = {
  name: "ChatCommands",
  default: { interval: 1000 },
  options: [
    { type: "input", label: "Owner (empty = anyone)", id: "owner" },
    { type: "input", label: "Prefix", id: "prefix" },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater, libs) {
  if (!bot || !bot.entity) return log(`${info.name}: Connect a bot first`);
  const { goals } = libs;
  const owner = String((await getOption("owner", info.name)) || "").trim();
  const prefix = String((await getOption("prefix", info.name)) || "!").trim();

  const onChat = (username, message) => {
    if (username === bot.username || !message.startsWith(prefix)) return;
    if (owner && username.toLowerCase() !== owner.toLowerCase()) return;
    const [cmd, ...args] = message.slice(prefix.length).trim().split(/\s+/);
    const player = bot.players[username]?.entity;

    if (cmd === "come" && player) {
      const p = player.position;
      bot.pathfinder.setGoal(new goals.GoalNear(p.x, p.y, p.z, 2));
      bot.chat(`Coming, ${username}!`);
    } else if (cmd === "follow" && player) {
      bot.pathfinder.setGoal(new goals.GoalFollow(player, 2), true);
      bot.chat("Following you.");
    } else if (cmd === "pos") {
      const p = bot.entity.position;
      bot.chat(
        `I'm at ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`,
      );
    } else if (cmd === "stop") {
      bot.pathfinder.setGoal(null);
      bot.chat("Stopped.");
    } else if (cmd === "say" && args.length) {
      bot.chat(args.join(" "));
    }
  };

  bot.on("chat", onChat);
  log(
    `${info.name}: Listening for ${prefix}come ${prefix}follow ${prefix}pos ${prefix}stop ${prefix}say`,
  );
  try {
    await scriptRepeater(() => {}, info.default.interval);
  } finally {
    bot.removeListener("chat", onChat);
  }
}

module.exports = { info, script };
