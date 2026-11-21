const HOSTILE_NAMES = new Set([
  "blaze",
  "bogged",
  "breeze",
  "cave_spider",
  "creaking",
  "creeper",
  "drowned",
  "elder_guardian",
  "enderman",
  "endermite",
  "evoker",
  "ghast",
  "giant",
  "guardian",
  "hoglin",
  "husk",
  "illusioner",
  "magma_cube",
  "phantom",
  "piglin",
  "piglin_brute",
  "pillager",
  "ravager",
  "shulker",
  "silverfish",
  "skeleton",
  "slime",
  "spider",
  "stray",
  "vex",
  "vindicator",
  "warden",
  "witch",
  "wither",
  "wither_skeleton",
  "zoglin",
  "zombie",
  "zombie_villager",
  "zombified_piglin",
]);

const WEAPON_DAMAGE = {
  netherite_sword: 10,
  mace: 9.5,
  diamond_sword: 9,
  trident: 8.2,
  iron_sword: 7.5,
  netherite_axe: 7,
  diamond_axe: 6.2,
  stone_sword: 6,
  iron_axe: 5.2,
  golden_sword: 4.8,
  wooden_sword: 4.5,
  stone_axe: 4.2,
  golden_axe: 3.5,
  wooden_axe: 3.2,
};

// Vanilla 1.9+ attack speeds (attacks per second)
const WEAPON_ATTACK_SPEED = {
  netherite_sword: 1.6,
  diamond_sword: 1.6,
  iron_sword: 1.6,
  stone_sword: 1.6,
  golden_sword: 1.6,
  wooden_sword: 1.6,
  trident: 1.1,
  mace: 0.6,
  netherite_axe: 1.0,
  diamond_axe: 1.0,
  golden_axe: 1.0,
  iron_axe: 0.9,
  stone_axe: 0.8,
  wooden_axe: 0.8,
  netherite_pickaxe: 1.2,
  diamond_pickaxe: 1.2,
  iron_pickaxe: 1.2,
  stone_pickaxe: 1.2,
  golden_pickaxe: 1.2,
  wooden_pickaxe: 1.2,
  netherite_shovel: 1.0,
  diamond_shovel: 1.0,
  iron_shovel: 1.0,
  stone_shovel: 1.0,
  golden_shovel: 1.0,
  wooden_shovel: 1.0,
  netherite_hoe: 4.0,
  diamond_hoe: 4.0,
  iron_hoe: 3.0,
  stone_hoe: 2.0,
  golden_hoe: 1.0,
  wooden_hoe: 1.0,
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

const FOOD_PRIORITY = [
  "enchanted_golden_apple",
  "golden_apple",
  "golden_carrot",
  "cooked_porkchop",
  "cooked_beef",
  "cooked_mutton",
  "cooked_salmon",
  "baked_potato",
  "bread",
  "cooked_chicken",
  "cooked_cod",
  "cooked_rabbit",
  "pumpkin_pie",
  "mushroom_stew",
  "rabbit_stew",
  "beetroot_soup",
  "suspicious_stew",
  "apple",
  "carrot",
  "melon_slice",
  "sweet_berries",
  "glow_berries",
  "chorus_fruit",
  "cookie",
  "dried_kelp",
  "potato",
  "beetroot",
];

const MATERIAL_TIER_SCORE = {
  netherite: 6,
  diamond: 5,
  iron: 4,
  golden: 3.5,
  stone: 3,
  chainmail: 3,
  wooden: 2,
  leather: 1,
};

const ALWAYS_EDIBLE = new Set([
  "enchanted_golden_apple",
  "golden_apple",
  "chorus_fruit",
  "milk_bucket",
  "potion",
  "honey_bottle",
  "suspicious_stew",
]);

function isBotEating(bot) {
  if (!bot || !bot._mcbpEating) return false;
  if (Date.now() > (bot._mcbpEatingUntil || 0)) {
    bot._mcbpEating = false;
    return false;
  }
  return true;
}

function isBotDigging(bot) {
  return Boolean(bot && bot.targetDigBlock);
}

/**
 * Returns the 100%-charge attack cooldown in milliseconds for the given item
 * (or the bot's currently held item), accounting for 1.8 vs 1.9+ combat and Haste/Fatigue.
 */
function getWeaponCooldownMs(bot, item = bot?.heldItem) {
  if (
    bot &&
    typeof bot.supportFeature === "function" &&
    bot.supportFeature("doesntHaveOffHandSlot")
  ) {
    return 220;
  }

  const itemName = String(item?.name || "").toLowerCase();
  let attacksPerSec = WEAPON_ATTACK_SPEED[itemName];
  if (!attacksPerSec) {
    if (itemName.endsWith("_sword")) attacksPerSec = 1.6;
    else if (itemName.endsWith("_axe")) attacksPerSec = 0.9;
    else if (itemName.endsWith("_pickaxe")) attacksPerSec = 1.2;
    else if (itemName.endsWith("_shovel")) attacksPerSec = 1.0;
    else attacksPerSec = 2.2;
  }

  // Account for Haste (id 3) / Mining Fatigue (id 4) if present on bot.entity.effects
  const effects = bot?.entity?.effects;
  if (effects && typeof effects === "object") {
    const haste = effects[3] || effects.Haste || effects.haste;
    const fatigue =
      effects[4] || effects.MiningFatigue || effects.mining_fatigue;
    if (haste && typeof haste.amplifier === "number") {
      attacksPerSec *= 1 + 0.1 * (haste.amplifier + 1);
    }
    if (fatigue && typeof fatigue.amplifier === "number") {
      attacksPerSec *= Math.max(0.2, 1 - 0.1 * (fatigue.amplifier + 1));
    }
  }

  return Math.max(220, Math.ceil((1 / attacksPerSec) * 1000) + 20);
}

function isHostile(entity) {
  if (!entity || !entity.position) return false;
  const name = String(entity.name || entity.username || "").toLowerCase();
  if (HOSTILE_NAMES.has(name)) return true;
  const kind = String(entity.kind || "").toLowerCase();
  return kind.includes("hostile");
}

function getDurabilityLeft(item) {
  if (!item || !item.maxDurability) return Infinity;
  return Math.max(0, item.maxDurability - (item.durabilityUsed || 0));
}

function isLowDurability(item, minRemaining = 4) {
  if (!item || !item.maxDurability) return false;
  return getDurabilityLeft(item) <= minRemaining;
}

function getWeaponScore(item, preferAxe = false) {
  if (!item || !item.name) return -1;
  let score = WEAPON_DAMAGE[item.name] || -1;
  if (score < 0) return -1;
  if (preferAxe && item.name.endsWith("_axe")) {
    score += 1.5;
  }
  if (Array.isArray(item.enchants)) {
    for (const ench of item.enchants) {
      if (ench.name === "sharpness") score += (ench.lvl || 1) * 0.65;
      if (ench.name === "smite" || ench.name === "bane_of_arthropods") {
        score += (ench.lvl || 1) * 0.35;
      }
      if (ench.name === "fire_aspect") score += (ench.lvl || 1) * 0.4;
    }
  }
  return score;
}

async function equipBestWeapon(
  bot,
  { preferAxe = false, saveLowDurability = true, signal } = {},
) {
  if (
    signal?.aborted ||
    !bot ||
    !bot.inventory ||
    isBotEating(bot) ||
    isBotDigging(bot)
  ) {
    return null;
  }
  const items = bot.inventory.items();
  if (bot.heldItem && !items.some((i) => i.slot === bot.heldItem.slot)) {
    items.push(bot.heldItem);
  }

  let bestItem = null;
  let bestScore = -1;

  for (const item of items) {
    if (saveLowDurability && isLowDurability(item, 4)) continue;
    const score = getWeaponScore(item, preferAxe);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (bestItem && (!bot.heldItem || bot.heldItem.slot !== bestItem.slot)) {
    try {
      await bot.equip(bestItem, "hand");
    } catch (_) {}
  }
  return bestItem;
}

function guessToolClassForBlock(block) {
  if (!block) return null;
  const mat = String(block.material || "").toLowerCase();
  const name = String(block.name || "").toLowerCase();

  if (mat.includes("mineable/pickaxe")) return "_pickaxe";
  if (mat.includes("mineable/axe")) return "_axe";
  if (mat.includes("mineable/shovel")) return "_shovel";
  if (mat.includes("mineable/hoe")) return "_hoe";
  if (name === "cobweb" || name.includes("leaves") || name.includes("wool")) {
    return "shears";
  }
  if (
    name.includes("stone") ||
    name.includes("ore") ||
    name.includes("deepslate") ||
    name.includes("brick") ||
    name.includes("concrete") ||
    name.includes("terracotta") ||
    name.includes("obsidian") ||
    name.includes("iron") ||
    name.includes("gold") ||
    name.includes("diamond") ||
    name.includes("emerald") ||
    name.includes("copper") ||
    name.includes("netherite") ||
    name.includes("netherrack") ||
    name.includes("basalt") ||
    name.includes("blackstone") ||
    name.includes("quartz") ||
    name.includes("andesite") ||
    name.includes("diorite") ||
    name.includes("granite") ||
    name.includes("tuff") ||
    name.includes("calcite")
  ) {
    return "_pickaxe";
  }
  if (
    name.includes("log") ||
    name.includes("planks") ||
    name.includes("wood") ||
    name.includes("stem") ||
    name.includes("hyphae") ||
    name.includes("chest") ||
    name.includes("barrel") ||
    name.includes("fence") ||
    name.includes("door") ||
    name.includes("crafting_table") ||
    name.includes("bookshelf") ||
    name.includes("pumpkin") ||
    name.includes("melon")
  ) {
    return "_axe";
  }
  if (
    name.includes("dirt") ||
    name.includes("grass_block") ||
    name.includes("sand") ||
    name.includes("gravel") ||
    name.includes("clay") ||
    name.includes("mud") ||
    name.includes("podzol") ||
    name.includes("mycelium") ||
    name.includes("soul_") ||
    name.includes("snow") ||
    name.includes("farmland")
  ) {
    return "_shovel";
  }
  if (
    name.includes("hay") ||
    name.includes("sponge") ||
    name.includes("sculk") ||
    name.includes("wart_block") ||
    name.includes("shroomlight") ||
    name.includes("target") ||
    name.includes("moss")
  ) {
    return "_hoe";
  }
  return null;
}

function getToolTierScore(item) {
  if (!item || !item.name) return 0;
  const prefix = item.name.split("_")[0];
  let score = MATERIAL_TIER_SCORE[prefix] || 1;
  if (Array.isArray(item.enchants)) {
    for (const ench of item.enchants) {
      if (ench.name === "efficiency") score += (ench.lvl || 1) * 0.5;
      if (ench.name === "unbreaking") score += (ench.lvl || 1) * 0.15;
    }
  }
  return score;
}

async function equipBestToolForBlock(
  bot,
  block,
  { saveLowDurability = true } = {},
) {
  if (!bot || !bot.inventory || !block || isBotEating(bot)) return null;

  const items = bot.inventory.items().filter((it) => {
    return !(saveLowDurability && isLowDurability(it, 4));
  });

  const isRealHarvestTool = (it) =>
    Boolean(
      it &&
      it.name &&
      /_(pickaxe|axe|shovel|hoe|sword)$|^shears$/.test(it.name),
    );

  if (bot.pathfinder && typeof bot.pathfinder.bestHarvestTool === "function") {
    try {
      const nativeBest = bot.pathfinder.bestHarvestTool(block);
      if (
        nativeBest &&
        !(saveLowDurability && isLowDurability(nativeBest, 4))
      ) {
        if (isRealHarvestTool(nativeBest)) {
          if (!bot.heldItem || bot.heldItem.slot !== nativeBest.slot) {
            await bot.equip(nativeBest, "hand");
          }
          return nativeBest;
        }
        // Only swap to a non-tool item if we are currently holding a durability-bearing tool
        // so we don't waste tool durability on dirt/grass, and return null so AutoTool doesn't log "Equipped cobblestone for dirt".
        if (
          bot.heldItem &&
          bot.heldItem.maxDurability > 0 &&
          bot.heldItem.slot !== nativeBest.slot
        ) {
          await bot.equip(nativeBest, "hand").catch(() => {});
        }
        return null;
      }
    } catch (_) {}
  }

  const wantedSuffix = guessToolClassForBlock(block);
  if (!wantedSuffix) return null;

  let bestTool = null;
  let bestScore = -1;

  for (const item of items) {
    const matches =
      wantedSuffix === "shears"
        ? item.name === "shears" || item.name.endsWith("_hoe")
        : item.name.endsWith(wantedSuffix);
    if (!matches) continue;
    const score = getToolTierScore(item);
    if (score > bestScore) {
      bestScore = score;
      bestTool = item;
    }
  }

  if (bestTool && (!bot.heldItem || bot.heldItem.slot !== bestTool.slot)) {
    try {
      await bot.equip(bestTool, "hand");
    } catch (_) {}
  }
  return bestTool;
}

async function equipBestArmor(bot, { includeOffhand = true, signal } = {}) {
  if (signal?.aborted || !bot || !bot.inventory) return [];
  const equippedNames = [];
  const items = bot.inventory.items();

  for (const piece of ARMOR_SLOTS) {
    if (signal?.aborted) return equippedNames;
    const current = bot.inventory.slots[piece.slotIndex];
    const currentRank = current ? piece.ranks.indexOf(current.name) : 999;
    const effectiveCurrent = currentRank === -1 ? 999 : currentRank;

    let bestCandidate = null;
    let bestRank = effectiveCurrent;

    for (const item of items) {
      if (isLowDurability(item, 3)) continue;
      const rank = piece.ranks.indexOf(item.name);
      if (rank !== -1 && rank < bestRank) {
        bestRank = rank;
        bestCandidate = item;
      }
    }

    if (bestCandidate) {
      try {
        await bot.equip(bestCandidate, piece.dest);
        equippedNames.push(bestCandidate.name);
      } catch (_) {}
    }
  }

  if (includeOffhand && !signal?.aborted) {
    const offhandSlot = bot.inventory.slots[45];
    if (
      !offhandSlot ||
      (offhandSlot.name !== "totem_of_undying" && offhandSlot.name !== "shield")
    ) {
      const freshItems = bot.inventory.items();
      const totem = freshItems.find((i) => i.name === "totem_of_undying");
      const shield = freshItems.find(
        (i) => i.name === "shield" && !isLowDurability(i, 4),
      );
      const chosen = totem || shield;
      if (chosen) {
        try {
          await bot.equip(chosen, "off-hand");
          equippedNames.push(chosen.name);
        } catch (_) {}
      }
    }
  }

  return equippedNames;
}

function findBestFood(bot, { emergencyHeal = false } = {}) {
  if (!bot || !bot.inventory) return null;
  const items = bot.inventory.items();
  const foodById = bot.registry?.foodsByName || {};
  const isFoodFull =
    (bot.food ?? 20) >= 20 && bot.game?.gameMode !== "creative";

  let chosen = null;
  let bestScore = -1;

  for (const item of items) {
    if (isFoodFull && !ALWAYS_EDIBLE.has(item.name)) {
      continue;
    }
    if (emergencyHeal && item.name === "enchanted_golden_apple") {
      return item;
    }
    if (emergencyHeal && item.name === "golden_apple") {
      chosen = item;
      bestScore = 999;
      continue;
    }
    const priorityIdx = FOOD_PRIORITY.indexOf(item.name);
    const isKnownFood = priorityIdx !== -1 || Boolean(foodById[item.name]);
    if (!isKnownFood) continue;

    if (!emergencyHeal && item.name.includes("golden_apple")) {
      if (!chosen) chosen = item;
      continue;
    }

    const score =
      priorityIdx !== -1
        ? 100 - priorityIdx
        : foodById[item.name]?.foodPoints || 1;
    if (score > bestScore) {
      bestScore = score;
      chosen = item;
    }
  }

  return chosen;
}

/**
 * Safely consumes `foodItem` while locking `bot._mcbpEating = true` so combat
 * scripts (Hunt, KillAura, Guard, Survival, AutoTool) pause attacking and do
 * not swap weapons mid-eat. Also works around Mineflayer's heldItemChanged
 * premature resolve bug by waiting for entityStatus 9 or actual consumption.
 */
async function consumeFoodSafely(bot, foodItem, { signal } = {}) {
  if (signal?.aborted || !bot || !bot.entity || !bot.inventory || !foodItem)
    return false;
  if (isBotEating(bot) && bot._mcbpEatPromise) {
    return bot._mcbpEatPromise;
  }

  const runEat = async () => {
    bot._mcbpEating = true;
    bot._mcbpEatingUntil = Date.now() + 2400;
    try {
      if (bot.controlState?.sprint) {
        bot.setControlState("sprint", false);
      }

      if (!bot.heldItem || bot.heldItem.slot !== foodItem.slot) {
        await bot.equip(foodItem, "hand");
        await new Promise((r) => setTimeout(r, 60));
      }

      if (signal?.aborted || !bot || !bot.entity) return false;
      const held = bot.heldItem || foodItem;
      const startCount = held.count || 1;
      const startFood = bot.food ?? 20;

      await new Promise((resolve) => {
        let finished = false;
        let timer = null;
        let pollTimer = null;

        const done = () => {
          if (finished) return;
          finished = true;
          if (timer) clearTimeout(timer);
          if (pollTimer) clearInterval(pollTimer);
          signal?.removeEventListener("abort", done);
          if (
            bot?._client &&
            typeof bot._client.removeListener === "function"
          ) {
            bot._client.removeListener("entity_status", onStatus);
          }
          resolve();
        };

        const onStatus = (packet) => {
          if (
            bot?.entity &&
            packet.entityId === bot.entity.id &&
            packet.entityStatus === 9
          ) {
            done();
          }
        };

        if (bot._client && typeof bot._client.on === "function") {
          bot._client.on("entity_status", onStatus);
        }
        signal?.addEventListener("abort", done, { once: true });
        if (signal?.aborted) {
          done();
          return;
        }

        try {
          if (typeof bot.activateItem === "function") {
            bot.activateItem(false);
          } else if (typeof bot.consume === "function") {
            bot.consume().then(done).catch(done);
          } else {
            done();
            return;
          }
        } catch (_) {
          done();
          return;
        }

        if (finished) return;
        pollTimer = setInterval(() => {
          if (!bot || !bot.entity) {
            done();
            return;
          }
          const currentHeld = bot.heldItem;
          if (
            !currentHeld ||
            currentHeld.name !== held.name ||
            (currentHeld.count || 0) < startCount
          ) {
            done();
            return;
          }
          if ((bot.food ?? 20) > startFood && !ALWAYS_EDIBLE.has(held.name)) {
            done();
          }
        }, 75);

        timer = setTimeout(done, 1750);
      });

      try {
        if (bot && typeof bot.deactivateItem === "function") {
          bot.deactivateItem();
        }
      } catch (_) {}
      return !signal?.aborted;
    } catch (_) {
      return false;
    } finally {
      if (bot) {
        bot._mcbpEating = false;
        bot._mcbpEatingUntil = 0;
        bot._mcbpEatPromise = null;
      }
    }
  };

  bot._mcbpEatPromise = runEat();
  return bot._mcbpEatPromise;
}

/**
 * Checks if the bot needs to eat or heal during PvP/combat, and if so, pauses
 * combat to consume the best food or golden apple.
 */
async function tryCombatEat(
  bot,
  { minHp = 13, minFood = 16, onLog = null, signal } = {},
) {
  if (signal?.aborted || !bot || !bot.entity || !bot.inventory) return false;
  if (isBotEating(bot)) {
    if (bot._mcbpEatPromise) await bot._mcbpEatPromise;
    return true;
  }

  const now = Date.now();
  if (now - (bot._mcbpLastEatAttempt || 0) < 900) return false;

  const hp = bot.health ?? 20;
  const food = bot.food ?? 20;
  const needHeal = hp <= minHp;
  const needFood = food <= minFood;

  if (!needHeal && !needFood) return false;

  const bestFood = findBestFood(bot, { emergencyHeal: needHeal });
  if (!bestFood) return false;

  bot._mcbpLastEatAttempt = now;
  if (typeof onLog === "function") {
    onLog(bestFood, hp, food);
  }
  await consumeFoodSafely(bot, bestFood, { signal });
  return true;
}

/**
 * Performs a PvP melee attack with optional jump-critical timing:
 * - Never attacks while eating (`isBotEating(bot)`).
 * - When `useCrits` is true and the bot is on the ground within melee range,
 *   initiates a jump and waits for the downward falling phase (`velocity.y < -0.02`),
 *   briefly dropping sprint right before `bot.attack(target)` so the server
 *   registers a true 1.5x critical hit.
 */
async function performPvpAttack(
  bot,
  target,
  { useCrits = true, maxRange = 4.3, allowNpc = false, signal } = {},
) {
  if (
    signal?.aborted ||
    !bot ||
    !bot.entity ||
    !target ||
    !target.position ||
    isBotEating(bot)
  ) {
    return false;
  }

  // Never attack Anti-Cheat FakePlayers or Lobby NPCs during PvP/combat
  if (
    !allowNpc &&
    target.type === "player" &&
    isLikelyNpcOrFakePlayer(bot, target)
  ) {
    return false;
  }

  const dist = bot.entity.position.distanceTo(target.position);
  if (dist > maxRange) return false;

  // Respect server no-PvP zone notifications so we never spam illegal PvP packets
  const isPlayerTarget =
    target.type === "player" || Boolean(target.username && !isHostile(target));
  if (
    isPlayerTarget &&
    bot._mcbpNoPvpUntil &&
    Date.now() < bot._mcbpNoPvpUntil &&
    (!bot._mcbpNoPvpPos ||
      bot.entity.position.distanceTo(bot._mcbpNoPvpPos) <= 14)
  ) {
    return false;
  }

  const cooldownMs = getWeaponCooldownMs(bot, bot.heldItem);
  const lastAttack = bot._mcbpLastAttackTime || 0;
  const elapsed = Date.now() - lastAttack;

  const isPathing = Boolean(
    bot.pathfinder &&
    typeof bot.pathfinder.isMoving === "function" &&
    bot.pathfinder.isMoving(),
  );
  const inLiquid = Boolean(bot.entity.isInWater || bot.entity.isInLava);
  // Only initiate a standing crit-jump when in close melee range and NOT actively
  // pathfinding over obstacles (so we never disrupt pathfinder jumps).
  const canCrit = useCrits && !inLiquid && !isPathing && dist <= 3.0;

  if (!canCrit || !bot.entity.onGround) {
    if (elapsed < cooldownMs) return false;
  } else if (elapsed < cooldownMs - 240) {
    return false;
  }

  if (canCrit && bot.entity.onGround) {
    bot._mcbpCritJumping = true;
    bot.setControlState("jump", true);
    bot.jumpQueued = true;
    setTimeout(() => {
      if (bot && bot.entity) bot.setControlState("jump", false);
    }, 95);

    const startWait = Date.now();
    while (Date.now() - startWait < 310) {
      await new Promise((r) => setTimeout(r, 35));
      if (
        signal?.aborted ||
        !bot ||
        !bot.entity ||
        isBotEating(bot) ||
        !target.position
      ) {
        if (bot) bot._mcbpCritJumping = false;
        return false;
      }
      const vy = bot.entity.velocity?.y ?? 0;
      const chargeReady =
        Date.now() - (bot._mcbpLastAttackTime || 0) >= cooldownMs;
      if (!bot.entity.onGround && vy < -0.015 && chargeReady) {
        break;
      }
    }
    if (bot) bot._mcbpCritJumping = false;
  } else if (canCrit && !bot.entity.onGround) {
    const vy = bot.entity.velocity?.y ?? 0;
    if (vy > 0) {
      const startWait = Date.now();
      while (Date.now() - startWait < 170) {
        await new Promise((r) => setTimeout(r, 35));
        if (signal?.aborted || !bot || !bot.entity || isBotEating(bot))
          return false;
        if ((bot.entity.velocity?.y ?? 0) < -0.015) break;
      }
    }
  }

  if (
    signal?.aborted ||
    !bot ||
    !bot.entity ||
    !target ||
    !target.position ||
    isBotEating(bot)
  ) {
    return false;
  }
  if (Date.now() - (bot._mcbpLastAttackTime || 0) < cooldownMs) {
    return false;
  }
  if (bot.entity.position.distanceTo(target.position) > maxRange + 0.4) {
    return false;
  }

  const savedYaw = bot.entity.yaw;
  const savedPitch = bot.entity.pitch;
  const aimPos = target.position.offset(0, (target.height || 1.62) * 0.82, 0);
  await humanLookAt(bot, aimPos, true);
  if (signal?.aborted) return false;

  const isFalling =
    !bot.entity.onGround && (bot.entity.velocity?.y ?? 0) < -0.01;
  const wasSprinting = Boolean(bot.controlState?.sprint);

  if (useCrits && isFalling && wasSprinting) {
    bot.setControlState("sprint", false);
  }

  bot._mcbpLastAttackTime = Date.now();
  bot.attack(target);

  // If pathfinder is actively steering the bot, restore its movement yaw/pitch
  // immediately after swinging so looking at the target doesn't steer into walls.
  if (isPathing && bot.entity) {
    bot.entity.yaw = savedYaw;
    bot.entity.pitch = savedPitch;
  }

  if (useCrits && isFalling && wasSprinting) {
    setTimeout(() => {
      if (!signal?.aborted && bot && bot.entity && !isBotEating(bot)) {
        bot.setControlState("sprint", true);
      }
    }, 55);
  }

  return true;
}

/**
 * Computes the visible face vector (`{ x, y, z }`) of `block` pointing toward the bot's eyes
 * and digs the block cleanly (or digs an obstructing block in the line of sight first).
 */
function getVisibleDigFace(bot, block) {
  if (!bot?.entity?.position || !block?.position) {
    return { x: 0, y: 1, z: 0 };
  }
  const eyeY = bot.entity.position.y + (bot.entity.eyeHeight || 1.62);
  const dx = bot.entity.position.x - (block.position.x + 0.5);
  const dy = eyeY - (block.position.y + 0.5);
  const dz = bot.entity.position.z - (block.position.z + 0.5);

  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);

  if (ay >= ax && ay >= az) {
    return { x: 0, y: dy >= 0 ? 1 : -1, z: 0 };
  }
  if (ax >= az) {
    return { x: dx >= 0 ? 1 : -1, y: 0, z: 0 };
  }
  return { x: 0, y: 0, z: dz >= 0 ? 1 : -1 };
}

async function smartDig(
  bot,
  block,
  { autoTool = true, saveLowDurability = true, signal, canDigTarget } = {},
) {
  if (
    signal?.aborted ||
    !bot ||
    !bot.entity ||
    !block ||
    !block.position ||
    isBotEating(bot)
  ) {
    return false;
  }

  let targetToDig = bot.blockAt(block.position) || block;
  if (
    !targetToDig ||
    targetToDig.name === "air" ||
    targetToDig.name === "cave_air" ||
    targetToDig.name === "void_air" ||
    targetToDig.diggable === false
  ) {
    return false;
  }

  // Respect server block-break protection so we never spam illegal dig packets
  if (!bot._mcbpProtectedBlocks) bot._mcbpProtectedBlocks = new Set();
  const blockKey = `${targetToDig.position.x},${targetToDig.position.y},${targetToDig.position.z}`;
  if (bot._mcbpProtectedBlocks.has(blockKey)) {
    return false;
  }
  if (
    bot._mcbpProtectedZoneUntil &&
    Date.now() < bot._mcbpProtectedZoneUntil &&
    bot._mcbpProtectedZonePos &&
    targetToDig.position.distanceTo(bot._mcbpProtectedZonePos) <= 14
  ) {
    return false;
  }

  if (bot.world && typeof bot.world.raycast === "function") {
    try {
      const eyePos = bot.entity.position.offset(
        0,
        bot.entity.eyeHeight || 1.62,
        0,
      );
      const blockCenter = targetToDig.position.offset(0.5, 0.5, 0.5);
      const distToTarget = eyePos.distanceTo(blockCenter);
      if (distToTarget > 0.2 && distToTarget <= 5.2) {
        const dir = blockCenter.minus
          ? blockCenter.minus(eyePos).normalize()
          : null;
        if (dir) {
          const hit = bot.world.raycast(eyePos, dir, distToTarget);
          if (
            hit &&
            hit.position &&
            (hit.position.x !== targetToDig.position.x ||
              hit.position.y !== targetToDig.position.y ||
              hit.position.z !== targetToDig.position.z)
          ) {
            const blocker = bot.blockAt(hit.position);
            const botFloorX = Math.floor(bot.entity.position.x);
            const botFloorY = Math.floor(bot.entity.position.y);
            const botFloorZ = Math.floor(bot.entity.position.z);
            const isUnderOwnFeet =
              blocker &&
              blocker.position.x === botFloorX &&
              blocker.position.z === botFloorZ &&
              blocker.position.y < botFloorY;
            if (
              blocker &&
              !isUnderOwnFeet &&
              blocker.diggable !== false &&
              blocker.name !== "air" &&
              blocker.name !== "bedrock"
            ) {
              targetToDig = blocker;
            }
          }
        }
      }
    } catch (_) {}
  }

  if (canDigTarget && !canDigTarget(targetToDig)) return false;
  if (autoTool) {
    const prevSlot = bot.heldItem?.slot;
    await equipBestToolForBlock(bot, targetToDig, { saveLowDurability });
    if (bot.heldItem?.slot !== prevSlot) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  if (signal?.aborted || !bot || !bot.entity) return false;
  const digStartedAt = Date.now();
  const digFace = getVisibleDigFace(bot, targetToDig);
  if (signal) {
    await bot.lookAt(
      targetToDig.position.offset(
        0.5 + digFace.x * 0.5,
        0.5 + digFace.y * 0.5,
        0.5 + digFace.z * 0.5,
      ),
      true,
    );
    if (signal.aborted) return false;
    const current = bot.blockAt(targetToDig.position);
    if (!current || current.type !== targetToDig.type) return false;
    if (canDigTarget && !canDigTarget(current)) return false;
  }
  const stopOwnDig = () => {
    if (bot.targetDigBlock === targetToDig) {
      bot.stopDigging?.();
    }
  };
  signal?.addEventListener("abort", stopOwnDig, { once: true });
  try {
    await bot.dig(targetToDig, signal ? "ignore" : true, digFace);
  } catch (err) {
    if (signal?.aborted) return false;
    throw err;
  } finally {
    signal?.removeEventListener("abort", stopOwnDig);
  }
  if (signal?.aborted) return false;
  if (bot._mcbpDenied && bot._mcbpDenied.at >= digStartedAt - 100) {
    bot._mcbpProtectedBlocks.add(blockKey);
    bot._mcbpProtectedZoneUntil = Date.now() + 30000;
    bot._mcbpProtectedZonePos = targetToDig.position.clone();
    return false;
  }
  return true;
}

async function humanLookAt(bot, pos, force = false) {
  if (!bot || !bot.entity || !pos) return;
  try {
    const jitterYaw = (Math.random() - 0.5) * 0.025;
    const jitterPitch = (Math.random() - 0.5) * 0.02;
    const dx = pos.x - bot.entity.position.x;
    const dy = pos.y - (bot.entity.position.y + (bot.entity.height || 1.62));
    const dz = pos.z - bot.entity.position.z;
    const groundDist = Math.sqrt(dx * dx + dz * dz);
    const yaw = Math.atan2(-dx, -dz) + jitterYaw;
    const pitch = Math.atan2(dy, groundDist) + jitterPitch;
    await bot.look(yaw, pitch, force);
  } catch (_) {}
}

/**
 * Sets a dynamic GoalFollow without resetting pathfinder on every tick if already
 * following the same entity. Resetting GoalFollow every 400ms interrupts jumps mid-air.
 */
function setDynamicFollowGoal(bot, goals, targetEntity, range = 2) {
  if (!bot || !bot.pathfinder || !goals || !targetEntity) return;
  const prev = bot._mcbpFollowState;
  const hasGoal = Boolean(bot.pathfinder.goal);
  if (
    hasGoal &&
    prev &&
    prev.entityId === targetEntity.id &&
    prev.range === range
  ) {
    return;
  }
  bot._mcbpFollowState = {
    entityId: targetEntity.id,
    range,
  };
  bot.pathfinder.setGoal(new goals.GoalFollow(targetEntity, range), true);
}

/**
 * Clears the pathfinder goal while preserving the bot's current velocity and
 * exact position so `mineflayer-pathfinder`'s `fullStop()` does not zero out
 * knockback velocity (`velocity.x = 0; velocity.z = 0`) or snap position.
 */
function clearPathfinderGoal(bot) {
  if (!bot) return;
  bot._mcbpFollowState = null;
  if (bot.pathfinder) {
    const hasGoal = Boolean(
      bot.pathfinder.goal ||
      (typeof bot.pathfinder.isMoving === "function" &&
        bot.pathfinder.isMoving()),
    );
    if (!hasGoal) return;
    const vx = bot.entity?.velocity?.x ?? 0;
    const vy = bot.entity?.velocity?.y ?? 0;
    const vz = bot.entity?.velocity?.z ?? 0;
    const px = bot.entity?.position?.x;
    const pz = bot.entity?.position?.z;
    bot.pathfinder.setGoal(null);
    if (bot.entity?.velocity) {
      bot.entity.velocity.x = vx;
      bot.entity.velocity.y = vy;
      bot.entity.velocity.z = vz;
    }
    if (
      bot.entity?.position &&
      typeof px === "number" &&
      typeof pz === "number"
    ) {
      bot.entity.position.x = px;
      bot.entity.position.z = pz;
    }
  }
}

/**
 * Configures Baritone / Mineflayer pathfinder Movements with full safety & tick-cost rules.
 */
function configureSmartMovements(bot, mcData, Movements, options = {}) {
  if (!bot || !bot.pathfinder) return null;
  try {
    const { BaritoneMovements } = require("./baritone");
    const MovementCtor = BaritoneMovements || Movements;
    if (!MovementCtor) return null;
    const dataForVer =
      typeof mcData === "function" ? mcData(bot.version) : null;
    const movement = new MovementCtor(bot, dataForVer);
    movement.allowSprinting = options.allowSprinting !== false;
    movement.allowParkour = options.allowParkour !== false;
    movement.allowParkourAscend = options.allowParkourAscend !== false;
    movement.canDig = Boolean(options.canDig);
    movement.allow1by1towers = Boolean(options.allowPillaring);
    movement.canOpenDoors = options.canOpenDoors !== false;
    movement.avoidAdjacentHazards = options.avoidAdjacentHazards !== false;
    movement.protectValuableBlocks = options.protectValuableBlocks !== false;
    movement.maxDropDown =
      typeof options.maxDropDown === "number" ? options.maxDropDown : 4;

    if (bot.pathfinder.backtrackMemory && movement.context) {
      movement.context.backtrackMemory = bot.pathfinder.backtrackMemory;
    }

    const blocksByName =
      dataForVer?.blocksByName || bot.registry?.blocksByName || {};
    if (
      movement.blocksToAvoid &&
      typeof movement.blocksToAvoid.add === "function"
    ) {
      for (const haz of [
        "powder_snow",
        "magma_block",
        "soul_fire",
        "wither_rose",
        "campfire",
        "soul_campfire",
        "cobweb",
        "sweet_berry_bush",
        "cactus",
        "lava",
        "fire",
        "pointed_dripstone",
        "big_dripleaf",
      ]) {
        const b = blocksByName[haz];
        if (b && typeof b.id === "number") {
          movement.blocksToAvoid.add(b.id);
        }
      }
    }

    if (options.allowBridging || options.allowPillaring) {
      const scaffoldNames = [
        "cobblestone",
        "cobbled_deepslate",
        "dirt",
        "oak_planks",
        "spruce_planks",
        "birch_planks",
        "jungle_planks",
        "acacia_planks",
        "dark_oak_planks",
        "cherry_planks",
        "mangrove_planks",
        "pale_oak_planks",
        "stone",
        "netherrack",
        "andesite",
        "diorite",
        "granite",
      ];
      const scaffoldIds = [];
      const itemsByName =
        dataForVer?.itemsByName || bot.registry?.itemsByName || {};
      for (const name of scaffoldNames) {
        const b = itemsByName[name];
        if (b && typeof b.id === "number") scaffoldIds.push(b.id);
      }
      if (scaffoldIds.length > 0) {
        movement.scafoldingBlocks = scaffoldIds;
      }
    } else {
      movement.scafoldingBlocks = [];
    }

    bot.pathfinder.setMovements(movement);
    return movement;
  } catch (_) {
    return null;
  }
}

function isBlockPassable(block) {
  if (!block) return true;
  if (block.boundingBox === "empty") return true;
  const n = String(block.name || "");
  return (
    n === "air" ||
    n === "cave_air" ||
    n === "void_air" ||
    n === "water" ||
    n === "short_grass" ||
    n === "tall_grass" ||
    n === "fern" ||
    n === "snow" ||
    n.includes("carpet") ||
    n.includes("flower") ||
    n.includes("button") ||
    n.includes("pressure_plate") ||
    n.includes("torch") ||
    n.includes("sign") ||
    n.includes("banner")
  );
}

function isBlockSolidFloor(block) {
  if (!block) return false;
  if (block.boundingBox === "block") return true;
  const n = String(block.name || "");
  return (
    n.includes("slab") ||
    n.includes("stairs") ||
    n === "dirt_path" ||
    n === "farmland" ||
    n === "soul_sand" ||
    n === "mud"
  );
}

function isBlockHazard(block) {
  if (!block) return false;
  const n = String(block.name || "");
  return (
    n === "lava" ||
    n === "fire" ||
    n === "soul_fire" ||
    n === "magma_block" ||
    n === "cactus" ||
    n === "sweet_berry_bush" ||
    n === "wither_rose" ||
    n === "powder_snow"
  );
}

/**
 * Extracts text lines from any Minecraft sign block across 1.8 -> 1.21.5 / 26.1
 * (handling legacy Text1..Text4, 1.20+ front_text/back_text JSON, and 1.21.5+ NBT compounds
 * including anonymous `""` string tags and color/style codes).
 */
const SIGN_COLOR_CODES = {
  black: "§0",
  dark_blue: "§1",
  dark_green: "§2",
  dark_aqua: "§3",
  dark_red: "§4",
  dark_purple: "§5",
  gold: "§6",
  gray: "§7",
  dark_gray: "§8",
  blue: "§9",
  green: "§a",
  aqua: "§b",
  red: "§c",
  light_purple: "§d",
  yellow: "§e",
  white: "§f",
};

function unwrapNbtValue(v) {
  if (v === null || v === undefined) return v;
  if (
    typeof v === "object" &&
    !Array.isArray(v) &&
    "value" in v &&
    ("type" in v || Object.keys(v).length === 1)
  ) {
    return unwrapNbtValue(v.value);
  }
  return v;
}

function nbtNodeToText(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }
  if (typeof node === "string") {
    const trimmed = node.trim();
    if (
      !trimmed ||
      trimmed === '""' ||
      trimmed === "[object Object]" ||
      trimmed.includes("[object Object]")
    ) {
      return "";
    }
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      try {
        return nbtNodeToText(JSON.parse(trimmed));
      } catch (_) {}
    }
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(nbtNodeToText).join("");
  }
  if (typeof node === "object") {
    if (typeof node.toMotd === "function") {
      try {
        const motd = node.toMotd();
        if (motd && !motd.includes("[object Object]")) return motd;
      } catch (_) {}
    }
    if (
      "value" in node &&
      ("type" in node || Object.keys(node).length === 1) &&
      Object.keys(node).length <= 3
    ) {
      return nbtNodeToText(node.value);
    }

    let prefix = "";
    const rawColor = unwrapNbtValue(node.color);
    if (typeof rawColor === "string" && rawColor) {
      const cLower = rawColor.toLowerCase();
      if (SIGN_COLOR_CODES[cLower]) prefix += SIGN_COLOR_CODES[cLower];
      else if (/^#[0-9a-f]{6}$/i.test(rawColor)) prefix += `§${rawColor}`;
    }
    const isTrue = (v) => {
      const u = unwrapNbtValue(v);
      return u === true || u === 1 || u === "true";
    };
    if (isTrue(node.bold)) prefix += "§l";
    if (isTrue(node.italic)) prefix += "§o";
    if (isTrue(node.underlined)) prefix += "§n";
    if (isTrue(node.strikethrough)) prefix += "§m";

    let out = "";
    // 1.20.3+ / 1.21.5+ NBT text components often store plain text in the `""` key
    if ("" in node && node[""] !== undefined) {
      out += nbtNodeToText(node[""]);
    }
    if ("text" in node && node.text !== undefined) {
      out += nbtNodeToText(node.text);
    } else if ("translate" in node && node.translate !== undefined) {
      const tr = nbtNodeToText(node.translate);
      const withNode = unwrapNbtValue(node.with);
      if (Array.isArray(withNode) && withNode.length > 0) {
        out += withNode.map(nbtNodeToText).join(" ");
      } else {
        out += tr;
      }
    }

    if ("extra" in node && node.extra !== undefined) {
      const extraVal = unwrapNbtValue(node.extra);
      if (Array.isArray(extraVal)) {
        out += extraVal.map(nbtNodeToText).join("");
      } else if (extraVal && typeof extraVal === "object") {
        out += nbtNodeToText(extraVal);
      }
    }

    if ("contents" in node && !out) {
      out += nbtNodeToText(node.contents);
    }

    if (!out) return "";
    return `${prefix}${out}`;
  }
  return "";
}

function cleanSignLine(line) {
  if (!line || typeof line !== "string") return "";
  const cleaned = line
    .replace(/\[object Object\]/g, "")
    .replace(/^""$/, "")
    .trim();
  const plain = cleaned.replace(/§#[0-9a-fA-F]{6}|§[0-9a-fk-or]/gi, "").trim();
  return plain.length > 0 ? cleaned : "";
}

function extractSignText(block) {
  if (!block) return [];
  const rawLines = [];

  // 1. Parse directly from block.entity / block.blockEntity NBT first so 1.20.4+/1.21.5+
  //    NBT compound messages are never turned into "[object Object]" by prismarine-block's join('\n')
  const entitySources = [];
  if (block.entity) entitySources.push(block.entity.value || block.entity);
  try {
    if (block.blockEntity) entitySources.push(block.blockEntity);
  } catch (_) {}

  for (const val of entitySources) {
    if (!val || typeof val !== "object") continue;
    try {
      for (const side of ["front_text", "back_text"]) {
        const sideObj = unwrapNbtValue(val[side]);
        if (!sideObj || typeof sideObj !== "object") continue;
        const msgs = unwrapNbtValue(
          sideObj.messages ?? sideObj.filtered_messages,
        );
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            const line = cleanSignLine(nbtNodeToText(m));
            if (line) rawLines.push(line);
          }
        }
      }
      for (const k of ["Text1", "Text2", "Text3", "Text4"]) {
        if (val[k] !== undefined) {
          const line = cleanSignLine(nbtNodeToText(val[k]));
          if (line) rawLines.push(line);
        }
      }
      if (val.Text !== undefined) {
        const textVal = nbtNodeToText(val.Text);
        for (const l of String(textVal).split("\n")) {
          const line = cleanSignLine(l);
          if (line) rawLines.push(line);
        }
      }
    } catch (_) {}
    if (rawLines.length > 0) break;
  }

  // 2. Fallback to block.getSignText() only if NBT parsing yielded nothing,
  //    filtering out any "[object Object]" strings
  if (rawLines.length === 0 && typeof block.getSignText === "function") {
    try {
      const sides = block.getSignText();
      const arr = Array.isArray(sides) ? sides : [sides];
      for (const sideText of arr) {
        if (typeof sideText === "string" && sideText.trim()) {
          for (const l of sideText.split("\n")) {
            const line = cleanSignLine(l);
            if (line) rawLines.push(line);
          }
        } else if (sideText && typeof sideText === "object") {
          const line = cleanSignLine(nbtNodeToText(sideText));
          if (line) rawLines.push(line);
        }
      }
    } catch (_) {}
  }

  return rawLines;
}

function scanNearbySigns(bot, { maxDistance = 24, maxCount = 16 } = {}) {
  if (!bot || !bot.entity || typeof bot.findBlocks !== "function") return [];
  try {
    const positions = bot.findBlocks({
      matching: (b) => b && b.name && b.name.includes("sign"),
      maxDistance,
      count: 48,
    });

    const signs = [];
    const botPos = bot.entity.position;
    for (const pos of positions) {
      const block = bot.blockAt(pos);
      if (!block) continue;
      const lines = extractSignText(block);
      const dist = Math.round(pos.distanceTo(botPos) * 10) / 10;
      signs.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        name: block.name,
        distance: dist,
        lines,
        text: lines.join(" | "),
      });
    }

    signs.sort((a, b) => {
      const aHasText = a.lines.length > 0;
      const bHasText = b.lines.length > 0;
      if (aHasText !== bHasText) return aHasText ? -1 : 1;
      return a.distance - b.distance;
    });

    return signs.slice(0, maxCount);
  } catch (_) {
    return [];
  }
}

/**
 * Attaches a physics-tick movement & knockback assistant to `bot` that:
 * 1. Preserves server knockback (`entity_velocity`, including 1.21.5+/26.1 `lpVec3` floats)
 *    and prevents `mineflayer-pathfinder`'s `fullStop()` from zeroing knockback velocity.
 * 2. Floats in water/lava without cancelling jumps on land.
 * 3. Keeps sprint active when moving forward (unless eating or mid-crit).
 * 4. Enforces SafeWalk (`bot._mcbpSafeWalk`) when enabled so the bot sneaks at ledges/hazards.
 * 5. Sprint-jumps along clear, flat straightaways and steps over 1-block ledges,
 *    plus un-sticks the bot if it freezes ~0.1 blocks above ground.
 */
function attachCraftingFix(bot) {
  if (!bot || !bot._client || bot._mcbpCraftingFixAttached) return;
  if (typeof bot._client.write !== "function") return;
  bot._mcbpCraftingFixAttached = true;

  // 1. Fix missing `entityActionUsesStringMapper` feature in minecraft-data 1.21.6+ / 26.1
  //    Without this, mineflayer sends actionId=3 ("start_riding_jump") instead of "start_sprinting" (1),
  //    causing the server to think the bot is walking while client physics sprints -> 20x/sec server rubberbands!
  if (
    typeof bot.supportFeature === "function" &&
    !bot._mcbpSupportFeaturePatched
  ) {
    bot._mcbpSupportFeaturePatched = true;
    const origSupportFeature = bot.supportFeature.bind(bot);
    bot.supportFeature = (feature) => {
      if (feature === "entityActionUsesStringMapper") {
        return !origSupportFeature("sneakUsesEntityAction");
      }
      return origSupportFeature(feature);
    };
  }

  // 2. Add safe 120ms (2.5 tick) buffer to bot.digTime so finishDigging never fires
  //    before the server finishes breaking the block (which created client-side ghost air!).
  if (typeof bot.digTime === "function" && !bot._mcbpDigTimePatched) {
    bot._mcbpDigTimePatched = true;
    const origDigTime = bot.digTime.bind(bot);
    bot.digTime = (block) => {
      const base = origDigTime(block);
      if (!Number.isFinite(base) || base <= 0) return base;
      return base + 120;
    };
  }

  const LEGACY_ACTION_MAP = {
    2: "stop_sleeping",
    3: "start_sprinting",
    4: "stop_sprinting",
    8: "start_fall_flying",
  };

  const origWrite = bot._client.write.bind(bot._client);
  bot._client.write = function patchedWrite(name, params) {
    // Translate legacy numeric entity_action IDs to 1.21.6+/26.1 string mapper names
    if (
      name === "entity_action" &&
      params &&
      typeof params.actionId === "number" &&
      bot.supportFeature?.("entityActionUsesStringMapper")
    ) {
      const mapped = LEGACY_ACTION_MAP[params.actionId];
      if (mapped) {
        params = { ...params, actionId: mapped };
      } else if (params.actionId === 0 || params.actionId === 1) {
        return origWrite("player_input", {
          inputs: {
            forward: Boolean(bot.controlState?.forward),
            backward: Boolean(bot.controlState?.back),
            left: Boolean(bot.controlState?.left),
            right: Boolean(bot.controlState?.right),
            jump: Boolean(bot.controlState?.jump),
            shift: params.actionId === 0,
            sprint: Boolean(bot.controlState?.sprint),
          },
        });
      }
    }
    // Preserve full movement bitmask when mineflayer sends player_input for sneak
    if (
      name === "player_input" &&
      params &&
      params.inputs &&
      bot.controlState
    ) {
      params = {
        ...params,
        inputs: {
          forward: Boolean(bot.controlState.forward),
          backward: Boolean(bot.controlState.back),
          left: Boolean(bot.controlState.left),
          right: Boolean(bot.controlState.right),
          jump: Boolean(bot.controlState.jump),
          shift: Boolean(bot.controlState.sneak),
          sprint: Boolean(bot.controlState.sprint),
          ...params.inputs,
        },
      };
    }

    const res = origWrite(name, params);
    if (name === "window_click" && params && typeof params === "object") {
      const win =
        params.windowId === 0
          ? bot.inventory
          : bot.currentWindow && bot.currentWindow.id === params.windowId
            ? bot.currentWindow
            : null;
      const slot = params.slot;
      const isCraftSlot =
        win &&
        ((win.type === "minecraft:inventory" && slot >= 0 && slot <= 4) ||
          (win.type === "minecraft:crafting" && slot >= 0 && slot <= 9));

      if (isCraftSlot && typeof win.rawListeners === "function") {
        setImmediate(() => {
          const list = win.rawListeners("updateSlot:0");
          const waiter = list[list.length - 1];
          if (!waiter) return;
          const timer = setTimeout(() => {
            try {
              if (win.rawListeners("updateSlot:0").includes(waiter)) {
                win.emit("updateSlot:0", win.slots[0], win.slots[0]);
              }
            } catch (_) {}
          }, 120);
          if (typeof timer.unref === "function") timer.unref();
        });
      } else if (
        slot === -999 &&
        params.mode === 5 &&
        params.stateId === -1 &&
        typeof bot.rawListeners === "function"
      ) {
        const evt = `setWindowItems:${params.windowId}`;
        const list = bot.rawListeners(evt);
        const waiter = list[list.length - 1];
        if (waiter) {
          const timer = setTimeout(() => {
            try {
              if (bot.rawListeners(evt).includes(waiter)) {
                bot.emit(evt);
              }
            } catch (_) {}
          }, 250);
          if (typeof timer.unref === "function") timer.unref();
        }
      }
    }
    return res;
  };
}

async function cleanCraftingGrid(bot) {
  if (!bot || !bot.inventory) return;
  attachCraftingFix(bot);
  const inv = bot.inventory;
  try {
    if (inv.selectedItem) {
      await bot
        .putSelectedItemRange(inv.inventoryStart, inv.inventoryEnd, inv, null)
        .catch(() => {});
      if (inv.selectedItem) {
        await bot.clickWindow(-999, 0, 0).catch(() => {});
      }
    }
    for (let s = 1; s <= 4; s++) {
      if (inv.slots[s]) {
        await bot.putAway(s).catch(() => {});
      }
    }
  } catch (_) {}
}

/**
 * Sends a fresh `chat_session_update` (and `player_loaded` on 1.21.4+/26.1) to the current
 * backend server and clears stale seen-message signatures from any previous BungeeCord/Velocity server.
 */
function refreshChatSession(bot, { log } = {}) {
  if (!bot || !bot._client) return false;
  try {
    const client = bot._client;
    if (client._lastSeenMessages) {
      client._lastSeenMessages.pending = 0;
      if (typeof client._lastSeenMessages.offset === "number") {
        client._lastSeenMessages.offset = 0;
      }
      for (let i = 0; i < client._lastSeenMessages.length; i++) {
        client._lastSeenMessages[i] = null;
      }
    }
    if (bot.supportFeature?.("sendsPlayerLoadedPacket")) {
      try {
        client.write("player_loaded", {});
      } catch (_) {}
    }
    if (bot.supportFeature?.("useChatSessions") && client.profileKeys) {
      const crypto = require("crypto");
      client._session = {
        index: 0,
        uuid: crypto.randomUUID(),
      };
      client.write("chat_session_update", {
        sessionUUID: client._session.uuid,
        expireTime: BigInt(client.profileKeys.expiresOn.getTime()),
        publicKey: client.profileKeys.public.export({
          type: "spki",
          format: "der",
        }),
        signature: client.profileKeys.signatureV2,
      });
      if (log) {
        log("Sub-server switch: Refreshed secure chat session key");
      }
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * Fixes BungeeCord / Velocity sub-server transfers (e.g. Hub -> Survival on 1.19.3+ / 26.1)
 * where `minecraft-protocol` only registered `client.once('login')` and therefore fails to
 * send `chat_session_update` to the new backend server ("Chat disabled due to missing profile public key").
 */
function attachSubServerChatFix(bot, { log } = {}) {
  if (!bot || !bot._client || bot._mcbpSubServerChatFixAttached) return;
  if (typeof bot._client.on !== "function") return;
  bot._mcbpSubServerChatFixAttached = true;

  // If attached after initial login already happened (e.g. inside once("spawn")),
  // then the very next `login` packet IS a sub-server transfer!
  let seenInitialLogin = Boolean(bot.entity || bot._client._session);
  bot._client.on("login", (packet) => {
    if (!seenInitialLogin) {
      seenInitialLogin = true;
      return;
    }
    try {
      const client = bot._client;
      if (packet && packet.enforcesSecureChat !== undefined) {
        if (!client.serverFeatures) client.serverFeatures = {};
        client.serverFeatures.enforcesSecureChat = packet.enforcesSecureChat;
      }
      refreshChatSession(bot, { log });
      // Also send a delayed refresh 250ms later in case the backend server initializes chat session after spawn
      setTimeout(() => {
        if (bot && bot._client === client) {
          refreshChatSession(bot);
        }
      }, 250);
    } catch (_) {}
  });
}

/**
 * Locks bot control states across multiple physics ticks, running AFTER
 * `mineflayer-pathfinder`'s `monitorMovement()` on every `physicTick` so
 * pathfinder cannot cancel `jump`, `forward`, `back`, `left`, or `right` after 1 tick.
 */
function setBotControlOverride(
  bot,
  {
    durationMs = 550,
    controls = {},
    yaw = null,
    pitch = null,
    clearFirst = true,
  } = {},
) {
  if (!bot) return;
  bot._mcbpControlOverride = {
    until: Date.now() + durationMs,
    controls: { ...controls },
    yaw: typeof yaw === "number" ? yaw : null,
    pitch: typeof pitch === "number" ? pitch : null,
    clearFirst: clearFirst !== false,
  };
  if (bot.entity && typeof bot.setControlState === "function") {
    if (clearFirst !== false && typeof bot.clearControlStates === "function") {
      bot.clearControlStates();
    }
    for (const [k, v] of Object.entries(controls)) {
      bot.setControlState(k, Boolean(v));
    }
    if (controls.jump) {
      bot.jumpTicks = 0;
      bot.jumpQueued = true;
    }
    if (typeof yaw === "number") bot.entity.yaw = yaw;
    if (typeof pitch === "number") bot.entity.pitch = pitch;
  }
}

function attachSmartMovement(bot, manualControls = {}) {
  if (!bot || typeof bot.on !== "function" || bot._mcbpSmartMovementAttached) {
    return;
  }
  bot._mcbpSmartMovementAttached = true;
  attachCraftingFix(bot);
  attachSubServerChatFix(bot);
  if (!bot._mcbpLastSeenPlayers) bot._mcbpLastSeenPlayers = new Map();
  if (!bot._mcbpForcedMoveTimes) bot._mcbpForcedMoveTimes = [];

  let wasInLiquid = false;
  let autoJumpTicks = 0;
  let safeWalkSneakActive = false;
  let stuckTicks = 0;
  let unstuckStrafeTicks = 0;
  let unstuckDir = "left";
  let lastPos = null;
  let jumpCooldown = 0;

  // Track server position setbacks / rubberbands (anti-cheat or ghost blocks)
  bot.on("forcedMove", () => {
    if (!bot || !bot.entity) return;
    const now = Date.now();
    bot._mcbpLastForcedMoveAt = now;
    bot._mcbpLastForcedMovePos = bot.entity.position?.clone() || null;
    // Mineflayer's physics.js unconditionally sets `bot.entity.onGround = false` on every
    // clientbound `position` packet even when standing on solid ground. Restore `onGround = true`
    // if there is a solid block directly beneath our feet so jumping and digging aren't paralyzed!
    try {
      const p = bot.entity.position;
      if (p && typeof bot.blockAt === "function") {
        const below = bot.blockAt(p.offset(0, -0.08, 0).floored());
        const deepBelow = bot.blockAt(p.offset(0, -0.58, 0).floored());
        if (
          (below && !isBlockPassable(below)) ||
          (deepBelow && !isBlockPassable(deepBelow))
        ) {
          bot.entity.onGround = true;
        }
      }
    } catch (_) {}
    bot._mcbpForcedMoveTimes = (bot._mcbpForcedMoveTimes || []).filter(
      (t) => now - t < 4000,
    );
    bot._mcbpForcedMoveTimes.push(now);
    if (bot._mcbpForcedMoveTimes.length >= 4) {
      bot._mcbpAntiCheatSlowUntil = now + 4000;
      try {
        bot.setControlState("sprint", false);
        if (bot.pathfinder?.movements) {
          bot.pathfinder.movements.allowSprinting = false;
        }
      } catch (_) {}
    }
    // Re-sync pathfinder from the actual server setback position (throttled) and penalize
    // the setback node in Baritone BacktrackMemory so A* routes around anti-cheat/ghost-block traps.
    if (
      bot.pathfinder?.goal &&
      !bot._mcbpControlOverride &&
      now - (bot._mcbpLastSetbackRepathAt || 0) > 1100
    ) {
      bot._mcbpLastSetbackRepathAt = now;
      try {
        if (
          typeof bot.pathfinder.penalizeNode === "function" &&
          bot.entity?.position
        ) {
          bot.pathfinder.penalizeNode(bot.entity.position, 40);
        }
        if (typeof bot.pathfinder.repath === "function") {
          bot.pathfinder.repath();
        } else {
          const g = bot.pathfinder.goal;
          bot.pathfinder.setGoal(g, Boolean(g && g.entity));
        }
      } catch (_) {}
    }
  });

  // 0. Knockback preservation listener (fixes lpVec3 / 8000 bug & pathfinder fullStop zeroing)
  if (bot._client && typeof bot._client.on === "function") {
    bot._client.on("entity_velocity", (packet) => {
      if (!bot || !bot.entity || packet.entityId !== bot.entity.id) return;
      const v = packet.velocity;
      if (!v) return;

      let vx = v.x;
      let vy = v.y;
      let vz = v.z;

      // Detect whether packet.velocity is lpVec3 (already in blocks/tick floats)
      // vs legacy vec3i16 (multiplied by 8000).
      const isFloatLpVec =
        !Number.isInteger(vx) ||
        !Number.isInteger(vy) ||
        !Number.isInteger(vz) ||
        (Math.abs(vx) < 12 &&
          Math.abs(vy) < 12 &&
          Math.abs(vz) < 12 &&
          (vx !== 0 || vy !== 0 || vz !== 0));

      if (!isFloatLpVec) {
        vx = vx / 8000;
        vy = vy / 8000;
        vz = vz / 8000;
      }

      if (bot.entity.velocity) {
        bot.entity.velocity.set(vx, vy, vz);
      }
      if (vy > 0.05) {
        bot.entity.onGround = false;
      }
      bot._mcbpKnockback = {
        vx,
        vy,
        vz,
        time: Date.now(),
        ticksLeft: 6,
      };
    });
  }

  // Prevent mineflayer-pathfinder's fullStop() from wiping out active knockback velocity
  // or snapping X/Z to block center (Math.floor(x) + 0.5), which causes 20x/sec server setbacks!
  const restoreKnockbackAndPosition = () => {
    const pre = bot?._mcbpTruePhysicsPos;
    if (pre && bot?.entity?.position) {
      if (
        Math.abs(bot.entity.position.x - pre.x) > 1e-4 ||
        Math.abs(bot.entity.position.z - pre.z) > 1e-4
      ) {
        bot.entity.position.x = pre.x;
        bot.entity.position.z = pre.z;
      }
    }
    const kb = bot?._mcbpKnockback;
    if (!kb || !bot?.entity?.velocity) return;
    if (Date.now() - kb.time < 320 && kb.ticksLeft > 0) {
      if (bot.entity.velocity.x === 0 && bot.entity.velocity.z === 0) {
        bot.entity.velocity.x = kb.vx;
        bot.entity.velocity.z = kb.vz;
      }
    }
  };
  bot.on("path_stop", restoreKnockbackAndPosition);
  bot.on("goal_reached", restoreKnockbackAndPosition);

  // Record true physics-simulated position right before `physicTick` listeners (like pathfinder) run
  bot.on("physicsTick", () => {
    if (bot?.entity?.position) {
      bot._mcbpTruePhysicsPos = bot.entity.position.clone();
    }
  });

  function pulseAutoJump(ticks = 9) {
    if (!bot || !bot.entity) return;
    bot.jumpTicks = 0;
    bot.setControlState("jump", true);
    bot.jumpQueued = true;
    autoJumpTicks = Math.max(autoJumpTicks, ticks);
    jumpCooldown = Math.max(jumpCooldown, ticks + 3);
  }

  bot.on("physicTick", () => {
    if (!bot || !bot.entity || !bot.entity.position) return;

    // Undo any illegal horizontal X/Z position snap performed by mineflayer-pathfinder's fullStop()
    restoreKnockbackAndPosition();

    // Send 1.21.3+ / 26.1 client_tick_end right after Mineflayer's updatePosition() runs
    if (
      bot._client &&
      bot.registry?.protocol?.play?.toServer?.types?.packet_tick_end
    ) {
      queueMicrotask(() => {
        try {
          if (bot?._client && bot.entity) {
            bot._client.write("tick_end", {});
          }
        } catch (_) {}
      });
    }

    if (bot.players && bot._mcbpLastSeenPlayers) {
      const now = Date.now();
      for (const p of Object.values(bot.players)) {
        if (p?.username && p.username !== bot.username && p.entity?.position) {
          bot._mcbpLastSeenPlayers.set(p.username.toLowerCase(), {
            username: p.username,
            position: p.entity.position.clone(),
            at: now,
          });
        }
      }
    }

    const pos = bot.entity.position;

    // 0b. Active Unstuck Control Override (runs AFTER mineflayer-pathfinder's monitorMovement
    // so pathfinder cannot wipe `jump`, `forward`, `back`, `left`, `right`, or `yaw`!)
    if (bot._mcbpControlOverride) {
      const ov = bot._mcbpControlOverride;
      if (Date.now() < ov.until) {
        if (ov.clearFirst && typeof bot.clearControlStates === "function") {
          bot.clearControlStates();
        }
        for (const [k, v] of Object.entries(ov.controls || {})) {
          bot.setControlState(k, Boolean(v));
        }
        if (ov.controls?.jump) {
          bot.jumpTicks = 0;
          bot.jumpQueued = true;
        }
        if (typeof ov.yaw === "number") bot.entity.yaw = ov.yaw;
        if (typeof ov.pitch === "number") bot.entity.pitch = ov.pitch;
        lastPos = pos.clone();
        return;
      }
      for (const k of Object.keys(ov.controls || {})) {
        if (!manualControls[k]) {
          bot.setControlState(k, false);
        }
      }
      bot._mcbpControlOverride = null;
    }

    let inSinkHazard = false;
    try {
      const fBlock = bot.blockAt?.(pos.floored());
      const hBlock = bot.blockAt?.(pos.offset(0, 0.85, 0).floored());
      const fn = fBlock?.name || "";
      const hn = hBlock?.name || "";
      inSinkHazard =
        fn === "powder_snow" ||
        hn === "powder_snow" ||
        fn === "cobweb" ||
        fn === "sweet_berry_bush";
    } catch (_) {}
    const inLiquid = Boolean(
      bot.entity.isInWater ||
      bot.entity.isInLava ||
      bot.entity.isInPowderSnow ||
      inSinkHazard,
    );

    // Handle active knockback window
    const kb = bot._mcbpKnockback;
    const inKnockback = Boolean(kb && kb.ticksLeft > 0);
    if (inKnockback) {
      kb.ticksLeft--;
      if (
        kb.ticksLeft >= 4 &&
        bot.entity.velocity &&
        bot.entity.velocity.x === 0 &&
        bot.entity.velocity.z === 0
      ) {
        bot.entity.velocity.x = kb.vx;
        bot.entity.velocity.z = kb.vz;
      }
    }

    // 1. Liquid float handling - only release jump on transition out of liquid
    if (inLiquid) {
      bot.setControlState("jump", true);
      wasInLiquid = true;
      stuckTicks = 0;
      lastPos = pos.clone();
      return;
    } else if (wasInLiquid) {
      wasInLiquid = false;
      if (!manualControls.jump) {
        bot.setControlState("jump", false);
      }
    }

    if (jumpCooldown > 0) jumpCooldown--;

    const isPathing = Boolean(bot.pathfinder && bot.pathfinder.isMoving());

    // Keep temporary auto-jump active across ticks even if monitorMovement() cleared it!
    if (autoJumpTicks > 0) {
      autoJumpTicks--;
      if (autoJumpTicks > 0) {
        bot.jumpTicks = 0;
        bot.setControlState("jump", true);
        bot.jumpQueued = true;
        if (isPathing && !bot.controlState?.back) {
          bot.setControlState("forward", true);
        }
      } else if (!manualControls.jump && !bot._mcbpCritJumping) {
        bot.setControlState("jump", false);
      }
    }

    // Release temporary unstuck strafe
    if (unstuckStrafeTicks > 0) {
      unstuckStrafeTicks--;
      if (unstuckStrafeTicks === 0) {
        if (!manualControls[unstuckDir]) {
          bot.setControlState(unstuckDir, false);
        }
      }
    }

    const manualForward = Boolean(manualControls.forward);
    const wantsForward = Boolean(
      bot.controlState?.forward || manualForward || isPathing,
    );
    const wantsAnyMove = Boolean(
      wantsForward ||
      bot.controlState?.back ||
      bot.controlState?.left ||
      bot.controlState?.right ||
      manualControls.back ||
      manualControls.left ||
      manualControls.right,
    );

    if (!wantsAnyMove) {
      if (safeWalkSneakActive && !manualControls.sneak) {
        bot.setControlState("sneak", false);
        safeWalkSneakActive = false;
      }
      stuckTicks = 0;
      lastPos = pos.clone();
      return;
    }

    const yaw = bot.entity.yaw;
    const dirX = -Math.sin(yaw);
    const dirZ = -Math.cos(yaw);

    // 2. SafeWalk check (prevents walking off >1 block ledges or into lava/fire)
    if (bot._mcbpSafeWalk && typeof bot.blockAt === "function") {
      try {
        const baseFloorY = Math.floor(pos.y + 0.08);
        const nextFloor1 = bot.blockAt(
          pos
            .offset(dirX * 0.65, baseFloorY - pos.y - 1, dirZ * 0.65)
            .floored(),
        );
        const nextFloor2 = bot.blockAt(
          pos
            .offset(dirX * 0.65, baseFloorY - pos.y - 2, dirZ * 0.65)
            .floored(),
        );
        const aheadFoot = bot.blockAt(
          pos.offset(dirX * 0.75, 0, dirZ * 0.75).floored(),
        );
        const isDangerDrop =
          isBlockPassable(nextFloor1) && isBlockPassable(nextFloor2);
        const isHazardAhead =
          isBlockHazard(aheadFoot) ||
          isBlockHazard(nextFloor1) ||
          isBlockHazard(nextFloor2);

        if ((isDangerDrop || isHazardAhead) && bot.entity.onGround) {
          bot.setControlState("sneak", true);
          bot.setControlState("sprint", false);
          safeWalkSneakActive = true;
          if (isHazardAhead) {
            bot.setControlState("forward", false);
          }
          lastPos = pos.clone();
          return;
        } else if (safeWalkSneakActive && !manualControls.sneak) {
          bot.setControlState("sneak", false);
          safeWalkSneakActive = false;
        }
      } catch (_) {}
    }

    // 3. Movement & Jump assistance:
    const antiCheatSlow = Boolean(
      bot._mcbpAntiCheatSlowUntil && Date.now() < bot._mcbpAntiCheatSlowUntil,
    );
    const canSprint =
      !antiCheatSlow &&
      (bot.food ?? 20) > 6 &&
      !bot.controlState?.sneak &&
      !isBotEating(bot);
    const isMiningOrBuilding = Boolean(
      bot.pathfinder &&
      ((typeof bot.pathfinder.isMining === "function" &&
        bot.pathfinder.isMining()) ||
        (typeof bot.pathfinder.isBuilding === "function" &&
          bot.pathfinder.isBuilding())),
    );

    if (antiCheatSlow && bot.controlState?.sprint) {
      bot.setControlState("sprint", false);
    } else if (
      !antiCheatSlow &&
      bot._mcbpAntiCheatSlowUntil &&
      bot.pathfinder?.movements
    ) {
      bot._mcbpAntiCheatSlowUntil = 0;
      bot.pathfinder.movements.allowSprinting = true;
    }

    if (isPathing && !isMiningOrBuilding) {
      if (bot.entity.onGround && !bot.controlState?.jump) {
        bot.jumpTicks = 0;
      }

      // If pathfinder hit its `else { setControlState('forward', false) }` branch
      // OR the bot is horizontally collided / stationary against a 1-block step:
      // Note that when monitorMovement() sets `forward = false`, `isCollidedHorizontally`
      // drops to `false` on the next tick! So also trigger when `!forward && stuckTicks >= 4`.
      if (
        !bot.controlState?.back &&
        bot.entity.onGround &&
        (bot.entity.isCollidedHorizontally ||
          (!bot.controlState?.forward && stuckTicks >= 4))
      ) {
        bot.jumpTicks = 0;

        if (typeof bot.blockAt === "function") {
          try {
            const aheadFoot = bot.blockAt(
              pos.offset(dirX * 0.8, 0, dirZ * 0.8).floored(),
            );
            const aheadHead = bot.blockAt(
              pos.offset(dirX * 0.8, 1, dirZ * 0.8).floored(),
            );
            const aheadAbove = bot.blockAt(
              pos.offset(dirX * 0.8, 2, dirZ * 0.8).floored(),
            );
            const overhead = bot.blockAt(pos.offset(0, 2.1, 0).floored());
            const stepBlocked =
              Boolean(bot.entity.isCollidedHorizontally) ||
              Boolean(aheadFoot && !isBlockPassable(aheadFoot));

            if (
              stepBlocked &&
              isBlockPassable(aheadHead) &&
              isBlockPassable(aheadAbove) &&
              isBlockPassable(overhead) &&
              jumpCooldown === 0
            ) {
              bot.setControlState("forward", true);
              pulseAutoJump(9);
            }
          } catch (_) {}
        }
      }
    } else if (!isPathing) {
      if (wantsForward && canSprint) {
        bot.setControlState("sprint", true);
      }

      if (
        typeof bot.blockAt === "function" &&
        wantsForward &&
        bot.entity.onGround &&
        !inKnockback &&
        !bot._mcbpCritJumping &&
        jumpCooldown === 0
      ) {
        try {
          const ahead1Foot = bot.blockAt(
            pos.offset(dirX * 0.75, 0, dirZ * 0.75).floored(),
          );
          const ahead1Head = bot.blockAt(
            pos.offset(dirX * 0.75, 1, dirZ * 0.75).floored(),
          );
          const ahead1AboveHead = bot.blockAt(
            pos.offset(dirX * 0.75, 2, dirZ * 0.75).floored(),
          );
          const overhead = bot.blockAt(pos.offset(0, 2.1, 0).floored());

          if (
            ahead1Foot &&
            !isBlockPassable(ahead1Foot) &&
            isBlockPassable(ahead1Head) &&
            isBlockPassable(ahead1AboveHead) &&
            isBlockPassable(overhead)
          ) {
            pulseAutoJump(8);
          }
        } catch (_) {}
      }
    }

    // 4. Genuine stationary unstuck handler (never spoofs onGround in mid-air!)
    if (lastPos && !inKnockback && !bot._mcbpCritJumping) {
      const dx = pos.x - lastPos.x;
      const dy = pos.y - lastPos.y;
      const dz = pos.z - lastPos.z;
      const totalMoved = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (totalMoved < 0.015 && !isMiningOrBuilding) {
        stuckTicks++;
      } else {
        stuckTicks = 0;
      }

      if (stuckTicks === 14 && bot.entity.onGround && jumpCooldown === 0) {
        const overhead = bot.blockAt?.(pos.offset(0, 2.1, 0).floored());
        if (isBlockPassable(overhead)) {
          bot.jumpTicks = 0;
          pulseAutoJump(9);
        }
      } else if (stuckTicks >= 26) {
        stuckTicks = 0;
        const overhead = bot.blockAt?.(pos.offset(0, 2.1, 0).floored());
        if (
          bot.entity.onGround &&
          jumpCooldown === 0 &&
          isBlockPassable(overhead)
        ) {
          bot.jumpTicks = 0;
          pulseAutoJump(9);
        }
        if (!isPathing) {
          unstuckDir = unstuckDir === "left" ? "right" : "left";
          bot.setControlState(unstuckDir, true);
          unstuckStrafeTicks = 4;
        }
      }
    }

    lastPos = pos.clone();
  });
}

/**
 * Extracts block coordinates `{ x, y, z }` from natural chat messages like:
 * - "im at 120 64 -300" / "my coords are -50, 70, 200"
 * - "x: 120 y: 64 z: -300" / "x=120 z=-300"
 * - "120 64 -300" / "120, -300"
 */
function extractCoordsFromText(text) {
  const s = String(text || "").trim();
  if (!s || s.length > 220) return null;
  // Don't extract numbers from simple item counts like "mine 10 oak_log" or "give 5 iron"
  if (
    /^\s*(?:mine|dig|craft|make|smelt|cook|drop|toss|give|wait|jump|hotbar|slot|attack|kill|logs)\s+\d+/i.test(
      s,
    )
  ) {
    return null;
  }

  // 1. Explicit x/y/z labels: "x: 100, y: 64, z: -200" or "x 100 z -200"
  const labeledX = s.match(/\bx\s*[:=]?\s*(-?\d{1,7}(?:\.\d+)?)\b/i);
  const labeledY = s.match(/\by\s*[:=]?\s*(-?\d{1,4}(?:\.\d+)?)\b/i);
  const labeledZ = s.match(/\bz\s*[:=]?\s*(-?\d{1,7}(?:\.\d+)?)\b/i);
  if (labeledX && labeledZ) {
    const x = Math.round(Number(labeledX[1]));
    const y = labeledY ? Math.round(Number(labeledY[1])) : null;
    const z = Math.round(Number(labeledZ[1]));
    if (
      Number.isFinite(x) &&
      Number.isFinite(z) &&
      (y === null || (y >= -64 && y <= 320))
    ) {
      return { x, y, z };
    }
  }

  // 2. Three numbers: "120 64 -300", "120, 64, -300", "120 / 64 / -300"
  const threeMatch = s.match(
    /(?:^|[\s,:(])(-?\d{1,7})(?:\.\d+)?(?:\s*[,/\s]\s*|\s+)(-?\d{1,4})(?:\.\d+)?(?:\s*[,/\s]\s*|\s+)(-?\d{1,7})(?:\.\d+)?(?:$|[\s,).!?])/,
  );
  if (threeMatch) {
    const x = Number(threeMatch[1]);
    const y = Number(threeMatch[2]);
    const z = Number(threeMatch[3]);
    if (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(z) &&
      y >= -64 &&
      y <= 320
    ) {
      return { x, y, z };
    }
  }

  // 3. Two numbers when clearly a coordinate reply or location message:
  //    e.g. "120 -300", "im at 120 -300", "coords 120, -300"
  if (
    /^\s*-?\d{1,7}(?:\s*,\s*|\s+)-?\d{1,7}\s*$/.test(s) ||
    /\b(?:coords?|at|pos|position|location|come|walk|go|tp)\b/i.test(s)
  ) {
    const twoMatch = s.match(
      /(?:^|[\s,:(])(-?\d{1,7})(?:\.\d+)?(?:\s*,\s*|\s+)(-?\d{1,7})(?:\.\d+)?(?:$|[\s,).!?])/,
    );
    if (twoMatch) {
      const x = Number(twoMatch[1]);
      const z = Number(twoMatch[2]);
      if (Number.isFinite(x) && Number.isFinite(z)) {
        return { x, y: null, z };
      }
    }
  }

  return null;
}

/**
 * Inspects surrounding blocks, server setback state, and vertical clearance around the bot
 * to explain why walking or jumping is blocked and find the clearest horizontal escape angle.
 */
function diagnoseWalkingObstruction(bot) {
  if (!bot || !bot.entity || !bot.entity.position) {
    return {
      summary: "no entity",
      ceilingBlocked: false,
      frontWall2High: false,
      frontStep1High: false,
      serverRubberband: false,
      inProtectedZone: false,
      openYaw: 0,
      frontFoot: "air",
      frontHead: "air",
      frontAbove: "air",
      overhead: "air",
      feet: "air",
      floor: "air",
    };
  }
  const pos = bot.entity.position;
  const yaw = bot.entity.yaw || 0;
  const dirX = -Math.sin(yaw);
  const dirZ = -Math.cos(yaw);

  const safeBlock = (p) => {
    try {
      return typeof bot.blockAt === "function" ? bot.blockAt(p) : null;
    } catch (_) {
      return null;
    }
  };

  const feetBlock = safeBlock(pos.floored());
  const floorBlock = safeBlock(pos.offset(0, -0.5, 0).floored());
  const headBlock = safeBlock(pos.offset(0, 1, 0).floored());
  const overheadBlock = safeBlock(pos.offset(0, 2, 0).floored());
  const frontFoot = safeBlock(
    pos.offset(dirX * 0.85, 0, dirZ * 0.85).floored(),
  );
  const frontHead = safeBlock(
    pos.offset(dirX * 0.85, 1, dirZ * 0.85).floored(),
  );
  const frontAbove = safeBlock(
    pos.offset(dirX * 0.85, 2, dirZ * 0.85).floored(),
  );

  const ceilingBlocked =
    !isBlockPassable(overheadBlock) || !isBlockPassable(frontAbove);
  const frontWall2High = !isBlockPassable(frontHead);
  const frontStep1High =
    !isBlockPassable(frontFoot) &&
    isBlockPassable(frontHead) &&
    !ceilingBlocked;
  const serverRubberband = Boolean(
    bot._mcbpLastForcedMoveAt && Date.now() - bot._mcbpLastForcedMoveAt < 3200,
  );
  const inProtectedZone = Boolean(
    bot._mcbpProtectedZoneUntil && Date.now() < bot._mcbpProtectedZoneUntil,
  );

  // Scan 8 candidate directions to find the clearest open escape angle
  const angleOffsets = [
    Math.PI / 2,
    -Math.PI / 2,
    Math.PI * 0.75,
    -Math.PI * 0.75,
    Math.PI,
    Math.PI / 4,
    -Math.PI / 4,
    0,
  ];
  let openYaw = yaw + Math.PI / 2;
  let bestScore = -999;
  for (const delta of angleOffsets) {
    const candYaw = yaw + delta;
    const cx = -Math.sin(candYaw);
    const cz = -Math.cos(candYaw);
    let score = 0;
    for (const dist of [1.0, 2.0]) {
      const f0 = safeBlock(pos.offset(cx * dist, 0, cz * dist).floored());
      const f1 = safeBlock(pos.offset(cx * dist, 1, cz * dist).floored());
      const f2 = safeBlock(pos.offset(cx * dist, 2, cz * dist).floored());
      const fl = safeBlock(pos.offset(cx * dist, -1, cz * dist).floored());
      if (isBlockPassable(f0) && isBlockPassable(f1)) {
        score += 4;
      } else if (
        !isBlockPassable(f0) &&
        isBlockPassable(f1) &&
        isBlockPassable(f2) &&
        isBlockPassable(overheadBlock)
      ) {
        score += 1;
      } else {
        score -= 5;
      }
      if (isBlockHazard(f0) || isBlockHazard(fl)) score -= 20;
      else if (fl && !isBlockPassable(fl)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      openYaw = candYaw;
    }
  }

  const parts = [
    `pos=(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`,
    `front=${frontFoot?.name || "air"}/${frontHead?.name || "air"}`,
  ];
  if (!isBlockPassable(overheadBlock) || !isBlockPassable(frontAbove)) {
    parts.push(
      `overhead=${overheadBlock?.name || "air"}/${frontAbove?.name || "air"}`,
    );
  }
  if (feetBlock && feetBlock.name !== "air") {
    parts.push(`feet=${feetBlock.name}`);
  }
  parts.push(`onGround=${Boolean(bot.entity.onGround)}`);
  if (serverRubberband) parts.push("server-setback");
  if (inProtectedZone) parts.push("spawn-protected");

  return {
    summary: parts.join(", "),
    ceilingBlocked,
    frontWall2High,
    frontStep1High,
    serverRubberband,
    inProtectedZone,
    openYaw,
    frontFoot: frontFoot?.name || "air",
    frontHead: frontHead?.name || "air",
    frontAbove: frontAbove?.name || "air",
    overhead: overheadBlock?.name || "air",
    feet: feetBlock?.name || "air",
    floor: floorBlock?.name || "air",
    frontFootBlock: frontFoot,
    frontHeadBlock: frontHead,
    frontAboveBlock: frontAbove,
    overheadBlock,
  };
}

/**
 * Executes a physics-locked jump (holding jump + forward across 11 physics ticks so
 * pathfinder's `monitorMovement()` cannot cancel it after 1 tick) and verifies whether
 * the bot's Y coordinate actually rose on the server (`ΔY >= 0.25m`).
 * If the jump could not or did not happen on the server, logs the diagnostic cause and
 * immediately executes a horizontal un-wedge maneuver so the bot never gets stuck jumping in place.
 */
async function performVerifiedJumpOrUnwedge(
  bot,
  { log, onLogMovement, reason = "Stuck" } = {},
) {
  if (!bot || !bot.entity || !bot.entity.position) {
    return { jumped: false, moved: false, action: "no-bot" };
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const startPos = bot.entity.position.clone();
  const startY = startPos.y;
  const diag = diagnoseWalkingObstruction(bot);

  const recordMoveProblem = (title, details) => {
    if (log) log(`${title}: ${details}`);
    if (typeof onLogMovement === "function") {
      try {
        onLogMovement(title, details);
      } catch (_) {}
    }
  };

  // Helper to pause pathfinder during an un-wedge maneuver and restore it afterward
  const runHorizontalUnwedge = async (whyText) => {
    const savedGoal = bot.pathfinder?.goal || null;
    const savedDyn = Boolean(savedGoal && savedGoal.entity);
    if (savedGoal) {
      clearPathfinderGoal(bot);
    }

    // If ceiling, a 2-high wall, or multi-layer snow/snow_block on a slope is trapping the bot and we're not in spawn protection, dig a path out!
    const dugBlocks = [];
    if (!diag.inProtectedZone && !isBotDigging(bot)) {
      const snowBlocked =
        diag.feet === "snow" ||
        diag.frontFoot === "snow" ||
        diag.frontFoot === "snow_block" ||
        diag.frontFoot === "powder_snow";
      const candidates = [
        diag.overheadBlock,
        diag.frontAboveBlock,
        diag.frontHeadBlock,
        ...(snowBlocked || diag.serverRubberband ? [diag.frontFootBlock] : []),
      ];
      for (const blk of candidates) {
        if (
          blk &&
          (blk.boundingBox === "block" ||
            blk.name === "snow" ||
            blk.name === "snow_block" ||
            blk.name === "powder_snow") &&
          blk.diggable &&
          blk.name !== "bedrock" &&
          blk.name !== "obsidian"
        ) {
          const ok = await smartDig(bot, blk, { autoTool: true }).catch(
            () => false,
          );
          if (ok) dugBlocks.push(blk.name);
        }
      }
    }

    // Back off 250ms to un-wedge from slab/stair/fence/wall lip, then walk/jump along openYaw
    setBotControlOverride(bot, {
      durationMs: 240,
      controls: { back: true, forward: false, jump: false, sprint: false },
      yaw: bot.entity.yaw,
    });
    await sleep(250);
    if (!bot || !bot.entity) {
      return { jumped: false, moved: false, action: whyText };
    }

    const freshDiag = diagnoseWalkingObstruction(bot);
    const useYaw = dugBlocks.length > 0 ? bot.entity.yaw : freshDiag.openYaw;
    setBotControlOverride(bot, {
      durationMs: 650,
      controls: {
        forward: true,
        back: false,
        jump: !freshDiag.ceilingBlocked,
        sprint: false,
      },
      yaw: useYaw,
    });
    await sleep(670);

    if (savedGoal && bot?.pathfinder && !bot.pathfinder.goal) {
      try {
        bot.pathfinder.setGoal(savedGoal, savedDyn);
      } catch (_) {}
    }
    const endPos = bot?.entity?.position || startPos;
    const movedDist = endPos.distanceTo(startPos);
    const dugNote = dugBlocks.length ? `dug ${dugBlocks.join("+")} + ` : "";
    return {
      jumped: endPos.y - startY >= 0.25,
      moved: movedDist >= 0.35 || dugBlocks.length > 0,
      action: `${whyText} -> ${dugNote}un-wedge (${movedDist.toFixed(2)}m)`,
    };
  };

  // Case 1: Jump is physically impossible right now (ceiling overhead, 2-block wall, or not onGround)
  const hasSolidFloorSupport =
    Boolean(bot.entity.onGround) ||
    Boolean(bot.entity.isInWater) ||
    (diag.floor &&
      diag.floor !== "air" &&
      diag.floor !== "cave_air" &&
      diag.floor !== "void_air");
  if (hasSolidFloorSupport && !bot.entity.onGround && !bot.entity.isInWater) {
    bot.entity.onGround = true;
  }
  if (diag.ceilingBlocked || diag.frontWall2High || !hasSolidFloorSupport) {
    const cause = diag.ceilingBlocked
      ? `ceiling blocked by ${diag.overhead}/${diag.frontAbove}`
      : diag.frontWall2High
        ? `2-block wall ahead (${diag.frontFoot}/${diag.frontHead})`
        : `not onGround (${diag.feet})`;
    recordMoveProblem(
      `${reason}: Jump blocked (${cause})`,
      `${diag.summary} - un-wedging horizontally`,
    );
    return runHorizontalUnwedge(`jump blocked (${cause})`);
  }

  // Case 2: Attempt a physics-locked 550ms jump (11 physics ticks) so pathfinder cannot cancel it
  setBotControlOverride(bot, {
    durationMs: 550,
    controls: { forward: true, jump: true, sprint: false },
    yaw: bot.entity.yaw,
  });

  let maxY = startY;
  for (let i = 0; i < 11; i++) {
    await sleep(50);
    if (!bot || !bot.entity || !bot.entity.position) break;
    if (bot.entity.position.y > maxY) {
      maxY = bot.entity.position.y;
    }
  }

  if (!bot || !bot.entity || !bot.entity.position) {
    return { jumped: false, moved: false, action: "disconnected" };
  }

  const endPos = bot.entity.position;
  const dy = maxY - startY;
  const dHoriz = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);

  // Did the server actually let us jump?
  if (dy < 0.25) {
    recordMoveProblem(
      `${reason}: Jump did not register on server`,
      `ΔY=${dy.toFixed(2)}m, ΔXZ=${dHoriz.toFixed(2)}m | ${diag.summary} - switching to horizontal un-wedge`,
    );
    return runHorizontalUnwedge(`server jump failed (ΔY=${dy.toFixed(2)}m)`);
  }

  // We jumped up (dy >= 0.25), but were still blocked horizontally from advancing
  if (dHoriz < 0.25) {
    recordMoveProblem(
      `${reason}: Jumped but blocked horizontally`,
      `ΔY=${dy.toFixed(2)}m, ΔXZ=${dHoriz.toFixed(2)}m | ${diag.summary} - stepping around obstacle`,
    );
    return runHorizontalUnwedge(
      `jump blocked horizontally (ΔXZ=${dHoriz.toFixed(2)}m)`,
    );
  }

  return {
    jumped: true,
    moved: true,
    action: `jumped forward (ΔY=${dy.toFixed(2)}m, ΔXZ=${dHoriz.toFixed(2)}m)`,
  };
}

/**
 * Escapes immediate physical hazards (`powder_snow`, `cobweb`, `sweet_berry_bush`,
 * `lava`, `fire`, drowning, or suffocating/blocking blocks at feet/head).
 * Returns a short summary of recovery actions taken, or `""` if none needed.
 */
async function escapeHazardsAndObstructions(bot, { log, onLogMovement } = {}) {
  if (!bot || !bot.entity || !bot.entity.position) return "";
  const actions = [];
  const pos = bot.entity.position;
  const feetPos = pos.floored();
  const headPos = pos.offset(0, 1, 0).floored();
  const abovePos = pos.offset(0, 2, 0).floored();

  try {
    await cleanCraftingGrid(bot);
  } catch (_) {}

  try {
    const feetBlock = bot.blockAt(feetPos);
    const headBlock = bot.blockAt(headPos);
    const aboveBlock = bot.blockAt(abovePos);

    // 1. Dig out of powder_snow, cobweb, or sweet_berry_bush
    for (const blk of [headBlock, feetBlock]) {
      if (!blk) continue;
      if (
        blk.name === "powder_snow" ||
        blk.name === "cobweb" ||
        blk.name === "sweet_berry_bush"
      ) {
        if (log)
          log(
            `Recovery: Breaking ${blk.name} at (${blk.position.x}, ${blk.position.y}, ${blk.position.z})`,
          );
        setBotControlOverride(bot, {
          durationMs: 500,
          controls: { jump: true, forward: true },
        });
        await smartDig(bot, blk, { autoTool: true }).catch(async () => {
          await bot.dig(blk, true).catch(() => {});
        });
        actions.push(`dug ${blk.name}`);
      }
    }

    // 2. Suffocation or solid head block trap
    if (
      headBlock &&
      headBlock.boundingBox === "block" &&
      headBlock.diggable &&
      headBlock.name !== "bedrock"
    ) {
      if (log) log(`Recovery: Digging suffocating ${headBlock.name} at head`);
      await smartDig(bot, headBlock, { autoTool: true }).catch(() => {});
      actions.push(`dug head obstruction ${headBlock.name}`);
    }

    // 3. Underwater & losing oxygen with overhead block
    if (
      bot.entity.isInWater &&
      typeof bot.oxygenLevel === "number" &&
      bot.oxygenLevel < 12
    ) {
      setBotControlOverride(bot, {
        durationMs: 650,
        controls: { jump: true, forward: true },
      });
      if (
        aboveBlock &&
        aboveBlock.boundingBox === "block" &&
        aboveBlock.diggable
      ) {
        await smartDig(bot, aboveBlock, { autoTool: true }).catch(() => {});
        actions.push(`dug overhead ${aboveBlock.name} for air`);
      } else {
        actions.push("swimming up for air");
      }
    }

    // 4. Standing in lava/fire/magma/cactus/powder_snow: step onto nearest safe neighbor
    const floorBlock = bot.blockAt(feetPos.offset(0, -1, 0));
    if (
      isBlockHazard(feetBlock) ||
      isBlockHazard(headBlock) ||
      isBlockHazard(floorBlock)
    ) {
      const diag = diagnoseWalkingObstruction(bot);
      setBotControlOverride(bot, {
        durationMs: 650,
        controls: { jump: !diag.ceilingBlocked, forward: true },
        yaw: diag.openYaw,
      });
      actions.push("stepped out of hazard");
    }

    // 5. If horizontally collided against leaves/snow/dirt, clear the block in front
    if (bot.entity.isCollidedHorizontally && !isBotDigging(bot)) {
      const yaw = bot.entity.yaw;
      const dirX = -Math.sin(yaw);
      const dirZ = -Math.cos(yaw);
      const aheadHead = bot.blockAt(
        pos.offset(dirX * 0.85, 1, dirZ * 0.85).floored(),
      );
      const aheadFoot = bot.blockAt(
        pos.offset(dirX * 0.85, 0, dirZ * 0.85).floored(),
      );
      for (const blk of [aheadHead, aheadFoot]) {
        if (
          blk &&
          blk.boundingBox === "block" &&
          blk.diggable &&
          (blk.name.endsWith("_leaves") ||
            blk.name === "snow_block" ||
            blk.name === "snow" ||
            blk.name === "dirt" ||
            blk.name === "grass_block")
        ) {
          const dug = await smartDig(bot, blk, { autoTool: true }).catch(
            () => false,
          );
          if (dug) actions.push(`cleared ${blk.name}`);
          break;
        }
      }
    }

    // 6. Verified jump or horizontal un-wedge if still obstructed
    if (!actions.length) {
      const jumpRes = await performVerifiedJumpOrUnwedge(bot, {
        log,
        onLogMovement,
        reason: "Unstuck",
      });
      if (jumpRes?.action) actions.push(jumpRes.action);
    }
  } catch (_) {}

  return actions.join(", ");
}

/**
 * Attaches a lightweight real-time self-preservation loop to `bot`:
 * - Escapes `powder_snow`, `cobweb`, `sweet_berry_bush`, `lava`, `fire`, and drowning.
 * - Automatically eats food when starving (`food <= 6`) or critically low HP (`health <= 9`).
 * - Defends against immediate attackers or fusing creepers when no combat module is active.
 * - Records `bot._mcbpLastDeath` when the bot dies.
 */
function attachRealTimeSelfPreservation(bot, { log, onEvent } = {}) {
  if (!bot || bot._mcbpSelfPreservationAttached) return () => {};
  bot._mcbpSelfPreservationAttached = true;

  let busy = false;
  let lastHurtAt = 0;
  let lastAttackerId = null;

  const onHurt = (entity) => {
    if (!bot || !bot.entity || entity !== bot.entity) return;
    lastHurtAt = Date.now();
    let closest = null;
    let bestD = 5.5;
    for (const e of Object.values(bot.entities || {})) {
      if (!e || e === bot.entity || !e.position) continue;
      if (e.type === "object" || e.type === "orb") continue;
      const d = e.position.distanceTo(bot.entity.position);
      if (d < bestD) {
        bestD = d;
        closest = e;
      }
    }
    if (closest) {
      lastAttackerId = closest.id;
      if (onEvent) {
        onEvent(
          `Took damage near ${closest.username || closest.name || "entity"} (HP ${Math.round(bot.health ?? 20)}/20)`,
        );
      }
    }
  };

  const onDeath = () => {
    if (!bot || !bot.entity) return;
    const p = bot.entity.position;
    if (p) {
      bot._mcbpLastDeath = {
        position: p.clone(),
        dimension: String(bot.game?.dimension || "overworld").replace(
          /^minecraft:/,
          "",
        ),
        at: Date.now(),
      };
    }
  };

  bot.on("entityHurt", onHurt);
  bot.on("death", onDeath);

  const timer = setInterval(async () => {
    if (!bot || !bot.entity || !bot.entity.position || busy) return;
    busy = true;
    try {
      const pos = bot.entity.position;
      const feet = bot.blockAt?.(pos.floored());
      const head = bot.blockAt?.(pos.offset(0, 1, 0).floored());
      const inTrap =
        feet?.name === "powder_snow" ||
        head?.name === "powder_snow" ||
        feet?.name === "cobweb" ||
        feet?.name === "sweet_berry_bush" ||
        (head && head.boundingBox === "block" && head.diggable) ||
        (bot.entity.isInWater &&
          typeof bot.oxygenLevel === "number" &&
          bot.oxygenLevel < 10);

      if (inTrap && !isBotDigging(bot)) {
        const res = await escapeHazardsAndObstructions(bot, { log });
        if (res && onEvent) onEvent(`Escaped hazard (${res})`);
        return;
      }

      // Emergency starvation / low-HP eating
      if (!isBotEating(bot) && !isBotDigging(bot)) {
        const hp = bot.health ?? 20;
        const food = bot.food ?? 20;
        if (food <= 6 || (hp <= 9 && food < 20)) {
          await tryCombatEat(bot, {
            minHp: 9,
            minFood: 6,
            onLog: (bestFood) => {
              if (log)
                log(
                  `Self-Preservation: Eating ${bestFood.name} (HP ${Math.round(hp)}, Food ${food})`,
                );
            },
          });
        }
      }

      // Emergency creeper shield / retaliation when hurt
      const now = Date.now();
      let creeper = null;
      for (const e of Object.values(bot.entities || {})) {
        if (
          e &&
          e !== bot.entity &&
          e.position &&
          String(e.name || "").toLowerCase() === "creeper" &&
          e.position.distanceTo(pos) <= 3.8
        ) {
          creeper = e;
          break;
        }
      }
      if (creeper && !isBotDigging(bot)) {
        const offhand = bot.inventory?.slots?.[45];
        if (offhand && offhand.name === "shield") {
          await humanLookAt(bot, creeper.position.offset(0, 1.2, 0), true);
          bot.activateItem(true);
          setTimeout(() => {
            try {
              bot.deactivateItem();
            } catch (_) {}
          }, 400);
          return;
        }
      }

      if (
        lastAttackerId &&
        now - lastHurtAt < 3500 &&
        !isBotEating(bot) &&
        !isBotDigging(bot)
      ) {
        const attacker = bot.entities?.[lastAttackerId];
        if (
          attacker &&
          attacker.position &&
          isHostile(attacker) &&
          attacker.position.distanceTo(pos) <= 4.0
        ) {
          await equipBestWeapon(bot, { saveLowDurability: true }).catch(
            () => {},
          );
          await performPvpAttack(bot, attacker, {
            useCrits: true,
            maxRange: 4.0,
          }).catch(() => {});
        }
      }
    } catch (_) {
    } finally {
      busy = false;
    }
  }, 850);

  const stop = () => {
    clearInterval(timer);
    bot.removeListener("entityHurt", onHurt);
    bot.removeListener("death", onDeath);
    bot._mcbpSelfPreservationAttached = false;
  };
  bot.once("end", stop);
  return stop;
}

const {
  isLikelyNpcOrFakePlayer,
  isRealPlayerName,
  attachViaVersionAdapter,
  resolveSupportedVersion,
  resolveVersionFromKickOrError,
} = require("./viaAdapter");

module.exports = {
  HOSTILE_NAMES,
  ARMOR_SLOTS,
  FOOD_PRIORITY,
  ALWAYS_EDIBLE,
  WEAPON_ATTACK_SPEED,
  isBotEating,
  isBotDigging,
  getWeaponCooldownMs,
  isHostile,
  getDurabilityLeft,
  isLowDurability,
  equipBestWeapon,
  equipBestToolForBlock,
  equipBestArmor,
  findBestFood,
  consumeFoodSafely,
  tryCombatEat,
  performPvpAttack,
  getVisibleDigFace,
  smartDig,
  humanLookAt,
  setDynamicFollowGoal,
  clearPathfinderGoal,
  configureSmartMovements,
  extractSignText,
  scanNearbySigns,
  attachCraftingFix,
  refreshChatSession,
  attachSubServerChatFix,
  cleanCraftingGrid,
  setBotControlOverride,
  attachSmartMovement,
  diagnoseWalkingObstruction,
  performVerifiedJumpOrUnwedge,
  extractCoordsFromText,
  escapeHazardsAndObstructions,
  attachRealTimeSelfPreservation,
  isLikelyNpcOrFakePlayer,
  isRealPlayerName,
  attachViaVersionAdapter,
  resolveSupportedVersion,
  resolveVersionFromKickOrError,
};
