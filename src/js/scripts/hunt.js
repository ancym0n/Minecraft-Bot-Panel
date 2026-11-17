const { loadLibraries } = require("../runtime");
const {
  isBotEating,
  equipBestWeapon,
  tryCombatEat,
  performPvpAttack,
  setDynamicFollowGoal,
  clearPathfinderGoal,
} = require("../botUtils");

const info = {
  name: "Hunt",
  default: { interval: 320 },
  options: [
    {
      type: "checkbox",
      label: "Auto Weapon",
      id: "autoweapon",
    },
    {
      type: "checkbox",
      label: "Sprint Jump",
      id: "sprintjump",
    },
    {
      type: "checkbox",
      label: "Criticals",
      id: "crits",
    },
    {
      type: "input",
      label: "Target Player",
      id: "playername",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity || !bot.pathfinder) {
    clearLog("Hunt:");
    log("Hunt: Connect a bot first");
    return;
  }

  const { goals } = loadLibraries();
  let busy = false;

  function resolveTargetPlayer(targetName) {
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

  clearLog("Hunt:");
  log("Hunt: Active (pursuing target player)");

  async function huntTick() {
    if (!bot || !bot.entity || !bot.pathfinder || busy) return;
    busy = true;

    try {
      // Pause attacking if another script (or Hunt itself) is currently eating
      if (isBotEating(bot)) return;

      const ate = await tryCombatEat(bot, {
        minHp: 13,
        minFood: 16,
        onLog: (foodItem, hp, food) => {
          clearLog("Hunt status:");
          log(
            `Hunt status: Pausing fight to eat ${foodItem.name} (HP ${hp.toFixed(0)}, Food ${food})`,
          );
        },
      });
      if (ate) return;

      const [autoWeaponOpt, sprintJumpOpt, critsOpt, rawPlayerName] =
        await Promise.all([
          getOption("autoweapon", info.name),
          getOption("sprintjump", info.name),
          getOption("crits", info.name),
          getOption("playername", info.name),
        ]);

      const useAutoWeapon = autoWeaponOpt !== "off";
      const useSprintJump = sprintJumpOpt !== "off";
      const useCrits = critsOpt !== "off";
      const targetName = String(rawPlayerName || "").trim();

      bot._mcbpSprintJump = useSprintJump;

      const target = resolveTargetPlayer(targetName);
      if (!target || !target.position) {
        clearLog("Hunt status:");
        log(
          targetName
            ? `Hunt status: Waiting for "${targetName}" in visible range`
            : "Hunt status: No players in range",
        );
        return;
      }

      if (useAutoWeapon && !isBotEating(bot)) {
        await equipBestWeapon(bot, { saveLowDurability: true });
      }

      const dist = bot.entity.position.distanceTo(target.position);
      const label = target.username || targetName || "player";
      clearLog("Hunt status:");
      log(`Hunt status: Hunting ${label} (${dist.toFixed(1)}m)`);

      if (dist > 2.2) {
        setDynamicFollowGoal(bot, goals, target, 1.8);
      } else {
        clearPathfinderGoal(bot);
      }

      if (dist <= 4.3 && !isBotEating(bot)) {
        await performPvpAttack(bot, target, {
          useCrits,
          maxRange: 4.3,
        });
      }
    } finally {
      busy = false;
    }
  }

  try {
    await huntTick();
    await scriptRepeater(huntTick, info.default.interval);
  } finally {
    if (bot) {
      bot._mcbpSprintJump = false;
      clearPathfinderGoal(bot);
    }
  }
}

module.exports = {
  info,
  script,
};
