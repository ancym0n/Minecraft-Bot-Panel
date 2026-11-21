const { cleanCraftingGrid } = require("../botUtils");

const info = {
  name: "ClearInv",
  default: { interval: 1000 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.inventory) {
    clearLog("ClearInv:");
    log("ClearInv: Connect a bot first");
    return;
  }

  const signal = scriptRepeater.signal;
  const repeat = await getOption("repeat", info.name);
  if (signal?.aborted) return;
  let isDropping = false;

  async function dropAllItems() {
    if (signal?.aborted || !bot || !bot.inventory || isDropping) return;
    isDropping = true;
    try {
      await cleanCraftingGrid(bot);
      if (signal?.aborted) return;
      const items = bot.inventory.items();
      if (items.length === 0) {
        clearLog("No items to drop");
        log("No items to drop");
        return;
      }

      let dropped = 0;
      for (const item of items) {
        if (signal?.aborted || !bot || !bot.inventory) return;
        try {
          await bot.tossStack(item);
          dropped++;
        } catch (err) {
          if (!signal?.aborted) {
            log(`ClearInv: Could not drop ${item.name}: ${err.message || err}`);
          }
        }
      }
      if (signal?.aborted) return;
      clearLog("ClearInv:");
      log(`ClearInv: Dropped ${dropped}/${items.length} item stacks`);
    } finally {
      isDropping = false;
    }
  }

  await dropAllItems();
  if (repeat === "on" && !signal?.aborted) {
    await scriptRepeater(dropAllItems, info.default.interval);
  }
}

module.exports = {
  info,
  script,
};
