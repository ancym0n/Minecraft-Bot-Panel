const test = require("node:test");
const assert = require("node:assert/strict");
const {
  gearStageItems,
  computeGearBudget,
  describeGearBudget,
} = require("../src/js/scripts/gearup");

const owns = (have) => (suffix, tier) => have.includes(`${tier}_${suffix}`);
const hasPick = (have) => (name) => have.includes(name);
const countOf = (inv) => (name) => inv[name] || 0;
const all = { wantTools: true, wantArmor: true, wantShield: true };

test("Iron tier bill of materials: 34 ingots, sticks, planks, furnace and coal for the whole set", () => {
  const inv = { stone_pickaxe: 1, cobblestone: 3, oak_log: 2 };
  const items = gearStageItems("iron", "iron", all, owns(["stone_pickaxe"]), hasPick(["stone_pickaxe"]), countOf(inv));
  assert.deepEqual(items.map((i) => i.name), [
    "iron_pickaxe", "shield", "iron_sword", "iron_axe", "iron_shovel",
    "iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots",
  ]);
  const b = computeGearBudget(items, inv, { haveTable: false, haveFurnace: false, coalAvailable: true });
  assert.equal(b.ingotsNeed, 34);
  assert.equal(b.sticks, 7);
  assert.equal(b.craftPlanks, 6 + 4 + 4, "shield 6 + 2 stick crafts 4 + table 4");
  assert.equal(b.needFurnace, true);
  assert.deepEqual(b.missing, { logs: 2, cobblestone: 5, coal: 5, raw_iron: 34 });
  assert.equal(b.ready, false);
  assert.match(describeGearBudget("iron", b, inv), /34 iron_ingot \(have 0\).*still missing: 2 logs, 5 cobblestone, 5 coal, 34 raw_iron/);
});

test("Budget counts what is already owned, smelts everything at once and only then is ready", () => {
  const have = ["stone_pickaxe", "iron_pickaxe", "iron_sword"];
  const inv = { iron_ingot: 4, raw_iron: 20, coal: 3, spruce_planks: 4, stick: 8, furnace: 1 };
  const items = gearStageItems("iron", "iron", { ...all, wantShield: false }, owns(have), hasPick(have), countOf(inv));
  assert.deepEqual(items.map((i) => i.name), ["iron_axe", "iron_shovel", "iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"]);
  const b = computeGearBudget(items, inv, { haveTable: true, haveFurnace: true });
  assert.equal(b.ingotsNeed, 28);
  assert.equal(b.ingotsMissing, 24);
  assert.deepEqual(b.missing, { raw_iron: 4 }, "3 coal already cover 24 smelts");
  const later = computeGearBudget(items, { ...inv, raw_iron: 24 }, { haveTable: true, haveFurnace: true });
  assert.deepEqual(later.missing, {});
  assert.equal(later.smelts, 24, "all 24 smelted in one batch");
  assert.equal(later.ready, false);
  const done = computeGearBudget(items, { ...inv, raw_iron: 0, iron_ingot: 28 }, { haveTable: true, haveFurnace: true });
  assert.equal(done.ready, true);
});

test("No coal around: fuel comes from extra logs (planks), never from planks needed for crafting", () => {
  const inv = { stone_pickaxe: 1, raw_iron: 3, furnace: 1 };
  const items = gearStageItems("iron", "diamond", all, owns(["stone_pickaxe"]), hasPick(["stone_pickaxe"]), countOf(inv));
  assert.deepEqual(items.map((i) => i.name), ["iron_pickaxe", "shield"], "diamond tier only needs the iron pickaxe (+shield) here");
  const b = computeGearBudget(items, inv, { haveTable: true, haveFurnace: true, coalAvailable: false });
  assert.equal(b.fuelPlanks, 3, "4 smelts / 1.5 per plank");
  assert.equal(b.craftPlanks, 6 + 2);
  assert.deepEqual(b.missing, { logs: 3, raw_iron: 1 });
});

test("Stone and wooden stages", () => {
  const inv = { oak_log: 1 };
  const wood = gearStageItems("wooden", "iron", all, owns([]), hasPick([]), countOf(inv));
  assert.deepEqual(wood.map((i) => i.name), ["wooden_pickaxe"]);
  const wb = computeGearBudget(wood, inv, {});
  assert.equal(wb.craftPlanks, 3 + 2 + 4);
  assert.deepEqual(wb.missing, { logs: 2 });
  const stone = gearStageItems("stone", "stone", all, owns(["wooden_pickaxe"]), hasPick(["wooden_pickaxe"]), countOf({}));
  assert.deepEqual(stone.map((i) => i.name), ["stone_pickaxe", "stone_sword", "stone_axe"]);
  const sb = computeGearBudget(stone, { cobblestone: 2, oak_planks: 12 }, { haveTable: true });
  assert.deepEqual(sb.missing, { cobblestone: 6 });
});
