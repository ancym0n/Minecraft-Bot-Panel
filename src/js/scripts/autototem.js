const info = {
  name: "AutoTotem",
  default: { interval: 280 },
  options: [
    {
      type: "checkbox",
      label: "AutoLog Low HP",
      id: "autolog",
    },
    {
      type: "input",
      label: "Min HP [1-20]",
      id: "minhp",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.inventory) {
    clearLog("AutoTotem:");
    log("AutoTotem: Connect a bot first");
    return;
  }

  const [autoLogOpt, rawMinHp] = await Promise.all([
    getOption("autolog", info.name),
    getOption("minhp", info.name),
  ]);
  const signal = scriptRepeater.signal;
  if (signal?.aborted) return;

  const autoLog = autoLogOpt === "on";
  const parsedMinHp = parseFloat(rawMinHp);
  const minHp =
    Number.isFinite(parsedMinHp) && parsedMinHp >= 1 && parsedMinHp <= 19
      ? parsedMinHp
      : 6;

  let busy = false;

  async function totemTick() {
    if (signal?.aborted || !bot || !bot.inventory || busy) return;
    busy = true;
    try {
      const offhandItem = bot.inventory.slots[45];
      const hasTotemOffhand =
        offhandItem && offhandItem.name === "totem_of_undying";

      if (!hasTotemOffhand) {
        const items = bot.inventory.items();
        const totem = items.find((i) => i.name === "totem_of_undying");
        if (totem) {
          await bot.equip(totem, "off-hand");
          clearLog("AutoTotem:");
          log("AutoTotem: Equipped Totem of Undying in off-hand");
        } else if (!offhandItem) {
          const shield = items.find((i) => i.name === "shield");
          if (shield) {
            await bot.equip(shield, "off-hand");
          }
        }
      }

      if (
        !signal?.aborted &&
        autoLog &&
        typeof bot.health === "number" &&
        bot.health > 0 &&
        bot.health <= minHp
      ) {
        const currentOffhand = bot.inventory.slots[45];
        if (!currentOffhand || currentOffhand.name !== "totem_of_undying") {
          log(
            `AutoTotem: Health critical (${bot.health.toFixed(1)} HP) with no totem - disconnecting!`,
          );
          bot.quit("AutoLog: Low HP");
        }
      }
    } catch (error) {
      if (!signal?.aborted) log(`AutoTotem: ${error.message || error}`);
    } finally {
      busy = false;
    }
  }

  await totemTick();
  if (!signal?.aborted) await scriptRepeater(totemTick, info.default.interval);
}

module.exports = {
  info,
  script,
};
