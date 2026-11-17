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

  const repeat = await getOption("repeat", info.name);
  let isDropping = false;

  function dropAllItems() {
    if (!bot || !bot.inventory || isDropping) return;
    const items = bot.inventory.items();

    if (items.length === 0) {
      clearLog("No items to drop");
      log("No items to drop");
      return;
    }

    isDropping = true;
    let i = 0;

    function dropNext() {
      if (!bot || !bot.inventory || i >= items.length) {
        isDropping = false;
        clearLog("Dropped all items (Total: ");
        log(`Dropped all items (Total: ${items.length})`);
        return;
      }

      const item = items[i];
      bot.tossStack(item, () => {
        i++;
        dropNext();
      });
    }

    dropNext();
  }

  dropAllItems();
  if (repeat === "on") {
    await scriptRepeater(dropAllItems, info.default.interval);
  }
}

module.exports = {
  info,
  script,
};
