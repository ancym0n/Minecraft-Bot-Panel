const { isBotEating, humanLookAt } = require("../botUtils");

function castAndWait(bot, signal, report) {
  const client = bot._client;
  const registry = bot.registry;
  if (
    !client?.on ||
    !client?.removeListener ||
    !bot.on ||
    !bot.removeListener ||
    !registry?.supportFeature ||
    typeof bot.supportFeature !== "function" ||
    !Number.isInteger(bot.entity?.id)
  ) {
    throw new Error("Fishing requires an active Minecraft connection");
  }
  const bobberType = bot.supportFeature("fishingBobberCorrectlyNamed")
    ? registry.entitiesByName?.fishing_bobber?.id
    : 90;
  if (!Number.isInteger(bobberType)) {
    throw new Error("This Minecraft version has no known fishing bobber type");
  }

  return new Promise((resolve, reject) => {
    let bobberId = null;
    let settled = false;
    let spawnTimer;
    const cleanup = () => {
      clearTimeout(spawnTimer);
      client.removeListener("spawn_entity", onSpawn);
      client.removeListener("world_particles", onParticles);
      client.removeListener("entity_destroy", onDestroy);
      client.removeListener("end", onEnd);
      bot.removeListener("heldItemChanged", onHeldItemChanged);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (result, error) => {
      if (settled) return false;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
      return true;
    };
    const onSpawn = (packet) => {
      if (
        bobberId === null &&
        packet.type === bobberType &&
        packet.objectData === bot.entity.id
      ) {
        bobberId = packet.entityId;
        clearTimeout(spawnTimer);
      }
    };
    const onParticles = (packet) => {
      const position = bot.entities?.[bobberId]?.position;
      if (!position || bobberId === null) return;
      const modern = registry.supportFeature("updatedParticlesPacket");
      const particle = modern ? packet.particle?.type : packet.particleId;
      const matching = modern
        ? particle === "fishing" || particle === "bubble"
        : [
            registry.particlesByName?.fishing?.id,
            registry.particlesByName?.bubble?.id,
          ]
            .filter((id) => id !== undefined)
            .includes(particle);
      const count = modern ? packet.amount : packet.particles;
      if (
        !matching ||
        count !== 6 ||
        !Number.isFinite(packet.x) ||
        !Number.isFinite(packet.z) ||
        Math.hypot(packet.x - position.x, packet.z - position.z) > 1.23
      )
        return;
      if (bot.heldItem?.name !== "fishing_rod") {
        finish("rod-changed");
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      try {
        bot.activateItem();
        resolve("caught");
      } catch (error) {
        reject(error);
      }
    };
    const onDestroy = (packet) => {
      if (bobberId !== null && packet.entityIds?.includes(bobberId)) {
        finish("removed");
      }
    };
    const onEnd = () => finish("disconnected");
    const onHeldItemChanged = (item) => {
      if (item?.name !== "fishing_rod") finish("rod-changed");
    };
    const onAbort = () => {
      if (!finish("stopped")) return;
      if (bobberId === null || bot.heldItem?.name !== "fishing_rod") {
        report(
          "AutoFish status: Check the line and reel in manually if needed",
        );
      } else {
        try {
          bot.activateItem();
        } catch (error) {
          report(
            `AutoFish status: Could not reel in: ${error.message || error}`,
          );
        }
      }
    };
    if (signal?.aborted) {
      finish("stopped");
      return;
    }
    client.on("spawn_entity", onSpawn);
    client.on("world_particles", onParticles);
    client.on("entity_destroy", onDestroy);
    client.on("end", onEnd);
    bot.on("heldItemChanged", onHeldItemChanged);
    signal?.addEventListener("abort", onAbort, { once: true });
    spawnTimer = setTimeout(() => finish("unconfirmed"), 15000);
    try {
      bot.activateItem();
    } catch (error) {
      finish(null, error);
    }
  });
}

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
  let halted = false;
  let catchCount = 0;
  let lastCastTime = 0;
  const signal = scriptRepeater.signal;
  const stopped = () => Boolean(signal?.aborted);
  clearLog("AutoFish:");
  log("AutoFish: Active (casting & reeling automatically)");

  async function fishTick() {
    if (
      !bot ||
      !bot.entity ||
      !bot.inventory ||
      busy ||
      halted ||
      isBotEating(bot)
    ) {
      return;
    }
    busy = true;
    let casting = false;

    try {
      const [autoRodOpt, antiAfkOpt] = await Promise.all([
        getOption("autorod", info.name),
        getOption("antiafk", info.name),
      ]);
      if (stopped()) return;

      const useAutoRod = autoRodOpt !== "off";
      const useAntiAfk = antiAfkOpt !== "off";

      let rod = bot.heldItem?.name === "fishing_rod" ? bot.heldItem : null;
      if (!rod && useAutoRod) {
        rod = bot.inventory.items().find((i) => i.name === "fishing_rod");
        if (rod) {
          await bot.equip(rod, "hand");
          if (stopped()) return;
        }
      }

      if (bot.heldItem?.name !== "fishing_rod") {
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
          if (stopped()) return;
        }
      }

      if (useAntiAfk && Date.now() - lastCastTime > 6000) {
        const yawJitter = bot.entity.yaw + (Math.random() - 0.5) * 0.04;
        const pitchJitter = bot.entity.pitch + (Math.random() - 0.5) * 0.03;
        await bot.look(yawJitter, pitchJitter, false).catch(() => {});
        if (stopped()) return;
      }

      lastCastTime = Date.now();
      clearLog("AutoFish status:");
      log(`AutoFish status: Line cast (Catches: ${catchCount})`);
      casting = true;
      const result = await castAndWait(
        bot,
        signal,
        scriptRepeater.report || log,
      );
      if (stopped()) return;
      if (result === "caught") {
        catchCount++;
        clearLog("AutoFish status:");
        log(`AutoFish status: Reeled in catch #${catchCount}!`);
      } else if (result === "rod-changed" || result === "unconfirmed") {
        halted = true;
        clearLog("AutoFish status:");
        log(
          result === "rod-changed"
            ? "AutoFish status: Held item changed; check the line and reel in manually"
            : "AutoFish status: Bobber was not confirmed; check the line and reel in manually",
        );
        scriptRepeater.stop?.();
      } else if (result === "disconnected") {
        halted = true;
        scriptRepeater.stop?.();
      }
    } catch (err) {
      if (!stopped()) {
        clearLog("AutoFish status:");
        log(
          `AutoFish status: Fishing failed: ${err.message || err}${casting ? "; check the line before restarting" : ""}`,
        );
        if (casting) {
          halted = true;
          scriptRepeater.stop?.();
        }
      }
    } finally {
      busy = false;
    }
  }

  await fishTick();
  if (!stopped() && !halted)
    await scriptRepeater(fishTick, info.default.interval);
}

module.exports = {
  info,
  script,
};
