const info = {
  name: "AutoArmor",
  default: { interval: 1800 },
  options: [
    {
      type: "checkbox",
      label: "Repeat",
      id: "repeat",
    },
    {
      type: "checkbox",
      label: "Offhand Shield/Totem",
      id: "offhand",
    },
  ],
};

const ARMOR_SLOTS = [
  {
    dest: "head",
    slotIndex: 5,
    ranks: [
      "netherite_helmet",
      "diamond_helmet",
      "turtle_helmet",
      "iron_helmet",
      "chainmail_helmet",
      "golden_helmet",
      "leather_helmet",
    ],
  },
  {
    dest: "torso",
    slotIndex: 6,
    ranks: [
      "netherite_chestplate",
      "diamond_chestplate",
      "iron_chestplate",
      "chainmail_chestplate",
      "golden_chestplate",
      "leather_chestplate",
      "elytra",
    ],
  },
  {
    dest: "legs",
    slotIndex: 7,
    ranks: [
      "netherite_leggings",
      "diamond_leggings",
      "iron_leggings",
      "chainmail_leggings",
      "golden_leggings",
      "leather_leggings",
    ],
  },
  {
    dest: "feet",
    slotIndex: 8,
    ranks: [
      "netherite_boots",
      "diamond_boots",
      "iron_boots",
      "chainmail_boots",
      "golden_boots",
      "leather_boots",
    ],
  },
];

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.inventory) {
    clearLog("AutoArmor:");
    log("AutoArmor: Connect a bot first");
    return;
  }

  const [repeat, offhand] = await Promise.all([
    getOption("repeat", info.name),
    getOption("offhand", info.name),
  ]);
  const signal = scriptRepeater.signal;
  if (signal?.aborted) return;

  let equipping = false;

  async function checkAndEquipArmor() {
    if (signal?.aborted || !bot || !bot.inventory || equipping) return;
    equipping = true;

    try {
      const items = bot.inventory.items();

      for (const piece of ARMOR_SLOTS) {
        if (signal?.aborted) return;
        const equipped = bot.inventory.slots[piece.slotIndex];
        const currentRank = equipped ? piece.ranks.indexOf(equipped.name) : 999;
        const effectiveCurrent = currentRank === -1 ? 999 : currentRank;

        let bestCandidate = null;
        let bestRank = effectiveCurrent;

        for (const item of items) {
          const rank = piece.ranks.indexOf(item.name);
          if (rank !== -1 && rank < bestRank) {
            bestRank = rank;
            bestCandidate = item;
          }
        }

        if (bestCandidate) {
          await bot.equip(bestCandidate, piece.dest);
          clearLog("AutoArmor:");
          log(`AutoArmor: Equipped ${bestCandidate.name}`);
        }
      }

      if (!signal?.aborted && offhand === "on") {
        const offhandSlot = bot.inventory.slots[45];
        if (
          !offhandSlot ||
          (offhandSlot.name !== "totem_of_undying" &&
            offhandSlot.name !== "shield")
        ) {
          const totem = items.find((i) => i.name === "totem_of_undying");
          const shield = items.find((i) => i.name === "shield");
          const chosen = totem || shield;
          if (chosen) {
            await bot.equip(chosen, "off-hand");
            clearLog("AutoArmor:");
            log(`AutoArmor: Equipped ${chosen.name} in off-hand`);
          }
        }
      }
    } catch (error) {
      if (!signal?.aborted) log(`AutoArmor: ${error.message || error}`);
    } finally {
      equipping = false;
    }
  }

  await checkAndEquipArmor();
  if (!signal?.aborted && repeat === "on") {
    await scriptRepeater(checkAndEquipArmor, info.default.interval);
  }
}

module.exports = {
  info,
  script,
};
