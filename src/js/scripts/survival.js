const { loadLibraries } = require("../runtime");
const {
  isBotEating,
  isHostile,
  equipBestWeapon,
  equipBestArmor,
  tryCombatEat,
  performPvpAttack,
  humanLookAt,
  setDynamicFollowGoal,
  clearPathfinderGoal,
} = require("../botUtils");

const info = {
  name: "Survival",
  default: { interval: 380 },
  options: [
    {
      type: "checkbox",
      label: "Self Defense",
      id: "defend",
    },
    {
      type: "checkbox",
      label: "Auto Gear & Eat",
      id: "survival",
    },
    {
      type: "checkbox",
      label: "Collect Drops",
      id: "collect",
    },
    {
      type: "checkbox",
      label: "Look Around",
      id: "look",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.pathfinder) {
    clearLog("Survival:");
    log("Survival: Connect a bot first");
    return;
  }

  const { goals } = loadLibraries();
  const signal = scriptRepeater.signal;
  let busy = false;
  let lastArmorCheck = 0;
  let lastLookTime = 0;
  let attackerEntityId = null;
  let attackerExpire = 0;
  let warnedMissingAttacker = false;
  let shieldTimer = null;
  let shieldActive = false;

  function onEntityHurt(entity, source) {
    if (signal?.aborted || !bot.entity || entity !== bot.entity) return;
    if (!source) {
      if (!warnedMissingAttacker) {
        warnedMissingAttacker = true;
        log("Survival: Cannot identify the attacker for this hit");
      }
      return;
    }
    if (
      source !== bot.entity &&
      source.id != null &&
      (source.type === "player" || source.type === "mob")
    ) {
      attackerEntityId = source.id;
      attackerExpire = Date.now() + 12000;
    }
  }

  function releaseShield() {
    clearTimeout(shieldTimer);
    shieldTimer = null;
    if (shieldActive) {
      shieldActive = false;
      bot.deactivateItem();
    }
  }

  bot.on("entityHurt", onEntityHurt);
  signal?.addEventListener("abort", releaseShield, { once: true });
  bot._mcbpSprintJump = true;

  clearLog("Survival:");
  log("Survival: Active (autonomous survival, defense & movement)");

  async function survivalTick() {
    if (signal?.aborted || !bot || !bot.entity || busy) return;
    busy = true;

    try {
      if (isBotEating(bot)) return;

      const [defendOpt, survivalOpt, collectOpt, lookOpt] = await Promise.all([
        getOption("defend", info.name),
        getOption("survival", info.name),
        getOption("collect", info.name),
        getOption("look", info.name),
      ]);
      if (signal?.aborted) return;

      const allOff =
        defendOpt === "off" &&
        survivalOpt === "off" &&
        collectOpt === "off" &&
        lookOpt === "off";
      const useDefend = defendOpt === "on" || allOff;
      const useSurvival = survivalOpt === "on" || allOff;
      const useCollect = collectOpt === "on" || allOff;
      const useLook = lookOpt === "on" || allOff;

      const now = Date.now();

      // 1. Auto Gear & Eat: equip best armor/totem/shield & eat when hungry or low HP
      if (useSurvival) {
        if (now - lastArmorCheck > 2800 && !isBotEating(bot)) {
          lastArmorCheck = now;
          await equipBestArmor(bot, { includeOffhand: true, signal });
          if (signal?.aborted) return;
        }

        const ate = await tryCombatEat(bot, {
          minHp: 13,
          minFood: 16,
          signal,
          onLog: (bestFood, hp, food) => {
            clearLog("Survival status:");
            log(
              `Survival status: Eating ${bestFood.name} (HP ${hp.toFixed(0)}, Food ${food})`,
            );
          },
        });
        if (ate || signal?.aborted) return;
      }

      // 2. Self Defense: fight back against attackers or nearby hostile mobs
      if (useDefend && bot.entities) {
        let threat = null;
        if (attackerEntityId && now < attackerExpire) {
          const candidate = bot.entities[attackerEntityId];
          if (
            candidate &&
            candidate.position &&
            candidate.position.distanceTo(bot.entity.position) <= 10
          ) {
            threat = candidate;
          }
        }

        if (!threat) {
          let bestDist = 5.5;
          for (const e of Object.values(bot.entities)) {
            if (!e || e === bot.entity || !e.position) continue;
            if (!isHostile(e)) continue;
            const d = e.position.distanceTo(bot.entity.position);
            if (d < bestDist) {
              bestDist = d;
              threat = e;
            }
          }
        }

        if (threat && threat.position) {
          const dist = threat.position.distanceTo(bot.entity.position);

          // Raise shield if a creeper is very close
          const offhand = bot.inventory?.slots?.[45];
          if (
            String(threat.name || "").toLowerCase() === "creeper" &&
            dist <= 3.8 &&
            offhand &&
            offhand.name === "shield"
          ) {
            await humanLookAt(
              bot,
              threat.position.offset(0, (threat.height || 1.5) * 0.8, 0),
              true,
            );
            if (signal?.aborted) return;
            bot.activateItem(true);
            shieldActive = true;
            shieldTimer = setTimeout(releaseShield, 350);
            return;
          }

          if (!isBotEating(bot)) {
            await equipBestWeapon(bot, { saveLowDurability: true });
            if (signal?.aborted) return;
          }
          const label =
            threat.username || threat.displayName || threat.name || "threat";
          clearLog("Survival status:");
          log(
            `Survival status: Defending against ${label} (${dist.toFixed(1)}m)`,
          );

          if (dist > 2.8 && bot.pathfinder) {
            setDynamicFollowGoal(bot, goals, threat, 2.1);
          }

          if (dist <= 4.2 && !isBotEating(bot)) {
            await performPvpAttack(bot, threat, {
              useCrits: true,
              maxRange: 4.2,
              signal,
            });
          }
          return;
        }
      }

      // 3. Collect nearby dropped items within 7.5 blocks when safe
      if (useCollect && bot.entities && bot.pathfinder) {
        let nearestDrop = null;
        let bestDropDist = 7.5;
        for (const e of Object.values(bot.entities)) {
          if (!e || !e.position) continue;
          const isDrop =
            e.name === "item" ||
            e.displayName === "Item" ||
            e.objectType === "Item";
          if (!isDrop) continue;
          const d = e.position.distanceTo(bot.entity.position);
          if (d < bestDropDist && d > 1.1) {
            bestDropDist = d;
            nearestDrop = e;
          }
        }
        if (nearestDrop) {
          setDynamicFollowGoal(bot, goals, nearestDrop, 1);
          return;
        }
      }

      // 4. Natural head glances toward nearby players or mobs when idle
      if (useLook && now - lastLookTime > 2600 && !bot.pathfinder?.isMoving()) {
        lastLookTime = now;
        let lookTarget = null;
        let bestDist = 10;
        for (const e of Object.values(bot.entities || {})) {
          if (!e || e === bot.entity || !e.position) continue;
          if (e.type !== "player" && e.type !== "mob") continue;
          const d = e.position.distanceTo(bot.entity.position);
          if (d < bestDist) {
            bestDist = d;
            lookTarget = e;
          }
        }
        if (lookTarget) {
          await humanLookAt(
            bot,
            lookTarget.position.offset(0, (lookTarget.height || 1.6) * 0.85, 0),
            false,
          );
        }
      }
    } catch (err) {
      if (!signal?.aborted) log(`Survival: ${err.message || err}`);
    } finally {
      busy = false;
    }
  }

  try {
    await survivalTick();
    await scriptRepeater(survivalTick, info.default.interval);
  } finally {
    if (bot) {
      bot.removeListener("entityHurt", onEntityHurt);
      signal?.removeEventListener("abort", releaseShield);
      releaseShield();
      if (!scriptRepeater.isCurrent || scriptRepeater.isCurrent()) {
        bot._mcbpSprintJump = false;
        clearPathfinderGoal(bot);
      }
    }
  }
}

module.exports = {
  info,
  script,
};
