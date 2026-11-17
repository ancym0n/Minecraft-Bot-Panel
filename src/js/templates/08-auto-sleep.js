// @template Auto sleep | Finds a nearby bed and sleeps through the night
const info = {
  name: "AutoSleep",
  default: { interval: 5000 },
  options: [{ type: "input", label: "Bed search range", id: "range" }],
};

async function script(bot, log, clearLog, getOption, scriptRepeater, libs) {
  if (!bot || !bot.entity) return log(`${info.name}: Connect a bot first`);
  const { goals } = libs;
  const range = Math.max(4, Number(await getOption("range", info.name)) || 24);
  let busy = false;

  async function tick() {
    if (busy || bot.isSleeping || bot.time.isDay) return;
    const bed = bot.findBlock({
      matching: (block) => bot.isABed(block),
      maxDistance: range,
    });
    if (!bed) return;
    busy = true;
    try {
      await bot.pathfinder.goto(
        new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2),
      );
      await bot.sleep(bed);
      log(`${info.name}: Sleeping`);
    } catch (err) {
      log(`${info.name}: ${err.message}`);
    } finally {
      busy = false;
    }
  }

  log(`${info.name}: Will sleep at night (bed within ${range} blocks)`);
  await scriptRepeater(tick, info.default.interval);
}

module.exports = { info, script };
