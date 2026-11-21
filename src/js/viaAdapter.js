// ViaVersion-style protocol compatibility layer & Anti-Cheat FakePlayer / NPC detector for Mineflayer.
// Bridges protocol differences across MC 1.8 -> 1.21.x -> 26.1 -> 26.2 (776) -> 26.3 (777),
// emits client tick_end packets on 1.21.2+/26.x to prevent 26.3 invalid_player_movement kicks,
// and shields against PartialReadError kicks.

const NATIVE_MAX_PROTOCOL = 775; // MC 26.1 / 26.1.1 / 26.1.2
const NATIVE_MAX_VERSION = "26.1";

// Virtual protocol definitions registered into minecraft-data / minecraft-protocol / mineflayer
// so MC 26.2 (proto 776) and MC 26.3 (proto 777) work cleanly without upstream package lag.
const VIA_SHIM_VERSIONS = [
  { version: "26.2", protocol: 776, dataVersion: 4903, baseVersion: "26.1" },
  { version: "26.3", protocol: 777, dataVersion: 5023, baseVersion: "26.1" },
];

// Known protocol numbers for modern versions & snapshots so we can bridge newer servers
// onto the closest supported minecraft-data schema.
const PROTOCOL_FALLBACK_MAP = [
  { minProto: 777, targetVersion: "26.3" },
  { minProto: 776, targetVersion: "26.2" },
  { minProto: 775, targetVersion: "26.1" },
  { minProto: 774, targetVersion: "1.21.11" },
  { minProto: 773, targetVersion: "1.21.9" },
  { minProto: 772, targetVersion: "1.21.8" },
  { minProto: 771, targetVersion: "1.21.6" },
  { minProto: 770, targetVersion: "1.21.5" },
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

// Registers runtime protocol shims for MC 26.2 (776) and MC 26.3 (777) into
// minecraft-data, minecraft-protocol, and mineflayer BEFORE mineflayer loads its
// version table. Safe to call repeatedly (idempotent).
function installViaVersionProtocolShims(scopedRequire = require) {
  const req = typeof scopedRequire === "function" ? scopedRequire : require;
  const shimmedVersions = [];

  try {
    const mcData = req("minecraft-data");
    const dataMod = req("minecraft-data/data.js");
    const pcData = dataMod?.pc;

    if (pcData) {
      for (const spec of VIA_SHIM_VERSIONS) {
        const base = pcData[spec.baseVersion];
        if (!base) continue;

        if (!pcData[spec.version]) {
          const clone = Object.create(null);
          for (const key of Object.keys(base)) {
            const desc = Object.getOwnPropertyDescriptor(base, key);
            if (key === "version") {
              Object.defineProperty(clone, "version", {
                enumerable: true,
                configurable: true,
                get: () => ({
                  version: spec.protocol,
                  minecraftVersion: spec.version,
                  majorVersion: spec.baseVersion,
                  releaseType: "release",
                }),
              });
            } else if (desc) {
              Object.defineProperty(clone, key, desc);
            }
          }
          pcData[spec.version] = clone;
          shimmedVersions.push(spec.version);
        }

        // Ensure protocolVersions metadata exists even on older minecraft-data installs.
        if (
          mcData.versionsByMinecraftVersion?.pc &&
          !mcData.versionsByMinecraftVersion.pc[spec.version]
        ) {
          const meta = {
            minecraftVersion: spec.version,
            version: spec.protocol,
            dataVersion: spec.dataVersion,
            usesNetty: true,
            majorVersion: spec.version,
            releaseType: "release",
          };
          mcData.versionsByMinecraftVersion.pc[spec.version] = meta;
          if (mcData.postNettyVersionsByProtocolVersion?.pc) {
            mcData.postNettyVersionsByProtocolVersion.pc[spec.protocol] = [
              meta,
            ];
          }
        }

        if (
          Array.isArray(mcData.supportedVersions?.pc) &&
          !mcData.supportedVersions.pc.includes(spec.version)
        ) {
          mcData.supportedVersions.pc.push(spec.version);
        }
      }
    }
  } catch (_) {}

  try {
    const nmpVer = req("minecraft-protocol/src/version");
    if (Array.isArray(nmpVer?.supportedVersions)) {
      for (const spec of VIA_SHIM_VERSIONS) {
        if (!nmpVer.supportedVersions.includes(spec.version)) {
          nmpVer.supportedVersions.push(spec.version);
        }
      }
    }
  } catch (_) {}

  try {
    const mfVer = req("mineflayer/lib/version");
    if (Array.isArray(mfVer?.testedVersions)) {
      for (const spec of VIA_SHIM_VERSIONS) {
        if (!mfVer.testedVersions.includes(spec.version)) {
          mfVer.testedVersions.push(spec.version);
        }
      }
      mfVer.latestSupportedVersion =
        mfVer.testedVersions[mfVer.testedVersions.length - 1];
    }
  } catch (_) {}

  return {
    shimmedVersions,
    allViaVersions: VIA_SHIM_VERSIONS.map((v) => v.version),
  };
}

// Determines whether a requested version or server protocol number exceeds
// native Mineflayer 26.1 (775) wire schemas and benefits from a ViaProxy bridge.
function needsViaProxyBridge(versionOrProto) {
  if (typeof versionOrProto === "number" && Number.isFinite(versionOrProto)) {
    if (versionOrProto > NATIVE_MAX_PROTOCOL) {
      const mapped = PROTOCOL_FALLBACK_MAP.find(
        (r) => versionOrProto >= r.minProto,
      );
      return {
        needed: true,
        targetVersion: mapped ? mapped.targetVersion : "26.3",
        protocol: versionOrProto,
      };
    }
    return { needed: false, targetVersion: null, protocol: versionOrProto };
  }

  const raw = String(versionOrProto || "").trim();
  if (!raw || /^auto$/i.test(raw)) {
    return { needed: false, targetVersion: null, protocol: null };
  }
  const m = raw.match(/\b(26)\.(\d+)(?:\.(\d+))?\b/);
  if (m) {
    const minor = Number(m[2]);
    if (minor >= 2) {
      const targetVersion = minor >= 3 ? "26.3" : "26.2";
      const spec = VIA_SHIM_VERSIONS.find((v) => v.version === targetVersion);
      return {
        needed: true,
        targetVersion,
        protocol: spec ? spec.protocol : 776,
      };
    }
  }
  const mFuture = raw.match(/\b(\d+)\.(\d+)(?:\.(\d+))?\b/);
  if (mFuture && Number(mFuture[1]) > 26) {
    return { needed: true, targetVersion: mFuture[0], protocol: null };
  }
  return { needed: false, targetVersion: null, protocol: null };
}

// Lightweight Server List Ping (SLP) to inspect a server's exact protocol version
// before Mineflayer connects so we can decide between native 26.1, ViaProxy, or shimmed 26.2/26.3.
function pingServerProtocol(
  host,
  port = 25565,
  { timeoutMs = 3000, scopedRequire = require } = {},
) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: "Ping timeout" }),
      timeoutMs,
    );
    try {
      const req = typeof scopedRequire === "function" ? scopedRequire : require;
      const nmp = req("minecraft-protocol");
      const mcData = req("minecraft-data");
      nmp.ping(
        {
          host,
          port: Number(port) || 25565,
          closeTimeout: timeoutMs,
          noPongTimeout: Math.min(1500, timeoutMs),
        },
        (err, response) => {
          if (err || !response) {
            return finish({
              ok: false,
              error: err?.message || "Ping failed",
            });
          }
          const protocol = Number(response?.version?.protocol) || null;
          const versionName = String(response?.version?.name || "").trim();
          let resolvedVersion = null;
          if (protocol) {
            const row = PROTOCOL_FALLBACK_MAP.find(
              (r) => protocol >= r.minProto,
            );
            if (row) {
              resolvedVersion = resolveSupportedVersion(
                row.targetVersion,
                mcData,
              );
            }
          }
          if (!resolvedVersion && versionName) {
            resolvedVersion = resolveSupportedVersion(versionName, mcData);
          }
          finish({
            ok: true,
            protocol,
            versionName,
            resolvedVersion,
          });
        },
      );
    } catch (err) {
      finish({ ok: false, error: err?.message || String(err) });
    }
  });
}

function resolveSupportedVersion(rawVersion, mcDataModule = null) {
  let mcData = mcDataModule;
  if (!mcData) {
    try {
      const { loadLibraries } = require("./runtime");
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
  // Extract semantic version from server brand strings like "Paper 1.21.7", "Purpur 26.3", "Velocity 1.7.2-26.2"
  const verMatch = clean.match(/(\d+\.\d+(?:\.\d+)?)/g);
  if (verMatch && verMatch.length > 0) {
    const candidate = verMatch[verMatch.length - 1];
    if (mcData) {
      try {
        if (mcData(candidate)) return candidate;
      } catch (_) {}
      const parts = candidate.split(".");
      const major = Number(parts[0]);
      const minor = Number(parts[1]);
      if (major >= 26) {
        if (major > 26 || minor >= 3) {
          try {
            if (mcData("26.3")) return "26.3";
          } catch (_) {}
        }
        if (minor === 2) {
          try {
            if (mcData("26.2")) return "26.2";
          } catch (_) {}
        }
        return "26.1";
      }
      if (major === 1 && minor >= 21) return "26.1";
      const majorMinor = `${parts[0]}.${parts[1]}`;
      try {
        if (mcData(majorMinor)) return majorMinor;
      } catch (_) {}
    }
  }
  return NATIVE_MAX_VERSION;
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
// Vanilla stores the player width as a Java float (0.6F = 0.60000002384...),
// so its half-width is 0.30000001192..., while prismarine-physics uses exactly
// 0.3. When mineflayer slides the bot flush against a wall, the server's box
// then sticks ~1.2e-8 into the block; Paper/Purpur count any overlap as a
// "new collision" and silently teleport the player back - every tick, in
// every pit and tunnel (hundreds of setbacks, nothing in the server log).
// Using the vanilla value keeps the bot exactly where a real client would be.
// (+1e-7 so rounding can never put the box back inside a wall.)
const VANILLA_PLAYER_HALF_WIDTH = Math.fround(0.6) / 2 + 1e-7;

function matchVanillaHitbox(bot) {
  const apply = () => {
    const ph = bot?.physics;
    if (!ph || typeof ph.playerHalfWidth !== "number") return false;
    // The height stays 1.8: taller than the server's float 1.8F box, so the
    // client is the cautious one at ceilings too.
    ph.playerHalfWidth = Math.max(
      ph.playerHalfWidth,
      VANILLA_PLAYER_HALF_WIDTH,
    );
    return true;
  };
  // bot.physics is created by mineflayer's physics plugin; it may not exist
  // yet when the adapter is attached right after createBot().
  if (!apply() && typeof bot?.once === "function") {
    bot.once("login", apply);
    bot.once("spawn", apply);
  }
}

// Block-break prediction like the vanilla 1.19+ client. Mineflayer sends
// "finish digging" without a sequence number and immediately turns the block
// into air locally. When the server has not finished breaking it yet (its
// own dig progress is behind, e.g. the bot was not on the ground, or a new
// dig started first) the block stays on the server, the bot falls into a
// hole that only exists client-side and the server pulls it back every tick.
// Vanilla avoids that: each dig gets a sequence number, the client remembers
// the block's real state, and when the server acknowledges that sequence
// without having sent an update for the block, the client puts it back.
function attachDigPrediction(bot, { log = null } = {}) {
  const client = bot?._client;
  if (!client || client._mcbpDigPrediction) return;
  const fields = (() => {
    try {
      return (
        bot.registry?.protocol?.play?.toServer?.types?.packet_block_dig?.[1] ||
        []
      );
    } catch (_) {
      return [];
    }
  })();
  if (!fields.some((f) => f?.name === "sequence")) return; // pre-1.19
  client._mcbpDigPrediction = true;

  let sequence = 0;
  const pending = new Map(); // "x,y,z" -> { seq, stateId, pos, server, armed, at }
  const keyOf = (p) => `${p.x},${p.y},${p.z}`;
  let rollbacks = 0;

  const origWrite = client.write.bind(client);
  client.write = (name, params) => {
    if (
      name === "block_dig" &&
      params &&
      (params.status === 0 || params.status === 2)
    ) {
      sequence += 1;
      params = { ...params, sequence };
      if (params.status === 2 && params.location) {
        const pos = params.location;
        let stateId;
        try {
          stateId = bot.blockAt(
            pos.offset
              ? pos
              : new bot.entity.position.constructor(pos.x, pos.y, pos.z),
          )?.stateId;
        } catch (_) {}
        if (typeof stateId === "number" && stateId !== 0) {
          const entry = {
            seq: sequence,
            stateId,
            pos,
            server: undefined,
            armed: false,
            at: Date.now(),
          };
          pending.set(keyOf(pos), entry);
          // Mineflayer applies its own "air" prediction right after this
          // write; updates after that come from the server.
          setImmediate(() => {
            entry.armed = true;
          });
        }
      }
    }
    return origWrite(name, params);
  };

  // Server block updates (packet level: an update that matches what the
  // client already shows still counts as the server's answer).
  const markServer = (x, y, z, stateId) => {
    const entry = pending.get(`${x},${y},${z}`);
    if (entry && entry.armed) entry.server = stateId;
  };
  client.on("block_change", (packet) => {
    const p = packet?.location;
    if (p) markServer(p.x, p.y, p.z, packet.type);
  });
  client.on("multi_block_change", (packet) => {
    const c = packet?.chunkCoordinates;
    if (!c || !Array.isArray(packet.records)) return;
    for (const r of packet.records) {
      if (typeof r !== "number") continue;
      markServer(
        c.x * 16 + ((r >> 8) & 0x0f),
        c.y * 16 + (r & 0x0f),
        c.z * 16 + ((r >> 4) & 0x0f),
        Math.floor(r / 4096),
      );
    }
  });

  client.on("acknowledge_player_digging", (packet) => {
    const ack = Number(packet?.sequenceId ?? packet?.sequence ?? -1);
    if (!(ack >= 0)) return;
    const now = Date.now();
    for (const [key, entry] of pending) {
      if (entry.seq > ack && now - entry.at < 10000) continue;
      pending.delete(key);
      if (entry.server !== undefined) continue; // server told us the result
      const cur = bot.blockAt?.(entry.pos);
      if (!cur || cur.stateId === entry.stateId) continue;
      // The server acknowledged the dig but never removed the block.
      try {
        bot._updateBlockState(entry.pos, entry.stateId);
        rollbacks += 1;
        // Don't let the pathfinder hammer the same block again right away.
        try {
          bot.pathfinder?.penalizeNode?.(entry.pos, 60, 20000);
        } catch (_) {}
        if (log && (rollbacks <= 3 || rollbacks % 20 === 0)) {
          log(
            `Dig: server kept ${cur.name === "air" ? "the block" : cur.name} at (${entry.pos.x}, ${entry.pos.y}, ${entry.pos.z}) - restored it locally (${rollbacks} so far)`,
          );
        }
      } catch (_) {}
    }
  });
}

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
  matchVanillaHitbox(bot);
  // The registry (protocol) is known once the bot logs in.
  if (bot.registry?.protocol) attachDigPrediction(bot, { log });
  else if (typeof bot.once === "function") {
    bot.once("login", () => attachDigPrediction(bot, { log }));
  }

  const wireClient = (client) => {
    if (!client || client._mcbpViaClientWired) return;
    client._mcbpViaClientWired = true;

    // 0. Login/configuration phase compatibility (what ViaVersion does for
    // clients that lack these handlers). Modded/proxied servers (Fabric,
    // Velocity, Geyser, plugin cookies) can hold a client in the configuration
    // phase forever if a request is never answered - the server then only
    // shows "lost connection: Disconnected" when the user gives up.
    const hasServerboundPacket = (state, name) => {
      try {
        let proto = bot.registry?.protocol || null;
        if (!proto && client.version) {
          proto = require("minecraft-data")(client.version)?.protocol || null;
        }
        const packetDef = proto?.[state]?.toServer?.types?.packet;
        const mappings = packetDef?.[1]?.[0]?.type?.[1]?.mappings;
        if (mappings) return Object.values(mappings).includes(name);
        return Boolean(proto?.[state]?.toServer?.types?.[`packet_${name}`]);
      } catch (_) {
        return false;
      }
    };
    // Vanilla answers every cookie request; an unknown cookie is "no payload".
    client.on("cookie_request", (packet) => {
      const state = client.state || "configuration";
      if (!hasServerboundPacket(state, "cookie_response")) return;
      try {
        client.write("cookie_response", {
          key: packet?.cookie ?? packet?.key,
          value: undefined,
        });
      } catch (_) {}
    });

    // Diagnostics: remember the last server packets seen before spawning and
    // warn when the configuration phase stalls, so a silent hang shows up in
    // the console with the packet the server is waiting on.
    const recent = [];
    let configSince = 0;
    let stallTimer = null;
    const stopStallTimer = () => {
      if (stallTimer) clearInterval(stallTimer);
      stallTimer = null;
    };
    client.on("packet", (_data, meta) => {
      if (!meta || bot._mcbpHasSpawned) return;
      if (meta.state === "configuration" || meta.state === "login") {
        recent.push(meta.name);
        if (recent.length > 8) recent.shift();
        bot._mcbpViaLastConfigPackets = `${meta.state}: ${recent.join(", ")}`;
      }
      if (meta.state === "configuration" && !configSince) {
        configSince = Date.now();
        stopStallTimer();
        stallTimer = setInterval(() => {
          if (bot._mcbpHasSpawned || client.state !== "configuration") {
            stopStallTimer();
            return;
          }
          const secs = Math.round((Date.now() - configSince) / 1000);
          if (log) {
            log(
              `ViaVersion: Still in the configuration phase after ${secs}s - server has not finished login (last packets: ${recent.join(", ") || "none"}). The server may require a client mod/resource pack or be waiting on a plugin handshake.`,
            );
          }
        }, 15000);
        if (typeof stallTimer.unref === "function") stallTimer.unref();
      }
      if (meta.state === "play") stopStallTimer();
    });
    client.once("end", stopStallTimer);

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
  };

  if (bot._client) wireClient(bot._client);
  bot.on("login", () => {
    patchSupportFeatures();
    if (bot._client) wireClient(bot._client);
  });

  // MC 1.21.2+ and especially MC 26.3 strictly enforce one movement packet per client tick
  // and reset the counter on serverbound `tick_end`. Mineflayer 4.39.0 omits `tick_end`,
  // causing ~1.5s `invalid_player_movement` kicks on 26.3 servers (PrismarineJS/mineflayer#4189).
  if (!bot._mcbpTickEndAttached) {
    bot._mcbpTickEndAttached = true;
    bot.on("physicsTick", () => {
      const client = bot._client;
      if (
        !client ||
        client.state !== "play" ||
        typeof client.write !== "function"
      ) {
        return;
      }
      const needsTickEnd =
        (typeof bot.supportFeature === "function" &&
          bot.supportFeature("sendsClientTickEndPacket")) ||
        Number(bot.protocolVersion || 0) >= 768;
      if (!needsTickEnd) return;
      const hasTickEndPacket = Boolean(
        bot.registry?.protocol?.play?.toServer?.types?.packet_tick_end ||
        client.serializer?.proto?.types?.packet_tick_end,
      );
      if (!hasTickEndPacket) return;
      try {
        client.write("tick_end", {});
      } catch (_) {}
    });
  }

  // Make bot.findBlocks and bot.findBlock forgiving for custom AI-generated scripts:
  // - Accepts `find:` / `block:` / `type:` aliases for `matching:`
  // - Accepts a block/item object `{ id }`, a string name (e.g. "diamond" -> diamond_ore / deepslate_diamond_ore), or array
  // - Adds `.position` self-reference on returned Vec3 items from `findBlocks` so `blocks[0].position.x` and `blocks[0].x` both work
  const normalizeBlockMatcher = (raw) => {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "function" || typeof raw === "number") return raw;
    if (Array.isArray(raw)) {
      const flat = raw
        .map((x) => normalizeBlockMatcher(x))
        .flat()
        .filter((x) => typeof x === "number");
      return flat.length ? flat : null;
    }
    if (typeof raw === "object" && typeof raw.id === "number") {
      const name = String(raw.name || "").toLowerCase();
      const blocksByName = bot.registry?.blocksByName || {};
      // If an itemType object from itemsByName (e.g. diamond) was passed instead of a blockType, map it to the matching block(s)
      if (name && !blocksByName[name]) {
        const oreIds = [
          blocksByName[`${name}_ore`]?.id,
          blocksByName[`deepslate_${name}_ore`]?.id,
          blocksByName[`${name}_block`]?.id,
        ].filter((id) => typeof id === "number");
        if (oreIds.length) return oreIds;
      }
      return raw.id;
    }
    if (typeof raw === "string") {
      const clean = raw
        .trim()
        .toLowerCase()
        .replace(/^minecraft:/, "")
        .replace(/\s+/g, "_");
      const blocksByName = bot.registry?.blocksByName || {};
      if (blocksByName[clean]) return blocksByName[clean].id;
      const oreIds = [
        blocksByName[`${clean}_ore`]?.id,
        blocksByName[`deepslate_${clean}_ore`]?.id,
        blocksByName[`${clean}_log`]?.id,
        blocksByName[`${clean}_block`]?.id,
      ].filter((id) => typeof id === "number");
      if (oreIds.length) return oreIds;
    }
    return null;
  };

  if (typeof bot.findBlocks === "function" && !bot._mcbpFindBlocksPatched) {
    bot._mcbpFindBlocksPatched = true;
    const origFindBlocks = bot.findBlocks.bind(bot);
    bot.findBlocks = (options = {}) => {
      if (!options || typeof options !== "object") return [];
      const rawMatch =
        options.matching ?? options.find ?? options.block ?? options.type;
      const matching = normalizeBlockMatcher(rawMatch);
      if (matching === null) return [];
      const positions = origFindBlocks({ ...options, matching }) || [];
      for (const p of positions) {
        if (p && typeof p === "object" && !p.position) {
          Object.defineProperty(p, "position", {
            value: p,
            enumerable: false,
            configurable: true,
          });
        }
      }
      return positions;
    };
  }

  if (typeof bot.findBlock === "function" && !bot._mcbpFindBlockPatched) {
    bot._mcbpFindBlockPatched = true;
    const origFindBlock = bot.findBlock.bind(bot);
    bot.findBlock = (options = {}) => {
      if (!options || typeof options !== "object") return null;
      const rawMatch =
        options.matching ?? options.find ?? options.block ?? options.type;
      const matching = normalizeBlockMatcher(rawMatch);
      if (matching === null) return null;
      return origFindBlock({ ...options, matching });
    };
  }

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
      (isInvisible &&
        ageMs < 1500 &&
        (tabEntry.ping === 0 || tabEntry.ping < 0))
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
  VANILLA_PLAYER_HALF_WIDTH,
  attachDigPrediction,
  NATIVE_MAX_PROTOCOL,
  NATIVE_MAX_VERSION,
  VIA_SHIM_VERSIONS,
  PROTOCOL_FALLBACK_MAP,
  installViaVersionProtocolShims,
  needsViaProxyBridge,
  pingServerProtocol,
  resolveSupportedVersion,
  resolveVersionFromKickOrError,
  attachViaVersionAdapter,
  isLikelyNpcOrFakePlayer,
  isRealPlayerName,
};
