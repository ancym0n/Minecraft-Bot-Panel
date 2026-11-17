// Functions the AI Agent may call. Each tool has an Ollama/OpenAI style
// schema plus a handler that returns a short text result for the model.
// Movement is checked for a real path and watched for getting stuck, with
// automatic recovery (jump, re-path, dig/bridge) before reporting failure.
const {
  equipBestArmor,
  equipBestWeapon,
  findBestFood,
  consumeFoodSafely,
  smartDig,
  setDynamicFollowGoal,
  clearPathfinderGoal,
  configureSmartMovements,
  isHostile,
} = require("./botUtils");

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required },
  },
});

const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

const TOOL_SCHEMAS = [
  fn(
    "get_status",
    "Get the bot's health, food, position, held item, inventory, nearby players/mobs and running scripts.",
  ),
  fn(
    "go_to",
    "Walk to block coordinates.",
    { x: num("X"), y: num("Y (optional)"), z: num("Z") },
    ["x", "z"],
  ),
  fn(
    "come_to_player",
    "Walk next to a player once. For 'come here' use the asking player's name.",
    { player: str("Player username") },
    ["player"],
  ),
  fn(
    "follow_player",
    "Keep following a player until stop is called.",
    { player: str("Player username") },
    ["player"],
  ),
  fn("stop", "Stop all movement, following, mining and attacking."),
  fn(
    "look_at_player",
    "Turn to look at a player.",
    { player: str("Player username") },
    ["player"],
  ),
  fn(
    "attack",
    "Attack the nearest entity matching a mob type (e.g. zombie) or a player name. Use 'hostile' for the nearest hostile mob.",
    { target: str("Mob type, player name, or 'hostile'") },
    ["target"],
  ),
  fn(
    "mine_block",
    "Find, walk to and mine nearby blocks of a type, e.g. oak_log, stone, iron_ore. Picks up the drops.",
    {
      block: str("Minecraft block id like oak_log"),
      count: num("How many blocks (1-32)"),
    },
    ["block"],
  ),
  fn("equip_best_gear", "Equip the best armor and weapon in the inventory."),
  fn("eat", "Eat the best available food."),
  fn(
    "toss_item",
    "Drop items from the inventory to give them to nearby players.",
    {
      item: str("Item id like bread or diamond"),
      count: num("Amount, default all of that item"),
    },
    ["item"],
  ),
  fn("list_scripts", "List MCBP automation scripts and whether they run."),
  fn(
    "start_script",
    "Start an MCBP automation script by name (see list_scripts), e.g. AutoEat, KillAura, AutoFish.",
    { name: str("Script name") },
    ["name"],
  ),
  fn(
    "stop_script",
    "Stop a running MCBP automation script by name.",
    { name: str("Script name") },
    ["name"],
  ),
];

const RUN_CODE_SCHEMA = fn(
  "run_code",
  "Run async JavaScript with the Mineflayer API when no other tool fits, or to fix a task that failed. Available: bot, goals (mineflayer-pathfinder goals), Vec3, mcData, sleep(ms). Use `return` to get a value back. Runs at most 20s. Example: `await bot.pathfinder.goto(new goals.GoalNear(0, 64, 0, 1)); return 'arrived'`",
  { code: str("JavaScript function body") },
  ["code"],
);

// Scripts the AI should never toggle itself.
const BLOCKED_SCRIPTS = new Set(["chatai", "aiagent", "clearinv", "spam"]);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (onTimeout) onTimeout();
        reject(new Error(`timed out after ${Math.round(ms / 1000)}s`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createAiTools(ctx) {
  const {
    getBot,
    loadLibraries,
    scripts,
    log,
    onTaskDone = () => {},
    canRunCode = () => false,
  } = ctx;

  const requireBot = () => {
    const bot = getBot();
    if (!bot || !bot.entity) throw new Error("Bot is not connected");
    if (!bot.pathfinder) throw new Error("Pathfinder is not loaded yet");
    return bot;
  };

  const findPlayer = (bot, name) => {
    const wanted = String(name || "")
      .replace(/^@/, "")
      .toLowerCase();
    const key = Object.keys(bot.players || {}).find(
      (u) => u.toLowerCase() === wanted,
    );
    const entity = key ? bot.players[key]?.entity : null;
    if (!entity) {
      throw new Error(
        `${name} is not within view distance (too far or not online)`,
      );
    }
    return entity;
  };

  const resolveScript = (name) => {
    const wanted = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return scripts
      .list()
      .find((s) => s.toLowerCase().replace(/[^a-z0-9]/g, "") === wanted);
  };

  const itemId = (raw) =>
    String(raw || "")
      .toLowerCase()
      .replace(/^minecraft:/, "")
      .trim()
      .replace(/\s+/g, "_");

  // --- Movement modes -----------------------------------------------------
  function setHardMode(bot, on) {
    const { mcData, Movements } = loadLibraries();
    if (on) {
      configureSmartMovements(bot, mcData, Movements, {
        canDig: true,
        allowPillaring: true,
        allowBridging: true,
        allowParkour: true,
      });
    } else {
      configureSmartMovements(bot, mcData, Movements);
    }
    bot._mcbpAiHardMode = on;
  }

  function stopWatch(bot) {
    const w = bot?._mcbpAiWatch;
    if (!w) return;
    clearInterval(w.timer);
    bot._mcbpAiWatch = null;
    if (bot._mcbpAiHardMode) setHardMode(bot, false);
  }

  // Resolves with the pathfinder's first verdict for the new goal.
  function pathVerdict(bot, ms = 3000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        bot.removeListener("path_update", onUpdate);
        bot.removeListener("goal_reached", onReached);
        resolve(v);
      };
      const onUpdate = (r) => finish(r?.status || "unknown");
      const onReached = () => finish("reached");
      bot.on("path_update", onUpdate);
      bot.on("goal_reached", onReached);
      const timer = setTimeout(() => finish("pending"), ms);
    });
  }

  // Detects "not moving while far from the goal" and recovers step by step.
  function watchGoal(bot, { goal, dynamic, label, sender, isFar }) {
    stopWatch(bot);
    const w = {
      goal,
      lastPos: bot.entity.position.clone(),
      still: 0,
      attempt: 0,
      timer: null,
    };
    bot._mcbpAiWatch = w;
    const TICK = 1500;
    w.timer = setInterval(() => {
      if (getBot() !== bot || !bot.entity || bot.pathfinder.goal !== goal) {
        stopWatch(bot);
        return;
      }
      const pos = bot.entity.position;
      if (!dynamic && goal.isEnd(pos.floored())) {
        stopWatch(bot);
        return;
      }
      if (pos.distanceTo(w.lastPos) > 0.7 || !isFar()) {
        w.lastPos = pos.clone();
        w.still = 0;
        return;
      }
      w.still += TICK;
      if (w.still < 6000) return;
      w.still = 0;
      w.attempt += 1;
      if (w.attempt === 1) {
        log(`AIAgent: Stuck going to ${label}, jumping and re-pathing`);
        bot.setControlState("jump", true);
        setTimeout(() => bot.setControlState("jump", false), 450);
        bot.pathfinder.setGoal(goal, dynamic);
      } else if (w.attempt === 2) {
        log(`AIAgent: Still stuck, allowing digging and bridging`);
        setHardMode(bot, true);
        bot.pathfinder.setGoal(goal, dynamic);
      } else {
        log(`AIAgent: Gave up going to ${label} (stuck)`);
        stopWatch(bot);
        clearPathfinderGoal(bot);
        onTaskDone({
          name: "move",
          ok: false,
          sender,
          result: `Stuck: could not reach ${label} even after jumping, re-pathing, digging and bridging`,
        });
      }
    }, TICK);
  }

  // Sets a goal, waits for a real path (retrying in dig/bridge mode) and
  // starts the stuck watchdog. Throws when no path exists.
  async function startMove(
    bot,
    goal,
    { dynamic = false, label, sender, isFar },
  ) {
    stopWatch(bot);
    let verdict = pathVerdict(bot);
    bot.pathfinder.setGoal(goal, dynamic);
    let status = await verdict;
    if (status === "noPath") {
      setHardMode(bot, true);
      verdict = pathVerdict(bot);
      bot.pathfinder.setGoal(goal, dynamic);
      status = await verdict;
      if (status === "noPath") {
        clearPathfinderGoal(bot);
        setHardMode(bot, false);
        throw new Error(
          `No path to ${label}, even with digging and bridging. Try other coordinates or ask the player to come closer`,
        );
      }
    }
    if (status !== "reached") {
      watchGoal(bot, {
        goal,
        dynamic,
        label,
        sender,
        isFar: isFar || (() => !goal.isEnd(bot.entity.position.floored())),
      });
    }
    return status;
  }

  const handlers = {
    get_status() {
      const bot = requireBot();
      const p = bot.entity.position;
      const counts = {};
      for (const it of bot.inventory.items()) {
        counts[it.name] = (counts[it.name] || 0) + it.count;
      }
      const inv = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([n, c]) => `${n} x${c}`);
      const mobs = Object.values(bot.entities || {})
        .filter(
          (e) =>
            e !== bot.entity &&
            e.position &&
            e.type !== "player" &&
            (e.type === "mob" || e.type === "hostile" || e.type === "animal") &&
            e.position.distanceTo(p) < 24,
        )
        .slice(0, 8)
        .map((e) => `${e.name} ${Math.round(e.position.distanceTo(p))}m`);
      const players = Object.values(bot.players || {})
        .filter((pl) => pl.entity && pl.username !== bot.username)
        .map(
          (pl) =>
            `${pl.username} ${Math.round(pl.entity.position.distanceTo(p))}m`,
        );
      const goal = bot.pathfinder?.goal;
      return [
        `HP ${Math.round(bot.health)}/20, food ${bot.food}/20`,
        `Position ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)} in ${String(bot.game?.dimension || "overworld").replace("minecraft:", "")}`,
        `Holding ${bot.heldItem ? bot.heldItem.name : "nothing"}`,
        `Inventory: ${inv.join(", ") || "empty"}`,
        `Players nearby: ${players.join(", ") || "none"}`,
        `Mobs nearby: ${mobs.join(", ") || "none"}`,
        `Moving: ${goal ? "yes" : "no"}${bot._mcbpAiWatch?.attempt ? " (recovering from being stuck)" : ""}`,
        `Running scripts: ${scripts.active().join(", ") || "none"}`,
      ].join("\n");
    },

    async go_to({ x, y, z }, { sender }) {
      const bot = requireBot();
      const { goals } = loadLibraries();
      const nx = Number(x);
      const nz = Number(z);
      if (!Number.isFinite(nx) || !Number.isFinite(nz))
        throw new Error("x and z must be numbers");
      const ny = Number(y);
      const hasY =
        y !== undefined && y !== null && y !== "" && Number.isFinite(ny);
      const label = `${Math.floor(nx)} ${hasY ? Math.floor(ny) : "~"} ${Math.floor(nz)}`;
      const goal = hasY
        ? new goals.GoalNear(nx, ny, nz, 1)
        : new goals.GoalXZ(nx, nz);
      const status = await startMove(bot, goal, { label, sender });
      const me = bot.entity.position;
      const dist = Math.round(
        Math.hypot(me.x - nx, hasY ? me.y - ny : 0, me.z - nz),
      );
      return status === "reached"
        ? `Already at ${label}`
        : `Walking to ${label} (${dist}m away${status === "partial" ? ", long route" : ""})`;
    },

    async come_to_player({ player }, { sender }) {
      const bot = requireBot();
      const target = findPlayer(bot, player || sender);
      const { goals } = loadLibraries();
      const p = target.position;
      const dist = Math.round(p.distanceTo(bot.entity.position));
      if (dist <= 2) return `Already next to ${player || sender}`;
      await startMove(bot, new goals.GoalNear(p.x, p.y, p.z, 2), {
        label: player || sender,
        sender,
      });
      return `Walking to ${player || sender} (${dist}m away)`;
    },

    async follow_player({ player }, { sender }) {
      const bot = requireBot();
      const name = player || sender;
      const target = findPlayer(bot, name);
      const { goals } = loadLibraries();
      bot._mcbpSprintJump = true;
      bot._mcbpFollowState = null;
      const goal = new goals.GoalFollow(target, 2);
      await startMove(bot, goal, {
        dynamic: true,
        label: name,
        sender,
        isFar: () =>
          target.isValid !== false &&
          target.position.distanceTo(bot.entity.position) > 4,
      });
      bot._mcbpFollowState = { entityId: target.id, range: 2 };
      return `Following ${name}`;
    },

    stop() {
      const bot = requireBot();
      stopWatch(bot);
      bot._mcbpAiTask = null;
      bot.clearControlStates();
      clearPathfinderGoal(bot);
      if (typeof bot.stopDigging === "function") {
        try {
          bot.stopDigging();
        } catch (_) {}
      }
      return "Stopped everything";
    },

    async look_at_player({ player }, { sender }) {
      const bot = requireBot();
      const target = findPlayer(bot, player || sender);
      await bot.lookAt(target.position.offset(0, target.height || 1.6, 0));
      return `Looking at ${player || sender}`;
    },

    async attack({ target }) {
      const bot = requireBot();
      const wanted = String(target || "")
        .replace(/^@/, "")
        .toLowerCase();
      const me = bot.entity.position;
      const candidates = Object.values(bot.entities || {}).filter((e) => {
        if (e === bot.entity || !e.position) return false;
        if (e.position.distanceTo(me) > 24) return false;
        if (wanted === "hostile") return isHostile(e);
        if (e.type === "player")
          return String(e.username || "").toLowerCase() === wanted;
        return String(e.name || "").toLowerCase() === itemId(wanted);
      });
      candidates.sort(
        (a, b) => a.position.distanceTo(me) - b.position.distanceTo(me),
      );
      const victim = candidates[0];
      if (!victim) throw new Error(`No ${target} within 24 blocks`);
      stopWatch(bot);
      const task = {};
      bot._mcbpAiTask = task;
      await equipBestWeapon(bot, { saveLowDurability: true }).catch(() => {});
      const { goals } = loadLibraries();
      bot.pathfinder.setGoal(new goals.GoalFollow(victim, 1.5), true);
      let hits = 0;
      const started = Date.now();
      while (
        getBot() === bot &&
        bot._mcbpAiTask === task &&
        bot.entities[victim.id] &&
        Date.now() - started < 20000
      ) {
        if (victim.position.distanceTo(bot.entity.position) <= 3.3) {
          await bot.lookAt(
            victim.position.offset(0, (victim.height || 1.6) * 0.85, 0),
            true,
          );
          bot.attack(victim);
          hits += 1;
        }
        await sleep(600);
      }
      const cancelled = getBot() !== bot || bot._mcbpAiTask !== task;
      if (!cancelled) {
        bot._mcbpAiTask = null;
        clearPathfinderGoal(bot);
      }
      const label = victim.username || victim.name;
      if (cancelled) return `Stopped attacking ${label}`;
      if (bot.entities[victim.id]) {
        throw new Error(
          hits
            ? `${label} survived ${hits} hits and is still alive`
            : `Could not get close enough to ${label}`,
        );
      }
      return `Defeated ${label} (${hits} hits)`;
    },

    async mine_block({ block, count }) {
      const bot = requireBot();
      const name = itemId(block);
      const blockType = bot.registry?.blocksByName?.[name];
      if (!blockType) throw new Error(`Unknown block id "${block}"`);
      const amount = Math.max(1, Math.min(32, Math.floor(Number(count) || 1)));
      const { goals } = loadLibraries();
      stopWatch(bot);
      const task = {};
      bot._mcbpAiTask = task;
      const failed = new Set();
      const key = (p) => `${p.x},${p.y},${p.z}`;
      let mined = 0;
      let fails = 0;
      let lastError = "";
      try {
        while (mined < amount && fails < 4) {
          if (getBot() !== bot || bot._mcbpAiTask !== task) break;
          const positions = bot.findBlocks({
            matching: blockType.id,
            maxDistance: 64,
            count: 24,
          });
          const pos = positions.find((p) => !failed.has(key(p)));
          if (!pos) {
            lastError = `no more reachable ${name} within 64 blocks`;
            break;
          }
          try {
            await withTimeout(
              bot.pathfinder.goto(
                new goals.GoalLookAtBlock(pos, bot.world, { reach: 4 }),
              ),
              25000,
              () => bot.pathfinder.setGoal(null),
            );
            const target = bot.blockAt(pos);
            if (!target || target.type !== blockType.id) continue;
            const ok = await smartDig(bot, target, { autoTool: true });
            if (ok === false) throw new Error("dig was interrupted");
            mined += 1;
            // Step onto the spot to pick up the drop.
            await withTimeout(
              bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 1)),
              4000,
              () => bot.pathfinder.setGoal(null),
            ).catch(() => {});
          } catch (err) {
            failed.add(key(pos));
            fails += 1;
            lastError = err.message || String(err);
            // Blocked twice: let the pathfinder dig and bridge.
            if (fails === 2) setHardMode(bot, true);
          }
        }
      } finally {
        if (bot._mcbpAiHardMode) setHardMode(bot, false);
      }
      const cancelled = getBot() !== bot || bot._mcbpAiTask !== task;
      if (!cancelled) bot._mcbpAiTask = null;
      if (cancelled) return `Stopped mining (${mined} ${name} mined)`;
      if (!mined) {
        throw new Error(
          `Could not mine any ${name}: ${lastError || "stopped"}`,
        );
      }
      return `Mined ${mined}/${amount} ${name}${mined < amount && lastError ? ` (stopped: ${lastError})` : ""}`;
    },

    async equip_best_gear() {
      const bot = requireBot();
      await equipBestArmor(bot, { includeOffhand: true });
      await equipBestWeapon(bot, { saveLowDurability: true });
      return "Equipped best armor and weapon";
    },

    async eat() {
      const bot = requireBot();
      if (bot.food >= 20) return "Already full";
      const food = findBestFood(bot, { emergencyHeal: bot.health < 10 });
      if (!food) throw new Error("No food in inventory");
      const ok = await consumeFoodSafely(bot, food);
      if (!ok) throw new Error(`Could not eat ${food.name}`);
      return `Ate ${food.name}`;
    },

    async toss_item({ item, count }, { sender }) {
      const bot = requireBot();
      const name = itemId(item);
      const stacks = bot.inventory.items().filter((i) => i.name === name);
      if (!stacks.length) throw new Error(`No ${name} in inventory`);
      const receiver = bot.players[sender]?.entity;
      if (receiver) {
        await bot.lookAt(receiver.position.offset(0, 1.4, 0), true);
      }
      let left = Number(count) > 0 ? Math.floor(Number(count)) : Infinity;
      let tossed = 0;
      for (const stack of stacks) {
        if (left <= 0) break;
        const n = Math.min(stack.count, left);
        await bot.toss(stack.type, stack.metadata, n);
        tossed += n;
        left -= n;
      }
      return `Dropped ${tossed} ${name}`;
    },

    list_scripts() {
      const active = new Set(scripts.active());
      return scripts
        .list()
        .filter((s) => !BLOCKED_SCRIPTS.has(s.toLowerCase()))
        .map((s) => `${s}${active.has(s) ? " (running)" : ""}`)
        .join(", ");
    },

    start_script({ name }) {
      const real = resolveScript(name);
      if (!real) throw new Error(`No script named ${name}, see list_scripts`);
      if (BLOCKED_SCRIPTS.has(real.toLowerCase()))
        throw new Error(`${real} can only be toggled from the panel`);
      return scripts.start(real)
        ? `Started ${real}`
        : `${real} is already running`;
    },

    stop_script({ name }) {
      const real = resolveScript(name);
      if (!real) throw new Error(`No script named ${name}, see list_scripts`);
      if (BLOCKED_SCRIPTS.has(real.toLowerCase()))
        throw new Error(`${real} can only be toggled from the panel`);
      return scripts.stop(real) ? `Stopped ${real}` : `${real} was not running`;
    },

    async run_code({ code }, { sender }) {
      if (!canRunCode(sender)) {
        throw new Error("Running code is not allowed for this player");
      }
      const bot = requireBot();
      const { goals, Vec3, mcData, Movements } = loadLibraries();
      const src = String(code || "")
        .replace(/^```(?:js|javascript)?\s*|```\s*$/g, "")
        .trim();
      if (!src) throw new Error("No code given");
      let runner;
      try {
        runner = new AsyncFunction(
          "bot",
          "goals",
          "Vec3",
          "mcData",
          "Movements",
          "sleep",
          `"use strict";\n${src}`,
        );
      } catch (err) {
        throw new Error(`SyntaxError: ${err.message}. Fix the code and retry`);
      }
      try {
        const value = await withTimeout(
          runner(bot, goals, Vec3, mcData, Movements, sleep),
          20000,
        );
        let out;
        try {
          out = value === undefined ? "done" : JSON.stringify(value);
        } catch (_) {
          out = String(value);
        }
        return `OK: ${String(out).slice(0, 800)}`;
      } catch (err) {
        const line = String(err.stack || "").match(/<anonymous>:(\d+)/);
        throw new Error(
          `${err.name || "Error"}: ${err.message}${line ? ` (line ${Number(line[1]) - 3})` : ""}. Fix the code and retry`,
        );
      }
    },
  };

  // Long tasks run in the background so the bot can answer right away;
  // their outcome is reported back so the AI can fix failures.
  const BACKGROUND = new Set(["attack", "mine_block"]);

  async function executeTool(name, args = {}, meta = {}) {
    const handler = handlers[name];
    if (!handler) return `Error: unknown tool ${name}`;
    const safeArgs = args && typeof args === "object" ? args : {};
    const argText = JSON.stringify(safeArgs);
    if (BACKGROUND.has(name)) {
      requireBot();
      Promise.resolve()
        .then(() => handler(safeArgs, meta))
        .then((res) => {
          log(`AIAgent: ${name} finished → ${res}`);
          onTaskDone({
            name,
            args: safeArgs,
            ok: true,
            result: res,
            sender: meta.sender,
          });
        })
        .catch((err) => {
          const msg = err.message || String(err);
          log(`AIAgent: ${name} failed → ${msg}`);
          onTaskDone({
            name,
            args: safeArgs,
            ok: false,
            result: msg,
            sender: meta.sender,
          });
        });
      log(`AIAgent: ${name}(${argText}) started`);
      return `Started ${name.replace("_", " ")} in the background, you will get a report when it finishes`;
    }
    try {
      const result = await handler(safeArgs, meta);
      log(`AIAgent: ${name}(${argText}) → ${String(result).split("\n")[0]}`);
      return result;
    } catch (err) {
      const msg = `Error: ${err.message || err}`;
      log(`AIAgent: ${name}(${argText}) → ${msg}`);
      return msg;
    }
  }

  function schemasFor(sender) {
    return canRunCode(sender)
      ? [...TOOL_SCHEMAS, RUN_CODE_SCHEMA]
      : TOOL_SCHEMAS;
  }

  function stopAll() {
    const bot = getBot();
    if (!bot) return;
    stopWatch(bot);
    bot._mcbpAiTask = null;
  }

  return { schemas: TOOL_SCHEMAS, schemasFor, executeTool, stopAll };
}

module.exports = { createAiTools, TOOL_SCHEMAS, RUN_CODE_SCHEMA };
