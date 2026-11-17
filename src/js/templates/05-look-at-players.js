// @template Look at players | Smoothly faces the nearest player like a real person
const info = {
  name: "LookAtPlayers",
  default: { interval: 250 },
  options: [{ type: "input", label: "Range [blocks]", id: "range" }],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity) return log(`${info.name}: Connect a bot first`);
  const range = Math.max(2, Number(await getOption("range", info.name)) || 12);

  async function tick() {
    const target = bot.nearestEntity(
      (e) =>
        e.type === "player" &&
        e.position.distanceTo(bot.entity.position) <= range,
    );
    if (target) {
      await bot.lookAt(target.position.offset(0, target.height || 1.6, 0));
    }
  }

  log(`${info.name}: Watching players within ${range} blocks`);
  await scriptRepeater(tick, info.default.interval);
}

module.exports = { info, script };
