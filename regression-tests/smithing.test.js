const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Vec3 } = require("vec3");
const {
  smithingLayout,
  upgradeAtSmithingTable,
} = require("../src/js/smithing");
const gearUp = require("../src/js/scripts/gearup");

function fixture(
  version,
  { rejectResult = false, stripData = false, onTransfer } = {},
) {
  const registry = require("prismarine-registry")(version);
  const Item = require("prismarine-item")(registry);
  const window = require("prismarine-windows")(registry).createWindow(
    7,
    "minecraft:smithing",
    "Smithing",
  );
  const modern = registry.version[">="]("1.20");
  if (modern) window.slots.push(null);
  const firstInventorySlot = modern ? 4 : 3;
  const nbt = {
    type: "compound",
    name: "",
    value: { marker: { type: "string", value: "kept" } },
  };
  const makeItem = (name, data) =>
    new Item(registry.itemsByName[name].id, 1, 0, data);
  window.updateSlot(firstInventorySlot, makeItem("diamond_sword", nbt));
  window.updateSlot(firstInventorySlot + 1, makeItem("netherite_ingot"));
  if (modern) {
    window.updateSlot(
      firstInventorySlot + 2,
      makeItem("netherite_upgrade_smithing_template"),
    );
  }
  const bot = new EventEmitter();
  bot.registry = registry;
  bot.currentWindow = null;
  bot.supportFeature = (feature) =>
    feature === "stateIdUsed" && registry.version[">="]("1.17.1");
  bot.openBlock = async () => {
    bot.currentWindow = window;
    return window;
  };
  window.close = async () => {
    bot.currentWindow = null;
  };
  const layout = {
    template: modern ? 0 : null,
    equipment: modern ? 1 : 0,
    ingot: modern ? 2 : 1,
    result: modern ? 3 : 2,
  };
  bot.transfer = async (options) => {
    const item = window.slots[options.sourceStart];
    window.updateSlot(options.sourceStart, null);
    window.updateSlot(options.destStart, item);
    onTransfer?.();
    if (
      window.slots[layout.equipment] &&
      window.slots[layout.ingot] &&
      (layout.template === null || window.slots[layout.template])
    ) {
      window.updateSlot(
        layout.result,
        makeItem(
          window.slots[layout.equipment].name.replace("diamond_", "netherite_"),
          stripData ? null : window.slots[layout.equipment].nbt,
        ),
      );
    }
  };
  bot.clickWindow = async (slot) => {
    window.selectedItem = window.slots[slot];
    window.updateSlot(slot, null);
    for (const input of [layout.template, layout.equipment, layout.ingot]) {
      if (input !== null) window.updateSlot(input, null);
    }
  };
  bot._client = {
    write: () => {
      if (rejectResult) window.selectedItem = null;
      setImmediate(() => bot.emit(`setWindowItems:${window.id}`));
    },
  };
  bot.putSelectedItemRange = async () => {
    const slot = window.firstEmptySlotRange(
      window.inventoryStart,
      window.inventoryEnd,
    );
    window.updateSlot(slot, window.selectedItem);
    window.selectedItem = null;
  };
  return { bot, window, nbt };
}

for (const version of ["1.16.5", "1.20.1", "1.21.4"]) {
  test(`smithing upgrades actual equipment and keeps NBT on ${version}`, async () => {
    const { bot, window, nbt } = fixture(version);
    await upgradeAtSmithingTable(bot, {}, "sword");
    const result = window.slots.find(
      (item) => item?.name === "netherite_sword",
    );
    assert.ok(result);
    assert.deepEqual(result.nbt, nbt);
    assert.equal(bot.currentWindow, null);
  });
}

test("smithing rejects an unexpected window layout without moving items", () => {
  const { bot, window } = fixture("1.20.1");
  window.slots.pop();
  assert.throws(() => smithingLayout(bot, window), /Unexpected smithing/);
});

test("smithing does not report a rejected result as an upgrade", async () => {
  const { bot } = fixture("1.20.1", { rejectResult: true });
  await assert.rejects(
    upgradeAtSmithingTable(bot, {}, "sword"),
    /did not confirm/,
  );
  assert.equal(bot.currentWindow, null);
});

test("smithing does not take a result that lost equipment data", async () => {
  const { bot, window } = fixture("1.20.1", { stripData: true });
  let clicked = false;
  bot.clickWindow = async () => {
    clicked = true;
  };
  await assert.rejects(
    upgradeAtSmithingTable(bot, {}, "sword"),
    /does not preserve/,
  );
  assert.equal(clicked, false);
  assert.equal(bot.currentWindow, null);
  assert.equal(window.slots[1]?.name, "diamond_sword");
});

test("smithing stops moving inputs when cancelled", async () => {
  const controller = new AbortController();
  let transfers = 0;
  const { bot } = fixture("1.20.1", {
    onTransfer: () => {
      transfers++;
      controller.abort();
    },
  });
  await assert.rejects(
    upgradeAtSmithingTable(bot, {}, "sword", controller.signal),
    { name: "AbortError" },
  );
  assert.equal(transfers, 1);
  assert.equal(bot.currentWindow, null);
});

test("GearUp upgrades the last selected piece and verifies completion", async () => {
  const { bot, window } = fixture("1.20.1");
  const Item = require("prismarine-item")(bot.registry);
  for (const [index, name, count] of [
    [7, "netherite_pickaxe", 1],
    [8, "netherite_axe", 1],
    [9, "netherite_shovel", 1],
  ]) {
    window.updateSlot(
      index,
      new Item(bot.registry.itemsByName[name].id, count, 0),
    );
  }
  const pos = new Vec3(1, 0, 0);
  const table = { name: "smithing_table", position: pos, boundingBox: "block" };
  bot.entity = { position: new Vec3(0, 0, 0) };
  bot.inventory = {
    slots: [],
    items: () => window.slots.slice(4, 40).filter(Boolean),
  };
  bot.pathfinder = { setGoal: () => {} };
  bot.equip = async () => {};
  bot.findBlocks = ({ matching }) =>
    matching.includes(bot.registry.blocksByName.smithing_table.id) ? [pos] : [];
  bot.blockAt = (at) =>
    at.equals(pos)
      ? table
      : { name: "air", position: at, boundingBox: "empty" };
  const logs = [];
  await gearUp.script(
    bot,
    (line) => logs.push(line),
    () => {},
    async (key) =>
      ({ tier: "netherite", tools: "on", armor: "off", shield: "off" })[key],
    async (tick) => tick(),
  );
  assert.ok(window.slots.some((item) => item?.name === "netherite_sword"));
  assert.equal(bot._mcbpGearUpDone, true, logs.join("\n"));
  assert.ok(logs.some((line) => line.includes("Completed Netherite")));
});

test("GearUp upgrades multiple selected tools before reporting completion", async () => {
  const { bot, window } = fixture("1.20.1");
  const Item = require("prismarine-item")(bot.registry);
  for (const [index, name] of [
    [7, "diamond_pickaxe"],
    [8, "diamond_axe"],
    [9, "diamond_shovel"],
    [10, "netherite_ingot"],
    [11, "netherite_ingot"],
    [12, "netherite_ingot"],
    [13, "netherite_upgrade_smithing_template"],
    [14, "netherite_upgrade_smithing_template"],
    [15, "netherite_upgrade_smithing_template"],
  ]) {
    window.updateSlot(index, new Item(bot.registry.itemsByName[name].id, 1, 0));
  }
  const pos = new Vec3(1, 0, 0);
  const table = { name: "smithing_table", position: pos, boundingBox: "block" };
  bot.entity = { position: new Vec3(0, 0, 0) };
  bot.inventory = {
    slots: [],
    items: () => window.slots.slice(4, 40).filter(Boolean),
  };
  bot.pathfinder = { setGoal: () => {} };
  bot.equip = async () => {};
  bot.findBlocks = ({ matching }) =>
    matching.includes(bot.registry.blocksByName.smithing_table.id) ? [pos] : [];
  bot.blockAt = (at) =>
    at.equals(pos)
      ? table
      : { name: "air", position: at, boundingBox: "empty" };
  const logs = [];
  await gearUp.script(
    bot,
    (line) => logs.push(line),
    () => {},
    async (key) =>
      ({ tier: "netherite", tools: "on", armor: "off", shield: "off" })[key],
    async (tick) => {
      for (let i = 0; i < 5; i++) await tick();
    },
  );
  const names = bot.inventory.items().map((item) => item.name);
  for (const piece of ["sword", "pickaxe", "axe", "shovel"]) {
    assert.ok(names.includes(`netherite_${piece}`), logs.join("\n"));
  }
  assert.equal(bot._mcbpGearUpDone, true, logs.join("\n"));
});

test("GearUp searches for a return portal when template duplication needs diamonds", async () => {
  const { bot, window } = fixture("1.20.1");
  const Item = require("prismarine-item")(bot.registry);
  for (const [index, name, count] of [
    [7, "netherite_pickaxe", 1],
    [8, "diamond_axe", 1],
    [9, "diamond_shovel", 1],
    [10, "oak_log", 2],
  ]) {
    window.updateSlot(
      index,
      new Item(bot.registry.itemsByName[name].id, count, 0),
    );
  }
  bot.entity = { position: new Vec3(0, 0, 0) };
  bot.game = { dimension: "minecraft:the_nether" };
  bot.inventory = {
    slots: [],
    items: () => window.slots.slice(4, 40).filter(Boolean),
  };
  bot.pathfinder = {
    movements: {
      canDig: false,
      allowParkour: false,
      allowParkourAscend: false,
      maxDropDown: 1,
    },
    setGoal: () => {},
  };
  bot.equip = async () => {};
  bot.findBlocks = () => [];
  bot.blockAt = (position) => ({ name: "air", position, boundingBox: "empty" });
  const logs = [];
  await gearUp.script(
    bot,
    (line) => logs.push(line),
    () => {},
    async (key) =>
      ({ tier: "netherite", tools: "on", armor: "off", shield: "off" })[key],
    async () => {},
  );
  assert.ok(
    logs.some((line) => line.includes("Cannot find a safe return portal")),
    logs.join("\n"),
  );
  assert.ok(
    !logs.some((line) => line.includes("ensureOverworld is not defined")),
  );
  assert.equal(bot._mcbpGearUpDone, false);
});

test("GearUp steps out of a portal before doing other work on startup", async () => {
  const { bot, window } = fixture("1.20.1");
  const portal = new Vec3(0, 0, 0);
  bot.entity = { position: portal.offset(0.5, 0, 0.5) };
  bot.game = { dimension: "the_nether" };
  bot.inventory = {
    slots: [],
    items: () => window.slots.slice(4, 40).filter(Boolean),
  };
  bot.pathfinder = { setGoal: () => {} };
  bot.findBlocks = ({ matching }) =>
    matching.includes(bot.registry.blocksByName.nether_portal.id)
      ? [portal]
      : [];
  bot.blockAt = (position) => {
    const isPortal = position.equals(portal);
    return {
      position,
      name: isPortal ? "nether_portal" : position.y < 0 ? "stone" : "air",
      boundingBox: isPortal || position.y >= 0 ? "empty" : "block",
      getProperties: () => ({ axis: "x" }),
    };
  };
  bot.lookAt = async () => {};
  const controls = [];
  bot.setControlState = (name, value) => {
    controls.push([name, value]);
    if (value) bot.entity.position = portal.offset(0.5, 0, -0.5);
  };
  await gearUp.script(
    bot,
    () => {},
    () => {},
    async (key) =>
      ({ tier: "netherite", tools: "on", armor: "off", shield: "off" })[key],
    async () => {},
  );
  assert.deepEqual(controls, [
    ["forward", true],
    ["forward", false],
  ]);
});

test("GearUp opens a tunnel toward buried ancient debris without pathfinder digging", async () => {
  const { bot, window } = fixture("1.20.1");
  const Item = require("prismarine-item")(bot.registry);
  window.updateSlot(5, null);
  for (const [index, name, count] of [
    [7, "diamond_pickaxe", 1],
    [8, "diamond_axe", 1],
    [9, "diamond_shovel", 1],
    [10, "oak_log", 2],
  ]) {
    window.updateSlot(
      index,
      new Item(bot.registry.itemsByName[name].id, count, 0),
    );
  }
  bot.entity = { position: new Vec3(0.5, 0, 0.5) };
  bot.game = { dimension: "the_nether" };
  bot.entities = {};
  bot.health = 20;
  bot.inventory = {
    slots: [],
    items: () => window.slots.slice(4, 40).filter(Boolean),
  };
  bot.pathfinder = {
    movements: {
      canDig: false,
      allowParkour: false,
      allowParkourAscend: false,
      maxDropDown: 1,
    },
    setGoal: () => {},
  };
  const ore = new Vec3(8, 0, 0);
  bot.findBlocks = ({ matching }) =>
    matching.includes(bot.registry.blocksByName.ancient_debris.id) ? [ore] : [];
  const dug = [];
  bot.blockAt = (position) => {
    const name = position.equals(ore)
      ? "ancient_debris"
      : position.y < 0
        ? "stone"
        : position.x === 0 && position.z === 0
          ? "air"
          : "netherrack";
    return {
      position,
      name,
      type: bot.registry.blocksByName[name].id,
      boundingBox: name === "air" ? "empty" : "block",
    };
  };
  bot.equip = async () => {};
  bot.lookAt = async () => {};
  bot.dig = async (block) => dug.push(block.position);
  const repeater = async () => {};
  repeater.signal = new AbortController().signal;
  const logs = [];
  await gearUp.script(
    bot,
    (line) => logs.push(line),
    () => {},
    async (key) =>
      ({ tier: "netherite", tools: "on", armor: "off", shield: "off" })[key],
    repeater,
  );
  assert.deepEqual(dug, [new Vec3(1, 1, 0)], logs.join("\n"));
  assert.equal(bot.pathfinder.movements.canDig, false);
  assert.equal(bot._mcbpGearUpDone, false);
});

test("GearUp does not claim Netherite armor is complete if equipping failed", async () => {
  const { bot, window } = fixture("1.20.1");
  const Item = require("prismarine-item")(bot.registry);
  for (const [index, name] of [
    [7, "netherite_helmet"],
    [8, "netherite_chestplate"],
    [9, "netherite_leggings"],
    [10, "netherite_boots"],
    [11, "netherite_pickaxe"],
  ]) {
    window.updateSlot(index, new Item(bot.registry.itemsByName[name].id, 1, 0));
  }
  bot.entity = { position: new Vec3(0, 0, 0) };
  bot.inventory = {
    slots: [],
    items: () => window.slots.slice(4, 40).filter(Boolean),
  };
  bot.pathfinder = { setGoal: () => {} };
  bot.equip = async () => {};
  bot.findBlocks = () => [];
  bot.blockAt = (position) => ({ position, name: "air", boundingBox: "empty" });
  const logs = [];
  await gearUp.script(
    bot,
    (line) => logs.push(line),
    () => {},
    async (key) =>
      ({ tier: "netherite", tools: "off", armor: "on", shield: "off" })[key],
    async () => {},
  );
  assert.equal(bot._mcbpGearUpDone, false);
  assert.ok(
    logs.some((line) => line.includes("Could not equip netherite_")),
    logs.join("\n"),
  );
});
