// @template Collect blocks | Pathfinds to the nearest block of a type and mines it
const info = {
  name: "CollectBlocks",
  default: { interval: 500 },
  options: [
    { type: "input", label: "Block id (e.g. oak_log)", id: "block" },
    { type: "input", label: "Amount", id: "amount" },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater, libs) {
  if (!bot || !bot.entity) return log(`${info.name}: Connect a bot first`);
  const { goals } = libs;
  const blockName = String((await getOption("block", info.name)) || "oak_log")
    .trim()
    .toLowerCase();
  const amount = Math.max(
    1,
    Number(await getOption("amount", info.name)) || 16,
  );
  const blockType = bot.registry.blocksByName[blockName];
  if (!blockType) return log(`${info.name}: Unknown block "${blockName}"`);

  let mined = 0;
  let busy = false;

  async function tick() {
    if (busy || mined >= amount) return;
    busy = true;
    try {
      const block = bot.findBlock({ matching: blockType.id, maxDistance: 48 });
      if (!block) {
        clearLog(`${info.name}:`);
        log(`${info.name}: No ${blockName} nearby`);
        return;
      }
      await bot.pathfinder.goto(
        new goals.GoalLookAtBlock(block.position, bot.world, { reach: 4 }),
      );
      const tool = bot.pathfinder.bestHarvestTool(block);
      if (tool) await bot.equip(tool, "hand");
      await bot.dig(block, true);
      mined += 1;
      clearLog(`${info.name}:`);
      log(`${info.name}: ${mined}/${amount} ${blockName}`);
    } catch (err) {
      log(`${info.name}: ${err.message}`);
    } finally {
      busy = false;
    }
  }

  try {
    await scriptRepeater(tick, info.default.interval);
  } finally {
    bot.pathfinder.setGoal(null);
  }
}

module.exports = { info, script };
