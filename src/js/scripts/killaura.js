const {
  isBotEating,
  isHostile,
  equipBestWeapon,
  tryCombatEat,
  performPvpAttack,
} = require("../botUtils");

const info = {
  name: "KillAura",
  default: { interval: 420 },
  options: [
    {
      type: "checkbox",
      label: "Hostile Mobs",
      id: "hostiles",
    },
    {
      type: "checkbox",
      label: "Players",
      id: "players",
    },
    {
      type: "checkbox",
      label: "Passive Mobs",
      id: "passives",
    },
    {
      type: "checkbox",
      label: "Auto Weapon",
      id: "autoweapon",
    },
    {
      type: "checkbox",
      label: "Criticals",
      id: "crits",
    },
    {
      type: "input",
      label: "Range [blocks]",
      id: "range",
    },
  ],
};

async function script(bot, log, clearLog, getOption, scriptRepeater) {
  if (!bot || !bot.entity) {
    clearLog("KillAura:");
    log("KillAura: Connect a bot first");
    return;
  }

  let busy = false;

  async function auraTick() {
    if (!bot || !bot.entity || !bot.entities || busy) return;
    busy = true;

    try {
      if (isBotEating(bot)) return;

      const ate = await tryCombatEat(bot, {
        minHp: 12,
        minFood: 15,
        onLog: (foodItem, hp, food) => {
          clearLog("KillAura hit:");
          log(
            `KillAura: Pausing to eat ${foodItem.name} (HP ${hp.toFixed(0)}, Food ${food})`,
          );
        },
      });
      if (ate) return;

      const [
        hostilesOpt,
        playersOpt,
        passivesOpt,
        weaponOpt,
        critsOpt,
        rawRange,
      ] = await Promise.all([
        getOption("hostiles", info.name),
        getOption("players", info.name),
        getOption("passives", info.name),
        getOption("autoweapon", info.name),
        getOption("crits", info.name),
        getOption("range", info.name),
      ]);

      const hitHostiles =
        hostilesOpt === "on" ||
        (hostilesOpt === "off" &&
          playersOpt === "off" &&
          passivesOpt === "off");
      const hitPlayers = playersOpt === "on";
      const hitPassives = passivesOpt === "on";
      const autoWeapon = weaponOpt !== "off";
      const useCrits = critsOpt !== "off";
      const parsedRange = parseFloat(rawRange);
      const range =
        Number.isFinite(parsedRange) && parsedRange >= 1 && parsedRange <= 6
          ? parsedRange
          : 4.2;

      let nearest = null;
      let bestDist = Infinity;

      for (const entity of Object.values(bot.entities)) {
        if (!entity || entity === bot.entity || !entity.position) continue;
        if (entity.type === "object" || entity.type === "orb") continue;

        const dist = bot.entity.position.distanceTo(entity.position);
        if (dist > range) continue;

        const kind = String(entity.kind || "").toLowerCase();
        const isPlayer = entity.type === "player";
        const hostile = isHostile(entity);
        const isPassive =
          !isPlayer &&
          !hostile &&
          (entity.type === "mob" ||
            entity.type === "animal" ||
            kind.includes("passive"));

        if (
          (hostile && hitHostiles) ||
          (isPlayer && hitPlayers) ||
          (isPassive && hitPassives)
        ) {
          if (dist < bestDist) {
            bestDist = dist;
            nearest = entity;
          }
        }
      }

      if (!nearest || isBotEating(bot)) return;

      if (autoWeapon) {
        await equipBestWeapon(bot, { saveLowDurability: true });
      }

      const attacked = await performPvpAttack(bot, nearest, {
        useCrits,
        maxRange: range,
      });
      if (attacked) {
        clearLog("KillAura hit:");
        log(
          `KillAura hit: ${nearest.username || nearest.displayName || nearest.name} (${bestDist.toFixed(1)}m)`,
        );
      }
    } catch (_) {
    } finally {
      busy = false;
    }
  }

  await auraTick();
  await scriptRepeater(auraTick, info.default.interval);
}

module.exports = {
  info,
  script,
};
