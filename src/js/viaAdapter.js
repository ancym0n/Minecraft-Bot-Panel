// ViaVersion-style protocol compatibility layer & Anti-Cheat FakePlayer / NPC detector for Mineflayer.
// Bridges protocol differences across MC 1.8 -> 1.21.x -> 26.1+ and shields against PartialReadError kicks.

const { loadLibraries } = require("./runtime");

// Known protocol numbers for modern versions & snapshots so we can bridge newer servers
// onto the closest supported minecraft-data schema.
const PROTOCOL_FALLBACK_MAP = [
  { minProto: 770, targetVersion: "26.1" },
  { minProto: 769, targetVersion: "1.21.4" },
  { minProto: 768, targetVersion: "1.21.3" },
  { minProto: 767, targetVersion: "1.21.1" },
  { minProto: 766, targetVersion: "1.20.6" },
  { minProto: 765, targetVersion: "1.20.4" },
  { minProto: 763, targetVersion: "1.20.1" },
  { minProto: 760, targetVersion: "1.19.2" },
  { minProto: 759, targetVersion: "1.19" },
  { minProto: 758, targetVersion: "1.18.2" },
  { minProto: 757, targetVersion: "1.18" },
  { minProto: 756, targetVersion: "1.17.1" },
  { minProto: 754, targetVersion: "1.16.5" },
  { minProto: 578, targetVersion: "1.15.2" },
  { minProto: 498, targetVersion: "1.14.4" },
  { minProto: 404, targetVersion: "1.13.2" },
  { minProto: 340, targetVersion: "1.12.2" },
  { minProto: 47, targetVersion: "1.8.9" },
];

function resolveSupportedVersion(rawVersion, mcDataModule = null) {
  let mcData = mcDataModule;
  if (!mcData) {
    try {
      mcData = loadLibraries().mcData;
    } catch (_) {}
  }
  const clean = String(rawVersion || "").trim();
  if (!clean || /^auto$/i.test(clean)) return false;
  if (mcData) {
    try {
      if (mcData(clean)) return clean;
    } catch (_) {}
  }
  // Extract semantic version from server brand strings like "Paper 1.21.7", "Velocity 1.7.2-1.21.6", "26.2"
  const verMatch = clean.match(/(\d+\.\d+(?:\.\d+)?)/g);
  if (verMatch && verMatch.length > 0) {
    const candidate = verMatch[verMatch.length - 1];
    if (mcData) {
      try {
        if (mcData(candidate)) return candidate;
      } catch (_) {}
      // Try major.minor fallback (e.g. 1.21.8 -> 1.21.4 or 26.2 -> 26.1)
      const parts = candidate.split(".");
      if (parts[0] === "26") return "26.1";
      if (parts[0] === "1" && Number(parts[1]) >= 21) return "26.1";
      const majorMinor = `${parts[0]}.${parts[1]}`;
      try {
        if (mcData(majorMinor)) return majorMinor;
      } catch (_) {}
    }
  }
  return "26.1";
}

function resolveVersionFromKickOrError(errText, mcDataModule = null) {
  const text = String(errText || "");
  if (!text) return null;

  // Match protocol number if server says "Outdated client! Please use 1.21.x" or "Unsupported protocol version 771"
  const protoMatch = text.match(/protocol(?:\s+version)?\s*[:=]?\s*(\d{2,4})/i);
  if (protoMatch) {
    const proto = parseInt(protoMatch[1], 10);
    for (const row of PROTOCOL_FALLBACK_MAP) {
      if (proto >= row.minProto) {
        return resolveSupportedVersion(row.targetVersion, mcDataModule);
      }
    }
  }

  const verMatches = text.match(/\b(26\.\d+|\d+\.\d+(?:\.\d+)?)\b/g);
  if (verMatches && verMatches.length > 0) {
    const preferred = verMatches[verMatches.length - 1];
    return resolveSupportedVersion(preferred, mcDataModule);
  }
  return null;
}

// Attaches ViaVersion-style packet translation and error resilience to a Mineflayer bot.
function attachViaVersionAdapter(bot, { log = null } = {}) {
  if (!bot || bot._mcbpViaAttached) return;
  bot._mcbpViaAttached = true;

  const patchSupportFeatures = () => {
    if (
      typeof bot.supportFeature === "function" &&
      !bot._mcbpSupportFeaturePatched
    ) {
      bot._mcbpSupportFeaturePatched = true;
      const origSupportFeature = bot.supportFeature.bind(bot);
      bot.supportFeature = (feature) => {
        if (feature === "entityActionUsesStringMapper") {
          return !origSupportFeature("sneakUsesEntityAction");
        }
        return origSupportFeature(feature);
      };
    }
  };
  patchSupportFeatures();

  const wireClient = (client) => {
    if (!client || client._mcbpViaClientWired) return;
    client._mcbpViaClientWired = true;

    // 1. Shield against PartialReadError / unknown packet crashes on newer/custom servers
    client.on("error", (err) => {
      const msg = String(err?.message || err || "");
      if (
        /PartialReadError|Read error for|Unexpected buffer end|unknown packet/i.test(
          msg,
        )
      ) {
        if (log && Date.now() - (bot._mcbpLastViaWarnAt || 0) > 15000) {
          bot._mcbpLastViaWarnAt = Date.now();
          log(`ViaVersion: Ignored non-fatal protocol packet mismatch`);
        }
      }
    });

    // 2. Auto-acknowledge 1.20.5+ / 1.21.4+ / 26.1 configuration & chunk batch packets
    client.on("packet", (data, meta) => {
      if (!meta || !meta.name) return;
      try {
        if (meta.name === "chunk_batch_finished" && data?.batchSize >= 0) {
          client.write("chunk_batch_received", { chunksPerTick: 25.0 });
        } else if (
          meta.name === "SelectKnownPacks" ||
          meta.name === "select_known_packs"
        ) {
          client.write("select_known_packs", {
            packs: Array.isArray(data?.packs) ? data.packs : [],
          });
        }
      } catch (_) {}
    });
  };

  if (bot._client) wireClient(bot._client);
  bot.on("login", () => {
    patchSupportFeatures();
    if (bot._client) wireClient(bot._client);
  });

  // Track entity spawn timestamps & movement for Anti-Cheat FakePlayer detection
  bot.on("entitySpawn", (entity) => {
    if (!entity) return;
    entity._mcbpSpawnedAt = Date.now();
    if (entity.position) {
      entity._mcbpSpawnPos = entity.position.clone();
    }
    if (entity.type === "player" && bot.entity?.position && entity.position) {
      const d = entity.position.distanceTo(bot.entity.position);
      const dy = entity.position.y - bot.entity.position.y;
      // Watchdog / Matrix killaura check bots often spawn mid-air right above/behind the player
      if (d <= 5.5 && dy >= 1.35) {
        const below = bot.blockAt?.(entity.position.offset(0, -1, 0).floored());
        if (!below || below.name === "air" || below.name === "cave_air") {
          entity._mcbpSpawnedMidAirNearBot = true;
        }
      }
    }
  });

  bot.on("entityMoved", (entity) => {
    if (!entity || entity.type !== "player" || entity === bot.entity) return;
    if (!bot.entity?.position || !entity.position) return;
    const now = Date.now();
    if (!entity._mcbpSpawnedAt) entity._mcbpSpawnedAt = now;
    const ageMs = now - entity._mcbpSpawnedAt;
    // Check for rapid 360-degree orbiting around the bot within the first 2.5s (classic Anti-Cheat killaura bot)
    if (ageMs <= 2500) {
      const dx = entity.position.x - bot.entity.position.x;
      const dz = entity.position.z - bot.entity.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > 0.2 && distSq <= 25) {
        const angle = Math.atan2(dz, dx);
        if (typeof entity._mcbpLastAngle === "number") {
          let delta = Math.abs(angle - entity._mcbpLastAngle);
          if (delta > Math.PI) delta = 2 * Math.PI - delta;
          entity._mcbpOrbitRadians = (entity._mcbpOrbitRadians || 0) + delta;
          if (entity._mcbpOrbitRadians > Math.PI * 1.35) {
            entity._mcbpIsAntiCheatBot = true;
          }
        }
        entity._mcbpLastAngle = angle;
      }
    }
  });
}

// Determines whether an entity is a Server Lobby NPC, Hologram, or Anti-Cheat FakePlayer (Watchdog / Matrix / Citizens).
function isLikelyNpcOrFakePlayer(
  bot,
  entity,
  { allowExplicitNpc = false } = {},
) {
  if (!bot || !entity) return true;
  if (entity === bot.entity) return true;

  const botName = String(bot.username || "").toLowerCase();
  const rawName = String(entity.username || entity.name || "").trim();
  const cleanName = rawName.replace(/§[0-9a-fk-or]/gi, "").trim();
  const lowerName = cleanName.toLowerCase();

  // Never confuse the bot's own username with another player
  if (botName && lowerName === botName) return true;

  // Non-player entities with NPC types
  if (entity.type !== "player") {
    const eName = String(entity.name || "").toLowerCase();
    if (
      /armor_stand|text_display|interaction|villager|wandering_trader|npc|mannequin/i.test(
        eName,
      )
    ) {
      return !allowExplicitNpc;
    }
    return false;
  }

  // Flagged by rapid-orbit Anti-Cheat detector
  if (entity._mcbpIsAntiCheatBot) return true;

  // 1. Invalid Minecraft username characters (color codes, spaces, brackets, CIT-, NPC-)
  if (
    !cleanName ||
    /§|\s|\[|\]|\bnpc\b|^cit-/i.test(rawName) ||
    !/^[A-Za-z0-9_.\-]{2,24}$/.test(cleanName)
  ) {
    return !allowExplicitNpc;
  }

  // 2. UUID version 2 check (Citizens / Server NPCs use UUID v2: xxxxxxxx-xxxx-2xxx-...)
  const uuid = String(entity.uuid || "").toLowerCase();
  if (uuid.length >= 15 && uuid[14] === "2") {
    return !allowExplicitNpc;
  }

  // 3. Tab-list presence check: Real players are in bot.players with a matching username/UUID
  const playersMap = bot.players || {};
  const tabKeys = Object.keys(playersMap);
  if (tabKeys.length > 0) {
    const tabEntry =
      playersMap[cleanName] ||
      Object.values(playersMap).find(
        (p) =>
          p?.username &&
          p.username.toLowerCase() === lowerName &&
          (!uuid || !p.uuid || p.uuid.toLowerCase() === uuid),
      );
    if (!tabEntry) {
      // Not in tab list -> FakePlayer or NPC!
      return !allowExplicitNpc;
    }
    // Check if invisible + freshly spawned mid-air right near the bot (Watchdog / Matrix check)
    const meta0 = Array.isArray(entity.metadata) ? entity.metadata[0] : 0;
    const isInvisible = typeof meta0 === "number" && (meta0 & 0x20) !== 0;
    const ageMs = entity._mcbpSpawnedAt
      ? Date.now() - entity._mcbpSpawnedAt
      : 99999;
    if (
      (entity._mcbpSpawnedMidAirNearBot && ageMs < 1800) ||
      (isInvisible && ageMs < 1500 && (tabEntry.ping === 0 || tabEntry.ping < 0))
    ) {
      return true;
    }
  }

  // 4. Hologram / ArmorStand stacked directly above the player entity at the exact same (X, Z)
  if (entity.position && bot.entities) {
    for (const other of Object.values(bot.entities)) {
      if (!other || other === entity || !other.position) continue;
      const oName = String(other.name || "").toLowerCase();
      if (oName !== "armor_stand" && oName !== "text_display") continue;
      const dx = Math.abs(other.position.x - entity.position.x);
      const dz = Math.abs(other.position.z - entity.position.z);
      const dy = other.position.y - entity.position.y;
      if (dx <= 0.65 && dz <= 0.65 && dy >= -0.2 && dy <= 3.2) {
        return !allowExplicitNpc;
      }
    }
  }

  return false;
}

// Returns true only if `username` belongs to a verified real player (not self, not NPC, not Anti-Cheat bot).
function isRealPlayerName(bot, username) {
  if (!bot || !username) return false;
  const clean = String(username || "")
    .replace(/§[0-9a-fk-or]/gi, "")
    .trim();
  if (!clean || !/^[A-Za-z0-9_.\-]{2,24}$/.test(clean)) return false;
  if (bot.username && clean.toLowerCase() === bot.username.toLowerCase()) {
    return false;
  }
  const playersMap = bot.players || {};
  const entry =
    playersMap[clean] ||
    Object.values(playersMap).find(
      (p) => p?.username && p.username.toLowerCase() === clean.toLowerCase(),
    );
  if (!entry) return false;
  if (entry.uuid && String(entry.uuid)[14] === "2") return false;
  if (entry.entity && isLikelyNpcOrFakePlayer(bot, entry.entity)) return false;
  return true;
}

module.exports = {
  PROTOCOL_FALLBACK_MAP,
  resolveSupportedVersion,
  resolveVersionFromKickOrError,
  attachViaVersionAdapter,
  isLikelyNpcOrFakePlayer,
  isRealPlayerName,
};
