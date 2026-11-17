const { loadLibraries } = require("../runtime");
const {
  isBotEating,
  isHostile,
  equipBestWeapon,
  tryCombatEat,
  performPvpAttack,
  setDynamicFollowGoal,
  clearPathfinderGoal,
} = require("../botUtils");

const info = {
  name: "Guard",
  default: { interval: 360 },
  options: [
    {
      type: "checkbox",
      label: "Hostile Mobs",
      id: "hostiles",
    },
    {
      type: "checkbox",
      label: "Defend PvP",
      id: "pvp",
    },
    {
      type: "checkbox",
      label: "Auto Weapon",
      id: "autoweapon",
    },
    {
      type: "input",
      label: "Protect Player",
      id: "playername",
    },
    {
      type: "input",
      label: "Radius [blocks]",
      id: "radius",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.pathfinder) {
    clearLog("Guard:");
    log("Guard: Connect a bot first");
    return;
  }

  const { goals } = loadLibraries();
  const anchorPos = bot.entity.position.clone();
  const hostilePlayers = new Map();
  let currentTargetName = "";
  let busy = false;

  function resolveGuardedPlayer(targetName) {
    if (!bot || !bot.players) return null;
    if (targetName) {
      const exact = bot.players[targetName]?.entity;
      if (exact) return exact;
      const lower = targetName.toLowerCase();
      const match = Object.values(bot.players).find(
        (p) => p && p.username && p.username.toLowerCase() === lower,
      );
      return match?.entity || null;
    }

    let nearest = null;
    let bestDist = Infinity;
    for (const p of Object.values(bot.players)) {
      if (!p || !p.entity || p.username === bot.username) continue;
      const d = p.entity.position.distanceTo(bot.entity.position);
      if (d < bestDist) {
        bestDist = d;
        nearest = p.entity;
      }
    }
    return nearest;
  }

  function onEntityHurt(entity) {
    if (!bot || !bot.entity || !entity) return;
    const guarded = resolveGuardedPlayer(currentTargetName);
    const isGuardedVictim =
      entity === bot.entity || (guarded && entity.id === guarded.id);
    if (!isGuardedVictim) return;

    const attacker = Object.values(bot.entities).find((e) => {
      if (!e || e === bot.entity || e.type !== "player") return false;
      if (guarded && e.username === guarded.username) return false;
      return e.position && e.position.distanceTo(entity.position) <= 6;
    });
    if (attacker && attacker.username) {
      hostilePlayers.set(attacker.username, Date.now() + 25000);
    }
  }

  bot.on("entityHurt", onEntityHurt);
  bot._mcbpSprintJump = true;

  clearLog("Guard:");
  log("Guard: Active (bodyguard & perimeter defense)");

  async function guardTick() {
    if (!bot || !bot.entity || !bot.pathfinder || busy) return;
    busy = true;

    try {
      if (isBotEating(bot)) return;

      const ate = await tryCombatEat(bot, {
        minHp: 13,
        minFood: 16,
        onLog: (foodItem, hp, food) => {
          clearLog("Guard status:");
          log(
            `Guard status: Pausing fight to eat ${foodItem.name} (HP ${hp.toFixed(0)}, Food ${food})`,
          );
        },
      });
      if (ate) return;

      const [hostilesOpt, pvpOpt, autoWeaponOpt, rawPlayerName, rawRadius] =
        await Promise.all([
          getOption("hostiles", info.name),
          getOption("pvp", info.name),
          getOption("autoweapon", info.name),
          getOption("playername", info.name),
          getOption("radius", info.name),
        ]);

      const attackHostiles = hostilesOpt !== "off" || pvpOpt === "off";
      const defendPvp = pvpOpt === "on";
      const useAutoWeapon = autoWeaponOpt !== "off";
      currentTargetName = String(rawPlayerName || "").trim();
      const parsedRadius = parseFloat(rawRadius);
      const guardRadius =
        Number.isFinite(parsedRadius) && parsedRadius >= 3 && parsedRadius <= 64
          ? parsedRadius
          : 12;

      const guarded = resolveGuardedPlayer(currentTargetName);
      const centerPos = guarded ? guarded.position : anchorPos;

      const now = Date.now();
      let threat = null;
      let bestScore = Infinity;

      for (const entity of Object.values(bot.entities || {})) {
        if (!entity || entity === bot.entity || !entity.position) continue;
        if (guarded && entity.id === guarded.id) continue;

        const distToCenter = entity.position.distanceTo(centerPos);
        const distToBot = entity.position.distanceTo(bot.entity.position);
        if (distToCenter > guardRadius && distToBot > guardRadius) continue;

        let isThreat = false;
        let priorityBonus = 0;

        if (attackHostiles && isHostile(entity)) {
          isThreat = true;
        } else if (defendPvp && entity.type === "player" && entity.username) {
          const expire = hostilePlayers.get(entity.username) || 0;
          if (expire > now || distToCenter <= 4.5) {
            isThreat = true;
            priorityBonus = -2;
          }
        }

        if (isThreat) {
          const score = Math.min(distToCenter, distToBot) + priorityBonus;
          if (score < bestScore) {
            bestScore = score;
            threat = entity;
          }
        }
      }

      if (threat) {
        if (useAutoWeapon && !isBotEating(bot)) {
          await equipBestWeapon(bot, { saveLowDurability: true });
        }

        const dist = bot.entity.position.distanceTo(threat.position);
        const threatLabel =
          threat.username || threat.displayName || threat.name || "Target";
        clearLog("Guard status:");
        log(`Guard status: Engaging ${threatLabel} (${dist.toFixed(1)}m)`);

        if (dist > 2.8) {
          setDynamicFollowGoal(bot, goals, threat, 2.1);
        } else {
          clearPathfinderGoal(bot);
        }

        if (dist <= 4.3 && !isBotEating(bot)) {
          await performPvpAttack(bot, threat, {
            useCrits: true,
            maxRange: 4.3,
          });
        }
        return;
      }

      if (guarded) {
        const dist = bot.entity.position.distanceTo(guarded.position);
        clearLog("Guard status:");
        log(
          `Guard status: Escorting ${guarded.username || currentTargetName || "player"} (${dist.toFixed(1)}m)`,
        );
        if (dist > 3.2) {
          setDynamicFollowGoal(bot, goals, guarded, 2.5);
        } else {
          clearPathfinderGoal(bot);
        }
      } else if (currentTargetName) {
        clearLog("Guard status:");
        log(`Guard status: Waiting for "${currentTargetName}" in range`);
      } else {
        const dist = bot.entity.position.distanceTo(anchorPos);
        if (dist > 2.5) {
          bot.pathfinder.setGoal(
            new goals.GoalNear(anchorPos.x, anchorPos.y, anchorPos.z, 1.5),
          );
        }
      }
    } finally {
      busy = false;
    }
  }

  try {
    await guardTick();
    await scriptRepeater(guardTick, info.default.interval);
  } finally {
    if (bot) {
      bot._mcbpSprintJump = false;
      bot.removeListener("entityHurt", onEntityHurt);
      clearPathfinderGoal(bot);
    }
  }
}

module.exports = {
  info,
  script,
};
