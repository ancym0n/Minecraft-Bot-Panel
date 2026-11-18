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
const {
  translate,
  resolveScriptName,
  HELP: COMMANDS_HELP,
  VERB_LIST,
} = require("./commandTranslator");

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
  fn(
    "think",
    "Your private notepad. Write your plan or what went wrong here; players never see it. Use it before retrying a failed task.",
    { thought: str("Your private thought") },
    ["thought"],
  ),
  fn(
    "run_commands",
    `EASIEST WAY to control the bot. Write simple commands, one per line or separated by ;. They run in order. Examples:\n${COMMANDS_HELP}`,
    { commands: str("Commands, e.g. 'walk to Steve; say hi'") },
    ["commands"],
  ),
  fn(
    "list_scripts",
    "List every module (script) with ON/OFF state and its options with current values.",
  ),
  fn(
    "start_script",
    'Turn ON a module by name, e.g. KillAura, AutoEat, AutoFish, Survival. Optional options like {"range":"4","players":"on"}.',
    {
      name: str("Module name"),
      options: {
        type: "object",
        description: 'Optional option values to set first, e.g. {"range":"4"}',
      },
    },
    ["name"],
  ),
  fn(
    "stop_script",
    "Turn OFF a module by name.",
    { name: str("Module name") },
    ["name"],
  ),
  fn("stop_all_scripts", "Turn OFF every running module."),
  fn(
    "set_script_option",
    "Change one option of a module, e.g. name=KillAura option=range value=4. Checkboxes take on/off.",
    {
      name: str("Module name"),
      option: str("Option id or label"),
      value: str("New value"),
    },
    ["name", "option", "value"],
  ),
  fn(
    "read_logs",
    "Read the bot's recent console log (errors, module messages, chat, task results). Use it to find out why something failed.",
    {
      lines: num("How many recent lines (default 15, max 80)"),
      filter: str("Only lines containing this text, e.g. error"),
    },
  ),
];

const RUN_CODE_SCHEMA = fn(
  "run_code",
  "Run async JavaScript with the Mineflayer API when no other tool fits, or to fix a task that failed. Available: bot, goals (mineflayer-pathfinder goals), Vec3, mcData, sleep(ms). Use `return` to get a value back. Runs at most 20s. Example: `await bot.pathfinder.goto(new goals.GoalNear(0, 64, 0, 1)); return 'arrived'`",
  { code: str("JavaScript function body") },
  ["code"],
);

// The AI may toggle every module except the ones that run the AI itself.
const BLOCKED_SCRIPTS = new Set(["chatai", "aiagent"]);
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
    getLogs = () => [],
  } = ctx;

  const requireBot = () => {
    const bot = getBot();
    if (!bot || !bot.entity) throw new Error("Bot is not connected");
    if (!bot.pathfinder) throw new Error("Pathfinder is not loaded yet");
    return bot;
  };

  // Edit distance, for typos like "ancynamon" → "ancymon".
  const distance = (a, b) => {
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(
          dp[j] + 1,
          dp[j - 1] + 1,
          prev + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        prev = tmp;
      }
    }
    return dp[b.length];
  };

  // Exact name, else a unique close match (prefix or a couple of typos).
  const matchPlayerName = (bot, name) => {
    const wanted = String(name || "")
      .replace(/^@/, "")
      .toLowerCase();
    const names = Object.keys(bot.players || {}).filter(
      (u) => u !== bot.username,
    );
    const exact = names.find((u) => u.toLowerCase() === wanted);
    if (exact || wanted.length < 3) return exact || null;
    const scored = names
      .map((u) => {
        const l = u.toLowerCase();
        const d =
          l.startsWith(wanted) || wanted.startsWith(l)
            ? 0.5
            : distance(l, wanted);
        return { u, d };
      })
      .filter((x) => x.d <= Math.max(2, Math.floor(wanted.length / 3)))
      .sort((a, b) => a.d - b.d);
    if (!scored.length) return null;
    if (scored[1] && scored[1].d === scored[0].d) return null;
    return scored[0].u;
  };

  const findPlayer = (bot, name) => {
    const key = matchPlayerName(bot, name);
    const entity = key ? bot.players[key]?.entity : null;
    if (!entity) {
      throw new Error(
        `${name} is not within view distance (too far or not online)`,
      );
    }
    return entity;
  };

  const resolveScript = (name) => {
    const list = scripts.list();
    const wanted = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return (
      list.find((s) => s.toLowerCase().replace(/[^a-z0-9]/g, "") === wanted) ||
      resolveScriptName(name, list)
    );
  };

  const toggleable = (name) => {
    const real = resolveScript(name);
    if (!real) {
      throw new Error(
        `No module named "${name}". Modules: ${scripts
          .list()
          .filter((s) => !BLOCKED_SCRIPTS.has(s.toLowerCase()))
          .join(", ")}`,
      );
    }
    if (BLOCKED_SCRIPTS.has(real.toLowerCase()))
      throw new Error(`${real} can only be toggled from the panel`);
    return real;
  };

  // Accepts "zombies", "Zombie", "oak logs", "wood" and returns a real id.
  const resolveName = (raw, table) => {
    const id = itemId(raw);
    if (!table) return id;
    const tries = [
      id,
      id.replace(/es$/, ""),
      id.replace(/s$/, ""),
      id.replace(/s_/g, "_"),
      ALIASES[id],
      ALIASES[id.replace(/s$/, "")],
    ].filter(Boolean);
    for (const t of tries) if (table[t]) return t;
    return id;
  };

  const ALIASES = {
    wood: "oak_log",
    log: "oak_log",
    tree: "oak_log",
    trees: "oak_log",
    cobble: "cobblestone",
    diamond: "diamond_ore",
    diamonds: "diamond_ore",
    iron: "iron_ore",
    coal: "coal_ore",
    gold: "gold_ore",
    sword: "diamond_sword",
    pick: "diamond_pickaxe",
    pickaxe: "diamond_pickaxe",
  };

  // Chat components / JSON strings / § codes → plain text.
  const plainText = (v) => {
    if (v === null || v === undefined) return "";
    let val = v;
    if (typeof val === "string") {
      const t = val.trim();
      if (/^[{["]/.test(t)) {
        try {
          val = JSON.parse(t);
        } catch (_) {}
      }
    }
    const walk = (n) => {
      if (n === null || n === undefined) return "";
      if (typeof n === "string" || typeof n === "number") return String(n);
      if (Array.isArray(n)) return n.map(walk).join("");
      if (typeof n === "object") {
        if (
          typeof n.toString === "function" &&
          n.toString !== Object.prototype.toString
        )
          return String(n.toString());
        return `${walk(n.text ?? n.translate ?? "")}${walk(n.extra || [])}`;
      }
      return "";
    };
    return walk(val)
      .replace(/§[0-9a-fk-or]/gi, "")
      .trim();
  };

  // Items in the open menu (not the player's own inventory part).
  const menuItems = (win) => {
    const end =
      typeof win.inventoryStart === "number"
        ? win.inventoryStart
        : win.slots.length;
    const out = [];
    for (let i = 0; i < end; i++) {
      const it = win.slots[i];
      if (!it) continue;
      let custom = "";
      try {
        custom = plainText(it.customName);
      } catch (_) {}
      let lore = "";
      try {
        lore = (it.customLore || []).map(plainText).join(" ");
      } catch (_) {}
      const label = custom || it.displayName || it.name;
      if (
        /^(gray|black|white|light_gray)_stained_glass_pane$/.test(it.name) &&
        !custom
      )
        continue;
      out.push({
        slot: i,
        label,
        key: label.toLowerCase().replace(/[^a-z0-9]/g, ""),
        text: `${label} ${it.name} ${lore}`
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ""),
      });
    }
    return out;
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

  // Sets a module option through the panel UI so it shows and persists.
  async function setOption(scriptName, key, value) {
    // "AI Fixes Errors" is the user's switch, not the AI's.
    const opts = ((await scripts.options?.(scriptName)) || []).filter(
      (o) => o.id !== "aifix",
    );
    if (/^ai\s*fix/i.test(String(key || "")))
      throw new Error("That setting can only be changed by the owner");
    if (!opts.length) throw new Error(`${scriptName} has no options`);
    const k = String(key || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const opt =
      opts.find((o) => o.id.toLowerCase() === k) ||
      opts.find((o) => o.label.toLowerCase().replace(/[^a-z0-9]/g, "") === k) ||
      opts.find(
        (o) =>
          k.length >= 3 &&
          (o.label
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .includes(k) ||
            o.id.toLowerCase().includes(k)),
      );
    if (!opt) {
      throw new Error(
        `${scriptName} has no option "${key}". Options: ${opts.map((o) => o.id).join(", ")}`,
      );
    }
    let v = value;
    if (opt.type === "checkbox") {
      v = /^(on|true|yes|1|enable|enabled|y)$/i.test(String(v).trim())
        ? "on"
        : "off";
    } else if (opt.type === "select") {
      const want = String(v).toLowerCase().trim();
      const choice = (opt.choices || []).find((c) => {
        const cv = String(typeof c === "object" ? c.value : c).toLowerCase();
        const cl = String(
          typeof c === "object" ? c.label || c.value : c,
        ).toLowerCase();
        return cv === want || cl === want;
      });
      if (!choice) {
        throw new Error(
          `${opt.id} must be one of: ${(opt.choices || [])
            .map((c) => (typeof c === "object" ? c.value : c))
            .join(", ")}`,
        );
      }
      v = typeof choice === "object" ? choice.value : choice;
    } else {
      v = String(v ?? "");
    }
    const ok = await scripts.setOption(scriptName, opt.id, v);
    if (!ok) throw new Error(`Could not set ${opt.id} (is the panel open?)`);
    return `${opt.id}=${v}`;
  }

  // Waits until the pathfinder goal is reached, dropped or 90s pass.
  async function arrive(bot, seq) {
    const started = Date.now();
    await sleep(300);
    while (Date.now() - started < 90000) {
      if (getBot() !== bot || !bot.entity) return;
      if (seq && bot._mcbpAiSeq !== seq) return;
      if (!bot.pathfinder?.goal) return;
      await sleep(300);
    }
  }

  let inSequence = false;

  // Translates plain commands to JS and runs them step by step.
  async function runTranslated(text, sender) {
    const bot = requireBot();
    const t = translate(text, {
      scripts: scripts.list(),
      sender,
      botName: bot.username,
    });
    if (!t.count) {
      throw new Error(
        `${t.errors.join("; ") || "No commands given"}. Command words: ${VERB_LIST}`,
      );
    }
    if (t.needsCode && !canRunCode(sender)) {
      throw new Error(
        "That looks like JavaScript, which is not allowed. Use plain commands like: walk to Steve; mine 5 oak_log",
      );
    }
    // Show the JS each command became, without the step() wrapper.
    const shown = t.js
      .split("\n")
      .filter((l) => !/^await api\.arrive\(\);$/.test(l))
      .map((l) =>
        l.replace(
          /^await api\.step\(\d+, "(?:[^"\\]|\\.)*", \(\) => (.*)\);$/,
          "$1",
        ),
      )
      .join("; ");
    log(
      `AIAgent: "${String(text).replace(/\s+/g, " ").slice(0, 80)}" → ${shown.slice(0, 400)}`,
    );
    const seq = {};
    bot._mcbpAiSeq = seq;
    const results = [];
    const { goals, Vec3, mcData } = loadLibraries();
    const api = {
      arrive: () => arrive(bot, seq),
      async step(i, line, call) {
        if (getBot() !== bot || bot._mcbpAiSeq !== seq)
          throw new Error("cancelled");
        let res;
        try {
          inSequence = true;
          res = await call();
        } catch (err) {
          throw new Error(`Step ${i} "${line}" failed: ${err.message || err}`);
        } finally {
          inSequence = false;
        }
        results.push(`${i}. ${String(res).split("\n")[0].slice(0, 120)}`);
        return res;
      },
      async raw(i, line, fnBody) {
        return api.step(i, line.split("\n")[0], async () => {
          const v = await withTimeout(fnBody(), 20000);
          return v === undefined ? "done" : JSON.stringify(v);
        });
      },
    };
    for (const [name, h] of Object.entries(handlers)) {
      if (name === "run_commands" || name === "run_code") continue;
      api[name] = (args = {}) => h(args, { sender });
    }
    let runner;
    try {
      runner = new AsyncFunction(
        "api",
        "bot",
        "goals",
        "Vec3",
        "mcData",
        "sleep",
        `"use strict";\n${t.js}`,
      );
    } catch (err) {
      throw new Error(
        `SyntaxError: ${err.message}. Use plain commands instead`,
      );
    }
    try {
      await runner(api, bot, goals, Vec3, mcData, sleep);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg === "cancelled")
        return `Stopped. Done: ${results.join(" | ") || "nothing"}`;
      throw new Error(
        `${msg}${results.length ? `. Done before that: ${results.join(" | ")}` : ""}`,
      );
    } finally {
      if (bot._mcbpAiSeq === seq) bot._mcbpAiSeq = null;
    }
    const skipped = t.errors.length ? ` Skipped: ${t.errors.join("; ")}` : "";
    return `${results.join(" | ")}${skipped}`;
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
      const wanted = String(player || sender || "").replace(/^@/, "");
      const isOnline = Boolean(matchPlayerName(bot, wanted));
      // "go to kitpvp": not a player, so it's probably a game in a menu.
      if (
        !isOnline &&
        player &&
        wanted.toLowerCase() !== String(sender).toLowerCase()
      ) {
        try {
          return await handlers.join_game({ name: wanted });
        } catch (_) {}
      }
      const target = findPlayer(bot, player || sender);
      const who = target.username || player || sender;
      const { goals } = loadLibraries();
      const p = target.position;
      const dist = Math.round(p.distanceTo(bot.entity.position));
      if (dist <= 2) return `Already next to ${who}`;
      await startMove(bot, new goals.GoalNear(p.x, p.y, p.z, 2), {
        label: who,
        sender,
      });
      return `Walking to ${who} (${dist}m away)`;
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
      return `Following ${target.username || name}`;
    },

    stop() {
      const bot = requireBot();
      stopWatch(bot);
      bot._mcbpAiTask = null;
      if (!inSequence) bot._mcbpAiSeq = null;
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
        return (
          String(e.name || "").toLowerCase() ===
          resolveName(wanted, bot.registry?.entitiesByName)
        );
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
      const deniedNow = () =>
        bot._mcbpDenied && bot._mcbpDenied.at >= started
          ? bot._mcbpDenied.text
          : "";
      while (
        getBot() === bot &&
        bot._mcbpAiTask === task &&
        bot.entities[victim.id] &&
        Date.now() - started < 20000 &&
        !deniedNow()
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
      if (deniedNow()) {
        clearPathfinderGoal(bot);
        throw new Error(
          `The server won't let me fight here ("${deniedNow()}")`,
        );
      }
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
      const name = resolveName(block, bot.registry?.blocksByName);
      const blockType = bot.registry?.blocksByName?.[name];
      if (!blockType)
        throw new Error(
          `Unknown block "${block}". Use a Minecraft id like oak_log, stone, iron_ore`,
        );
      const amount = Math.max(1, Math.min(32, Math.floor(Number(count) || 1)));
      const { goals } = loadLibraries();
      stopWatch(bot);
      const task = {};
      bot._mcbpAiTask = task;
      const failed = new Set();
      const key = (p) => `${p.x},${p.y},${p.z}`;
      let mined = 0;
      let fails = 0;
      let denied = "";
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
            const digStart = Date.now();
            const ok = await smartDig(bot, target, { autoTool: true });
            await sleep(250);
            if (bot._mcbpDenied && bot._mcbpDenied.at >= digStart) {
              denied = bot._mcbpDenied.text;
              break;
            }
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
      if (denied) {
        throw new Error(
          `The server won't let me break blocks here ("${denied}"). Mined ${mined}`,
        );
      }
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
      const name = resolveName(item, bot.registry?.itemsByName);
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

    async list_scripts() {
      const active = new Set(scripts.active());
      const names = scripts
        .list()
        .filter((s) => !BLOCKED_SCRIPTS.has(s.toLowerCase()));
      const rows = await Promise.all(
        names.map(async (s) => {
          const opts = ((await scripts.options?.(s)) || [])
            .filter((o) => o.id !== "aifix")
            .map((o) => `${o.id}=${o.value === "" ? "?" : o.value}`)
            .join(" ");
          return `${s} ${active.has(s) ? "ON" : "off"}${opts ? ` [${opts}]` : ""}`;
        }),
      );
      return rows.join("\n");
    },

    async start_script({ name, options }) {
      const real = toggleable(name);
      const notes = [];
      if (options && typeof options === "object") {
        for (const [k, v] of Object.entries(options)) {
          notes.push(await setOption(real, k, v));
        }
      }
      const started = scripts.start(real);
      const head = started ? `Turned ON ${real}` : `${real} is already ON`;
      return notes.length ? `${head} (${notes.join(", ")})` : head;
    },

    stop_script({ name }) {
      const real = toggleable(name);
      return scripts.stop(real)
        ? `Turned OFF ${real}`
        : `${real} was already off`;
    },

    stop_all_scripts() {
      const stopped = scripts
        .active()
        .filter((s) => !BLOCKED_SCRIPTS.has(s.toLowerCase()))
        .filter((s) => scripts.stop(s));
      return stopped.length
        ? `Turned OFF ${stopped.join(", ")}`
        : "No modules were running";
    },

    async set_script_option({ name, option, value }) {
      const real = toggleable(name);
      return `${real}: ${await setOption(real, option, value)}`;
    },

    // Batch form used by the command translator.
    async set_script_options({ name, options = {} }) {
      const real = toggleable(name);
      const notes = [];
      for (const [k, v] of Object.entries(options)) {
        notes.push(await setOption(real, k, v));
      }
      return `${real}: ${notes.join(", ") || "nothing changed"}`;
    },

    read_logs({ lines, filter } = {}) {
      const n = Math.max(1, Math.min(80, Math.floor(Number(lines) || 15)));
      const f = String(filter || "")
        .toLowerCase()
        .trim();
      let all = getLogs();
      if (f) {
        const words = f.split(/\s+/);
        all = all.filter((l) => words.some((w) => l.toLowerCase().includes(w)));
      }
      const out = all.slice(-n);
      return out.length
        ? out.join("\n").slice(-3000)
        : f
          ? `No log lines contain "${filter}"`
          : "Log is empty";
    },

    // --- Small primitives (mostly used by run_commands) ---
    say({ text, message }) {
      const bot = requireBot();
      const msg = String(text ?? message ?? "").trim();
      if (!msg) throw new Error("Nothing to say");
      bot.chat(msg.slice(0, 250));
      return `Said "${msg.slice(0, 60)}"`;
    },

    async wait({ ms, seconds }) {
      const t = Number(ms) || Number(seconds) * 1000 || 1000;
      const left = Math.max(0, Math.min(600000, t));
      const bot = getBot();
      const seq = bot?._mcbpAiSeq;
      const end = Date.now() + left;
      while (Date.now() < end) {
        if (seq && bot._mcbpAiSeq !== seq) break;
        await sleep(Math.min(250, end - Date.now()));
      }
      return `Waited ${Math.round(left / 100) / 10}s`;
    },

    async jump({ times = 1 }) {
      const bot = requireBot();
      const n = Math.max(1, Math.min(20, Math.floor(Number(times) || 1)));
      for (let i = 0; i < n; i++) {
        bot.setControlState("jump", true);
        await sleep(350);
        bot.setControlState("jump", false);
        await sleep(250);
      }
      return `Jumped ${n}x`;
    },

    control({ control, on = true }) {
      const bot = requireBot();
      const c = String(control || "").toLowerCase();
      if (
        ![
          "sneak",
          "sprint",
          "jump",
          "forward",
          "back",
          "left",
          "right",
        ].includes(c)
      )
        throw new Error(`Unknown control ${control}`);
      const state = on !== false && on !== "off" && on !== "false";
      bot.setControlState(c, state);
      return `${c} ${state ? "on" : "off"}`;
    },

    async walk_direction({ direction, seconds = 1 }) {
      const bot = requireBot();
      const d = String(direction || "forward").toLowerCase();
      const dir = d.startsWith("back")
        ? "back"
        : d.startsWith("forw")
          ? "forward"
          : d;
      if (!["forward", "back", "left", "right"].includes(dir))
        throw new Error(`Unknown direction ${direction}`);
      stopWatch(bot);
      clearPathfinderGoal(bot);
      const ms = Math.max(100, Math.min(30000, Number(seconds) * 1000 || 1000));
      bot.setControlState(dir, true);
      await sleep(ms);
      bot.setControlState(dir, false);
      return `Walked ${dir} for ${ms / 1000}s`;
    },

    async look_at({ x, y, z }) {
      const bot = requireBot();
      const { Vec3 } = loadLibraries();
      const v = new Vec3(Number(x), Number(y), Number(z));
      if (![v.x, v.y, v.z].every(Number.isFinite))
        throw new Error("x, y and z must be numbers");
      await bot.lookAt(v.offset(0.5, 0.5, 0.5));
      return `Looking at ${v.x} ${v.y} ${v.z}`;
    },

    async hold({ item }) {
      const bot = requireBot();
      const name = resolveName(item, bot.registry?.itemsByName);
      const inv = bot.inventory.items();
      const found =
        inv.find((i) => i.name === name) ||
        inv.find((i) => i.name.includes(itemId(item)));
      if (!found) throw new Error(`No ${itemId(item)} in inventory`);
      await bot.equip(found, "hand");
      return `Holding ${found.name}`;
    },

    async drop_all() {
      const bot = requireBot();
      let n = 0;
      for (const it of bot.inventory.items()) {
        await bot.tossStack(it).catch(() => {});
        n += 1;
      }
      return n ? `Dropped ${n} stacks` : "Inventory already empty";
    },

    async use_item({ item }) {
      const bot = requireBot();
      if (item) await handlers.hold({ item });
      // Lobby items (compass, nether star...) usually open a menu.
      const opened = new Promise((resolve) => {
        const onOpen = (w) => resolve(w);
        bot.once("windowOpen", onOpen);
        setTimeout(() => {
          bot.removeListener("windowOpen", onOpen);
          resolve(null);
        }, 1500);
      });
      bot.activateItem();
      await sleep(300);
      bot.deactivateItem();
      const win = await opened;
      const used = `Used ${bot.heldItem ? bot.heldItem.name : "empty hand"}`;
      if (!win) return used;
      const items = menuItems(win)
        .map((m) => m.label)
        .slice(0, 20);
      return `${used}, opened menu "${plainText(win.title)}" with: ${items.join(", ") || "nothing"}`;
    },

    async click_slot({ name, slot, button }) {
      const bot = requireBot();
      const win = bot.currentWindow;
      if (!win) {
        throw new Error("No menu is open. Open one first, e.g. use compass");
      }
      const items = menuItems(win);
      let target = null;
      if (slot !== undefined && slot !== null && slot !== "") {
        const n = Math.floor(Number(slot));
        target = items.find((m) => m.slot === n) || {
          slot: n,
          label: `slot ${n}`,
        };
      } else {
        const want = String(name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        if (!want) throw new Error("Say which item to click");
        target =
          items.find((m) => m.key === want) ||
          items.find((m) => m.key.includes(want)) ||
          items.find((m) => m.text.includes(want));
        if (!target) {
          throw new Error(
            `Nothing called "${name}" in this menu. Items: ${items
              .map((m) => m.label)
              .slice(0, 20)
              .join(", ")}`,
          );
        }
      }
      const right = /right/i.test(String(button || ""));
      await bot.clickWindow(target.slot, right ? 1 : 0, 0);
      await sleep(500);
      const now = bot.currentWindow;
      const after =
        now && now !== win
          ? `, new menu "${plainText(now.title)}" with: ${menuItems(now)
              .map((m) => m.label)
              .slice(0, 20)
              .join(", ")}`
          : now
            ? ""
            : ", menu closed";
      return `Clicked ${target.label}${after}`;
    },

    // Lobby games: open the selector item's menu and click the game.
    async join_game({ name, allowCommand = false }) {
      const bot = requireBot();
      const want = String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      if (!want) throw new Error("Say which game to join");
      const pick = (win) => {
        const items = menuItems(win);
        return (
          items.find((m) => m.key === want) ||
          items.find((m) => m.key.includes(want)) ||
          items.find((m) => m.text.includes(want))
        );
      };
      const clickIn = async (win) => {
        const hit = pick(win);
        if (!hit) return null;
        return handlers.click_slot({ slot: hit.slot });
      };
      if (bot.currentWindow) {
        const done = await clickIn(bot.currentWindow);
        if (done) return done;
      }
      const SELECTOR =
        /compass|clock|nether_star|book|chest|emerald|comparator|ender_eye|player_head|diamond_sword|firework/;
      const selectors = bot.inventory
        .items()
        .filter((i) => SELECTOR.test(i.name))
        .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
        .slice(0, 3);
      for (const item of selectors) {
        await handlers.use_item({ item: item.name }).catch(() => {});
        const win = bot.currentWindow;
        if (!win) continue;
        const done = await clickIn(win);
        if (done) return `Joining ${name}: ${done}`;
        if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
      }
      if (allowCommand) {
        bot.chat(`/server ${String(name).trim()}`);
        return `Sent /server ${String(name).trim()}`;
      }
      throw new Error(
        `Couldn't find ${name} in any menu${selectors.length ? "" : " (no compass or selector item)"}`,
      );
    },

    close_window() {
      const bot = requireBot();
      if (!bot.currentWindow) return "No menu was open";
      bot.closeWindow(bot.currentWindow);
      return "Closed the menu";
    },

    hotbar({ slot }) {
      const bot = requireBot();
      const n = Math.floor(Number(slot));
      if (!(n >= 1 && n <= 9)) throw new Error("Hotbar slot must be 1-9");
      bot.setQuickBarSlot(n - 1);
      return `Selected hotbar slot ${n}${bot.heldItem ? ` (${bot.heldItem.name})` : ""}`;
    },

    think({ thought }) {
      const t = String(thought || "").trim();
      if (t) log(`AIAgent (thinking): ${t.slice(0, 300)}`);
      return "noted";
    },

    respawn() {
      const bot = requireBot();
      if (bot.health > 0) return "Not dead";
      bot.respawn();
      return "Respawned";
    },

    // Runs plain-English commands through the translator.
    async run_commands({ commands }, { sender }) {
      const text = Array.isArray(commands)
        ? commands.join("\n")
        : String(commands || "");
      return runTranslated(text, sender);
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
      // Small models often send "walk to Steve" here instead of JS.
      const plainCommands = translate(src, {
        scripts: scripts.list(),
        sender,
        botName: bot.username,
      });
      if (
        !plainCommands.needsCode &&
        plainCommands.count > 0 &&
        !plainCommands.errors.length
      ) {
        return runTranslated(src, sender);
      }
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

  // Names small models invent for the real tools.
  const TOOL_ALIASES = {
    commands: "run_commands",
    command: "run_commands",
    run_command: "run_commands",
    execute: "run_commands",
    do: "run_commands",
    status: "get_status",
    getstatus: "get_status",
    walk_to: "go_to",
    goto: "go_to",
    move_to: "go_to",
    come: "come_to_player",
    come_here: "come_to_player",
    follow: "follow_player",
    look: "look_at_player",
    kill: "attack",
    mine: "mine_block",
    dig: "mine_block",
    equip: "equip_best_gear",
    drop: "toss_item",
    toss: "toss_item",
    give: "toss_item",
    chat: "say",
    send_chat: "say",
    list_modules: "list_scripts",
    modules: "list_scripts",
    enable_script: "start_script",
    enable_module: "start_script",
    start_module: "start_script",
    turn_on: "start_script",
    toggle_script: "start_script",
    disable_script: "stop_script",
    disable_module: "stop_script",
    stop_module: "stop_script",
    turn_off: "stop_script",
    set_option: "set_script_option",
    logs: "read_logs",
    get_logs: "read_logs",
    read_log: "read_logs",
  };

  // Argument names small models use instead of the real ones.
  const ARG_ALIASES = {
    player: [
      "username",
      "name",
      "target",
      "who",
      "user",
      "playerName",
      "player_name",
    ],
    name: ["script", "module", "script_name", "module_name", "scriptName"],
    block: ["block_type", "blockType", "type", "item", "name", "block_name"],
    target: ["entity", "mob", "player", "name", "type"],
    item: ["item_name", "itemName", "name", "type"],
    count: ["amount", "quantity", "number", "n", "times"],
    commands: ["command", "code", "text", "cmd", "cmds", "input", "steps"],
    code: ["js", "javascript", "script", "source", "commands"],
    text: ["message", "msg", "content"],
    option: ["key", "setting", "option_name"],
    value: ["val", "new_value", "setting_value"],
  };

  function fixArgs(name, rawArgs) {
    let args = rawArgs;
    // Tiny models sometimes send the JSON schema itself as the arguments.
    if (args && args.type === "object" && args.properties) {
      args = {};
    }
    const schema = [...TOOL_SCHEMAS, RUN_CODE_SCHEMA].find(
      (t) => t.function.name === name,
    );
    const props = Object.keys(schema?.function?.parameters?.properties || {});
    const out = { ...args };
    for (const k of Object.keys(out)) {
      const v = out[k];
      if (v && typeof v === "object" && v.type && v.description) delete out[k];
    }
    for (const p of props) {
      if (out[p] !== undefined && out[p] !== "") continue;
      for (const alt of ARG_ALIASES[p] || []) {
        if (args[alt] !== undefined && args[alt] !== "") {
          out[p] = args[alt];
          break;
        }
      }
    }
    // A single unnamed value: put it into the only required field.
    const required = schema?.function?.parameters?.required || [];
    if (required.length === 1 && out[required[0]] === undefined) {
      const vals = Object.values(args).filter(
        (v) => typeof v === "string" || typeof v === "number",
      );
      if (vals.length === 1) out[required[0]] = vals[0];
    }
    return out;
  }

  function resolveTool(rawName) {
    const n = String(rawName || "")
      .trim()
      .replace(/^functions?\./, "")
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (handlers[n]) return n;
    if (TOOL_ALIASES[n]) return TOOL_ALIASES[n];
    const squashed = n.replace(/_/g, "");
    return (
      Object.keys(handlers).find((h) => h.replace(/_/g, "") === squashed) ||
      TOOL_ALIASES[squashed] ||
      null
    );
  }

  async function executeTool(rawName, args = {}, meta = {}) {
    let name = resolveTool(rawName);
    if (!name) {
      return `Error: unknown tool ${rawName}. Use run_commands with simple commands like "walk to Steve"`;
    }
    let safeArgs = args && typeof args === "object" ? args : {};
    if (typeof args === "string") safeArgs = { commands: args };
    // Code is not allowed for this player: try it as plain commands.
    if (name === "run_code" && !canRunCode(meta.sender)) {
      name = "run_commands";
      safeArgs = { commands: safeArgs.code ?? safeArgs.commands ?? "" };
    }
    // go_to("Steve") / go_to({value:"Steve"}): a name, not coordinates.
    if (name === "go_to") {
      const nums = ["x", "z"].every(
        (k) =>
          safeArgs[k] !== undefined && Number.isFinite(Number(safeArgs[k])),
      );
      const who =
        safeArgs.player ?? safeArgs.value ?? safeArgs.name ?? safeArgs.target;
      if (
        !nums &&
        typeof who === "string" &&
        who.trim() &&
        !Number.isFinite(Number(who))
      ) {
        name = "come_to_player";
        safeArgs = { player: who.trim() };
      }
    }
    safeArgs = fixArgs(name, safeArgs);
    const handler = handlers[name];
    const argText = JSON.stringify(safeArgs);
    let background = BACKGROUND.has(name);
    if (name === "run_commands" || name === "run_code") {
      const bot = getBot();
      const text = String(safeArgs.commands ?? safeArgs.code ?? "");
      background = translate(text, {
        scripts: scripts.list(),
        sender: meta.sender,
        botName: bot?.username,
      }).long;
    }
    if (background) {
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
      return `Started ${name.replace(/_/g, " ")} in the background, you will get a report when it finishes`;
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
    bot._mcbpAiSeq = null;
  }

  // For the !do console command: runs plain commands directly, no AI.
  const runCommands = (text, sender) => runTranslated(text, sender);

  // Chat fast path: when a player's message already is a clear command
  // ("follow me", "jump twice then say gg"), run it without asking the
  // model. Returns null when the message needs the model.
  async function tryDirect(message, sender) {
    const bot = getBot();
    if (!bot?.entity) return null;
    let text = String(message || "").trim();
    const esc = String(bot.username || "").replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    if (esc) text = text.replace(new RegExp(`^@?${esc}[,:]?\\s*`, "i"), "");
    if (!text || text.length > 200) return null;
    // Long sentences are conversation, not orders.
    if (text.split(/\s+/).length > 10) return null;
    if (
      /\?\s*$/.test(text) ||
      /^(what|why|how|did|do|does|can|could|would|is|are|where|who|when|which|should|will|whats|what's)\b/i.test(
        text,
      )
    ) {
      return null;
    }
    const t = translate(text, {
      scripts: scripts.list(),
      sender,
      botName: bot.username,
    });
    if (!t.count || t.errors.length || t.needsCode) return null;
    // Following or looking at someone needs them to be online. ("go to
    // kitpvp" is fine: come_to_player joins it via the lobby menu.)
    const online = new Set(
      Object.keys(bot.players || {}).map((u) => u.toLowerCase()),
    );
    for (const st of t.steps) {
      const m = String(st.js || "").match(
        /^api\.(?:follow_player|look_at_player)\(\{ player: "([^"]*)" \}\)/,
      );
      if (m && !online.has(m[1].toLowerCase()) && !matchPlayerName(bot, m[1]))
        return null;
    }
    // Info commands need the model to word the answer.
    if (
      t.steps.some((st) =>
        /^api\.(get_status|read_logs|list_scripts)\(/.test(st.js || ""),
      )
    ) {
      return null;
    }
    const result = await executeTool(
      "run_commands",
      { commands: text },
      { sender },
    );
    return { ok: !/^Error:/.test(String(result)), result: String(result) };
  }

  return {
    schemas: TOOL_SCHEMAS,
    schemasFor,
    executeTool,
    stopAll,
    runCommands,
    resolveTool,
    tryDirect,
  };
}

module.exports = { createAiTools, TOOL_SCHEMAS, RUN_CODE_SCHEMA };
