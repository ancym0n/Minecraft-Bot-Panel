const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const { Vec3 } = require("vec3");
const protocol = require("minecraft-protocol");
const autoFish = require("../src/js/scripts/autofish");
const { findFreePort } = require("../src/js/viaProxyBridge");

test(
  "AutoFish handles bobber and bite packets over a local TCP connection",
  { timeout: 10000 },
  async () => {
    const version = "1.20.1";
    const port = await findFreePort("127.0.0.1");
    const server = protocol.createServer({
      "online-mode": false,
      host: "127.0.0.1",
      port,
      version,
      keepAlive: false,
      checkTimeoutInterval: 0,
    });
    await once(server, "listening");
    let client;
    try {
      const login = once(server, "login");
      client = protocol.createClient({
        host: "127.0.0.1",
        port,
        version,
        username: "FishingFixture",
        auth: "offline",
        keepAlive: false,
        checkTimeoutInterval: 0,
      });
      const [peer] = await login;
      if (client.state !== "play") {
        await new Promise((resolve, reject) => {
          client.on("state", function ready(state) {
            if (state === "play") {
              client.removeListener("state", ready);
              resolve();
            }
          });
          client.once("error", reject);
        });
      }

      const bot = new EventEmitter();
      const rod = { name: "fishing_rod" };
      bot.entity = { id: 1, position: new Vec3(0, 0, 0) };
      bot.entities = {};
      bot.inventory = { items: () => [rod] };
      bot.heldItem = rod;
      bot._client = client;
      bot.registry = require("prismarine-registry")(version);
      bot.supportFeature = (feature) => bot.registry.supportFeature(feature);
      client.on("spawn_entity", (packet) => {
        bot.entities[packet.entityId] = {
          id: packet.entityId,
          position: new Vec3(packet.x, packet.y, packet.z),
        };
      });
      require("mineflayer/lib/plugins/fishing")(bot);
      let cast;
      const castStarted = new Promise((resolve) => (cast = resolve));
      let uses = 0;
      bot.activateItem = () => {
        uses++;
        cast();
      };
      const logs = [];
      const running = autoFish.script(
        bot,
        (line) => logs.push(line),
        () => {},
        async () => "off",
        async () => {},
      );
      await castStarted;
      peer.write("spawn_entity", {
        entityId: 10,
        objectUUID: "00000000-0000-4000-8000-000000000001",
        type: bot.registry.entitiesByName.fishing_bobber.id,
        x: 3,
        y: 0,
        z: 0,
        pitch: 0,
        yaw: 0,
        headPitch: 0,
        objectData: 1,
        velocity: { x: 0, y: 0, z: 0 },
      });
      peer.write("world_particles", {
        particleId: bot.registry.particlesByName.fishing.id,
        longDistance: false,
        x: 3,
        y: 0,
        z: 0,
        offsetX: 0,
        offsetY: 0,
        offsetZ: 0,
        particleData: 0,
        particles: 6,
        data: {},
      });
      await running;
      assert.equal(uses, 2);
      assert.ok(logs.some((line) => line.includes("catch #1")));
    } finally {
      client?.socket?.destroy();
      for (const peer of Object.values(server.clients || {})) {
        peer.socket?.destroy();
      }
      server.close();
      server.socketServer?.unref?.();
    }
  },
);
