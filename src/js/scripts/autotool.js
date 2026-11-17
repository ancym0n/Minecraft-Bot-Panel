const {
  isBotEating,
  equipBestToolForBlock,
  equipBestWeapon,
  getVisibleDigFace,
  isHostile,
} = require("../botUtils");

const info = {
  name: "AutoTool",
  default: { interval: 220 },
  options: [
    {
      type: "checkbox",
      label: "Mine Tools",
      id: "minetool",
    },
    {
      type: "checkbox",
      label: "Combat Weapon",
      id: "weapon",
    },
    {
      type: "checkbox",
      label: "Save Durability",
      id: "savedur",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.inventory) {
    clearLog("AutoTool:");
    log("AutoTool: Connect a bot first");
    return;
  }

  let busy = false;
  let lastEquippedName = "";

  async function onBlockBreakProgress(block) {
    if (!bot || !block || busy) return;
    const [mineToolOpt, saveDurOpt] = await Promise.all([
      getOption("minetool", info.name),
      getOption("savedur", info.name),
    ]);
    if (mineToolOpt === "off") return;
    busy = true;
    try {
      const tool = await equipBestToolForBlock(bot, block, {
        saveLowDurability: saveDurOpt !== "off",
      });
      if (tool && tool.name !== lastEquippedName) {
        lastEquippedName = tool.name;
        clearLog("AutoTool:");
        log(`AutoTool: Switched to ${tool.name} for ${block.name}`);
      }
    } catch (_) {
    } finally {
      busy = false;
    }
  }

  async function autoToolTick() {
    if (!bot || !bot.entity || !bot.inventory || busy) return;

    const [mineToolOpt, weaponOpt, saveDurOpt] = await Promise.all([
      getOption("minetool", info.name),
      getOption("weapon", info.name),
      getOption("savedur", info.name),
    ]);

    const useMineTool = mineToolOpt !== "off" || weaponOpt === "off";
    const useWeapon = weaponOpt !== "off";
    const saveLowDurability = saveDurOpt !== "off";

    busy = true;
    try {
      if (isBotEating(bot)) return;

      // If currently digging a target block, equip the fastest harvest tool
      if (useMineTool && bot.targetDigBlock) {
        const targetBlock = bot.targetDigBlock;
        const prevSlot = bot.heldItem?.slot;
        const tool = await equipBestToolForBlock(bot, targetBlock, {
          saveLowDurability,
        });
        if (tool && tool.name !== lastEquippedName) {
          lastEquippedName = tool.name;
          clearLog("AutoTool:");
          log(`AutoTool: Equipped ${tool.name} for ${targetBlock.name}`);
        }
        // If we switched slots while digging was already in progress, restart
        // bot.dig with the new tool so server & client dig timers stay synced.
        if (
          tool &&
          bot.heldItem?.slot !== prevSlot &&
          bot.targetDigBlock === targetBlock
        ) {
          const face = getVisibleDigFace(bot, targetBlock);
          bot.dig(targetBlock, true, face).catch(() => {});
        }
        return;
      }

      // If a hostile mob is within melee range (4.5m), equip best weapon
      if (useWeapon && bot.entities) {
        let threatNear = false;
        for (const e of Object.values(bot.entities)) {
          if (!e || e === bot.entity || !e.position) continue;
          if (
            isHostile(e) &&
            e.position.distanceTo(bot.entity.position) <= 4.6
          ) {
            threatNear = true;
            break;
          }
        }
        if (threatNear) {
          const weapon = await equipBestWeapon(bot, { saveLowDurability });
          if (weapon && weapon.name !== lastEquippedName) {
            lastEquippedName = weapon.name;
            clearLog("AutoTool:");
            log(`AutoTool: Equipped ${weapon.name} for combat`);
          }
          return;
        }
      }

      // Check block in line of sight if close
      if (useMineTool && typeof bot.blockAtCursor === "function") {
        const cursorBlock = bot.blockAtCursor(4.5);
        if (cursorBlock && bot.targetDigBlock) {
          await equipBestToolForBlock(bot, cursorBlock, { saveLowDurability });
        }
      }
    } catch (_) {
    } finally {
      busy = false;
    }
  }

  bot.on("diggingAborted", onBlockBreakProgress);

  clearLog("AutoTool:");
  log("AutoTool: Active (monitoring mining & combat)");

  try {
    await autoToolTick();
    await scriptRepeater(autoToolTick, info.default.interval);
  } finally {
    if (bot) {
      bot.removeListener("diggingAborted", onBlockBreakProgress);
    }
  }
}

module.exports = {
  info,
  script,
};
