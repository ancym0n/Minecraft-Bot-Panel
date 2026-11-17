const { isBotEating, humanLookAt } = require("../botUtils");

const info = {
  name: "AutoFish",
  default: { interval: 1100 },
  options: [
    {
      type: "checkbox",
      label: "Auto Equip Rod",
      id: "autorod",
    },
    {
      type: "checkbox",
      label: "Anti-AFK Glance",
      id: "antiafk",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.inventory) {
    clearLog("AutoFish:");
    log("AutoFish: Connect a bot first");
    return;
  }

  let busy = false;
  let catchCount = 0;
  let lastCastTime = 0;

  clearLog("AutoFish:");
  log("AutoFish: Active (casting & reeling automatically)");

  async function fishTick() {
    if (!bot || !bot.entity || !bot.inventory || busy || isBotEating(bot)) {
      return;
    }
    busy = true;

    try {
      const [autoRodOpt, antiAfkOpt] = await Promise.all([
        getOption("autorod", info.name),
        getOption("antiafk", info.name),
      ]);

      const useAutoRod = autoRodOpt !== "off";
      const useAntiAfk = antiAfkOpt !== "off";

      let rod = bot.heldItem?.name === "fishing_rod" ? bot.heldItem : null;
      if (!rod && useAutoRod) {
        rod = bot.inventory.items().find((i) => i.name === "fishing_rod");
        if (rod) {
          await bot.equip(rod, "hand").catch(() => {});
        }
      }

      if (!rod && bot.heldItem?.name !== "fishing_rod") {
        clearLog("AutoFish status:");
        log("AutoFish status: Waiting for a fishing_rod in inventory");
        return;
      }

      // Aim toward nearby water block if visible
      if (typeof bot.findBlocks === "function") {
        const waterBlocks = bot.findBlocks({
          matching: (b) => b && b.name === "water",
          maxDistance: 10,
          count: 5,
        });
        if (waterBlocks.length > 0) {
          const wPos = waterBlocks[0].offset(0.5, 0.6, 0.5);
          await humanLookAt(bot, wPos, false);
        }
      }

      if (useAntiAfk && Date.now() - lastCastTime > 6000) {
        const yawJitter = bot.entity.yaw + (Math.random() - 0.5) * 0.04;
        const pitchJitter = bot.entity.pitch + (Math.random() - 0.5) * 0.03;
        await bot.look(yawJitter, pitchJitter, false).catch(() => {});
      }

      if (typeof bot.fish === "function") {
        lastCastTime = Date.now();
        clearLog("AutoFish status:");
        log(`AutoFish status: Line cast (Catches: ${catchCount})`);
        await bot.fish();
        catchCount++;
        clearLog("AutoFish status:");
        log(`AutoFish status: Reeled in catch #${catchCount}!`);
      } else {
        bot.activateItem();
      }
    } catch (_) {
    } finally {
      busy = false;
    }
  }

  await fishTick();
  await scriptRepeater(fishTick, info.default.interval);
}

module.exports = {
  info,
  script,
};
