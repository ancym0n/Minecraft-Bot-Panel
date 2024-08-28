let info = {
  name: "ClearInv",
  default: { interval: 200 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
    },
  ],
};

function script(bot, log, clearLog, getOption, scriptRepeater) {
  getOption("repeat", info.name).then((r) => {
    function dropAllItems() {
      const items = bot.inventory.items();

      if (items.length === 0) {
        clearLog("No items to drop");
        log("No items to drop");
        return;
      }

      let i = 0;
      function dropNext() {
        if (i >= items.length) {
          clearLog("Dropped all items (Total: ");
          log("Dropped all items (Total: " + items.length + ")");
          return;
        }

        const item = items[i];
        bot.tossStack(item, (err) => {
          i++;
          dropNext();
        });
      }

      dropNext();
    }

    if (r === "on") {
      scriptRepeater(dropAllItems, info.default.interval).then(() => {
        return;
      });
    } else dropAllItems();
  });
}

module.exports = {
  info,
  script,
};
