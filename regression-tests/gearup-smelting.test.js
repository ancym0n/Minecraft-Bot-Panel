const test = require("node:test");
const assert = require("node:assert/strict");
const { Vec3 } = require("vec3");
const { smeltInFurnace } = require("../src/js/scripts/gearup");

function fixture({ occupied = false, onInput, fuelName = "coal" } = {}) {
  const registry = require("prismarine-registry")("1.20.1");
  const position = new Vec3(1, 0, 0);
  const block = { name: "furnace", position, boundingBox: "block" };
  const debris = { name: "ancient_debris", type: 1, count: 1 };
  const coal = { name: fuelName, type: 2, count: 1 };
  let inventory = [debris, coal];
  const slots = new Array(39).fill(null);
  slots[3] = debris;
  slots[4] = coal;
  if (occupied) slots[0] = { name: "raw_iron", type: 3, count: 1 };
  let insertions = 0;
  let taken = 0;
  let closed = false;
  const furnace = {
    slots,
    inventoryStart: 3,
    inventoryEnd: 39,
    inputItem: () => slots[0],
    fuelItem: () => slots[1],
    outputItem: () => slots[2],
    putFuel: async () => {
      insertions++;
      slots[1] = slots[4];
      slots[4] = null;
    },
    putInput: async () => {
      insertions++;
      if (!slots[3]) throw new Error("input was already moved");
      slots[3] = null;
      slots[2] = { name: "netherite_scrap", type: 4, count: 1 };
      onInput?.(slots);
    },
    takeOutput: async () => {
      taken++;
      slots[3] = slots[2];
      slots[0] = null;
      slots[2] = null;
    },
    takeInput: async () => {
      slots[5] = slots[0];
      slots[0] = null;
    },
    takeFuel: async () => {
      slots[6] = slots[1];
      slots[1] = null;
    },
    close: async () => {
      closed = true;
      inventory = slots.slice(3).filter(Boolean);
    },
  };
  const bot = {
    registry,
    entity: { position: new Vec3(0, 0, 0) },
    pathfinder: { setGoal: () => {} },
    inventory: { items: () => inventory, slots: [] },
    findBlocks: ({ matching }) =>
      matching.includes(registry.blocksByName.furnace.id) ? [position] : [],
    blockAt: (pos) =>
      pos.equals(position)
        ? block
        : { name: "air", position: pos, boundingBox: "empty" },
    openFurnace: async () => furnace,
  };
  return {
    bot,
    slots,
    get insertions() {
      return insertions;
    },
    get taken() {
      return taken;
    },
    get closed() {
      return closed;
    },
  };
}

test("smelting counts output in the open window rather than stale inventory", async () => {
  const state = fixture();
  const result = await smeltInFurnace(
    state.bot,
    {},
    {
      inputNames: ["ancient_debris"],
      outputName: "netherite_scrap",
      neededCount: 1,
      requireEmptyFurnace: true,
    },
  );
  assert.equal(result, true);
  assert.equal(state.insertions, 2);
  assert.equal(state.taken, 1);
  assert.equal(state.closed, true);
});

test("cancelled smelting recovers its own output and unused fuel", async () => {
  const controller = new AbortController();
  const state = fixture({ onInput: () => controller.abort() });
  const logs = [];
  const result = await smeltInFurnace(
    state.bot,
    {},
    {
      inputNames: ["ancient_debris"],
      outputName: "netherite_scrap",
      requireEmptyFurnace: true,
      signal: controller.signal,
      recoveryLog: (message) => logs.push(message),
    },
  );
  assert.equal(result, false);
  assert.equal(state.taken, 1);
  assert.equal(state.slots[1], null);
  assert.ok(state.bot.inventory.items().some((item) => item.name === "coal"));
  assert.ok(
    state.bot.inventory.items().some((item) => item.name === "netherite_scrap"),
  );
  assert.ok(logs.some((message) => message.includes("Recovered")));
});

test("cancelled smelting leaves unexpectedly changed furnace contents alone", async () => {
  const controller = new AbortController();
  const state = fixture({
    onInput: (slots) => {
      slots[2] = { name: "diamond", type: 5, count: 1 };
      controller.abort();
    },
  });
  const logs = [];
  await smeltInFurnace(
    state.bot,
    {},
    {
      inputNames: ["ancient_debris"],
      outputName: "netherite_scrap",
      requireEmptyFurnace: true,
      signal: controller.signal,
      recoveryLog: (message) => logs.push(message),
    },
  );
  assert.equal(state.taken, 0);
  assert.equal(state.slots[2].name, "diamond");
  assert.ok(logs.some((message) => message.includes("changed unexpectedly")));
});

test("Netherite smelting leaves an occupied furnace untouched", async () => {
  const state = fixture({ occupied: true });
  const logs = [];
  const result = await smeltInFurnace(
    state.bot,
    {},
    {
      inputNames: ["ancient_debris"],
      outputName: "netherite_scrap",
      neededCount: 1,
      requireEmptyFurnace: true,
      stepLog: (message) => logs.push(message),
    },
  );
  assert.equal(result, false);
  assert.equal(state.insertions, 0);
  assert.equal(state.taken, 0);
  assert.equal(state.closed, true);
  assert.ok(logs.some((message) => message.includes("Furnace is occupied")));
});

test("Nether wood planks are not treated as furnace fuel", async () => {
  const state = fixture({ fuelName: "crimson_planks" });
  const logs = [];
  const result = await smeltInFurnace(
    state.bot,
    {},
    {
      inputNames: ["ancient_debris"],
      outputName: "netherite_scrap",
      requireEmptyFurnace: true,
      stepLog: (message) => logs.push(message),
    },
  );
  assert.equal(result, false);
  assert.equal(state.insertions, 0);
  assert.ok(logs.some((message) => message.includes("Need fuel")));
});
