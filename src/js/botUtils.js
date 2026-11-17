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
  { preferAxe = false, saveLowDurability = true } = {},
) {
  if (!bot || !bot.inventory || isBotEating(bot) || isBotDigging(bot)) {
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

  if (bot.pathfinder && typeof bot.pathfinder.bestHarvestTool === "function") {
    try {
      const nativeBest = bot.pathfinder.bestHarvestTool(block);
      if (
        nativeBest &&
        !(saveLowDurability && isLowDurability(nativeBest, 4))
      ) {
        if (!bot.heldItem || bot.heldItem.slot !== nativeBest.slot) {
          await bot.equip(nativeBest, "hand");
        }
        return nativeBest;
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

async function equipBestArmor(bot, { includeOffhand = true } = {}) {
  if (!bot || !bot.inventory) return [];
  const equippedNames = [];
  const items = bot.inventory.items();

  for (const piece of ARMOR_SLOTS) {
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

  if (includeOffhand) {
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
async function consumeFoodSafely(bot, foodItem) {
  if (!bot || !bot.entity || !bot.inventory || !foodItem) return false;
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

      if (!bot || !bot.entity) return false;
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
      return true;
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
  { minHp = 13, minFood = 16, onLog = null } = {},
) {
  if (!bot || !bot.entity || !bot.inventory) return false;
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
  await consumeFoodSafely(bot, bestFood);
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
  { useCrits = true, maxRange = 4.3 } = {},
) {
  if (!bot || !bot.entity || !target || !target.position || isBotEating(bot)) {
    return false;
  }

  const dist = bot.entity.position.distanceTo(target.position);
  if (dist > maxRange) return false;

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
      if (!bot || !bot.entity || isBotEating(bot) || !target.position) {
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
        if (!bot || !bot.entity || isBotEating(bot)) return false;
        if ((bot.entity.velocity?.y ?? 0) < -0.015) break;
      }
    }
  }

  if (!bot || !bot.entity || !target || !target.position || isBotEating(bot)) {
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
      if (bot && bot.entity && !isBotEating(bot)) {
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
  { autoTool = true, saveLowDurability = true } = {},
) {
  if (!bot || !bot.entity || !block || !block.position || isBotEating(bot)) {
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
            if (
              blocker &&
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

  if (autoTool) {
    const prevSlot = bot.heldItem?.slot;
    await equipBestToolForBlock(bot, targetToDig, { saveLowDurability });
    if (bot.heldItem?.slot !== prevSlot) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  if (!bot || !bot.entity) return false;
  const digFace = getVisibleDigFace(bot, targetToDig);
  await bot.dig(targetToDig, true, digFace);
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
 * Configures Mineflayer pathfinder Movements with Baritone-like options.
 */
function configureSmartMovements(bot, mcData, Movements, options = {}) {
  if (!bot || !bot.pathfinder || !Movements) return null;
  try {
    const dataForVer =
      typeof mcData === "function" ? mcData(bot.version) : null;
    const movement = new Movements(bot, dataForVer);
    movement.allowSprinting = options.allowSprinting !== false;
    movement.allowParkour = options.allowParkour !== false;
    movement.canDig = Boolean(options.canDig);
    movement.allow1by1towers = Boolean(options.allowPillaring);
    movement.maxDropDown =
      typeof options.maxDropDown === "number" ? options.maxDropDown : 4;

    if (options.allowBridging || options.allowPillaring) {
      const scaffoldNames = [
        "cobblestone",
        "cobbled_deepslate",
        "dirt",
        "oak_planks",
        "spruce_planks",
        "birch_planks",
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
function attachSmartMovement(bot, manualControls = {}) {
  if (!bot || typeof bot.on !== "function" || bot._mcbpSmartMovementAttached) {
    return;
  }
  bot._mcbpSmartMovementAttached = true;

  let wasInLiquid = false;
  let autoJumpTicks = 0;
  let safeWalkSneakActive = false;
  let stuckTicks = 0;
  let unstuckStrafeTicks = 0;
  let unstuckDir = "left";
  let lastPos = null;
  let jumpCooldown = 0;

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
  const restoreKnockbackIfZeroed = () => {
    const kb = bot?._mcbpKnockback;
    if (!kb || !bot?.entity?.velocity) return;
    if (Date.now() - kb.time < 320 && kb.ticksLeft > 0) {
      if (bot.entity.velocity.x === 0 && bot.entity.velocity.z === 0) {
        bot.entity.velocity.x = kb.vx;
        bot.entity.velocity.z = kb.vz;
      }
    }
  };
  bot.on("path_stop", restoreKnockbackIfZeroed);
  bot.on("goal_reached", restoreKnockbackIfZeroed);

  function pulseAutoJump(ticks = 2) {
    if (!bot || !bot.entity) return;
    bot.setControlState("jump", true);
    bot.jumpQueued = true;
    autoJumpTicks = Math.max(autoJumpTicks, ticks);
    jumpCooldown = 7;
  }

  bot.on("physicTick", () => {
    if (!bot || !bot.entity || !bot.entity.position) return;

    const pos = bot.entity.position;
    const inLiquid = Boolean(bot.entity.isInWater || bot.entity.isInLava);

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

    // 1. Liquid float handling — only release jump on transition out of liquid
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

    // Release temporary auto-jump pulses without touching manual Jump toggle or crit jump
    if (autoJumpTicks > 0) {
      autoJumpTicks--;
      if (
        autoJumpTicks === 0 &&
        !manualControls.jump &&
        !bot._mcbpCritJumping
      ) {
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

    const isPathing = Boolean(bot.pathfinder && bot.pathfinder.isMoving());
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
    //    - When `isPathing` IS true, let mineflayer-pathfinder control `sprint` and `jump`
    //      on normal ticks, EXCEPT when pathfinder's 20-tick lookahead simulation hits its
    //      fallback `else` branch (`forward === false`) and freezes the bot in front of a jump
    //      or in mid-air!
    const canSprint =
      (bot.food ?? 20) > 6 && !bot.controlState?.sneak && !isBotEating(bot);
    const isMiningOrBuilding = Boolean(
      bot.pathfinder &&
      ((typeof bot.pathfinder.isMining === "function" &&
        bot.pathfinder.isMining()) ||
        (typeof bot.pathfinder.isBuilding === "function" &&
          bot.pathfinder.isBuilding())),
    );

    if (isPathing && !isMiningOrBuilding) {
      if (bot.entity.onGround && !bot.controlState?.jump) {
        bot.jumpTicks = 0;
      }

      // If pathfinder hit its `else { setControlState('forward', false) }` branch,
      // un-block the bot immediately so it keeps moving and steps over the obstacle!
      // Only intervene when grounded AND physically pressed against a wall in the
      // direction we are facing. Forcing `forward` in mid-air or while the bot is
      // still turning toward the next node makes it run in circles.
      if (
        !bot.controlState?.forward &&
        !bot.controlState?.back &&
        bot.entity.onGround &&
        bot.entity.isCollidedHorizontally
      ) {
        bot.jumpTicks = 0;

        if (typeof bot.blockAt === "function") {
          try {
            const aheadFoot = bot.blockAt(
              pos.offset(dirX * 0.75, 0, dirZ * 0.75).floored(),
            );
            const aheadHead = bot.blockAt(
              pos.offset(dirX * 0.75, 1, dirZ * 0.75).floored(),
            );
            const aheadAbove = bot.blockAt(
              pos.offset(dirX * 0.75, 2, dirZ * 0.75).floored(),
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
              pulseAutoJump(3);
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
            pulseAutoJump(2);
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
        bot.jumpTicks = 0;
        pulseAutoJump(2);
      } else if (stuckTicks >= 26) {
        stuckTicks = 0;
        if (bot.entity.onGround && jumpCooldown === 0) {
          bot.jumpTicks = 0;
          pulseAutoJump(2);
        }
        // Never strafe while the pathfinder owns movement: sideways nudges
        // combined with jumps make the bot orbit its target node.
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
  attachSmartMovement,
};
