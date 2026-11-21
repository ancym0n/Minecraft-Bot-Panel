const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");

const { loadLibraries, getRuntimeInfo } = require("../src/js/runtime");
const {
  NATIVE_MAX_PROTOCOL,
  VIA_SHIM_VERSIONS,
  installViaVersionProtocolShims,
  needsViaProxyBridge,
  pingServerProtocol,
  resolveSupportedVersion,
  resolveVersionFromKickOrError,
  attachViaVersionAdapter,
  isLikelyNpcOrFakePlayer,
  isRealPlayerName,
} = require("../src/js/viaAdapter");
const viaProxyBridge = require("../src/js/viaProxyBridge");

// Load runtime libraries once (this runs installViaVersionProtocolShims before mineflayer loads).
const libs = loadLibraries();
const { mcData, mineflayer } = libs;

test("ViaVersion shims register MC 26.2 (776) and MC 26.3 (777) across full PrismarineJS stack", () => {
  const shimResult = installViaVersionProtocolShims(libs.scopedRequire);
  assert.deepEqual(shimResult.allViaVersions, ["26.2", "26.3"]);

  for (const spec of [
    { version: "26.1", protocol: 775, dataVersion: 4786 },
    ...VIA_SHIM_VERSIONS,
  ]) {
    const d = mcData(spec.version);
    assert.ok(d, `mcData("${spec.version}") should load`);
    assert.equal(d.version.version, spec.protocol);
    assert.equal(d.version.minecraftVersion, spec.version);
    assert.equal(d.version.dataVersion, spec.dataVersion);
    assert.equal(d.version[">="]("26.1"), true);
    assert.equal(d.supportFeature("sendsClientTickEndPacket"), true);

    const reg = libs.scopedRequire("prismarine-registry")(spec.version);
    assert.ok(reg && reg.version, `prismarine-registry("${spec.version}") should load`);

    const Chunk = libs.scopedRequire("prismarine-chunk")(spec.version);
    const chunk = new Chunk({ minY: -64, worldHeight: 384 });
    assert.ok(chunk, `prismarine-chunk("${spec.version}") should instantiate`);

    const Item = libs.scopedRequire("prismarine-item")(spec.version);
    const Block = libs.scopedRequire("prismarine-block")(spec.version);
    const Entity = libs.scopedRequire("prismarine-entity")(spec.version);
    const Physics = libs.scopedRequire("prismarine-physics").Physics;
    assert.ok(Item && Block && Entity && Physics(d, { getBlock: () => null }));
  }

  assert.equal(mineflayer.latestSupportedVersion, "26.3");
  const info = getRuntimeInfo();
  assert.ok(info.supportedVersions.includes("26.3"));
  assert.ok(info.supportedVersions.includes("26.2"));
  assert.ok(info.supportedVersions.includes("26.1"));
  assert.equal(info.maxMcVersion, "26.3");
  assert.equal(info.versionRange, "1.8 ➙ 26.3");
});

test("resolveSupportedVersion, resolveVersionFromKickOrError, and needsViaProxyBridge handle 26.1-26.3+", () => {
  assert.equal(resolveSupportedVersion("Auto", mcData), false);
  assert.equal(resolveSupportedVersion("", mcData), false);
  assert.equal(resolveSupportedVersion("26.3", mcData), "26.3");
  assert.equal(resolveSupportedVersion("26.2", mcData), "26.2");
  assert.equal(resolveSupportedVersion("26.1.2", mcData), "26.1.2");
  assert.equal(resolveSupportedVersion("Purpur 26.3", mcData), "26.3");
  assert.equal(resolveSupportedVersion("Paper 26.2", mcData), "26.2");
  assert.equal(resolveSupportedVersion("26.4", mcData), "26.3");

  assert.equal(
    resolveVersionFromKickOrError("Outdated client! Please use 26.3", mcData),
    "26.3",
  );
  assert.equal(
    resolveVersionFromKickOrError("Unsupported protocol version 777", mcData),
    "26.3",
  );
  assert.equal(
    resolveVersionFromKickOrError("Unsupported protocol: 776", mcData),
    "26.2",
  );
  assert.equal(
    resolveVersionFromKickOrError("Please use 1.21.4 to join", mcData),
    "1.21.4",
  );

  assert.deepEqual(needsViaProxyBridge("26.3"), {
    needed: true,
    targetVersion: "26.3",
    protocol: 777,
  });
  assert.deepEqual(needsViaProxyBridge("26.2"), {
    needed: true,
    targetVersion: "26.2",
    protocol: 776,
  });
  assert.deepEqual(needsViaProxyBridge(777), {
    needed: true,
    targetVersion: "26.3",
    protocol: 777,
  });
  assert.deepEqual(needsViaProxyBridge(776), {
    needed: true,
    targetVersion: "26.2",
    protocol: 776,
  });
  assert.equal(needsViaProxyBridge(NATIVE_MAX_PROTOCOL).needed, false);
  assert.equal(needsViaProxyBridge("26.1").needed, false);
  assert.equal(needsViaProxyBridge("1.21.4").needed, false);
});

test("attachViaVersionAdapter sends tick_end on 1.21.2+/26.3 play ticks and shields PartialReadError", () => {
  const bot263 = new EventEmitter();
  const written = [];
  const logs = [];
  const client = new EventEmitter();
  client.state = "configuration";
  client.write = (name, params) => written.push({ name, params });

  bot263._client = client;
  bot263.protocolVersion = 777;
  bot263.supportFeature = (f) => f === "sendsClientTickEndPacket";
  bot263.registry = {
    protocol: { play: { toServer: { types: { packet_tick_end: ["container", []] } } } },
  };

  attachViaVersionAdapter(bot263, { log: (m) => logs.push(m) });

  // Should NOT emit tick_end during configuration phase
  bot263.emit("physicsTick");
  assert.equal(written.length, 0);

  // Should emit tick_end once per physicsTick in play state
  client.state = "play";
  for (let i = 0; i < 4; i++) bot263.emit("physicsTick");
  assert.equal(written.length, 4);
  assert.deepEqual(written[0], { name: "tick_end", params: {} });

  // Should throttle PartialReadError warnings without throwing
  client.emit("error", new Error("PartialReadError: Read error for play.toClient"));
  client.emit("error", new Error("PartialReadError: Read error for play.toClient"));
  assert.equal(logs.length, 1);

  // Older version (1.20.4, proto 765) must NOT emit tick_end
  const bot120 = new EventEmitter();
  const written120 = [];
  const client120 = new EventEmitter();
  client120.state = "play";
  client120.write = (name, params) => written120.push({ name, params });
  bot120._client = client120;
  bot120.protocolVersion = 765;
  bot120.supportFeature = () => false;
  attachViaVersionAdapter(bot120);
  bot120.emit("physicsTick");
  assert.equal(written120.length, 0);
});

test("Real local TCP protocol 777 (MC 26.3) server: SLP ping, auto-version login, and tick_end reception", async () => {
  const nmp = libs.scopedRequire("minecraft-protocol");
  const port = await viaProxyBridge.findFreePort("127.0.0.1");

  const server = nmp.createServer({
    "online-mode": false,
    host: "127.0.0.1",
    port,
    version: "26.3",
    motd: "MCBP 26.3 Test Server",
    keepAlive: false,
    checkTimeoutInterval: 0,
    kickTimeout: 2000,
  });

  let serverSawClient = null;
  let serverTickEndCount = 0;

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    // 1. Verify Server List Ping reports exact protocol 777 & resolves to 26.3
    const pingRes = await pingServerProtocol("127.0.0.1", port, {
      timeoutMs: 3000,
      scopedRequire: libs.scopedRequire,
    });
    assert.equal(pingRes.ok, true);
    assert.equal(pingRes.protocol, 777);
    assert.equal(pingRes.resolvedVersion, "26.3");

    // 2. Connect a real minecraft-protocol client using Auto version negotiation (version: false)
    const loginPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("26.3 handshake/login timed out")),
        6000,
      );

      server.once("login", (srvClient) => {
        serverSawClient = {
          username: srvClient.username,
          protocolVersion: srvClient.protocolVersion,
          version: srvClient.version,
        };
        srvClient.on("tick_end", () => {
          serverTickEndCount += 1;
          if (serverTickEndCount >= 2) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      const client = nmp.createClient({
        host: "127.0.0.1",
        port,
        username: "ViaTestBot263",
        auth: "offline",
        version: false,
        keepAlive: false,
        checkTimeoutInterval: 0,
        closeTimeout: 2000,
        noPongTimeout: 1000,
      });

      client.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      client.on("state", (newState) => {
        if (newState === "play") {
          // Attach our ViaVersion adapter on a mock bot wrapping the real client
          const mockBot = new EventEmitter();
          mockBot._client = client;
          mockBot.protocolVersion = 777;
          mockBot.registry = mcData("26.3");
          mockBot.supportFeature = (f) => mockBot.registry.supportFeature(f);
          attachViaVersionAdapter(mockBot);
          mockBot.emit("physicsTick");
          mockBot.emit("physicsTick");
        }
      });

      server.once("playerJoin", () => {});
      // Cleanup client when test resolves
      server._testClient = client;
    });

    await loginPromise;
    assert.ok(serverSawClient);
    assert.equal(serverSawClient.username, "ViaTestBot263");
    assert.equal(serverSawClient.protocolVersion, 777);
    assert.equal(serverSawClient.version, "26.3");
    assert.ok(serverTickEndCount >= 2, "Server should receive client tick_end packets");
  } finally {
    try {
      server._testClient?.socket?.destroy();
    } catch (_) {}
    for (const srvClient of Object.values(server.clients || {})) {
      try {
        srvClient.socket?.destroy();
      } catch (_) {}
    }
    server.close();
    server.socketServer?.unref?.();
  }
});

test("Real local TCP protocol 776 (MC 26.2) server: SLP ping and protocol negotiation", async () => {
  const nmp = libs.scopedRequire("minecraft-protocol");
  const port = await viaProxyBridge.findFreePort("127.0.0.1");

  const server = nmp.createServer({
    "online-mode": false,
    host: "127.0.0.1",
    port,
    version: "26.2",
    motd: "MCBP 26.2 Test Server",
    keepAlive: false,
    checkTimeoutInterval: 0,
    kickTimeout: 2000,
  });

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const pingRes = await pingServerProtocol("127.0.0.1", port, {
      timeoutMs: 3000,
      scopedRequire: libs.scopedRequire,
    });
    assert.equal(pingRes.ok, true);
    assert.equal(pingRes.protocol, 776);
    assert.equal(pingRes.resolvedVersion, "26.2");
  } finally {
    for (const srvClient of Object.values(server.clients || {})) {
      try {
        srvClient.socket?.destroy();
      } catch (_) {}
    }
    server.close();
    server.socketServer?.unref?.();
  }
});

test("ViaProxy bridge helpers parse Java versions, allocate free ports, and generate valid viaproxy.yml", async () => {
  assert.equal(
    viaProxyBridge.parseJavaMajorVersion('openjdk version "21.0.13" 2026-04-21'),
    21,
  );
  assert.equal(
    viaProxyBridge.parseJavaMajorVersion('java version "17.0.9" 2023-10-17 LTS'),
    17,
  );
  assert.equal(
    viaProxyBridge.parseJavaMajorVersion('java version "1.8.0_401"'),
    8,
  );
  assert.equal(viaProxyBridge.parseJavaMajorVersion("not java"), null);

  const javaInfo = await viaProxyBridge.checkJavaVersion();
  assert.equal(typeof javaInfo.available, "boolean");

  const port = await viaProxyBridge.findFreePort("127.0.0.1");
  assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535);

  const yml = viaProxyBridge.buildViaProxyConfig({
    bindHost: "127.0.0.1",
    bindPort: port,
    targetHost: "play.example.net",
    targetPort: 25565,
    targetVersion: "Purpur 26.3",
    authMethod: "NONE",
  });
  assert.match(yml, new RegExp(`bind-address: 127\\.0\\.0\\.1:${port}`));
  assert.match(yml, /target-address: play\.example\.net:25565/);
  assert.match(yml, /target-version: 26\.3/);
  assert.match(yml, /auth-method: NONE/);
  assert.match(yml, /proxy-online-mode: false/);
});

test("NPC and Anti-Cheat FakePlayer detector filters NPCs/self while keeping real players", () => {
  const realPlayerEntity = {
    type: "player",
    username: "Steve",
    uuid: "550e8400-e29b-41d4-a716-446655440000",
    metadata: [0],
  };
  const citizensNpc = {
    type: "player",
    username: "ShopKeeper",
    uuid: "550e8400-e29b-21d4-a716-446655440000", // UUID v2
    metadata: [0],
  };
  const antiCheatBot = {
    type: "player",
    username: "Steve",
    uuid: "550e8400-e29b-41d4-a716-446655440000",
    _mcbpIsAntiCheatBot: true,
    metadata: [0],
  };
  const bot = {
    username: "MyBot",
    entity: { type: "player", username: "MyBot" },
    players: {
      Steve: {
        username: "Steve",
        uuid: realPlayerEntity.uuid,
        ping: 42,
        entity: realPlayerEntity,
      },
      MyBot: { username: "MyBot", uuid: "11111111-1111-4111-8111-111111111111" },
    },
    entities: {},
  };

  assert.equal(isLikelyNpcOrFakePlayer(bot, realPlayerEntity), false);
  assert.equal(isLikelyNpcOrFakePlayer(bot, citizensNpc), true);
  assert.equal(isLikelyNpcOrFakePlayer(bot, antiCheatBot), true);
  assert.equal(isLikelyNpcOrFakePlayer(bot, bot.entity), true);
  assert.equal(isRealPlayerName(bot, "Steve"), true);
  assert.equal(isRealPlayerName(bot, "MyBot"), false);
  assert.equal(isRealPlayerName(bot, "§e[NPC] Guide"), false);
});

test("attachViaVersionAdapter answers configuration cookie requests like vanilla and records pre-spawn packets", () => {
  const bot = new EventEmitter();
  const client = new EventEmitter();
  const written = [];
  client.state = "configuration";
  client.version = "1.21.4";
  client.write = (name, params) => written.push({ name, params });
  bot._client = client;
  bot.registry = require("minecraft-data")("1.21.4");
  attachViaVersionAdapter(bot, { log: () => {} });

  client.emit("packet", {}, { state: "configuration", name: "select_known_packs" });
  client.emit("cookie_request", { cookie: "velocity:forwarding" });
  assert.deepEqual(written.at(-1), {
    name: "cookie_response",
    params: { key: "velocity:forwarding", value: undefined },
  });
  assert.match(bot._mcbpViaLastConfigPackets, /configuration: select_known_packs/);
  client.emit("end");
});

test("ViaProxy online-mode auth endpoint: secret required, joins with the hash, reports failures; plugin jar ships", async () => {
  const fs = require("fs");
  const { startAuthEndpoint, AUTH_PLUGIN_JAR } = require("../src/js/viaProxyBridge");
  assert.ok(fs.statSync(AUTH_PLUGIN_JAR).size > 1000, "prebuilt ViaProxy plugin jar is present");
  const joined = [];
  let fail = false;
  const { server, secret, url } = await startAuthEndpoint(async (hash) => {
    if (fail) throw new Error("Mojang session server HTTP 429");
    joined.push(hash);
  });
  const post = (body, sec) =>
    fetch(url, { method: "POST", body, headers: { "X-MCBP-Secret": sec } }).then((r) => r.status);
  try {
    assert.ok(url.startsWith("http://127.0.0.1:"));
    assert.equal(await post("-302a97c1f", "wrong"), 403);
    assert.equal(await post("not a hash!", secret), 400);
    assert.equal(await post("-302a97c1f", secret), 204);
    assert.deepEqual(joined, ["-302a97c1f"]);
    fail = true;
    assert.equal(await post("4f1a", secret), 502);
  } finally {
    server.close();
  }
});

test("Dig prediction: sequence numbers are sent and a break the server never confirmed is rolled back on ack", async () => {
  const { EventEmitter } = require("events");
  const { Vec3 } = require("vec3");
  const { attachDigPrediction, VANILLA_PLAYER_HALF_WIDTH } = require("../src/js/viaAdapter");
  assert.ok(VANILLA_PLAYER_HALF_WIDTH > 0.3000000119 && VANILLA_PLAYER_HALF_WIDTH < 0.3000003);
  const mcData = require("minecraft-data")("26.1");
  const stone = mcData.blocksByName.stone.defaultState;
  const states = new Map([["1,64,1", stone], ["2,64,1", stone]]);
  const bot = new EventEmitter();
  bot.registry = mcData;
  bot.entity = { position: new Vec3(0, 65, 0) };
  bot.blockAt = (p) => ({ position: p, stateId: states.get(`${p.x},${p.y},${p.z}`) ?? 0, name: (states.get(`${p.x},${p.y},${p.z}`) ?? 0) ? "stone" : "air" });
  bot._updateBlockState = (p, id) => {
    const old = bot.blockAt(p);
    states.set(`${p.x},${p.y},${p.z}`, id);
    bot.emit("blockUpdate", old, bot.blockAt(p));
  };
  const client = new EventEmitter();
  const sent = [];
  client.write = (name, params) => sent.push({ name, params });
  bot._client = client;
  attachDigPrediction(bot);

  // Mineflayer: start, finish, then predict air locally.
  const a = new Vec3(1, 64, 1);
  client.write("block_dig", { status: 0, location: a, face: 1 });
  client.write("block_dig", { status: 2, location: a, face: 1 });
  bot._updateBlockState(a, 0);
  assert.deepEqual(sent.map((s) => s.params.sequence), [1, 2]);
  await new Promise((r) => setImmediate(r));
  client.emit("acknowledge_player_digging", { sequenceId: 2 });
  assert.equal(states.get("1,64,1"), stone, "server never removed it: restored");

  // Confirmed break: the server's update (air) arrives before the ack.
  const b = new Vec3(2, 64, 1);
  client.write("block_dig", { status: 2, location: b, face: 1 });
  bot._updateBlockState(b, 0);
  await new Promise((r) => setImmediate(r));
  client.emit("block_change", { location: { x: 2, y: 64, z: 1 }, type: 0 }); // server: air
  client.emit("acknowledge_player_digging", { sequenceId: 3 });
  assert.equal(states.get("2,64,1"), 0, "confirmed break stays air");

  // A multi_block_change confirming air also counts.
  const c = new Vec3(1, 64, 1);
  client.write("block_dig", { status: 2, location: c, face: 1 });
  bot._updateBlockState(c, 0);
  await new Promise((r) => setImmediate(r));
  client.emit("multi_block_change", { chunkCoordinates: { x: 0, y: 4, z: 0 }, records: [(0 << 12) | (1 << 8) | (1 << 4) | 0] });
  client.emit("acknowledge_player_digging", { sequenceId: 4 });
  assert.equal(states.get("1,64,1"), 0);
});
