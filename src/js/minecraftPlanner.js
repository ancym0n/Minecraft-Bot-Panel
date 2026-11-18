// Minecraft Survival Tech-Tree Planner, Action Knowledge Base & Sequential Task Queue.
// Understands composite goals (e.g. "make iron armor from scratch", "stone tools",
// "diamond gear", "get food") and inspects the bot's live inventory to generate
// and execute an ordered, dependency-resolved plan step by step.

const PICKAXE_TIERS = [
  "wooden_pickaxe",
  "golden_pickaxe",
  "stone_pickaxe",
  "iron_pickaxe",
  "diamond_pickaxe",
  "netherite_pickaxe",
];

// Composite item sets so "make iron armor", "craft stone tools", "make diamond gear"
// expand into all constituent items automatically.
const COMPOSITE_SETS = {
  iron_armor: ["iron_chestplate", "iron_leggings", "iron_helmet", "iron_boots"],
  full_iron_armor: [
    "iron_chestplate",
    "iron_leggings",
    "iron_helmet",
    "iron_boots",
  ],
  iron_armor_set: [
    "iron_chestplate",
    "iron_leggings",
    "iron_helmet",
    "iron_boots",
  ],
  iron_set: [
    "iron_chestplate",
    "iron_leggings",
    "iron_helmet",
    "iron_boots",
    "iron_sword",
    "iron_pickaxe",
  ],
  iron_gear: [
    "iron_pickaxe",
    "iron_sword",
    "iron_axe",
    "shield",
    "iron_chestplate",
    "iron_leggings",
    "iron_helmet",
    "iron_boots",
  ],
  full_iron: [
    "iron_pickaxe",
    "iron_sword",
    "iron_axe",
    "shield",
    "iron_chestplate",
    "iron_leggings",
    "iron_helmet",
    "iron_boots",
  ],
  iron_tools: ["iron_pickaxe", "iron_sword", "iron_axe", "iron_shovel"],
  diamond_armor: [
    "diamond_chestplate",
    "diamond_leggings",
    "diamond_helmet",
    "diamond_boots",
  ],
  full_diamond_armor: [
    "diamond_chestplate",
    "diamond_leggings",
    "diamond_helmet",
    "diamond_boots",
  ],
  diamond_set: [
    "diamond_chestplate",
    "diamond_leggings",
    "diamond_helmet",
    "diamond_boots",
    "diamond_sword",
    "diamond_pickaxe",
  ],
  diamond_gear: [
    "diamond_pickaxe",
    "diamond_sword",
    "diamond_axe",
    "shield",
    "diamond_chestplate",
    "diamond_leggings",
    "diamond_helmet",
    "diamond_boots",
  ],
  full_diamond: [
    "diamond_pickaxe",
    "diamond_sword",
    "diamond_axe",
    "shield",
    "diamond_chestplate",
    "diamond_leggings",
    "diamond_helmet",
    "diamond_boots",
  ],
  diamond_tools: [
    "diamond_pickaxe",
    "diamond_sword",
    "diamond_axe",
    "diamond_shovel",
  ],
  golden_armor: [
    "golden_chestplate",
    "golden_leggings",
    "golden_helmet",
    "golden_boots",
  ],
  gold_armor: [
    "golden_chestplate",
    "golden_leggings",
    "golden_helmet",
    "golden_boots",
  ],
  leather_armor: [
    "leather_chestplate",
    "leather_leggings",
    "leather_helmet",
    "leather_boots",
  ],
  stone_tools: ["stone_pickaxe", "stone_sword", "stone_axe", "stone_shovel"],
  stone_gear: ["stone_pickaxe", "stone_sword", "stone_axe", "stone_shovel"],
  wooden_tools: [
    "wooden_pickaxe",
    "wooden_sword",
    "wooden_axe",
    "wooden_shovel",
  ],
  wood_tools: ["wooden_pickaxe", "wooden_sword", "wooden_axe", "wooden_shovel"],
  wooden_gear: ["wooden_pickaxe", "wooden_sword", "wooden_axe"],
  wood_gear: ["wooden_pickaxe", "wooden_sword", "wooden_axe"],
  starter_kit: [
    "crafting_table",
    "wooden_pickaxe",
    "stone_pickaxe",
    "stone_sword",
    "stone_axe",
    "furnace",
  ],
};

// Recipe requirements for planning from scratch.
const ITEM_REQUIREMENTS = {
  // Wood tier
  oak_planks: { planks: 0, logs: 1, table: false },
  stick: { planks: 2, table: false },
  crafting_table: { planks: 4, table: false },
  wooden_pickaxe: { planks: 3, sticks: 2, table: true },
  wooden_axe: { planks: 3, sticks: 2, table: true },
  wooden_sword: { planks: 2, sticks: 1, table: true },
  wooden_shovel: { planks: 1, sticks: 2, table: true },
  wooden_hoe: { planks: 2, sticks: 2, table: true },
  chest: { planks: 8, table: true },
  barrel: { planks: 7, table: true },
  oak_boat: { planks: 5, table: true },
  oak_door: { planks: 6, table: true },
  bowl: { planks: 3, table: true },

  // Stone tier
  stone_pickaxe: {
    cobble: 3,
    sticks: 2,
    table: true,
    minPick: "wooden_pickaxe",
  },
  stone_axe: { cobble: 3, sticks: 2, table: true, minPick: "wooden_pickaxe" },
  stone_sword: { cobble: 2, sticks: 1, table: true, minPick: "wooden_pickaxe" },
  stone_shovel: {
    cobble: 1,
    sticks: 2,
    table: true,
    minPick: "wooden_pickaxe",
  },
  stone_hoe: { cobble: 2, sticks: 2, table: true, minPick: "wooden_pickaxe" },
  furnace: { cobble: 8, table: true, minPick: "wooden_pickaxe" },

  // Iron tier
  iron_pickaxe: {
    iron_ingot: 3,
    sticks: 2,
    table: true,
    minPick: "stone_pickaxe",
  },
  iron_axe: { iron_ingot: 3, sticks: 2, table: true, minPick: "stone_pickaxe" },
  iron_sword: {
    iron_ingot: 2,
    sticks: 1,
    table: true,
    minPick: "stone_pickaxe",
  },
  iron_shovel: {
    iron_ingot: 1,
    sticks: 2,
    table: true,
    minPick: "stone_pickaxe",
  },
  iron_hoe: { iron_ingot: 2, sticks: 2, table: true, minPick: "stone_pickaxe" },
  iron_helmet: { iron_ingot: 5, table: true, minPick: "stone_pickaxe" },
  iron_chestplate: { iron_ingot: 8, table: true, minPick: "stone_pickaxe" },
  iron_leggings: { iron_ingot: 7, table: true, minPick: "stone_pickaxe" },
  iron_boots: { iron_ingot: 4, table: true, minPick: "stone_pickaxe" },
  shield: { iron_ingot: 1, planks: 6, table: true, minPick: "stone_pickaxe" },
  bucket: { iron_ingot: 3, table: true, minPick: "stone_pickaxe" },
  shears: { iron_ingot: 2, table: false, minPick: "stone_pickaxe" },
  flint_and_steel: { iron_ingot: 1, table: false, minPick: "stone_pickaxe" },
  compass: { iron_ingot: 4, table: true, minPick: "stone_pickaxe" },
  cauldron: { iron_ingot: 7, table: true, minPick: "stone_pickaxe" },
  iron_block: { iron_ingot: 9, table: true, minPick: "stone_pickaxe" },

  // Gold tier
  golden_pickaxe: {
    gold_ingot: 3,
    sticks: 2,
    table: true,
    minPick: "iron_pickaxe",
  },
  golden_axe: {
    gold_ingot: 3,
    sticks: 2,
    table: true,
    minPick: "iron_pickaxe",
  },
  golden_sword: {
    gold_ingot: 2,
    sticks: 1,
    table: true,
    minPick: "iron_pickaxe",
  },
  golden_shovel: {
    gold_ingot: 1,
    sticks: 2,
    table: true,
    minPick: "iron_pickaxe",
  },
  golden_helmet: { gold_ingot: 5, table: true, minPick: "iron_pickaxe" },
  golden_chestplate: { gold_ingot: 8, table: true, minPick: "iron_pickaxe" },
  golden_leggings: { gold_ingot: 7, table: true, minPick: "iron_pickaxe" },
  golden_boots: { gold_ingot: 4, table: true, minPick: "iron_pickaxe" },
  golden_apple: { gold_ingot: 8, table: true, minPick: "iron_pickaxe" },

  // Diamond tier
  diamond_pickaxe: {
    diamond: 3,
    sticks: 2,
    table: true,
    minPick: "iron_pickaxe",
  },
  diamond_axe: { diamond: 3, sticks: 2, table: true, minPick: "iron_pickaxe" },
  diamond_sword: {
    diamond: 2,
    sticks: 1,
    table: true,
    minPick: "iron_pickaxe",
  },
  diamond_shovel: {
    diamond: 1,
    sticks: 2,
    table: true,
    minPick: "iron_pickaxe",
  },
  diamond_hoe: { diamond: 2, sticks: 2, table: true, minPick: "iron_pickaxe" },
  diamond_helmet: { diamond: 5, table: true, minPick: "iron_pickaxe" },
  diamond_chestplate: { diamond: 8, table: true, minPick: "iron_pickaxe" },
  diamond_leggings: { diamond: 7, table: true, minPick: "iron_pickaxe" },
  diamond_boots: { diamond: 4, table: true, minPick: "iron_pickaxe" },

  // Utility
  torch: { coal: 1, sticks: 1, table: false },
  campfire: { logs: 3, coal: 1, sticks: 3, table: true },
};

function getInventorySnapshot(bot) {
  const counts = {};
  if (bot?.inventory) {
    for (const it of bot.inventory.items()) {
      counts[it.name] = (counts[it.name] || 0) + it.count;
    }
    for (const s of [5, 6, 7, 8, 45]) {
      const eq = bot.inventory.slots?.[s];
      if (eq?.name) counts[eq.name] = (counts[eq.name] || 0) + (eq.count || 1);
    }
  }
  const sumMatch = (pred) =>
    Object.entries(counts)
      .filter(([k]) => pred(k))
      .reduce((acc, [, v]) => acc + v, 0);

  const logs = sumMatch((n) => n.endsWith("_log") || n.endsWith("_stem"));
  const planks = sumMatch((n) => n.endsWith("_planks"));
  const sticks = counts.stick || 0;
  const cobble = sumMatch(
    (n) =>
      n === "cobblestone" || n === "cobbled_deepslate" || n === "blackstone",
  );
  const rawIron =
    (counts.raw_iron || 0) +
    (counts.iron_ore || 0) +
    (counts.deepslate_iron_ore || 0);
  const ironIngot = counts.iron_ingot || 0;
  const rawGold =
    (counts.raw_gold || 0) +
    (counts.gold_ore || 0) +
    (counts.deepslate_gold_ore || 0);
  const goldIngot = counts.gold_ingot || 0;
  const diamond = counts.diamond || 0;
  const coal = (counts.coal || 0) + (counts.charcoal || 0);

  const hasPickAtLeast = (minPick) => {
    const idx = PICKAXE_TIERS.indexOf(minPick);
    if (idx === -1) return false;
    return PICKAXE_TIERS.slice(idx).some((p) => (counts[p] || 0) > 0);
  };

  let nearbyTable = false;
  let nearbyFurnace = false;
  try {
    if (typeof bot?.findBlock === "function" && bot.registry?.blocksByName) {
      const tId = bot.registry.blocksByName.crafting_table?.id;
      const fId = bot.registry.blocksByName.furnace?.id;
      const bfId = bot.registry.blocksByName.blast_furnace?.id;
      if (typeof tId === "number") {
        nearbyTable = Boolean(
          bot.findBlock({ matching: tId, maxDistance: 24 }),
        );
      }
      const fIds = [fId, bfId].filter((id) => typeof id === "number");
      if (fIds.length) {
        nearbyFurnace = Boolean(
          bot.findBlock({ matching: fIds, maxDistance: 24 }),
        );
      }
    }
  } catch (_) {}

  return {
    counts,
    logs,
    planks,
    sticks,
    cobble,
    rawIron,
    ironIngot,
    rawGold,
    goldIngot,
    diamond,
    coal,
    hasTable: (counts.crafting_table || 0) > 0 || nearbyTable,
    hasFurnace:
      (counts.furnace || 0) > 0 ||
      (counts.blast_furnace || 0) > 0 ||
      nearbyFurnace,
    hasPickAtLeast,
  };
}

/**
 * Normalizes a goal or item name into a list of target items to craft/obtain,
 * or returns `null` if it's not a crafting/progression goal.
 */
function resolveTargetItems(rawGoal, count = 1) {
  const clean = String(rawGoal || "")
    .toLowerCase()
    .replace(/^minecraft:/, "")
    .replace(
      /\b(from scratch|right now|please|pls|for me|me|full|set of|some|a|an|the|make|craft|create|forge|build|get|gear up to|gear up)\b/g,
      " ",
    )
    .trim()
    .replace(/[\s-]+/g, "_");

  if (!clean) return null;

  // Direct composite set match
  if (COMPOSITE_SETS[clean]) {
    return [...COMPOSITE_SETS[clean]];
  }
  const aliases = {
    iron_armour: "iron_armor",
    diamond_armour: "diamond_armor",
    gold_armour: "golden_armor",
    golden_armour: "golden_armor",
    leather_armour: "leather_armor",
    iron: "iron_ingot",
    iron_ingots: "iron_ingot",
    iron_ignot: "iron_ingot",
    iron_ignots: "iron_ingot",
    wood_pickaxe: "wooden_pickaxe",
    wood_pick: "wooden_pickaxe",
    wooden_pick: "wooden_pickaxe",
    stone_pick: "stone_pickaxe",
    iron_pick: "iron_pickaxe",
    diamond_pick: "diamond_pickaxe",
    wood_sword: "wooden_sword",
    wood_axe: "wooden_axe",
    wood_shovel: "wooden_shovel",
    table: "crafting_table",
    workbench: "crafting_table",
  };
  const mapped = aliases[clean] || clean;
  if (COMPOSITE_SETS[mapped]) {
    return [...COMPOSITE_SETS[mapped]];
  }
  if (ITEM_REQUIREMENTS[mapped]) {
    const n = Math.max(1, Math.min(32, Number(count) || 1));
    return Array.from({ length: n }, () => mapped);
  }
  return null;
}

/**
 * Builds an ordered, dependency-resolved list of steps (`[{ label, tool, args }]`)
 * to craft one or more target items from the bot's current inventory state.
 */
function buildCraftingPlan(bot, targetItemsInput, count = 1) {
  const targets = Array.isArray(targetItemsInput)
    ? targetItemsInput
    : resolveTargetItems(targetItemsInput, count);
  if (!targets || !targets.length) return null;

  const snap = getInventorySnapshot(bot);
  const steps = [];

  // Aggregate total requirements across all target items not already owned
  // (unless a single item was explicitly requested with count)
  const isSet = targets.length > 1 && new Set(targets).size > 1;
  const todoItems = isSet
    ? targets.filter((t) => !(snap.counts[t] > 0))
    : targets;

  if (todoItems.length === 0) {
    return [
      {
        label: `Equip ${targets.join(", ")}`,
        tool: "equip_best_gear",
        args: {},
      },
    ];
  }

  // Group identical items into { item, count }
  const grouped = [];
  for (const item of todoItems) {
    const last = grouped[grouped.length - 1];
    if (last && last.item === item) last.count += 1;
    else grouped.push({ item, count: 1 });
  }

  let neededPlanks = 0;
  let neededSticks = 0;
  let neededCobble = 0;
  let neededIron = 0;
  let neededGold = 0;
  let neededDiamond = 0;
  let needsTable = false;
  let highestPickNeeded = null;

  const pickOrder = [
    "wooden_pickaxe",
    "stone_pickaxe",
    "iron_pickaxe",
    "diamond_pickaxe",
  ];
  const bumpPick = (p) => {
    if (!p) return;
    if (
      !highestPickNeeded ||
      pickOrder.indexOf(p) > pickOrder.indexOf(highestPickNeeded)
    ) {
      highestPickNeeded = p;
    }
  };

  for (const { item, count: n } of grouped) {
    const req = ITEM_REQUIREMENTS[item];
    if (!req) continue;
    neededPlanks += (req.planks || 0) * n;
    neededSticks += (req.sticks || 0) * n;
    neededCobble += (req.cobble || 0) * n;
    neededIron += (req.iron_ingot || 0) * n;
    neededGold += (req.gold_ingot || 0) * n;
    neededDiamond += (req.diamond || 0) * n;
    if (req.table) needsTable = true;
    if (req.minPick) bumpPick(req.minPick);
  }

  const needIronSmelt = Math.max(0, neededIron - snap.ironIngot);
  const needIronMine = Math.max(0, needIronSmelt - snap.rawIron);
  const needGoldSmelt = Math.max(0, neededGold - snap.goldIngot);
  const needGoldMine = Math.max(0, needGoldSmelt - snap.rawGold);
  const needDiamondMine = Math.max(0, neededDiamond - snap.diamond);

  if (needDiamondMine > 0 || needGoldMine > 0) bumpPick("iron_pickaxe");
  if (needIronMine > 0) bumpPick("stone_pickaxe");
  if (neededCobble > snap.cobble) bumpPick("wooden_pickaxe");

  const needCraftWoodPick =
    highestPickNeeded &&
    !snap.hasPickAtLeast("wooden_pickaxe") &&
    !todoItems.includes("wooden_pickaxe");
  const needCraftStonePick =
    highestPickNeeded &&
    pickOrder.indexOf(highestPickNeeded) >=
      pickOrder.indexOf("stone_pickaxe") &&
    !snap.hasPickAtLeast("stone_pickaxe") &&
    !todoItems.includes("stone_pickaxe");
  const needCraftIronPick =
    highestPickNeeded &&
    pickOrder.indexOf(highestPickNeeded) >= pickOrder.indexOf("iron_pickaxe") &&
    !snap.hasPickAtLeast("iron_pickaxe") &&
    !todoItems.includes("iron_pickaxe");
  const needFurnace =
    (needIronSmelt > 0 || needGoldSmelt > 0) &&
    !snap.hasFurnace &&
    !todoItems.includes("furnace");

  if (
    needCraftWoodPick ||
    needCraftStonePick ||
    needCraftIronPick ||
    needFurnace
  ) {
    needsTable = true;
  }
  if (needCraftWoodPick) {
    neededPlanks += 3;
    neededSticks += 2;
  }
  if (needCraftStonePick) {
    neededCobble += 3;
    neededSticks += 2;
  }
  if (needFurnace) {
    neededCobble += 8;
  }
  if (!snap.hasTable && needsTable && !todoItems.includes("crafting_table")) {
    neededPlanks += 4;
  }

  const missingSticks = Math.max(0, neededSticks - snap.sticks);
  const planksForSticks = Math.ceil(missingSticks / 4) * 2;
  // Also budget planks for furnace fuel if smelting and no coal
  const fuelPlanks =
    (needIronSmelt > 0 || needGoldSmelt > 0) && snap.coal === 0
      ? Math.ceil((needIronSmelt + needGoldSmelt) / 1.5)
      : 0;
  const totalPlanksNeeded = neededPlanks + planksForSticks + fuelPlanks;
  const missingPlanks = Math.max(0, totalPlanksNeeded - snap.planks);
  const logsToMine = Math.max(0, Math.ceil(missingPlanks / 4) - snap.logs);

  // 1. Gather wood if needed
  if (logsToMine > 0) {
    steps.push({
      label: `Mine ${logsToMine} wood log(s) for planks, sticks${fuelPlanks ? " & fuel" : ""}`,
      tool: "mine_block",
      args: { block: "oak_log", count: logsToMine },
    });
  }

  // 2. Craft wooden_pickaxe if needed as prerequisite
  if (needCraftWoodPick) {
    steps.push({
      label: "Craft wooden_pickaxe to mine stone",
      tool: "craft_item",
      args: { item: "wooden_pickaxe", count: 1 },
    });
  }

  // 3. Mine stone/cobblestone if needed for stone_pickaxe, furnace, or target items
  const missingCobble = Math.max(0, neededCobble - snap.cobble);
  if (missingCobble > 0) {
    steps.push({
      label: `Mine ${missingCobble} stone for cobblestone`,
      tool: "mine_block",
      args: { block: "stone", count: missingCobble },
    });
  }

  // 4. Craft stone_pickaxe if needed as prerequisite for iron_ore
  if (needCraftStonePick) {
    steps.push({
      label: "Craft stone_pickaxe to mine iron_ore",
      tool: "craft_item",
      args: { item: "stone_pickaxe", count: 1 },
    });
  }

  // 5. Craft furnace if needed for smelting
  if (needFurnace) {
    steps.push({
      label: "Craft furnace (8 cobblestone)",
      tool: "craft_item",
      args: { item: "furnace", count: 1 },
    });
  }

  // 6. Mine & smelt iron if needed
  const totalIronToMine = needIronMine + (needCraftIronPick ? 3 : 0);
  const totalIronToSmelt = needIronSmelt + (needCraftIronPick ? 3 : 0);
  if (totalIronToMine > 0) {
    steps.push({
      label: `Mine ${totalIronToMine} iron_ore`,
      tool: "mine_block",
      args: { block: "iron_ore", count: totalIronToMine },
    });
  }
  if (totalIronToSmelt > 0) {
    steps.push({
      label: `Smelt ${totalIronToSmelt} iron_ingot in furnace`,
      tool: "smelt_item",
      args: { item: "iron_ingot", count: totalIronToSmelt },
    });
  }

  // 7. Craft iron_pickaxe if needed as prerequisite for gold/diamond
  if (needCraftIronPick) {
    steps.push({
      label: "Craft iron_pickaxe",
      tool: "craft_item",
      args: { item: "iron_pickaxe", count: 1 },
    });
  }

  // 8. Mine & smelt gold if needed
  if (needGoldMine > 0) {
    steps.push({
      label: `Mine ${needGoldMine} gold_ore`,
      tool: "mine_block",
      args: { block: "gold_ore", count: needGoldMine },
    });
  }
  if (needGoldSmelt > 0) {
    steps.push({
      label: `Smelt ${needGoldSmelt} gold_ingot`,
      tool: "smelt_item",
      args: { item: "gold_ingot", count: needGoldSmelt },
    });
  }

  // 9. Mine diamond if needed
  if (needDiamondMine > 0) {
    steps.push({
      label: `Mine ${needDiamondMine} diamond_ore`,
      tool: "mine_block",
      args: { block: "diamond_ore", count: needDiamondMine },
    });
  }

  // 10. Craft each target item
  for (const { item, count: n } of grouped) {
    if (item === "iron_ingot" || item === "gold_ingot") continue;
    steps.push({
      label: `Craft ${n}x ${item}`,
      tool: "craft_item",
      args: { item, count: n },
    });
  }

  // 11. Equip gear if any armor/weapon/shield was crafted
  if (
    grouped.some(({ item }) =>
      /(_helmet|_chestplate|_leggings|_boots|_sword|_axe|_pickaxe|shield)$/.test(
        item,
      ),
    )
  ) {
    steps.push({
      label: "Equip crafted armor & weapons",
      tool: "equip_best_gear",
      args: {},
    });
  }

  return steps;
}

module.exports = {
  COMPOSITE_SETS,
  ITEM_REQUIREMENTS,
  getInventorySnapshot,
  resolveTargetItems,
  buildCraftingPlan,
};
