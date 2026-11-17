const { isBotEating, findBestFood, consumeFoodSafely } = require("../botUtils");

const info = {
  name: "AutoEat",
  default: { interval: 900 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
    },
    {
      type: "checkbox",
      label: "Eat on Low HP",
      id: "lowhp",
    },
    {
      type: "input",
      label: "Min Food [1-20]",
      id: "minfood",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.inventory) {
    clearLog("AutoEat:");
    log("AutoEat: Connect a bot first");
    return;
  }

  const [repeat, lowHpOpt, rawMinFood] = await Promise.all([
    getOption("repeat", info.name),
    getOption("lowhp", info.name),
    getOption("minfood", info.name),
  ]);

  const parsedMin = parseInt(rawMinFood, 10);
  const minFood =
    Number.isFinite(parsedMin) && parsedMin >= 1 && parsedMin <= 20
      ? parsedMin
      : 16;
  const eatOnLowHp = lowHpOpt !== "off";
  let eating = false;

  async function tryEat() {
    if (!bot || !bot.inventory || eating || isBotEating(bot)) return;

    const currentFood = bot.food ?? 20;
    const currentHealth = bot.health ?? 20;
    const needEmergencyHeal = eatOnLowHp && currentHealth <= 13;
    const needFood = currentFood < minFood;

    if (!needFood && !needEmergencyHeal) return;

    const chosen = findBestFood(bot, { emergencyHeal: needEmergencyHeal });
    if (!chosen) return;

    eating = true;
    const previousHeld = bot.heldItem;
    try {
      clearLog("AutoEat:");
      log(
        `AutoEat: Consuming ${chosen.name} (HP: ${currentHealth.toFixed(0)}/20, Food: ${currentFood}/20)`,
      );
      await consumeFoodSafely(bot, chosen);
      if (
        previousHeld &&
        previousHeld.slot !== chosen.slot &&
        bot &&
        bot.inventory
      ) {
        const stillHasPrev = bot.inventory.slots?.[previousHeld.slot];
        if (stillHasPrev) {
          try {
            await bot.equip(stillHasPrev, "hand");
          } catch (_) {}
        }
      }
    } catch (_) {
    } finally {
      eating = false;
    }
  }

  await tryEat();
  if (repeat === "on") {
    await scriptRepeater(tryEat, info.default.interval);
  }
}

module.exports = {
  info,
  script,
};
