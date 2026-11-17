// @template Health guard | Warns when health is low and can leave the server to stay safe
const info = {
  name: "HealthGuard",
  default: { interval: 500 },
  options: [
    { type: "input", label: "Alert below HP", id: "minhp" },
    { type: "checkbox", label: "Disconnect when critical", id: "leave" },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity) return log(`${info.name}: Connect a bot first`);
  let warned = false;

  async function tick() {
    const minHp = Number(await getOption("minhp", info.name)) || 8;
    const leave = (await getOption("leave", info.name)) === "on";
    if (bot.health <= minHp && !warned) {
      warned = true;
      log(`${info.name}: Low health! ${Math.round(bot.health)}/20 HP`);
      if (leave && bot.health <= Math.min(4, minHp)) {
        log(`${info.name}: Critical health, disconnecting`);
        bot.quit("Low health");
      }
    } else if (bot.health > minHp + 2) {
      warned = false;
    }
  }

  log(`${info.name}: Watching health`);
  await scriptRepeater(tick, info.default.interval);
}

module.exports = { info, script };
