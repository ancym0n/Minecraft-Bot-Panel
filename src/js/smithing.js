const { isDeepStrictEqual } = require("node:util");

const RESULT_TIMEOUT_MS = 8000;

function abortError() {
  const error = new Error("Smithing was cancelled");
  error.name = "AbortError";
  return error;
}

function checkCancelled(signal) {
  if (signal?.aborted) throw abortError();
}

function preservesItemData(input, output) {
  if (!isDeepStrictEqual(input.nbt, output.nbt)) return false;
  for (const component of input.components || []) {
    const resultComponent = (output.components || []).find(
      (candidate) => candidate.type === component.type,
    );
    if (!isDeepStrictEqual(component, resultComponent)) return false;
  }
  return (input.removedComponents || []).every((component) =>
    (output.removedComponents || []).includes(component),
  );
}

function smithingLayout(bot, window) {
  if (window?.type !== "minecraft:smithing") {
    throw new Error("The opened window is not a smithing table");
  }
  const version = bot.registry?.version;
  if (typeof version?.[">="] !== "function" || !version[">="]("1.16")) {
    throw new Error(
      "This Minecraft version does not support Netherite smithing",
    );
  }
  const template = version[">="]("1.20");
  const inventoryStart = template ? 4 : 3;
  const inventoryEnd = inventoryStart + 36;
  if (
    window.slots.length !== inventoryEnd ||
    ![3, inventoryStart].includes(window.inventoryStart)
  ) {
    throw new Error(
      "Unexpected smithing window layout; refusing to move items",
    );
  }

  // prismarine-windows currently describes the 1.20+ table using its old
  // three-slot layout. Correct it after receiving the full server inventory.
  window.inventoryStart = inventoryStart;
  window.inventoryEnd = inventoryEnd;
  window.hotbarStart = inventoryEnd - 9;
  window.craftingResultSlot = template ? 3 : 2;
  return {
    template: template ? 0 : null,
    equipment: template ? 1 : 0,
    ingot: template ? 2 : 1,
    result: template ? 3 : 2,
  };
}

function waitForResult(window, slot, expectedName, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      window.removeListener(`updateSlot:${slot}`, inspect);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(abortError());
    const inspect = () => {
      const item = window.slots[slot];
      if (!item) return;
      if (item.name !== expectedName) {
        finish(new Error(`Unexpected smithing result: ${item.name}`));
      } else {
        finish();
      }
    };
    timer = setTimeout(
      () => finish(new Error("Smithing table did not produce a result")),
      RESULT_TIMEOUT_MS,
    );
    window.on(`updateSlot:${slot}`, inspect);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else inspect();
  });
}

function syncWindow(bot, window, signal) {
  if (!bot.supportFeature("stateIdUsed")) return Promise.resolve();
  const Item = require("prismarine-item")(bot.registry);
  return new Promise((resolve, reject) => {
    let timer;
    const event = `setWindowItems:${window.id}`;
    const cleanup = () => {
      clearTimeout(timer);
      bot.removeListener(event, onSync);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onSync = () => finish();
    const onAbort = () => finish(abortError());
    timer = setTimeout(
      () => finish(new Error("Server did not confirm the smithing inventory")),
      RESULT_TIMEOUT_MS,
    );
    bot.once(event, onSync);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      bot._client.write("window_click", {
        windowId: window.id,
        stateId: -1,
        slot: -999,
        mouseButton: 2,
        mode: 5,
        changedSlots: [],
        cursorItem: Item.toNotch(window.selectedItem),
      });
    } catch (error) {
      finish(error);
    }
  });
}

async function upgradeAtSmithingTable(bot, block, piece, signal) {
  const allowed = new Set([
    "sword",
    "pickaxe",
    "axe",
    "shovel",
    "helmet",
    "chestplate",
    "leggings",
    "boots",
  ]);
  if (!allowed.has(piece)) throw new Error("Unsupported Netherite equipment");
  checkCancelled(signal);
  if (bot.currentWindow) throw new Error("Another inventory window is open");
  const window = await bot.openBlock(block);
  try {
    const layout = smithingLayout(bot, window);
    checkCancelled(signal);
    if (
      window.selectedItem ||
      window.slots.slice(0, window.inventoryStart).some(Boolean)
    ) {
      throw new Error("Smithing table or cursor is not empty");
    }

    const inputs = [
      ...(layout.template === null
        ? []
        : [["netherite_upgrade_smithing_template", layout.template]]),
      [`diamond_${piece}`, layout.equipment],
      ["netherite_ingot", layout.ingot],
    ];
    let equipment;
    for (const [name, destination] of inputs) {
      checkCancelled(signal);
      const item = window.slots
        .slice(window.inventoryStart, window.inventoryEnd)
        .find((candidate) => candidate?.name === name);
      if (!item) throw new Error(`Missing ${name}`);
      if (destination === layout.equipment) equipment = item;
      await bot.transfer({
        window,
        itemType: item.type,
        metadata: item.metadata,
        nbt: item.nbt,
        count: 1,
        sourceStart: item.slot,
        sourceEnd: item.slot + 1,
        destStart: destination,
        destEnd: destination + 1,
      });
      if (window.slots[destination]?.name !== name) {
        throw new Error(`Server did not accept ${name}`);
      }
    }

    const resultName = `netherite_${piece}`;
    await waitForResult(window, layout.result, resultName, signal);
    checkCancelled(signal);
    if (!preservesItemData(equipment, window.slots[layout.result])) {
      throw new Error("Smithing result does not preserve the equipment data");
    }
    await bot.clickWindow(layout.result, 0, 0);
    checkCancelled(signal);
    await syncWindow(bot, window, signal);
    if (window.selectedItem?.name !== resultName) {
      throw new Error("Server did not confirm the Netherite item");
    }
    await bot.putSelectedItemRange(
      window.inventoryStart,
      window.inventoryEnd,
      window,
      null,
    );
    checkCancelled(signal);
    await syncWindow(bot, window, signal);
    if (
      window.selectedItem ||
      !window.slots
        .slice(window.inventoryStart, window.inventoryEnd)
        .some((item) => item?.name === resultName)
    ) {
      throw new Error("Server did not confirm the upgraded item in inventory");
    }
    return true;
  } finally {
    if (bot.currentWindow === window) await window.close();
  }
}

module.exports = { smithingLayout, upgradeAtSmithingTable };
