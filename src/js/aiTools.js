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
  attachCraftingFix,
  cleanCraftingGrid,
  setBotControlOverride,
  diagnoseWalkingObstruction,
  performVerifiedJumpOrUnwedge,
  escapeHazardsAndObstructions,
  isLikelyNpcOrFakePlayer,
  isRealPlayerName,
} = require("./botUtils");
const { aiBrain } = require("./aiBrain");
const { runWithPathOwner } = require("./baritone");
const {
  craftItemByName,
  craftAnyPlanks,
  ensureCraftingTablePlaced,
  ensureSticksAndPlanks,
  placeBlockNearby,
  smeltInFurnace,
  smeltIronInFurnace,
  collectNearbyDropsAround,
} = require("./scripts/gearup");
const {
  translate,
  resolveScriptName,
  HELP: COMMANDS_HELP,
  VERB_LIST,
} = require("./commandTranslator");
const {
  COMPOSITE_SETS,
  resolveTargetItems,
  buildCraftingPlan,
} = require("./minecraftPlanner");

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
  fn(
    "craft_item",
    "Craft an item (e.g. wooden_pickaxe, stone_pickaxe, crafting_table, furnace, iron_pickaxe, stick, oak_planks), gathering wood/stone and placing a crafting table automatically if needed.",
    {
      item: str("Item id like wooden_pickaxe or crafting_table"),
      count: num("How many to craft (default 1)"),
    },
    ["item"],
  ),
  fn(
    "smelt_item",
    "Smelt ores into ingots (e.g. iron_ingot from raw_iron/iron_ore) in a furnace, mining ore/cobblestone and crafting a furnace if needed.",
    {
      item: str("Item to smelt or produce, e.g. iron_ingot"),
      count: num("How many ingots (default 1)"),
    },
    ["item"],
  ),
  fn("equip_best_gear", "Equip the best armor and weapon in the inventory."),
  fn("eat", "Eat the best available food."),
  fn(
    "toss_item",
    "Drop items from the inventory to give them to nearby players.",
    {
      item: str("Item id like bread or diamond, or category like food/pickaxe"),
      count: num("Amount, default all of that item"),
      player: str("Optional player username to walk to before dropping"),
    },
    ["item"],
  ),
  fn(
    "place_block",
    "Place a block from inventory onto a nearby surface (e.g. crafting_table, furnace, torch, chest, bed).",
    {
      block: str("Block/item id like crafting_table, furnace, torch, chest"),
    },
    ["block"],
  ),
  fn(
    "collect_drops",
    "Walk to and pick up nearby dropped items on the ground.",
  ),
  fn(
    "return_to_death",
    "Walk back to where the bot last died and pick up dropped items.",
  ),
  fn(
    "sleep_in_bed",
    "Find a nearby bed (or place one from inventory) and sleep / set respawn point.",
  ),
  fn(
    "unstuck",
    "Escape physical hazards (powder_snow, cobwebs, water, holes, obstructions), clean crafting grid, and recover movement.",
  ),
  fn(
    "create_plan",
    "Create and execute a step-by-step plan for a complex goal (e.g. 'make iron armor from scratch', 'stone tools', 'diamond gear') or an ordered list of semicolon-separated commands. Steps are queued and run one after another.",
    {
      goal: str("Goal like 'make iron armor from scratch' or 'stone tools'"),
      steps: str(
        "Optional semicolon-separated command steps to queue in order",
      ),
    },
  ),
  fn(
    "queue_task",
    "Queue one or more commands to start automatically after the currently running task or plan finishes.",
    {
      commands: str("Commands to queue, e.g. 'craft iron_sword; come to me'"),
    },
    ["commands"],
  ),
  fn(
    "get_queue",
    "Get the status of the active step-by-step plan and any queued tasks waiting to run.",
  ),
  fn(
    "hunt_food",
    "Find nearby food animals (cows, pigs, sheep, chickens) or crops, harvest/hunt them, collect drops, and cook raw meat.",
    {
      count: num("How many food animals/items to gather (default 3)"),
    },
  ),
  fn(
    "store_items",
    "Store items into a nearby chest or barrel (crafting and placing a chest if needed).",
    {
      item: str("Item id or 'all'"),
      count: num("Amount (optional)"),
    },
    ["item"],
  ),
  fn(
    "take_items",
    "Take items out of a nearby chest or barrel.",
    {
      item: str("Item id or 'all'"),
      count: num("Amount (optional)"),
    },
    ["item"],
  ),
  fn(
    "fill_bucket",
    "Fill an empty bucket with water or lava from a nearby source block.",
    {
      liquid: str("'water' or 'lava' (default 'water')"),
    },
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
  fn(
    "query_game_mechanics",
    "Look up Minecraft recipes, required pickaxe/tool tiers, smelting fuels, ore Y-levels, combat/dimension mechanics, remembered spatial landmarks, last death coords, and recent problem diagnoses.",
    {
      topic: str(
        "Item/block name or topic, e.g. 'iron_chestplate', 'smelting', 'diamond_ore', 'landmarks', 'errors'",
      ),
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
const BLOCKED_SCRIPTS = new Set(["aichat", "chatai", "aiagent"]);
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
  // Never matches the bot's own username or entities flagged as NPC / FakePlayer.
  const matchPlayerName = (bot, name) => {
    const wanted = String(name || "")
      .replace(/^@/, "")
      .toLowerCase();
    const botLower = String(bot.username || "").toLowerCase();
    if (!wanted || wanted === botLower) return null;
    const remembered = Array.from(bot._mcbpLastSeenPlayers?.values() || [])
      .map((v) => v?.username)
      .filter(Boolean);
    const names = [
      ...new Set([...Object.keys(bot.players || {}), ...remembered]),
    ].filter((u) => {
      if (!u || u.toLowerCase() === botLower) return false;
      const ent = bot.players?.[u]?.entity;
      if (ent && isLikelyNpcOrFakePlayer(bot, ent)) return false;
      return true;
    });
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
        key
          ? `${key} is too far away (out of view distance, coordinates unknown) — ask ${key} for their coordinates`
          : `${name} is not online`,
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
    logs: "oak_log",
    tree: "oak_log",
    trees: "oak_log",
    cobble: "cobblestone",
    diamond: "diamond_ore",
    diamonds: "diamond_ore",
    iron: "iron_ore",
    coal: "coal_ore",
    gold: "gold_ore",
    sword: "diamond_sword",
    pick: "wooden_pickaxe",
    pickaxe: "wooden_pickaxe",
    wood_pickaxe: "wooden_pickaxe",
    wood_pick: "wooden_pickaxe",
    wooden_pick: "wooden_pickaxe",
    stone_pick: "stone_pickaxe",
    iron_pick: "iron_pickaxe",
    diamond_pick: "diamond_pickaxe",
    wood_sword: "wooden_sword",
    wood_axe: "wooden_axe",
    wood_shovel: "wooden_shovel",
    table: "crafting_table",
    workbench: "crafting_table",
    planks: "oak_planks",
    plank: "oak_planks",
    sticks: "stick",
    ingot: "iron_ingot",
    ingots: "iron_ingot",
    ignot: "iron_ingot",
    ignots: "iron_ingot",
    iron_ignot: "iron_ingot",
    iron_ignots: "iron_ingot",
    iron_ingots: "iron_ingot",
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
    const inProtected = Boolean(
      bot._mcbpProtectedZoneUntil && Date.now() < bot._mcbpProtectedZoneUntil,
    );
    if (on && !inProtected) {
      configureSmartMovements(bot, mcData, Movements, {
        canDig: true,
        allowPillaring: false,
        allowBridging: false,
        allowParkour: true,
      });
    } else {
      configureSmartMovements(bot, mcData, Movements);
    }
    bot._mcbpAiHardMode = Boolean(on && !inProtected);
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
      busy: false,
      timer: null,
    };
    bot._mcbpAiWatch = w;
    const TICK = 1500;
    w.timer = setInterval(async () => {
      if (w.busy) return;
      if (getBot() !== bot || !bot.entity || bot.pathfinder.goal !== goal) {
        stopWatch(bot);
        return;
      }
      if (dynamic && goal.entity && goal.entity.isValid === false) {
        const fresh = bot.players?.[label]?.entity || null;
        if (fresh && fresh.isValid !== false && fresh.position) {
          goal.entity = fresh;
        } else {
          stopWatch(bot);
          return;
        }
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
      if (w.still < 5500) return;
      w.still = 0;
      w.attempt += 1;
      w.busy = true;
      try {
        const diag = diagnoseWalkingObstruction(bot);
        if (typeof bot.pathfinder.penalizeNode === "function" && bot.entity?.position) {
          bot.pathfinder.penalizeNode(bot.entity.position, 55);
        }
        if (w.attempt === 1) {
          log(
            `AIAgent: Stuck going to ${label} (${diag.summary}), jumping / un-wedging`,
          );
          await performVerifiedJumpOrUnwedge(bot, {
            log,
            reason: `AIAgent Stuck (${label})`,
          }).catch(() => {});
          if (getBot() === bot && bot.entity) {
            if (bot.pathfinder.goal === goal && typeof bot.pathfinder.repath === "function") {
              bot.pathfinder.repath();
            } else {
              bot.pathfinder.setGoal(goal, dynamic);
            }
          }
        } else if (w.attempt === 2) {
          log(
            `AIAgent: Still stuck going to ${label} (${diag.summary}), allowing block clearing`,
          );
          setHardMode(bot, true);
          if (bot.pathfinder.goal === goal && typeof bot.pathfinder.repath === "function") {
            bot.pathfinder.repath();
          } else {
            bot.pathfinder.setGoal(goal, dynamic);
          }
        } else if (w.attempt === 3) {
          log(
            `AIAgent: Backing off and strafing around obstacle toward ${label} (${diag.summary})`,
          );
          const side = Math.random() < 0.5 ? "left" : "right";
          clearPathfinderGoal(bot);
          setBotControlOverride(bot, {
            durationMs: 800,
            controls: {
              back: true,
              [side]: true,
              forward: false,
              jump: false,
              sprint: false,
            },
            yaw: bot.entity.yaw,
          });
          await sleep(830);
          if (getBot() === bot && bot.entity) {
            bot.pathfinder.setGoal(goal, dynamic);
          }
        } else {
          log(`AIAgent: Gave up going to ${label} (stuck at ${diag.summary})`);
          stopWatch(bot);
          clearPathfinderGoal(bot);
          onTaskDone({
            name: "move",
            ok: false,
            sender,
            result: `Stuck: could not reach ${label} (${diag.summary})`,
          });
        }
      } finally {
        w.busy = false;
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
    let activeGoal = goal;
    let verdict = pathVerdict(bot);
    bot.pathfinder.setGoal(activeGoal, dynamic);
    let status = await verdict;
    if (status === "noPath") {
      await escapeHazardsAndObstructions(bot, { log }).catch(() => {});
      setHardMode(bot, true);
      verdict = pathVerdict(bot);
      bot.pathfinder.setGoal(activeGoal, dynamic);
      status = await verdict;
      if (
        status === "noPath" &&
        !dynamic &&
        typeof goal?.x === "number" &&
        typeof goal?.z === "number"
      ) {
        // Long-distance waypoint fallback: step 24 blocks toward the target XZ
        const me = bot.entity.position;
        const dx = goal.x - me.x;
        const dz = goal.z - me.z;
        const horiz = Math.hypot(dx, dz);
        if (horiz > 22) {
          const { goals } = loadLibraries();
          const stepDist = Math.min(24, horiz * 0.5);
          const wx = Math.round(me.x + (dx / horiz) * stepDist);
          const wz = Math.round(me.z + (dz / horiz) * stepDist);
          activeGoal = new goals.GoalXZ(wx, wz);
          verdict = pathVerdict(bot);
          bot.pathfinder.setGoal(activeGoal, false);
          status = await verdict;
        }
      }
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
        goal: activeGoal,
        dynamic,
        label,
        sender,
        isFar:
          isFar || (() => !activeGoal.isEnd(bot.entity.position.floored())),
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
      const tierAliases = {
        wooden: "wood",
        wood_tools: "wood",
        wooden_tools: "wood",
        leather_armor: "leather",
        leather_wood: "leather",
        stone_tools: "stone",
        golden: "gold",
        golden_gear: "gold",
        gold_gear: "gold",
        full_iron: "iron",
        iron_armor: "iron",
        iron_gear: "iron",
        full_diamond: "diamond",
        diamond_armor: "diamond",
        diamond_gear: "diamond",
        best: "netherite",
      };
      const aliased = tierAliases[want] || want;
      const choice = (opt.choices || []).find((c) => {
        const cv = String(typeof c === "object" ? c.value : c).toLowerCase();
        const cl = String(
          typeof c === "object" ? c.label || c.value : c,
        ).toLowerCase();
        return (
          cv === want ||
          cl === want ||
          cv === aliased ||
          cl.includes(want) ||
          cl.includes(aliased)
        );
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

  // Sequential task & plan queue so complex multi-step goals ("make iron armor")
  // and queued tasks run one after another instead of overwriting each other.
  const queueState = {
    running: false,
    cancelled: false,
    planTitle: "",
    sender: "",
    current: null,
    pending: [],
    completed: [],
    total: 0,
  };

  function getQueueStatus() {
    if (!queueState.running && !queueState.pending.length) return "";
    const curIdx = queueState.completed.length + 1;
    const curLabel = queueState.current?.label || "starting";
    const nextPart = queueState.pending.length
      ? ` ➙ Next: ${queueState.pending
          .slice(0, 4)
          .map((s) => s.label)
          .join(
            " ➙ ",
          )}${queueState.pending.length > 4 ? ` (+${queueState.pending.length - 4} more)` : ""}`
      : "";
    return `Plan [${curIdx}/${queueState.total}]: ${curLabel}${nextPart}`;
  }

  function syncBrainPlan() {
    const bot = getBot();
    if (!queueState.running) {
      aiBrain.syncPlan({ goal: "Idle", currentStep: "", steps: [] }, bot);
      return;
    }
    const allSteps = [
      ...queueState.completed.map((c) => ({ label: c.label, status: "done" })),
      ...(queueState.current
        ? [{ label: queueState.current.label, status: "active" }]
        : []),
      ...queueState.pending.map((p) => ({ label: p.label, status: "pending" })),
    ];
    aiBrain.syncPlan(
      {
        goal: queueState.planTitle || "Task Plan",
        currentStep: queueState.current
          ? `[${queueState.current.index}/${queueState.total}] ${queueState.current.label}`
          : "",
        steps: allSteps,
      },
      bot,
    );
  }

  function clearTaskQueue() {
    queueState.cancelled = true;
    queueState.running = false;
    queueState.current = null;
    queueState.pending = [];
    const bot = getBot();
    if (bot) bot._mcbpActivePlanSummary = "";
    syncBrainPlan();
  }

  function enqueueSteps(
    steps,
    { planTitle = "Task Plan", sender = "Player" } = {},
  ) {
    if (!steps || !steps.length) return "Nothing to queue";
    requireBot();
    if (queueState.running) {
      queueState.pending.push(...steps);
      queueState.total += steps.length;
      syncBrainPlan();
      const labels = steps.map((s) => s.label).join(" ➙ ");
      log(
        `AIAgent Queue (+${steps.length}): Added [${labels}] after "${queueState.current?.label || "current task"}"`,
      );
      return `Queued ${steps.length} step(s) to start when "${queueState.current?.label || "current task"}" finishes: ${labels}`;
    }

    queueState.running = true;
    queueState.cancelled = false;
    queueState.planTitle = planTitle;
    queueState.sender = sender;
    queueState.completed = [];
    queueState.pending = [...steps];
    queueState.total = steps.length;
    aiBrain.setGoal(planTitle, sender, getBot());
    syncBrainPlan();

    const numbered = steps.map((s, i) => `${i + 1}. ${s.label}`).join(" ➙ ");
    if (steps.length > 1) {
      log(`AIAgent Plan (${steps.length} steps) ▸ ${numbered}`);
    } else {
      log(`AIAgent ▸ ${steps[0].label}`);
    }

    Promise.resolve()
      .then(async () => {
        while (queueState.pending.length > 0 && !queueState.cancelled) {
          const step = queueState.pending.shift();
          const idx = queueState.completed.length + 1;
          queueState.current = { ...step, index: idx };
          const bot = getBot();
          if (bot) {
            bot._mcbpActivePlanSummary = getQueueStatus();
          }
          syncBrainPlan();
          if (queueState.total > 1) {
            log(`AIAgent Plan [${idx}/${queueState.total}] ▸ ${step.label}`);
          }
          let res;
          try {
            inSequence = true;
            res = await step.run();
          } finally {
            inSequence = false;
          }
          if (queueState.cancelled) break;
          if (queueState.total > 1) {
            log(
              `AIAgent Plan [${idx}/${queueState.total}] ✓ ${String(res).split("\n")[0]}`,
            );
          }
          aiBrain.recordAction(step.tool, step.args, res, false, getBot());
          queueState.completed.push({
            label: step.label,
            tool: step.tool,
            args: step.args,
            result: String(res),
          });
          syncBrainPlan();
        }
        if (queueState.cancelled) return;
        const single =
          queueState.completed.length === 1 ? queueState.completed[0] : null;
        const doneSummary = single
          ? single.result
          : queueState.completed
              .map((c, i) => `${i + 1}. ${c.result}`)
              .join(" | ");
        const finalTitle = single?.tool || queueState.planTitle;
        const finalArgs = single?.args || {};
        const finalSender = queueState.sender;
        queueState.running = false;
        queueState.current = null;
        const bot = getBot();
        if (bot) bot._mcbpActivePlanSummary = "";
        syncBrainPlan();
        if (queueState.total > 1) {
          log(
            `AIAgent Plan ✓ Finished (${queueState.completed.length}/${queueState.total}): ${doneSummary.slice(0, 240)}`,
          );
        } else {
          log(`AIAgent ✓ ${doneSummary.slice(0, 240)}`);
        }
        onTaskDone({
          name: finalTitle,
          args: finalArgs,
          ok: true,
          result: doneSummary,
          sender: finalSender,
        });
      })
      .catch((err) => {
        if (queueState.cancelled) return;
        const msg = err.message || String(err);
        const failedStep = queueState.current;
        const finalSender = queueState.sender;
        aiBrain.recordAction(
          failedStep?.tool || planTitle,
          failedStep?.args || {},
          msg,
          true,
          getBot(),
        );
        log(
          `AIAgent Plan [${failedStep?.index || "?"}/${queueState.total}] failed (${failedStep?.label || planTitle}) → ${msg}`,
        );
        queueState.running = false;
        queueState.current = null;
        queueState.pending = [];
        const bot = getBot();
        if (bot) bot._mcbpActivePlanSummary = "";
        syncBrainPlan();
        onTaskDone({
          name: failedStep?.tool || planTitle,
          args: failedStep?.args || {},
          ok: false,
          result: msg,
          sender: finalSender,
        });
      });

    return steps.length > 1
      ? `Created & started ${steps.length}-step plan: ${numbered}`
      : `Started ${steps[0].label} in the background, you will get a report when it finishes`;
  }

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
        .filter(
          (pl) =>
            pl.entity &&
            pl.username !== bot.username &&
            !isLikelyNpcOrFakePlayer(bot, pl.entity),
        )
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
        `Active plan/queue: ${getQueueStatus() || "none"}`,
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
      const key = matchPlayerName(bot, wanted);
      const isOnline = Boolean(key);
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
      if (
        key &&
        !bot.players[key]?.entity &&
        bot._mcbpLastSeenPlayers?.has(key.toLowerCase())
      ) {
        const last = bot._mcbpLastSeenPlayers.get(key.toLowerCase());
        const { goals } = loadLibraries();
        const p = last.position;
        const dist = Math.round(p.distanceTo(bot.entity.position));
        await startMove(bot, new goals.GoalNear(p.x, p.y, p.z, 2), {
          label: key,
          sender,
        });
        return `Walking toward ${key}'s last known position (${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}, ${dist}m away)`;
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
        label: target.username || name,
        sender,
        isFar: () =>
          goal.entity &&
          goal.entity.isValid !== false &&
          goal.entity.position &&
          goal.entity.position.distanceTo(bot.entity.position) > 4,
      });
      bot._mcbpFollowState = { entityId: target.id, range: 2 };
      return `Following ${target.username || name}`;
    },

    stop() {
      const bot = requireBot();
      clearTaskQueue();
      stopWatch(bot);
      bot._mcbpAiTask = null;
      bot._mcbpControlOverride = null;
      if (!inSequence) bot._mcbpAiSeq = null;
      bot.clearControlStates();
      clearPathfinderGoal(bot);
      if (typeof bot.stopDigging === "function") {
        try {
          bot.stopDigging();
        } catch (_) {}
      }
      // Also stop active movement/combat/mining modules so "stop" or "stop hunting me" halts Hunt, Follow, GoTo, etc.
      const ACTION_SCRIPTS = [
        "Hunt",
        "Follow",
        "GoTo",
        "Guard",
        "GearUp",
        "Mine",
        "Excavator",
        "AutoBuild",
      ];
      const stoppedScripts = [];
      for (const s of ACTION_SCRIPTS) {
        if (scripts.active().includes(s)) {
          scripts.stop(s);
          stoppedScripts.push(s);
        }
      }
      return stoppedScripts.length
        ? `Stopped everything (turned off ${stoppedScripts.join(", ")}) and cleared task queue`
        : "Stopped everything and cleared task queue";
    },

    async look_at_player({ player }, { sender }) {
      const bot = requireBot();
      const target = findPlayer(bot, player || sender);
      await bot.lookAt(target.position.offset(0, target.height || 1.6, 0));
      return `Looking at ${player || sender}`;
    },

    async attack({ target }, { sender } = {}) {
      const bot = requireBot();
      const senderLower = String(sender || "").toLowerCase();
      const rawWanted = String(target || "")
        .replace(/^@/, "")
        .toLowerCase()
        .replace(/[_\s]+/g, " ")
        .trim();
      const isNpcTarget =
        /\bnpc\b/i.test(rawWanted) ||
        /\b(towny|smp|survival|lobby|hub|shop|crate|teleporter|portal)\b/i.test(
          rawWanted,
        );
      const wanted = rawWanted
        .replace(/\b(the|a|an|npc)\b/g, " ")
        .replace(/[_\s]+/g, " ")
        .trim();
      const wantedSlug = wanted.replace(/\s+/g, "_");
      const wantedTokens = wanted.split(" ").filter((t) => t.length >= 2);
      const extractEntityText = (e) => {
        const parts = [
          e.username,
          e.name,
          e.displayName,
          e.customName,
          typeof e.getCustomName === "function" ? e.getCustomName() : null,
        ];
        if (Array.isArray(e.metadata)) {
          for (const m of e.metadata) {
            if (!m) continue;
            if (typeof m === "string") parts.push(m);
            else if (typeof m === "object") {
              try {
                parts.push(JSON.stringify(m));
              } catch {}
            }
          }
        }
        return parts
          .filter(Boolean)
          .join(" ")
          .replace(/§[0-9a-fk-or]/gi, "")
          .toLowerCase();
      };
      const me = bot.entity.position;
      const allEntities = Object.values(bot.entities || {}).filter(
        (e) =>
          e &&
          e !== bot.entity &&
          e.position &&
          e.position.distanceTo(me) <= 36,
      );
      let candidates = allEntities.filter((e) => {
        if (rawWanted === "hostile" || wantedSlug === "hostile")
          return isHostile(e);
        if (e.type === "player") {
          const uname = String(e.username || "").toLowerCase();
          if (uname === rawWanted || uname === wantedSlug || uname === wanted)
            return true;
        }
        const resolved = resolveName(
          wantedSlug || rawWanted,
          bot.registry?.entitiesByName,
        );
        if (String(e.name || "").toLowerCase() === resolved) return true;
        if (wantedTokens.length > 0) {
          const text = extractEntityText(e);
          if (wantedTokens.every((tok) => text.includes(tok))) return true;
        }
        return false;
      });
      candidates.sort(
        (a, b) => a.position.distanceTo(me) - b.position.distanceTo(me),
      );
      let victim = candidates[0];
      // If we matched a floating hologram (armor_stand / text_display), resolve the clickable NPC entity underneath/at the same XZ
      if (
        victim &&
        /armor_stand|text_display/i.test(String(victim.name || ""))
      ) {
        const nearbyBody = allEntities
          .filter(
            (e) =>
              e !== victim &&
              (!senderLower ||
                String(e.username || "").toLowerCase() !== senderLower) &&
              !/armor_stand|text_display|item/i.test(String(e.name || "")) &&
              Math.abs(e.position.x - victim.position.x) <= 1.75 &&
              Math.abs(e.position.z - victim.position.z) <= 1.75 &&
              Math.abs(e.position.y - victim.position.y) <= 3.5,
          )
          .sort((a, b) => {
            const dXZ =
              Math.hypot(
                a.position.x - victim.position.x,
                a.position.z - victim.position.z,
              ) -
              Math.hypot(
                b.position.x - victim.position.x,
                b.position.z - victim.position.z,
              );
            if (Math.abs(dXZ) > 0.1) return dXZ;
            return (
              a.position.distanceTo(victim.position) -
              b.position.distanceTo(victim.position)
            );
          })[0];
        if (nearbyBody) victim = nearbyBody;
      }
      // Fallback for lobby NPCs when hologram text is stored in unparsed packets: pick nearest non-self player/villager/interaction NPC
      if (!victim && isNpcTarget) {
        victim = allEntities
          .filter(
            (e) =>
              (!senderLower ||
                String(e.username || "").toLowerCase() !== senderLower) &&
              (e.type === "player" ||
                /villager|interaction|mannequin|npc/i.test(
                  String(e.name || ""),
                )),
          )
          .sort(
            (a, b) => a.position.distanceTo(me) - b.position.distanceTo(me),
          )[0];
      }
      if (!victim) throw new Error(`No ${target} within 24 blocks`);
      stopWatch(bot);
      const task = {};
      bot._mcbpAiTask = task;
      if (!isNpcTarget) {
        await equipBestWeapon(bot, { saveLowDurability: true }).catch(() => {});
      }
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
        Date.now() - started < (isNpcTarget ? 10000 : 20000) &&
        !deniedNow()
      ) {
        if (victim.position.distanceTo(bot.entity.position) <= 3.5) {
          await bot.lookAt(
            victim.position.offset(0, (victim.height || 1.6) * 0.85, 0),
            true,
          );
          bot.attack(victim);
          if (isNpcTarget && typeof bot.activateEntity === "function") {
            await bot.activateEntity(victim).catch(() => {});
          }
          hits += 1;
          if (isNpcTarget) break;
        }
        await sleep(600);
      }
      const cancelled = getBot() !== bot || bot._mcbpAiTask !== task;
      if (!cancelled) {
        bot._mcbpAiTask = null;
        clearPathfinderGoal(bot);
      }
      const label = victim.username || victim.name;
      if (isNpcTarget && hits > 0) {
        return `Clicked NPC ${label}`;
      }
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
      const blocksByName = bot.registry?.blocksByName || {};

      // Auto-resolve required pickaxe tier before mining stone/ores so drops aren't lost
      const hasPickAtLeast = (minTier) => {
        const order = [
          "wooden_pickaxe",
          "golden_pickaxe",
          "stone_pickaxe",
          "iron_pickaxe",
          "diamond_pickaxe",
          "netherite_pickaxe",
        ];
        const minIdx = order.indexOf(minTier);
        return bot.inventory
          .items()
          .some((i) => order.indexOf(i.name) >= minIdx);
      };
      if (
        (name === "stone" ||
          name === "cobblestone" ||
          name === "deepslate" ||
          name === "cobbled_deepslate" ||
          name === "coal_ore" ||
          name === "deepslate_coal_ore") &&
        !hasPickAtLeast("wooden_pickaxe")
      ) {
        log(
          `AIAgent: Need wooden_pickaxe before mining ${name}, crafting one first...`,
        );
        await handlers
          .craft_item({ item: "wooden_pickaxe", count: 1 })
          .catch(() => {});
      } else if (
        (name === "iron_ore" ||
          name === "deepslate_iron_ore" ||
          name === "copper_ore" ||
          name === "deepslate_copper_ore" ||
          name === "lapis_ore" ||
          name === "deepslate_lapis_ore") &&
        !hasPickAtLeast("stone_pickaxe")
      ) {
        log(
          `AIAgent: Need stone_pickaxe before mining ${name}, crafting one first...`,
        );
        await handlers
          .craft_item({ item: "stone_pickaxe", count: 1 })
          .catch(() => {});
      } else if (
        (name === "diamond_ore" ||
          name === "deepslate_diamond_ore" ||
          name === "gold_ore" ||
          name === "deepslate_gold_ore" ||
          name === "redstone_ore" ||
          name === "emerald_ore") &&
        !hasPickAtLeast("iron_pickaxe")
      ) {
        log(
          `AIAgent: Need iron_pickaxe before mining ${name}, crafting one first...`,
        );
        await handlers
          .craft_item({ item: "iron_pickaxe", count: 1 })
          .catch(() => {});
      }

      const idsFor = (names) =>
        names
          .map((n) => blocksByName[n]?.id)
          .filter((id) => typeof id === "number");
      let matchIds = [blockType.id];
      if (name === "cobblestone" || name === "stone") {
        matchIds = idsFor([
          "stone",
          "cobblestone",
          "deepslate",
          "cobbled_deepslate",
        ]);
      } else if (name.endsWith("_ore") && !name.startsWith("deepslate_")) {
        matchIds = idsFor([name, `deepslate_${name}`]);
      } else if (name.endsWith("_log")) {
        const allLogs = idsFor([
          name,
          "oak_log",
          "birch_log",
          "spruce_log",
          "jungle_log",
          "acacia_log",
          "dark_oak_log",
          "cherry_log",
          "mangrove_log",
          "pale_oak_log",
        ]);
        if (
          /^(wood|logs?|trees?)$/i.test(String(block || "").trim()) ||
          !bot.findBlock({ matching: blockType.id, maxDistance: 64 })
        ) {
          matchIds = [...new Set(allLogs)];
        }
      }
      const matchSet = new Set(matchIds);
      stopWatch(bot);
      const task = {};
      bot._mcbpAiTask = task;
      const failed = new Set();
      const key = (p) => `${p.x},${p.y},${p.z}`;
      const colKey = (p) => `col:${p.x},${p.z}`;
      const isValidCandidate = (p) =>
        !failed.has(key(p)) &&
        !failed.has(colKey(p)) &&
        !bot._mcbpProtectedBlocks?.has(key(p));
      let mined = 0;
      let fails = 0;
      let explored = false;
      let denied = "";
      let lastError = "";
      try {
        while (mined < amount && fails < 4) {
          if (getBot() !== bot || bot._mcbpAiTask !== task) break;
          let positions = bot.findBlocks({
            matching: matchIds,
            maxDistance: 64,
            count: 48,
          });
          let pos = positions.find(isValidCandidate);
          if (!pos && !explored) {
            explored = true;
            log(`AIAgent: No ${name} nearby, exploring 20m to search...`);
            const me = bot.entity.position;
            const angle = Math.random() * Math.PI * 2;
            const ex = Math.round(me.x + Math.cos(angle) * 20);
            const ez = Math.round(me.z + Math.sin(angle) * 20);
            await withTimeout(
              bot.pathfinder.goto(new goals.GoalXZ(ex, ez)),
              8000,
              () => bot.pathfinder.setGoal(null),
            ).catch(() => {});
            positions = bot.findBlocks({
              matching: matchIds,
              maxDistance: 64,
              count: 48,
            });
            pos = positions.find(isValidCandidate);
          }
          if (!pos) {
            lastError = `no more reachable ${name} within 64 blocks`;
            break;
          }
          try {
            // Walk to 1 block distance from the block before mining so drops in caves don't get stuck behind walls
            await withTimeout(
              bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 1)),
              18000,
              () => bot.pathfinder.setGoal(null),
            ).catch(async () => {
              await withTimeout(
                bot.pathfinder.goto(
                  new goals.GoalLookAtBlock(pos, bot.world, { reach: 3 }),
                ),
                12000,
                () => bot.pathfinder.setGoal(null),
              );
            });
            const target = bot.blockAt(pos);
            if (!target || !matchSet.has(target.type)) continue;
            const digStart = Date.now();
            let ok = false;
            for (let pass = 0; pass < 3; pass++) {
              const liveBlk = bot.blockAt(pos);
              if (!liveBlk || !matchSet.has(liveBlk.type)) {
                ok = true;
                break;
              }
              ok = await smartDig(bot, liveBlk, { autoTool: true });
              await sleep(180);
              if (bot._mcbpDenied && bot._mcbpDenied.at >= digStart) {
                denied = bot._mcbpDenied.text;
                break;
              }
              if (ok === false) break;
              const afterBlk = bot.blockAt(pos);
              if (!afterBlk || !matchSet.has(afterBlk.type)) {
                ok = true;
                break;
              }
              // Dug an intervening blocker in front of the ore — step within 1 block
              await withTimeout(
                bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 1)),
                3500,
                () => bot.pathfinder.setGoal(null),
              ).catch(() => {});
            }
            if (denied) break;
            if (ok === false) throw new Error("dig was interrupted");
            mined += 1;
            // Step onto the spot and sweep nearby dropped item entities within 5.5m
            await collectNearbyDropsAround(bot, goals, pos, 1500).catch(
              () => {},
            );
          } catch (err) {
            failed.add(key(pos));
            failed.add(colKey(pos));
            fails += 1;
            lastError = err.message || String(err);
            await escapeHazardsAndObstructions(bot, { log }).catch(() => {});
            // Blocked twice: let the pathfinder clear obstructing blocks.
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

    async craft_item({ item, count }) {
      const bot = requireBot();
      attachCraftingFix(bot);
      await cleanCraftingGrid(bot);
      const rawId = itemId(item);
      const CRAFT_MAP = {
        iron: "iron_ingot",
        iron_ingot: "iron_ingot",
        iron_ingots: "iron_ingot",
        iron_ignot: "iron_ingot",
        iron_ignots: "iron_ingot",
        ingot: "iron_ingot",
        ingots: "iron_ingot",
        ignot: "iron_ingot",
        ignots: "iron_ingot",
        pickaxe: "wooden_pickaxe",
        pick: "wooden_pickaxe",
        wood_pickaxe: "wooden_pickaxe",
        wood_pick: "wooden_pickaxe",
        wooden_pick: "wooden_pickaxe",
        stone_pick: "stone_pickaxe",
        iron_pick: "iron_pickaxe",
        diamond_pick: "diamond_pickaxe",
        wood_sword: "wooden_sword",
        wood_axe: "wooden_axe",
        wood_shovel: "wooden_shovel",
        table: "crafting_table",
        workbench: "crafting_table",
        planks: "oak_planks",
        plank: "oak_planks",
        sticks: "stick",
      };
      const mapped =
        CRAFT_MAP[rawId] || resolveName(item, bot.registry?.itemsByName);
      const amount = Math.max(1, Math.min(32, Math.floor(Number(count) || 1)));
      if (mapped === "iron_ingot") {
        return handlers.smelt_item({ item: "iron_ingot", count: amount });
      }
      // Composite set (e.g. "iron_armor", "stone_tools", "diamond_gear", "starter_kit")
      const compositeTargets = resolveTargetItems(rawId, amount);
      if (
        (compositeTargets &&
          compositeTargets.length > 1 &&
          COMPOSITE_SETS[rawId]) ||
        (compositeTargets && !bot.registry?.itemsByName?.[mapped])
      ) {
        const plan = buildCraftingPlan(bot, compositeTargets, amount);
        if (plan && plan.length > 0) {
          log(
            `AIAgent Plan for ${rawId} (${plan.length} steps): ${plan.map((s, i) => `${i + 1}. ${s.label}`).join(" ➙ ")}`,
          );
          const done = [];
          for (let i = 0; i < plan.length; i++) {
            const st = plan[i];
            log(`AIAgent Plan [${i + 1}/${plan.length}]: ${st.label}...`);
            const res = await handlers[st.tool](st.args, { sender: "Player" });
            done.push(`${i + 1}. ${res}`);
          }
          return `Completed ${rawId} plan (${plan.length} steps): ${done.join(" | ")}`;
        }
      }
      const itemType = bot.registry?.itemsByName?.[mapped];
      if (!itemType) {
        throw new Error(
          `Unknown craftable item "${item}". Use an item id like wooden_pickaxe, crafting_table, stick`,
        );
      }
      const { goals } = loadLibraries();
      const stepLog = (msg) => log(`AIAgent: ${msg}`);

      if (mapped.endsWith("_planks")) {
        const hasLogs = bot.inventory
          .items()
          .some((i) => i.name.endsWith("_log") || i.name.endsWith("_stem"));
        if (!hasLogs) {
          await handlers.mine_block({ block: "oak_log", count: 2 });
        }
        let crafted = 0;
        for (let i = 0; i < amount; i++) {
          if (await craftAnyPlanks(bot)) crafted += 4;
          else break;
        }
        if (!crafted) throw new Error("No logs in inventory to craft planks");
        return `Crafted ${crafted} planks`;
      }

      // Gather wood/sticks automatically when crafting wood/stone/iron tools or tables
      const totalWood =
        bot.inventory
          .items()
          .filter((i) => i.name.endsWith("_log"))
          .reduce((s, i) => s + i.count * 4, 0) +
        bot.inventory
          .items()
          .filter((i) => i.name.endsWith("_planks"))
          .reduce((s, i) => s + i.count, 0);
      if (
        totalWood < 8 &&
        !bot.recipesFor(itemType.id, null, 1, null)?.length
      ) {
        await handlers
          .mine_block({ block: "oak_log", count: 3 })
          .catch(() => {});
      }

      if (mapped === "stick") {
        await ensureSticksAndPlanks(bot, amount * 4, 2, stepLog);
        return `Crafted sticks (now have ${bot.inventory
          .items()
          .filter((i) => i.name === "stick")
          .reduce((s, i) => s + i.count, 0)})`;
      }

      if (mapped === "crafting_table") {
        const existingTable = bot.findBlock({
          matching: (b) => b && b.name === "crafting_table",
          maxDistance: 36,
        });
        if (existingTable) {
          aiBrain.recordLandmark(
            "crafting_table",
            existingTable.position,
            "Crafting Table",
            bot,
          );
          return `Found existing crafting_table nearby at (${existingTable.position.x}, ${existingTable.position.y}, ${existingTable.position.z})`;
        }
        await ensureSticksAndPlanks(bot, 0, 4, stepLog);
        const ok = await craftItemByName(bot, "crafting_table", amount, null);
        if (!ok) throw new Error("Need 4 planks to craft a crafting_table");
        return `Crafted ${amount}x crafting_table`;
      }

      if (mapped === "furnace" && amount === 1) {
        const existingFurnace = bot.findBlock({
          matching: (b) =>
            b && (b.name === "furnace" || b.name === "blast_furnace"),
          maxDistance: 36,
        });
        if (existingFurnace) {
          aiBrain.recordLandmark(
            "furnace",
            existingFurnace.position,
            "Furnace",
            bot,
          );
          return `Found existing ${existingFurnace.name} nearby at (${existingFurnace.position.x}, ${existingFurnace.position.y}, ${existingFurnace.position.z})`;
        }
      }

      if (mapped.startsWith("stone_") || mapped === "furnace") {
        const neededCobble = mapped === "furnace" ? 8 : 3;
        const haveCobble = bot.inventory
          .items()
          .filter(
            (i) =>
              i.name === "cobblestone" ||
              i.name === "cobbled_deepslate" ||
              i.name === "blackstone",
          )
          .reduce((s, i) => s + i.count, 0);
        if (haveCobble < neededCobble) {
          const hasPick = bot.inventory
            .items()
            .some((i) => i.name.endsWith("_pickaxe"));
          if (!hasPick) {
            const remainingWood =
              bot.inventory
                .items()
                .filter((i) => i.name.endsWith("_log"))
                .reduce((s, i) => s + i.count * 4, 0) +
              bot.inventory
                .items()
                .filter((i) => i.name.endsWith("_planks"))
                .reduce((s, i) => s + i.count, 0);
            const remainingSticks = bot.inventory
              .items()
              .filter((i) => i.name === "stick")
              .reduce((s, i) => s + i.count, 0);
            if (remainingWood < 4 && remainingSticks < 2) {
              await handlers
                .mine_block({ block: "oak_log", count: 2 })
                .catch(() => {});
            }

            await ensureSticksAndPlanks(bot, 4, 6, stepLog);
            const t = await ensureCraftingTablePlaced(bot, goals, stepLog);
            if (t) await craftItemByName(bot, "wooden_pickaxe", 1, t);
          }
          await handlers.mine_block({
            block: "stone",
            count: neededCobble - haveCobble,
          });
        }
      }

      // Auto-smelt iron_ingot when crafting iron gear/tools/shield/bucket
      const IRON_COSTS = {
        iron_pickaxe: 3,
        iron_axe: 3,
        iron_sword: 2,
        iron_shovel: 1,
        iron_hoe: 2,
        iron_helmet: 5,
        iron_chestplate: 8,
        iron_leggings: 7,
        iron_boots: 4,
        shield: 1,
        bucket: 3,
        shears: 2,
      };
      if (IRON_COSTS[mapped]) {
        const neededIron = IRON_COSTS[mapped] * amount;
        const haveIron = bot.inventory
          .items()
          .filter((i) => i.name === "iron_ingot")
          .reduce((s, i) => s + i.count, 0);
        if (haveIron < neededIron) {
          await handlers
            .smelt_item({ item: "iron_ingot", count: neededIron - haveIron })
            .catch(() => {});
        }
      }

      const remainingWood =
        bot.inventory
          .items()
          .filter((i) => i.name.endsWith("_log"))
          .reduce((s, i) => s + i.count * 4, 0) +
        bot.inventory
          .items()
          .filter((i) => i.name.endsWith("_planks"))
          .reduce((s, i) => s + i.count, 0);
      const remainingSticks = bot.inventory
        .items()
        .filter((i) => i.name === "stick")
        .reduce((s, i) => s + i.count, 0);
      if (remainingWood < 4 && remainingSticks < 2) {
        await handlers
          .mine_block({ block: "oak_log", count: 2 })
          .catch(() => {});
      }

      await ensureSticksAndPlanks(bot, 4, 6, stepLog);
      if (await craftItemByName(bot, mapped, amount, null)) {
        await equipBestArmor(bot, { includeOffhand: true });
        await equipBestWeapon(bot, { saveLowDurability: true });
        return `Crafted ${amount}x ${mapped}`;
      }

      const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
      if (!table) {
        throw new Error(
          `Could not place a crafting_table to craft ${mapped} (need wood/planks)`,
        );
      }
      await ensureSticksAndPlanks(bot, 4, 4, stepLog);
      const ok = await craftItemByName(bot, mapped, amount, table);
      if (!ok) {
        throw new Error(
          `Missing ingredients to craft ${mapped} (check inventory with get_status)`,
        );
      }
      await equipBestArmor(bot, { includeOffhand: true });
      await equipBestWeapon(bot, { saveLowDurability: true });
      return `Crafted ${amount}x ${mapped}`;
    },

    async smelt_item({ item, count }) {
      const bot = requireBot();
      attachCraftingFix(bot);
      await cleanCraftingGrid(bot);
      const amount = Math.max(1, Math.min(32, Math.floor(Number(count) || 1)));
      const { goals } = loadLibraries();
      const stepLog = (msg) => log(`AIAgent: ${msg}`);

      const rawKey = itemId(item || "iron_ingot");
      const SMELT_RECIPES = {
        gold: {
          inputNames: ["raw_gold", "gold_ore", "deepslate_gold_ore"],
          outputName: "gold_ingot",
          mineBlock: "gold_ore",
        },
        gold_ingot: {
          inputNames: ["raw_gold", "gold_ore", "deepslate_gold_ore"],
          outputName: "gold_ingot",
          mineBlock: "gold_ore",
        },
        raw_gold: {
          inputNames: ["raw_gold", "gold_ore", "deepslate_gold_ore"],
          outputName: "gold_ingot",
          mineBlock: "gold_ore",
        },
        copper: {
          inputNames: ["raw_copper", "copper_ore", "deepslate_copper_ore"],
          outputName: "copper_ingot",
          mineBlock: "copper_ore",
        },
        copper_ingot: {
          inputNames: ["raw_copper", "copper_ore", "deepslate_copper_ore"],
          outputName: "copper_ingot",
          mineBlock: "copper_ore",
        },
        glass: {
          inputNames: ["sand", "red_sand"],
          outputName: "glass",
          mineBlock: "sand",
        },
        sand: {
          inputNames: ["sand", "red_sand"],
          outputName: "glass",
          mineBlock: "sand",
        },
        stone: {
          inputNames: ["cobblestone"],
          outputName: "stone",
          mineBlock: "cobblestone",
        },
        charcoal: {
          inputNames: [
            "oak_log",
            "birch_log",
            "spruce_log",
            "jungle_log",
            "acacia_log",
            "dark_oak_log",
            "cherry_log",
            "mangrove_log",
            "pale_oak_log",
          ],
          outputName: "charcoal",
          mineBlock: "oak_log",
        },
        beef: {
          inputNames: ["beef"],
          outputName: "cooked_beef",
        },
        cooked_beef: {
          inputNames: ["beef"],
          outputName: "cooked_beef",
        },
        steak: {
          inputNames: ["beef"],
          outputName: "cooked_beef",
        },
        porkchop: {
          inputNames: ["porkchop"],
          outputName: "cooked_porkchop",
        },
        cooked_porkchop: {
          inputNames: ["porkchop"],
          outputName: "cooked_porkchop",
        },
        chicken: {
          inputNames: ["chicken"],
          outputName: "cooked_chicken",
        },
        cooked_chicken: {
          inputNames: ["chicken"],
          outputName: "cooked_chicken",
        },
        mutton: {
          inputNames: ["mutton"],
          outputName: "cooked_mutton",
        },
        cooked_mutton: {
          inputNames: ["mutton"],
          outputName: "cooked_mutton",
        },
        potato: {
          inputNames: ["potato"],
          outputName: "baked_potato",
        },
        baked_potato: {
          inputNames: ["potato"],
          outputName: "baked_potato",
        },
      };

      const spec = SMELT_RECIPES[rawKey] || {
        inputNames: ["raw_iron", "iron_ore", "deepslate_iron_ore"],
        outputName: "iron_ingot",
        mineBlock: "iron_ore",
      };

      const countInput = () =>
        bot.inventory
          .items()
          .filter((i) => spec.inputNames.includes(i.name))
          .reduce((s, i) => s + i.count, 0);

      if (countInput() < amount && spec.mineBlock) {
        await handlers.mine_block({
          block: spec.mineBlock,
          count: amount - countInput(),
        });
      }

      const haveCobble = bot.inventory
        .items()
        .filter(
          (i) =>
            i.name === "cobblestone" ||
            i.name === "cobbled_deepslate" ||
            i.name === "blackstone",
        )
        .reduce((s, i) => s + i.count, 0);
      const hasFurnace =
        bot.inventory.items().some((i) => i.name === "furnace") ||
        Boolean(
          bot.findBlock({
            matching: [
              bot.registry?.blocksByName?.furnace?.id,
              bot.registry?.blocksByName?.blast_furnace?.id,
            ].filter(Boolean),
            maxDistance: 6,
          }),
        );
      if (!hasFurnace && haveCobble < 8) {
        await handlers
          .mine_block({ block: "stone", count: 8 - haveCobble })
          .catch(() => {});
      }

      // Ensure fuel (coal, charcoal, planks, or logs)
      const hasFuel = bot.inventory
        .items()
        .some(
          (i) =>
            i.name === "coal" ||
            i.name === "charcoal" ||
            i.name.endsWith("_planks") ||
            i.name.endsWith("_log"),
        );
      if (!hasFuel) {
        await handlers
          .mine_block({ block: "oak_log", count: 2 })
          .catch(() => {});
        await craftAnyPlanks(bot).catch(() => {});
      }

      const ok = await smeltInFurnace(bot, goals, {
        inputNames: spec.inputNames,
        outputName: spec.outputName,
        neededCount: amount,
        stepLog,
      });
      const totalOut = bot.inventory
        .items()
        .filter((i) => i.name === spec.outputName)
        .reduce((s, i) => s + i.count, 0);
      if (!ok && totalOut === 0) {
        throw new Error(
          `Could not smelt ${spec.outputName} (need ${spec.inputNames[0]}, furnace and fuel)`,
        );
      }
      return `Smelted ${spec.outputName} (now have ${totalOut} ${spec.outputName})`;
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

    async toss_item({ item, count, player }, { sender }) {
      const bot = requireBot();
      const raw = itemId(item);
      const name = resolveName(item, bot.registry?.itemsByName);
      const inv = bot.inventory.items();
      let stacks = inv.filter((i) => i.name === name);
      if (!stacks.length) {
        // Category match: "food", "pickaxe", "sword", "axe", "wood", "logs", "planks", "cobble"
        if (raw === "food") {
          const best = findBestFood(bot);
          if (best) stacks = inv.filter((i) => i.name === best.name);
        } else if (raw === "pickaxe" || raw === "pick") {
          stacks = inv.filter((i) => i.name.endsWith("_pickaxe"));
        } else if (raw === "sword" || raw === "weapon") {
          stacks = inv.filter((i) => i.name.endsWith("_sword"));
        } else if (raw === "axe") {
          stacks = inv.filter((i) => i.name.endsWith("_axe"));
        } else if (raw === "wood" || raw === "log" || raw === "logs") {
          stacks = inv.filter((i) => i.name.endsWith("_log"));
        } else if (raw === "planks" || raw === "plank") {
          stacks = inv.filter((i) => i.name.endsWith("_planks"));
        } else {
          stacks = inv.filter((i) => i.name.includes(raw));
        }
      }
      if (!stacks.length) throw new Error(`No ${name} in inventory`);
      const targetWho = matchPlayerName(bot, player || sender) || sender;
      const receiver = bot.players[targetWho]?.entity;
      if (receiver && receiver.position) {
        const d = receiver.position.distanceTo(bot.entity.position);
        if (d > 3.5 && d <= 28) {
          const { goals } = loadLibraries();
          await withTimeout(
            bot.pathfinder.goto(
              new goals.GoalNear(
                receiver.position.x,
                receiver.position.y,
                receiver.position.z,
                2.5,
              ),
            ),
            7000,
            () => clearPathfinderGoal(bot),
          ).catch(() => {});
        }
        await bot.lookAt(receiver.position.offset(0, 1.4, 0), true);
      }
      const dropLabel = stacks[0].name;
      let left = Number(count) > 0 ? Math.floor(Number(count)) : Infinity;
      let tossed = 0;
      for (const stack of stacks) {
        if (left <= 0) break;
        const n = Math.min(stack.count, left);
        await bot.toss(stack.type, stack.metadata, n);
        tossed += n;
        left -= n;
      }
      return `Dropped ${tossed} ${dropLabel}${receiver ? ` to ${targetWho}` : ""}`;
    },

    async place_block({ block }) {
      const bot = requireBot();
      const raw = itemId(block);
      const name = resolveName(block, bot.registry?.itemsByName);
      const { goals } = loadLibraries();
      const stepLog = (m) => log(`AIAgent: ${m}`);
      if (name === "crafting_table") {
        const table = await ensureCraftingTablePlaced(bot, goals, stepLog);
        if (!table) {
          throw new Error(
            "Could not find or place a crafting_table (need wood/planks)",
          );
        }
        return `Crafting table ready at (${table.position.x}, ${table.position.y}, ${table.position.z})`;
      }
      if (name === "furnace" || name === "blast_furnace") {
        const existingFurnace = bot.findBlock({
          matching: (b) =>
            b && (b.name === "furnace" || b.name === "blast_furnace"),
          maxDistance: 32,
        });
        if (existingFurnace) {
          aiBrain.recordLandmark(
            "furnace",
            existingFurnace.position,
            "Furnace",
            bot,
          );
          if (existingFurnace.position.distanceTo(bot.entity.position) > 2.6) {
            await withTimeout(
              bot.pathfinder.goto(
                new goals.GoalNear(
                  existingFurnace.position.x,
                  existingFurnace.position.y,
                  existingFurnace.position.z,
                  1,
                ),
              ),
              6000,
              () => clearPathfinderGoal(bot),
            ).catch(() => {});
          }
          return `Using existing ${existingFurnace.name} at (${existingFurnace.position.x}, ${existingFurnace.position.y}, ${existingFurnace.position.z})`;
        }
      }
      let invItem =
        bot.inventory.items().find((i) => i.name === name) ||
        bot.inventory.items().find((i) => i.name.includes(raw));
      if (
        !invItem &&
        (name === "crafting_table" || name === "furnace" || name === "chest")
      ) {
        await handlers.craft_item({ item: name, count: 1 });
        invItem = bot.inventory.items().find((i) => i.name === name);
      }
      if (!invItem) throw new Error(`No ${name} in inventory to place`);
      const ok = await placeBlockNearby(bot, invItem, invItem.name, stepLog);
      if (!ok)
        throw new Error(
          `Could not find a clear spot nearby to place ${invItem.name}`,
        );
      return `Placed ${invItem.name}`;
    },

    async collect_drops() {
      const bot = requireBot();
      const { goals } = loadLibraries();
      let collected = 0;
      for (let i = 0; i < 8; i++) {
        const me = bot.entity.position;
        const drops = Object.values(bot.entities || {})
          .filter(
            (e) =>
              e &&
              e.position &&
              (e.name === "item" ||
                e.displayName === "Item" ||
                e.objectType === "Item") &&
              e.position.distanceTo(me) <= 18,
          )
          .sort(
            (a, b) => a.position.distanceTo(me) - b.position.distanceTo(me),
          );
        if (!drops.length) break;
        const drop = drops[0];
        await withTimeout(
          bot.pathfinder.goto(
            new goals.GoalNear(
              drop.position.x,
              drop.position.y,
              drop.position.z,
              1,
            ),
          ),
          5000,
          () => clearPathfinderGoal(bot),
        ).catch(() => {});
        await sleep(250);
        collected += 1;
      }
      return collected
        ? `Collected ${collected} nearby item drop(s)`
        : "No dropped items within 18 blocks";
    },

    async return_to_death({ sender } = {}) {
      const bot = requireBot();
      const death = bot._mcbpLastDeath;
      if (!death || !death.position) {
        throw new Error("No recorded death location in this session");
      }
      const p = death.position;
      const { goals } = loadLibraries();
      const label = `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`;
      await startMove(bot, new goals.GoalNear(p.x, p.y, p.z, 2), {
        label: `death point (${label})`,
        sender,
      });
      return `Walking back to death location (${label})`;
    },

    async sleep_in_bed() {
      const bot = requireBot();
      const { goals } = loadLibraries();
      let bedBlock = bot.findBlock({
        matching: (b) => b && b.name && b.name.endsWith("_bed"),
        maxDistance: 24,
      });
      if (!bedBlock) {
        const bedItem = bot.inventory
          .items()
          .find((i) => i.name.endsWith("_bed"));
        if (bedItem) {
          await placeBlockNearby(bot, bedItem, bedItem.name, (m) =>
            log(`AIAgent: ${m}`),
          );
          bedBlock = bot.findBlock({
            matching: (b) => b && b.name && b.name.endsWith("_bed"),
            maxDistance: 8,
          });
        }
      }
      if (!bedBlock) throw new Error("No bed nearby or in inventory");
      if (bedBlock.position.distanceTo(bot.entity.position) > 3.5) {
        await withTimeout(
          bot.pathfinder.goto(
            new goals.GoalNear(
              bedBlock.position.x,
              bedBlock.position.y,
              bedBlock.position.z,
              2,
            ),
          ),
          8000,
          () => clearPathfinderGoal(bot),
        ).catch(() => {});
      }
      try {
        await bot.sleep(bedBlock);
        return `Sleeping in ${bedBlock.name}`;
      } catch (err) {
        await bot.activateBlock(bedBlock).catch(() => {});
        return `Set respawn point at ${bedBlock.name} (${err.message || "daytime"})`;
      }
    },

    async unstuck() {
      const bot = requireBot();
      stopWatch(bot);
      clearPathfinderGoal(bot);
      if (bot.currentWindow) {
        try {
          bot.closeWindow(bot.currentWindow);
        } catch (_) {}
      }
      const recovered = await escapeHazardsAndObstructions(bot, { log });
      bot.setControlState("jump", true);
      bot.setControlState("forward", true);
      await sleep(450);
      bot.setControlState("jump", false);
      bot.setControlState("forward", false);
      return recovered
        ? `Recovered: ${recovered}`
        : "Cleared pathfinder, crafting grid, and stepped free";
    },

    async create_plan({ goal, steps }, { sender } = {}) {
      const bot = requireBot();
      const rawGoal = String(goal || steps || "").trim();
      if (!rawGoal) {
        throw new Error(
          "Specify a goal (e.g. 'make iron armor from scratch') or steps",
        );
      }

      // 1. Check if goal can be expanded by the Minecraft dependency planner
      const craftPlan = buildCraftingPlan(bot, rawGoal, 1);
      if (craftPlan && craftPlan.length > 0 && !steps) {
        const queueable = craftPlan.map((st) => ({
          label: st.label,
          tool: st.tool,
          args: st.args,
          run: () => handlers[st.tool](st.args, { sender }),
        }));
        return enqueueSteps(queueable, { planTitle: rawGoal, sender });
      }

      // 2. Otherwise translate semicolon/newline-separated command steps
      const cmdText = String(steps || goal || "").trim();
      const t = translate(cmdText, {
        scripts: scripts.list(),
        sender,
        botName: bot.username,
      });
      const validSteps = t.steps.filter((s) => s.js);
      if (!validSteps.length) {
        throw new Error(
          `Could not build a plan from "${rawGoal}". Try e.g. "make iron armor" or "mine 4 oak_log; craft wooden_pickaxe"`,
        );
      }
      const queueable = validSteps.map((s) => ({
        label: s.line,
        tool: "run_commands",
        args: { commands: s.line },
        run: () => runTranslated(s.line, sender),
      }));
      return enqueueSteps(queueable, { planTitle: rawGoal, sender });
    },

    async queue_task({ commands }, { sender } = {}) {
      const bot = requireBot();
      const text = Array.isArray(commands)
        ? commands.join("; ")
        : String(commands || "").trim();
      if (!text) throw new Error("No commands given to queue");

      // Check if it's a composite crafting goal like "make iron armor"
      const craftPlan = buildCraftingPlan(bot, text, 1);
      if (craftPlan && craftPlan.length > 1) {
        const queueable = craftPlan.map((st) => ({
          label: st.label,
          tool: st.tool,
          args: st.args,
          run: () => handlers[st.tool](st.args, { sender }),
        }));
        return enqueueSteps(queueable, { planTitle: text, sender });
      }

      const t = translate(text, {
        scripts: scripts.list(),
        sender,
        botName: bot.username,
      });
      const validSteps = t.steps.filter((s) => s.js);
      if (!validSteps.length) {
        throw new Error(`Could not understand task "${text}"`);
      }
      const queueable = validSteps.map((s) => ({
        label: s.line,
        tool: "run_commands",
        args: { commands: s.line },
        run: () => runTranslated(s.line, sender),
      }));
      return enqueueSteps(queueable, { planTitle: text, sender });
    },

    get_queue() {
      const status = getQueueStatus();
      return status || "Task queue is empty (no active plan)";
    },

    async hunt_food({ count = 3 } = {}) {
      const bot = requireBot();
      const targetCount = Math.max(
        1,
        Math.min(12, Math.floor(Number(count) || 3)),
      );
      const FOOD_ANIMALS = new Set([
        "cow",
        "mooshroom",
        "pig",
        "sheep",
        "chicken",
        "rabbit",
        "cod",
        "salmon",
      ]);
      let hunted = 0;
      for (let i = 0; i < targetCount; i++) {
        const me = bot.entity.position;
        const animals = Object.values(bot.entities || {})
          .filter(
            (e) =>
              e &&
              e !== bot.entity &&
              e.position &&
              FOOD_ANIMALS.has(String(e.name || "").toLowerCase()) &&
              e.position.distanceTo(me) <= 32,
          )
          .sort(
            (a, b) => a.position.distanceTo(me) - b.position.distanceTo(me),
          );
        if (!animals.length) break;
        const animal = animals[0];
        await handlers.attack({ target: animal.name }).catch(() => {});
        await handlers.collect_drops().catch(() => {});
        hunted += 1;
      }

      // If we got raw meat, cook it if possible
      const rawMeat = bot.inventory
        .items()
        .find((i) =>
          ["beef", "porkchop", "chicken", "mutton"].includes(i.name),
        );
      if (rawMeat) {
        await handlers
          .smelt_item({ item: rawMeat.name, count: rawMeat.count })
          .catch(() => {});
      }

      if (!hunted && !rawMeat) {
        throw new Error(
          "No food animals (cow, pig, sheep, chicken, rabbit) within 32 blocks",
        );
      }
      return `Hunted ${hunted} animal(s) and collected food drops`;
    },

    async store_items({ item = "all", count } = {}) {
      const bot = requireBot();
      const { goals } = loadLibraries();
      let chestBlock = bot.findBlock({
        matching: (b) =>
          b &&
          (b.name === "chest" ||
            b.name === "trapped_chest" ||
            b.name === "barrel"),
        maxDistance: 12,
      });
      if (!chestBlock) {
        const chestItem = bot.inventory
          .items()
          .find((i) => i.name === "chest" || i.name === "barrel");
        if (!chestItem) {
          await handlers
            .craft_item({ item: "chest", count: 1 })
            .catch(() => {});
        }
        const toPlace = bot.inventory
          .items()
          .find((i) => i.name === "chest" || i.name === "barrel");
        if (toPlace) {
          await placeBlockNearby(bot, toPlace, toPlace.name, (m) =>
            log(`AIAgent: ${m}`),
          );
          chestBlock = bot.findBlock({
            matching: (b) =>
              b &&
              (b.name === "chest" ||
                b.name === "trapped_chest" ||
                b.name === "barrel"),
            maxDistance: 8,
          });
        }
      }
      if (!chestBlock) throw new Error("No chest nearby or in inventory");
      if (chestBlock.position.distanceTo(bot.entity.position) > 3.8) {
        await withTimeout(
          bot.pathfinder.goto(
            new goals.GoalNear(
              chestBlock.position.x,
              chestBlock.position.y,
              chestBlock.position.z,
              2,
            ),
          ),
          6000,
          () => clearPathfinderGoal(bot),
        ).catch(() => {});
      }
      const container = await bot.openContainer(chestBlock);
      let stored = 0;
      try {
        const raw = itemId(item);
        const targetName =
          raw === "all" ? "all" : resolveName(item, bot.registry?.itemsByName);
        const stacks = bot.inventory.items().filter((i) => {
          if (targetName === "all") {
            return !i.name.endsWith("_pickaxe") && !i.name.endsWith("_sword");
          }
          return i.name === targetName || i.name.includes(raw);
        });
        let left = Number(count) > 0 ? Math.floor(Number(count)) : Infinity;
        for (const st of stacks) {
          if (left <= 0) break;
          const n = Math.min(st.count, left);
          await container.deposit(st.type, null, n).catch(() => {});
          stored += n;
          left -= n;
        }
      } finally {
        container.close();
      }
      return `Stored ${stored} item(s) in ${chestBlock.name}`;
    },

    async take_items({ item = "all", count } = {}) {
      const bot = requireBot();
      const { goals } = loadLibraries();
      const chestBlock = bot.findBlock({
        matching: (b) =>
          b &&
          (b.name === "chest" ||
            b.name === "trapped_chest" ||
            b.name === "barrel"),
        maxDistance: 12,
      });
      if (!chestBlock) throw new Error("No chest or barrel within 12 blocks");
      if (chestBlock.position.distanceTo(bot.entity.position) > 3.8) {
        await withTimeout(
          bot.pathfinder.goto(
            new goals.GoalNear(
              chestBlock.position.x,
              chestBlock.position.y,
              chestBlock.position.z,
              2,
            ),
          ),
          6000,
          () => clearPathfinderGoal(bot),
        ).catch(() => {});
      }
      const container = await bot.openContainer(chestBlock);
      let taken = 0;
      try {
        const raw = itemId(item);
        const targetName =
          raw === "all" ? "all" : resolveName(item, bot.registry?.itemsByName);
        const items = container.containerItems().filter((i) => {
          if (targetName === "all") return true;
          return i.name === targetName || i.name.includes(raw);
        });
        let left = Number(count) > 0 ? Math.floor(Number(count)) : Infinity;
        for (const st of items) {
          if (left <= 0) break;
          const n = Math.min(st.count, left);
          await container.withdraw(st.type, null, n).catch(() => {});
          taken += n;
          left -= n;
        }
      } finally {
        container.close();
      }
      return `Took ${taken} item(s) from ${chestBlock.name}`;
    },

    async fill_bucket({ liquid = "water" } = {}) {
      const bot = requireBot();
      const { goals } = loadLibraries();
      const liqName = String(liquid || "water")
        .toLowerCase()
        .includes("lava")
        ? "lava"
        : "water";
      let bucket = bot.inventory.items().find((i) => i.name === "bucket");
      if (!bucket) {
        await handlers.craft_item({ item: "bucket", count: 1 });
        bucket = bot.inventory.items().find((i) => i.name === "bucket");
      }
      if (!bucket) throw new Error("Need an empty bucket (3 iron_ingot)");
      const liqBlock = bot.findBlock({
        matching: (b) => b && b.name === liqName,
        maxDistance: 24,
      });
      if (!liqBlock) throw new Error(`No ${liqName} within 24 blocks`);
      if (liqBlock.position.distanceTo(bot.entity.position) > 3.8) {
        await withTimeout(
          bot.pathfinder.goto(
            new goals.GoalNear(
              liqBlock.position.x,
              liqBlock.position.y,
              liqBlock.position.z,
              2,
            ),
          ),
          8000,
          () => clearPathfinderGoal(bot),
        ).catch(() => {});
      }
      await bot.equip(bucket, "hand");
      await bot.lookAt(liqBlock.position.offset(0.5, 0.5, 0.5), true);
      bot.activateItem();
      await sleep(300);
      bot.deactivateItem();
      return `Filled bucket with ${liqName}`;
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
      if (t) {
        aiBrain.recordThought(t, getBot());
        log(`AIAgent (thinking): ${t.slice(0, 300)}`);
      }
      return "noted";
    },

    query_game_mechanics({ topic } = {}) {
      const bot = getBot();
      return aiBrain.queryGameKnowledge(bot, topic, getLogs());
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
  const BACKGROUND = new Set([
    "attack",
    "mine_block",
    "craft_item",
    "smelt_item",
    "hunt_food",
    "store_items",
    "take_items",
    "fill_bucket",
  ]);

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
    craft: "craft_item",
    make: "craft_item",
    smelt: "smelt_item",
    cook: "smelt_item",
    equip: "equip_best_gear",
    gearup: "start_script",
    gear_up: "start_script",
    drop: "toss_item",
    toss: "toss_item",
    give: "toss_item",
    place: "place_block",
    pickup: "collect_drops",
    loot: "collect_drops",
    collect: "collect_drops",
    death: "return_to_death",
    deathpoint: "return_to_death",
    grave: "return_to_death",
    sleep: "sleep_in_bed",
    bed: "sleep_in_bed",
    escape: "unstuck",
    recover: "unstuck",
    unstick: "unstuck",
    plan: "create_plan",
    make_plan: "create_plan",
    queue: "queue_task",
    enqueue: "queue_task",
    tasks: "get_queue",
    hunt_animals: "hunt_food",
    get_food: "hunt_food",
    gather_food: "hunt_food",
    store: "store_items",
    deposit: "store_items",
    withdraw: "take_items",
    bucket: "fill_bucket",
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
    query: "query_game_mechanics",
    mechanics: "query_game_mechanics",
    game_mechanics: "query_game_mechanics",
    wiki: "query_game_mechanics",
    recipe: "query_game_mechanics",
    knowledge: "query_game_mechanics",
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
    goal: ["plan", "task", "objective", "target", "item"],
    steps: ["commands", "tasks", "list"],
    liquid: ["fluid", "type", "item"],
    topic: ["query", "item", "block", "question", "name", "subject"],
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
    if (Array.isArray(out._pos)) {
      const pos = out._pos;
      delete out._pos;
      props.forEach((p, idx) => {
        if (out[p] === undefined && pos[idx] !== undefined) out[p] = pos[idx];
      });
    }
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
    // Handle set_script_option({"value": "gearUp, tier, iron"}) or "GearUp tier=stone"
    if (name === "set_script_option" && (!out.name || !out.option)) {
      const packed = String(out.value ?? out.name ?? out.option ?? "").trim();
      const parts = packed.includes(",")
        ? packed
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : packed
            .split(/[\s=:]+/)
            .map((s) => s.trim())
            .filter(Boolean);
      if (parts.length >= 3) {
        out.name = parts[0];
        out.option = parts[1];
        out.value = parts.slice(2).join(" ");
      } else if (parts.length === 2 && out.name && !out.option) {
        out.option = parts[0];
        out.value = parts[1];
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

  // Everything the AI does is attributed to it, so it can take the pathfinder over
  // from running scripts (GearUp, mining...) and hand it back when it is done.
  function executeTool(rawName, args = {}, meta = {}) {
    return runWithPathOwner("AI", 2, () => executeToolInner(rawName, args, meta));
  }

  async function executeToolInner(rawName, args = {}, meta = {}) {
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
    const formatPrettyArgs = (obj) => {
      if (!obj || typeof obj !== "object") return "";
      const keys = Object.keys(obj);
      if (!keys.length) return "";
      if ((obj.item || obj.block) && keys.length <= 2) {
        const target = obj.item || obj.block;
        const cnt = obj.count && Number(obj.count) > 1 ? ` ×${obj.count}` : "";
        return `${target}${cnt}`;
      }
      if (obj.player && keys.length === 1) return String(obj.player);
      if (obj.target && keys.length === 1) return String(obj.target);
      if (obj.commands && keys.length === 1) return `"${obj.commands}"`;
      if (obj.topic && keys.length === 1) return `"${obj.topic}"`;
      return keys
        .map((k) => {
          const v = obj[k];
          return typeof v === "object"
            ? `${k}=${JSON.stringify(v)}`
            : `${k}=${v}`;
        })
        .join(", ");
    };
    const argText = formatPrettyArgs(safeArgs);
    let background = BACKGROUND.has(name);
    let translatedCmd = null;
    if (name === "run_commands" || name === "run_code") {
      const bot = getBot();
      const text = String(safeArgs.commands ?? safeArgs.code ?? "");
      translatedCmd = translate(text, {
        scripts: scripts.list(),
        sender: meta.sender,
        botName: bot?.username,
      });
      background = translatedCmd.long;
    }
    if (background) {
      const bot = requireBot();
      // Expand multi-step crafting plans into individual queued steps
      if (name === "craft_item") {
        const plan = buildCraftingPlan(bot, safeArgs.item, safeArgs.count || 1);
        if (plan && plan.length > 1) {
          const queueable = plan.map((st) => ({
            label: st.label,
            tool: st.tool,
            args: st.args,
            run: () => handlers[st.tool](st.args, meta),
          }));
          return enqueueSteps(queueable, {
            planTitle: `craft_item(${safeArgs.item})`,
            sender: meta.sender,
          });
        }
      }
      // Expand multi-step or composite run_commands into queued steps
      if (
        name === "run_commands" &&
        translatedCmd &&
        !translatedCmd.needsCode
      ) {
        const validSteps = translatedCmd.steps.filter((s) => s.js);
        if (validSteps.length === 1) {
          const cm = String(validSteps[0].js || "").match(
            /^api\.craft_item\(\{ item: "([^"]+)", count: (\d+) \}\)$/,
          );
          if (cm) {
            const plan = buildCraftingPlan(bot, cm[1], Number(cm[2]));
            if (plan && plan.length > 1) {
              const queueable = plan.map((st) => ({
                label: st.label,
                tool: st.tool,
                args: st.args,
                run: () => handlers[st.tool](st.args, meta),
              }));
              return enqueueSteps(queueable, {
                planTitle: validSteps[0].line,
                sender: meta.sender,
              });
            }
          }
        } else if (validSteps.length > 1) {
          const queueable = [];
          for (const st of validSteps) {
            const cm = String(st.js || "").match(
              /^api\.craft_item\(\{ item: "([^"]+)", count: (\d+) \}\)$/,
            );
            const plan = cm
              ? buildCraftingPlan(bot, cm[1], Number(cm[2]))
              : null;
            if (plan && plan.length > 1) {
              for (const p of plan) {
                queueable.push({
                  label: p.label,
                  tool: p.tool,
                  args: p.args,
                  run: () => handlers[p.tool](p.args, meta),
                });
              }
            } else {
              queueable.push({
                label: st.line,
                tool: "run_commands",
                args: { commands: st.line },
                run: () => runTranslated(st.line, meta.sender),
              });
            }
          }
          return enqueueSteps(queueable, {
            planTitle: String(safeArgs.commands || ""),
            sender: meta.sender,
          });
        }
      }

      return enqueueSteps(
        [
          {
            label: `${name.replace(/_/g, " ")}${argText ? ` (${argText})` : ""}`,
            tool: name,
            args: safeArgs,
            run: () => handler(safeArgs, meta),
          },
        ],
        { planTitle: name, sender: meta.sender },
      );
    }
    try {
      const result = await handler(safeArgs, meta);
      aiBrain.recordAction(name, safeArgs, result, false, getBot());
      if (name !== "think") {
        log(
          `AIAgent ▸ ${name}${argText ? `(${argText})` : ""} → ${String(result).split("\n")[0]}`,
        );
      }
      return result;
    } catch (err) {
      const msg = `Error: ${err.message || err}`;
      aiBrain.recordAction(name, safeArgs, msg, true, getBot());
      log(`AIAgent ✗ ${name}${argText ? `(${argText})` : ""} → ${msg}`);
      return msg;
    }
  }

  function schemasFor(sender) {
    return canRunCode(sender)
      ? [...TOOL_SCHEMAS, RUN_CODE_SCHEMA]
      : TOOL_SCHEMAS;
  }

  function stopAll() {
    clearTaskQueue();
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
    if (!text || text.length > 220) return null;
    // Long sentences are conversation, not orders.
    if (text.split(/\s+/).length > 16) return null;
    const isPoliteOrder =
      /^(?:hey\s+|yo\s+|bro\s+|please\s+|pls\s+)*(?:can|could|would|will)\s+you\s+(?:please\s+|pls\s+|just\s+)?(?:make|craft|create|mine|dig|chop|break|get|gather|collect|follow|come|walk|go|move|stop|halt|unstuck|escape|eat|drop|give|toss|throw|equip|gear|hold|attack|kill|fight|hunt|guard|protect|smelt|cook|jump|place|sleep|turn|switch|enable|disable|start)\b/i.test(
        text,
      );
    if (isPoliteOrder) {
      text = text
        .replace(
          /^(?:hey\s+|yo\s+|bro\s+|please\s+|pls\s+)*(?:can|could|would|will)\s+you\s+(?:please\s+|pls\s+|just\s+)?/i,
          "",
        )
        .replace(/\?+\s*$/, "")
        .trim();
    } else if (
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
    // kitpvp" is only tried directly when the target is an online player or
    // the bot has a lobby menu selector item.)
    const online = new Set(
      Object.keys(bot.players || {}).map((u) => u.toLowerCase()),
    );
    const hasSelector =
      Boolean(bot.currentWindow) ||
      bot.inventory
        ?.items()
        ?.some((i) =>
          /compass|clock|nether_star|book|chest|emerald|comparator|ender_eye|player_head/.test(
            i.name,
          ),
        );
    for (const st of t.steps) {
      const m = String(st.js || "").match(
        /^api\.(follow_player|look_at_player|come_to_player)\(\{ player: "([^"]*)" \}\)/,
      );
      if (m) {
        const who = m[2];
        const knownPlayer =
          online.has(who.toLowerCase()) || Boolean(matchPlayerName(bot, who));
        if (!knownPlayer && (m[1] !== "come_to_player" || !hasSelector)) {
          return null;
        }
      }
    }
    // Info commands need the model to word the answer.
    if (
      t.steps.some((st) =>
        /^api\.(get_status|read_logs|list_scripts|get_queue)\(/.test(
          st.js || "",
        ),
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
    getQueueStatus,
  };
}

module.exports = { createAiTools, TOOL_SCHEMAS, RUN_CODE_SCHEMA };
