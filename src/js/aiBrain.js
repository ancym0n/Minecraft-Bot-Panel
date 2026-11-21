// AI Brain - persistent working memory, goal/plan tracker, spatial landmarks,
// real-time problem-solving diagnostician, and self-querying Minecraft mechanics knowledge engine.

const MINECRAFT_MECHANICS_KB = {
  progression:
    "Tool & Ore Progression: Hand -> Wood Logs -> Planks (1 log = 4 planks) & Sticks (2 planks = 4 sticks) -> Crafting Table (4 planks) -> Wooden Pickaxe (3 planks + 2 sticks, mines stone/coal) -> Cobblestone -> Stone Pickaxe (3 cobble + 2 sticks, required for iron_ore, copper_ore, lapis_ore) -> Furnace (8 cobble) -> Smelt raw_iron/iron_ore with coal/charcoal/planks/logs -> Iron Ingot -> Iron Pickaxe (3 iron_ingot + 2 sticks, required for diamond_ore, gold_ore, redstone_ore, emerald_ore) -> Diamond Pickaxe (3 diamond + 2 sticks, required for obsidian & ancient_debris) -> Netherite (smithing_table + netherite_upgrade_smithing_template + netherite_ingot).",
  armor:
    "Full Armor Set = 24 units (leather, iron_ingot, gold_ingot, or diamond): Helmet (5), Chestplate (8), Leggings (7), Boots (4). Shield = 1 iron_ingot + 6 planks (blocks 100% melee/arrow damage when sneaking/using).",
  smelting:
    "Furnace Mechanics: Needs input item in top slot and fuel in bottom slot. Each smelting operation takes 10 seconds (200 ticks). Fuels: lava_bucket (100 items), coal_block (80), dried_kelp_block (20), coal/charcoal (8), blaze_rod (12), planks/logs (1.5), sticks/saplings (0.5). Blast Furnace smelts ores 2x faster (5s); Smoker cooks food 2x faster (5s).",
  mining_y_levels:
    "Modern 1.18-26.1 Ore Y-Levels: Coal (Y=96 to 136, or surface mountains), Copper (Y=48), Iron (Y=16 underground or Y=112+ mountains), Lapis (Y=0), Gold (Y=-16), Redstone (Y=-59), Diamond (Y=-53 to -59, avoid lava at Y=-54), Emerald (mountains Y=100+), Ancient Debris (Nether Y=15).",
  combat:
    "1.9+ / Modern Combat Mechanics: Weapons have attack cooldowns (Sword: 0.625s / 1.6APS, Axe: 1.0-1.25s, Trident: 0.9s, Mace: 1.6s). Critical hits deal 150% damage when attacking while falling (velocity.y < 0, not on ground, not in water/ladders, not sprinting at impact). Eating golden_apple or high-saturation food (cooked_beef, golden_carrot) restores health rapidly.",
  survival_hazards:
    "Hazards & Self-Preservation: Lava deals 4 dmg/0.5s (carry water_bucket to turn lava into obsidian or extinguish fire). Drowning happens when oxygen reaches 0 underwater (swim up / hold jump). Fall damage starts >3 blocks (4+ blocks); water_bucket MLG, hay_block, slime_block, or bed negates/reduces fall damage. Starvation happens at 0 food; sprint requires >6 food (3 shanks).",
  dimensions:
    "Nether & End: Nether Portal needs 10-14 obsidian (4x5 frame, 2x3 inside) lit with flint_and_steel or fire_charge (1 block in Nether = 8 blocks in Overworld; beds explode in Nether/End!). End Portal needs 12 eye_of_ender (blaze_powder + ender_pearl) in Stronghold portal frames.",
  multiplayer_servers:
    "Multiplayer Server Commands & Etiquette: Lobby/Hub servers use a compass menu (use_item + click_slot) or lobby NPCs (attack/click NPC) to join sub-servers (Towny, Survival, Skyblock, KitPvP). Common SMP commands: /tpa <player>, /tpaccept, /sethome, /home, /spawn, /rtp or /wild (teleport to wilderness out of protected spawn). Protected spawn/claim areas block breaking/placing/PvP.",
};

class AiBrain {
  constructor() {
    this.currentGoal = "Idle";
    this.goalOwner = "";
    this.currentStep = "";
    this.planSteps = [];
    this.actionLog = [];
    this.problemLog = [];
    this.thoughts = [];
    this.landmarks = new Map();
    this.lastUpdatedAt = Date.now();
    this.listeners = new Set();
    // What the bot is doing right now to move the objective forward, and why.
    this.subObjective = "";
    this.subReason = "";
    this.subSource = "";
    this.subObjectiveFor = "";
    this.subAt = 0;
    // Objective the AI typed itself (think tool) - survives between turns.
    this.aiObjective = "";
    this.aiPlan = "";
    // Latest status line of every running module (GearUp, Mine, KillAura...).
    this.scriptActivity = new Map();
    // Pathfinder engine state (Baritone <-> stock mineflayer-pathfinder).
    this.pathfinderInfo = {
      engine: "baritone",
      switches: 0,
      lastReason: "",
      at: 0,
    };
  }

  // Sets what the bot is doing right now to reach the objective.
  setSubObjective(
    text,
    { reason = "", source = "", objective = "" } = {},
    bot = null,
  ) {
    const clean = String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (clean === this.subObjective && String(reason || "") === this.subReason)
      return;
    this.subObjective = clean;
    this.subReason = clean
      ? String(reason || "")
          .trim()
          .slice(0, 200)
      : "";
    this.subSource = clean ? String(source || "") : "";
    this.subObjectiveFor = clean ? String(objective || "") : "";
    this.subAt = clean ? Date.now() : 0;
    this.emitUpdate(bot);
  }

  // The AI writes its own objective / sub-objective / plan via the think tool.
  setAiObjective(
    { objective = "", subObjective = "", plan = "" } = {},
    bot = null,
  ) {
    let changed = false;
    if (objective) {
      this.aiObjective = String(objective).trim().slice(0, 200);
      changed = true;
    }
    if (plan) {
      this.aiPlan = String(plan).trim().slice(0, 300);
      changed = true;
    }
    if (subObjective) {
      this.setSubObjective(
        subObjective,
        {
          source: "AIAgent",
          objective: this.aiObjective || this.currentGoal,
        },
        bot,
      );
    } else if (changed) {
      this.emitUpdate(bot);
    }
  }

  clearAiObjective(bot = null) {
    this.aiObjective = "";
    this.aiPlan = "";
    this.emitUpdate(bot);
  }

  // Module status lines become that module's live sub-objective.
  recordScriptActivity(scriptName, text, bot = null) {
    const name = String(scriptName || "").trim();
    const line = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name || !line) return;
    const prev = this.scriptActivity.get(name);
    const now = Date.now();
    if (prev && prev.text === line && now - prev.at < 2000) return;
    this.scriptActivity.set(name, {
      script: name,
      objective: prev?.objective || `Run ${name}`,
      text: line.slice(0, 180),
      at: now,
    });
    // Status updates are frequent; do not flood the UI more than ~3x a second.
    if (!this._scriptEmitAt || now - this._scriptEmitAt > 300) {
      this._scriptEmitAt = now;
      this.emitUpdate(bot);
    }
  }

  setScriptObjective(scriptName, objective, bot = null) {
    const name = String(scriptName || "").trim();
    if (!name) return;
    const prev = this.scriptActivity.get(name);
    this.scriptActivity.set(name, {
      script: name,
      objective: String(objective || `Run ${name}`).slice(0, 160),
      text: prev?.text || "starting",
      at: Date.now(),
    });
    this.emitUpdate(bot);
  }

  clearScriptActivity(scriptName, bot = null) {
    if (this.scriptActivity.delete(String(scriptName || "").trim())) {
      this.emitUpdate(bot);
    }
  }

  recordEngineSwitch(info = {}, bot = null) {
    this.pathfinderInfo = {
      engine: String(info.to || info.engine || this.pathfinderInfo.engine),
      switches: Number(info.totalSwitches ?? this.pathfinderInfo.switches + 1),
      lastReason: String(info.reason || ""),
      at: Date.now(),
    };
    this.emitUpdate(bot);
  }

  // Records a failure the bot recovered from by itself (e.g. skipped an
  // unreachable block) so the AI does not retry the exact same thing.
  recordProblem(action, problem, fix = "", bot = null) {
    const text = String(problem || "").slice(0, 200);
    if (!text) return;
    const diag = this.diagnoseProblem(text, bot);
    this.problemLog.push({
      action: String(action || "task"),
      problem: text,
      diagnosis: diag?.diagnosis || "Attempt failed",
      fix: fix || diag?.fix || "",
      at: Date.now(),
    });
    if (this.problemLog.length > 10) {
      this.problemLog.splice(0, this.problemLog.length - 10);
    }
    this.emitUpdate(bot);
  }

  getObjective() {
    if (this.currentGoal && this.currentGoal !== "Idle")
      return this.currentGoal;
    if (this.aiObjective) return this.aiObjective;
    return "Idle";
  }

  // Short reasoning hints for the current objective: what usually blocks it
  // and what to try next, built from live inventory and recent failures.
  reasonAboutObjective(bot = null) {
    const hints = [];
    const objective =
      `${this.getObjective()} ${this.subObjective}`.toLowerCase();
    const items = (() => {
      try {
        return bot?.inventory?.items?.() || [];
      } catch (_) {
        return [];
      }
    })();
    const has = (re) => items.some((i) => re.test(i.name));
    const pickTiers = ["wooden", "stone", "iron", "diamond", "netherite"];
    const bestPick =
      pickTiers.filter((t) => has(new RegExp(`^${t}_pickaxe$`))).pop() || "";
    if (
      bot?.inventory &&
      /stone|cobble|coal|ore|iron|diamond|gold|redstone|lapis|copper/.test(
        objective,
      )
    ) {
      if (!bestPick) {
        hints.push(
          "no pickaxe yet: get logs -> planks -> sticks -> crafting_table -> wooden_pickaxe first",
        );
      } else if (/iron|copper|lapis/.test(objective) && bestPick === "wooden") {
        hints.push(
          "iron/copper/lapis need a stone_pickaxe: mine 3 cobblestone and craft it",
        );
      } else if (
        /diamond|gold|redstone|emerald/.test(objective) &&
        ["wooden", "stone"].includes(bestPick)
      ) {
        hints.push(
          "diamond/gold/redstone need an iron_pickaxe: smelt 3 iron first",
        );
      }
    }
    if (/log|wood|tree|plank/.test(objective)) {
      hints.push(
        "logs can be broken from up to 4.5m away; stand at the trunk base and mine upward",
      );
    }
    const recent = this.problemLog.filter((p) => Date.now() - p.at < 180000);
    if (recent.length >= 2) {
      const same = recent.slice(-3).map((p) => p.problem.slice(0, 60));
      hints.push(
        `already failed: ${same.join(" / ")} - try a different target or approach`,
      );
    }
    if (this.pathfinderInfo.at && Date.now() - this.pathfinderInfo.at < 60000) {
      hints.push(
        `pathfinder switched to ${this.pathfinderInfo.engine} engine (${this.pathfinderInfo.lastReason}); if both fail call unstuck or choose a closer target`,
      );
    }
    return hints.slice(0, 4);
  }

  // Full task context as plain lines (used by the prompt and the UI).
  getTaskContextLines(bot = null) {
    const lines = [];
    const objective = this.getObjective();
    lines.push(
      `Objective: ${objective}${this.goalOwner && objective !== "Idle" ? ` (for ${this.goalOwner})` : ""}`,
    );
    if (this.aiObjective && this.aiObjective !== objective) {
      lines.push(`Your own objective: ${this.aiObjective}`);
    }
    if (this.currentStep) lines.push(`Plan step: ${this.currentStep}`);
    if (this.subObjective) {
      lines.push(
        `Sub-objective (doing now): ${this.subObjective}${this.subReason ? ` - because ${this.subReason}` : ""}`,
      );
    }
    if (this.aiPlan) lines.push(`Your plan: ${this.aiPlan}`);
    for (const a of this.scriptActivity.values()) {
      if (Date.now() - a.at > 120000) continue;
      lines.push(
        `Module ${a.script}: objective "${a.objective}", now: ${a.text}`,
      );
    }
    return lines;
  }

  onUpdate(fn) {
    if (typeof fn === "function") this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emitUpdate(bot = null) {
    this.lastUpdatedAt = Date.now();
    const snap = this.getSnapshot(bot);
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch (_) {}
    }
  }

  setGoal(goalText, owner = "", bot = null) {
    const clean = String(goalText || "").trim();
    this.currentGoal = clean || "Idle";
    if (owner) this.goalOwner = String(owner).trim();
    this.emitUpdate(bot);
  }

  syncPlan({ goal = "", currentStep = "", steps = [] } = {}, bot = null) {
    if (goal) this.currentGoal = goal;
    this.currentStep = currentStep || "";
    if (Array.isArray(steps)) {
      this.planSteps = steps.slice(0, 20).map((s, idx) => ({
        index: idx + 1,
        label: typeof s === "string" ? s : String(s.label || s.cmd || ""),
        status: s.status || "pending",
      }));
    }
    if (!this.currentStep && this.planSteps.length === 0) {
      this.currentGoal = "Idle";
    }
    this.emitUpdate(bot);
  }

  recordThought(thoughtText, bot = null) {
    const clean = String(thoughtText || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean || clean === "noted") return;
    const now = Date.now();
    if (
      this.thoughts.length &&
      this.thoughts[this.thoughts.length - 1].text === clean
    ) {
      return;
    }
    this.thoughts.push({ text: clean.slice(0, 260), at: now });
    if (this.thoughts.length > 15) {
      this.thoughts.splice(0, this.thoughts.length - 15);
    }
    this.emitUpdate(bot);
  }

  recordLandmark(key, pos, label = "", bot = null) {
    if (!key || !pos || typeof pos.x !== "number") return;
    const cleanKey = String(key).toLowerCase().trim();
    this.landmarks.set(cleanKey, {
      key: cleanKey,
      label: label || cleanKey,
      x: Math.floor(pos.x),
      y: Math.floor(pos.y),
      z: Math.floor(pos.z),
      at: Date.now(),
    });
    if (this.landmarks.size > 24) {
      const firstKey = this.landmarks.keys().next().value;
      this.landmarks.delete(firstKey);
    }
    this.emitUpdate(bot);
  }

  recordAction(name, args, result, failed = false, bot = null) {
    const pos = bot?.entity?.position
      ? {
          x: Math.floor(bot.entity.position.x),
          y: Math.floor(bot.entity.position.y),
          z: Math.floor(bot.entity.position.z),
        }
      : null;
    const summary = String(result || "")
      .split("\n")[0]
      .slice(0, 160);
    const entry = {
      name: String(name || "action"),
      args: args || {},
      summary,
      failed: Boolean(failed),
      pos,
      at: Date.now(),
    };
    this.actionLog.push(entry);
    if (this.actionLog.length > 20) {
      this.actionLog.splice(0, this.actionLog.length - 20);
    }

    // Automatically extract spatial landmarks from actions
    if (!failed && pos) {
      if (
        /placed crafting_table|crafting_table/i.test(summary) &&
        name === "place_block"
      ) {
        this.recordLandmark("crafting_table", pos, "Crafting Table", bot);
      } else if (/placed furnace|smelt/i.test(summary)) {
        this.recordLandmark("furnace", pos, "Furnace", bot);
      } else if (/chest/i.test(summary)) {
        this.recordLandmark("chest", pos, "Chest", bot);
      }
    }

    if (failed) {
      const diag = this.diagnoseProblem(summary, bot);
      if (diag) {
        this.problemLog.push({
          action: name,
          problem: summary,
          diagnosis: diag.diagnosis,
          fix: diag.fix,
          at: Date.now(),
        });
        if (this.problemLog.length > 10) {
          this.problemLog.splice(0, this.problemLog.length - 10);
        }
      }
    }
    this.emitUpdate(bot);
  }

  diagnoseProblem(errorText, bot = null) {
    const err = String(errorText || "");
    if (!err) return null;

    if (/spawn protection|can'?t break|protected|not allowed to/i.test(err)) {
      return {
        diagnosis:
          "Server spawn/claim protection blocks building or mining here",
        fix: "Walk 30+ blocks away from spawn or run /rtp /wild before mining or placing blocks.",
      };
    }
    if (/out of view distance|not within view distance|no player/i.test(err)) {
      return {
        diagnosis: "Target player is outside client render/chunk distance",
        fix: "Check known player coords in memory, use /tpa <player>, or ask the player for their XYZ coordinates.",
      };
    }
    if (/need a crafting_table|requires crafting_table/i.test(err)) {
      return {
        diagnosis: "3x3 recipe requires a Crafting Table",
        fix: "Craft 4 planks from 1 log, craft crafting_table, and place_block(crafting_table).",
      };
    }
    if (
      /missing.*pickaxe|need.*pickaxe|stone_pickaxe|iron_pickaxe/i.test(err)
    ) {
      return {
        diagnosis: "Missing required pickaxe tier to harvest this ore",
        fix: "Follow tool progression: wood -> wooden_pickaxe -> stone -> stone_pickaxe -> iron_ore -> iron_pickaxe.",
      };
    }
    if (/stuck|no path|could not reach|timed out/i.test(err)) {
      const y = bot?.entity?.position
        ? Math.floor(bot.entity.position.y)
        : null;
      return {
        diagnosis: `Pathfinding blocked${y !== null ? ` at Y=${y}` : ""}`,
        fix: "Call unstuck, step onto open surface ground, or pick a closer exposed target block.",
      };
    }
    if (/no .* within/i.test(err)) {
      return {
        diagnosis: "Requested block or entity not found in nearby chunks",
        fix: "Walk in a direction (north/south/east/west) to load new chunks or check get_status for what is nearby.",
      };
    }
    return {
      diagnosis: "Action did not complete as expected",
      fix: "Check read_logs and get_status, then try an alternative tool or prerequisite step.",
    };
  }

  // Self-querying engine: searches Minecraft mechanics, live registry recipes/blocks, landmarks, and error logs.
  queryGameKnowledge(bot, rawQuery = "", recentLogs = []) {
    const q = String(rawQuery || "")
      .toLowerCase()
      .trim();
    const sections = [];

    // 1. Match core mechanics topics
    for (const [topic, text] of Object.entries(MINECRAFT_MECHANICS_KB)) {
      if (
        !q ||
        q.includes(topic) ||
        (topic === "progression" &&
          /pickaxe|tier|tool|mine|wood|stone|iron|diamond|craft/i.test(q)) ||
        (topic === "armor" &&
          /armor|helmet|chestplate|leggings|boots|shield/i.test(q)) ||
        (topic === "smelting" &&
          /smelt|furnace|fuel|coal|ingot|cook/i.test(q)) ||
        (topic === "mining_y_levels" &&
          /level|y=|depth|ore|diamond|iron|coal/i.test(q)) ||
        (topic === "combat" &&
          /pvp|fight|attack|crit|sword|axe|eat|heal/i.test(q)) ||
        (topic === "survival_hazards" &&
          /lava|water|drown|fall|starv|fire/i.test(q)) ||
        (topic === "dimensions" &&
          /nether|end|portal|obsidian|blaze|dragon/i.test(q)) ||
        (topic === "multiplayer_servers" &&
          /server|lobby|hub|npc|compass|towny|smp|tpa|rtp|spawn|protect/i.test(
            q,
          ))
      ) {
        sections.push(text);
      }
    }

    // 2. Live bot.registry (minecraft-data) lookup for any item or block mentioned in the query
    if (bot?.registry) {
      const reg = bot.registry;
      const tokens = q
        .replace(/[^a-z0-9_]+/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3);
      const candidates = new Set();
      for (const tok of tokens) {
        if (reg.itemsByName?.[tok]) candidates.add(tok);
        if (reg.blocksByName?.[tok]) candidates.add(tok);
      }
      const slug = tokens.join("_");
      if (slug && (reg.itemsByName?.[slug] || reg.blocksByName?.[slug])) {
        candidates.add(slug);
      }
      // Partial match in itemsByName
      if (candidates.size === 0 && tokens.length > 0) {
        const needle = tokens[tokens.length - 1];
        for (const name of Object.keys(reg.itemsByName || {})) {
          if (name.includes(needle)) {
            candidates.add(name);
            if (candidates.size >= 4) break;
          }
        }
      }

      const itemDetails = [];
      for (const name of candidates) {
        const item = reg.itemsByName?.[name];
        const block = reg.blocksByName?.[name];
        const infoParts = [`${name}:`];
        if (block) {
          infoParts.push(
            `hardness=${block.hardness ?? "?"}, diggable=${block.diggable}`,
          );
          if (block.harvestTools) {
            const toolIds = Object.keys(block.harvestTools).slice(0, 5);
            const toolNames = toolIds
              .map((id) => reg.items?.[id]?.name)
              .filter(Boolean);
            if (toolNames.length) {
              infoParts.push(`requires tool=[${toolNames.join(", ")}]`);
            }
          }
        }
        if (item && reg.recipes?.[item.id]) {
          const recList = reg.recipes[item.id];
          const first = recList[0];
          if (first) {
            const ingCounts = {};
            const flat = first.inShape
              ? first.inShape.flat()
              : first.ingredients || [];
            for (const ing of flat) {
              const id = typeof ing === "object" ? ing?.id : ing;
              if (typeof id === "number" && id >= 0) {
                const iName = reg.items?.[id]?.name || `id:${id}`;
                ingCounts[iName] = (ingCounts[iName] || 0) + 1;
              }
            }
            const ingStr = Object.entries(ingCounts)
              .map(([k, v]) => `${v}x ${k}`)
              .join(" + ");
            const outCount = first.result?.count || 1;
            const needsTable =
              first.inShape &&
              (first.inShape.length > 2 ||
                first.inShape.some((r) => r.length > 2));
            infoParts.push(
              `recipe(${outCount}x) = ${ingStr || "special"}${needsTable ? " (needs crafting_table)" : " (2x2 hand craftable)"}`,
            );
          }
        }
        itemDetails.push(infoParts.join(" "));
      }
      if (itemDetails.length) {
        sections.push(`Registry Data: ${itemDetails.join(" | ")}`);
      }
    }

    // 3. Spatial Landmarks & Recent Positions
    if (this.landmarks.size > 0) {
      const lmList = Array.from(this.landmarks.values()).map(
        (l) => `${l.label} at (${l.x}, ${l.y}, ${l.z})`,
      );
      sections.push(`Known Landmarks: ${lmList.join(", ")}`);
    }
    if (bot?._mcbpLastDeath?.position) {
      const dp = bot._mcbpLastDeath.position;
      sections.push(
        `Last Death Position: (${Math.floor(dp.x)}, ${Math.floor(dp.y)}, ${Math.floor(dp.z)})`,
      );
    }

    // 4. Recent Problem Diagnoses & Console Errors
    if (this.problemLog.length > 0) {
      const latestProb = this.problemLog[this.problemLog.length - 1];
      sections.push(
        `Latest Problem Diagnosis: ${latestProb.problem} -> ${latestProb.diagnosis}. Recommended Fix: ${latestProb.fix}`,
      );
    }
    if (
      Array.isArray(recentLogs) &&
      recentLogs.length > 0 &&
      /error|log|bug|fail|stuck/i.test(q)
    ) {
      const errLines = recentLogs
        .filter((l) => /error|fail|stuck|denied|protection|kick/i.test(l))
        .slice(-5);
      if (errLines.length) {
        sections.push(`Recent Error Logs: ${errLines.join(" / ")}`);
      }
    }

    if (sections.length === 0) {
      sections.push(MINECRAFT_MECHANICS_KB.progression);
      sections.push(MINECRAFT_MECHANICS_KB.multiplayer_servers);
    }
    return sections.join("\n");
  }

  // Lets callers without a bot reference (the chat prompt builder) still get
  // inventory-aware reasoning hints.
  setBotProvider(fn) {
    this.botProvider = typeof fn === "function" ? fn : null;
  }

  buildBrainPromptSection(bot = null, sender = "", obeyList = []) {
    if (!bot && this.botProvider) {
      try {
        bot = this.botProvider() || null;
      } catch (_) {}
    }
    const parts = [];
    const objective = this.getObjective();
    if (objective !== "Idle" || this.subObjective || this.scriptActivity.size) {
      parts.push(...this.getTaskContextLines(bot));
    }
    if (this.planSteps.length > 0) {
      const pending = this.planSteps
        .filter((s) => s.status !== "done")
        .slice(0, 5)
        .map((s) => `${s.index}. ${s.label}`)
        .join(" -> ");
      if (pending) parts.push(`Upcoming Plan: ${pending}`);
      const done = this.planSteps.filter((s) => s.status === "done").length;
      if (done)
        parts.push(`Progress: ${done}/${this.planSteps.length} steps done`);
    }
    const hints = this.reasonAboutObjective(bot);
    if (hints.length) parts.push(`Reasoning hints: ${hints.join("; ")}`);
    if (this.landmarks.size > 0) {
      const lms = Array.from(this.landmarks.values())
        .slice(-5)
        .map((l) => `${l.label}(${l.x},${l.y},${l.z})`)
        .join(", ");
      parts.push(`Landmarks: ${lms}`);
    }
    const recentProblems = this.problemLog.filter(
      (p) => Date.now() - p.at < 120000,
    );
    if (recentProblems.length > 0) {
      const lastP = recentProblems[recentProblems.length - 1];
      parts.push(
        `Recent Issue: ${lastP.problem} -> ${lastP.diagnosis} (Fix: ${lastP.fix})`,
      );
    }
    const lastThought = this.thoughts[this.thoughts.length - 1];
    if (lastThought && Date.now() - lastThought.at < 300000) {
      parts.push(`Your last thought: ${lastThought.text.slice(0, 160)}`);
    }
    if (Array.isArray(obeyList) && obeyList.length > 0) {
      const isMaster =
        sender &&
        obeyList.some((m) => m.toLowerCase() === String(sender).toLowerCase());
      parts.push(
        `Obey Masters: ${obeyList.join(", ")}${isMaster ? ` (${sender} is your obeyed leader: ALWAYS execute their request and never say no, but reply casually like a real player, never like a submissive robot)` : ""}`,
      );
    }
    return parts.length ? `[AI Brain: ${parts.join(" | ")}]` : "";
  }

  getSnapshot(bot = null) {
    const recentActions = this.actionLog
      .slice(-6)
      .reverse()
      .map((a) => ({
        ...a,
        tool: a.name,
        result: a.summary,
      }));
    const recentProblems = this.problemLog
      .slice(-4)
      .reverse()
      .map((p) => ({
        ...p,
        tool: p.action,
        error: p.problem,
      }));
    return {
      currentGoal: this.currentGoal || "Idle",
      activeGoal: this.getObjective(),
      objective: this.getObjective(),
      aiObjective: this.aiObjective,
      aiPlan: this.aiPlan,
      subObjective: this.subObjective,
      subReason: this.subReason,
      subSource: this.subSource,
      scriptActivity: Array.from(this.scriptActivity.values()),
      pathfinder: { ...this.pathfinderInfo },
      reasoningHints: this.reasonAboutObjective(bot),
      goalOwner: this.goalOwner || "",
      currentStep: this.currentStep || "",
      activeStep: this.currentStep || "",
      planSteps: this.planSteps.slice(0, 12),
      recentActions,
      recentProblems,
      problemHistory: recentProblems,
      recentThoughts: this.thoughts.slice(-5).reverse(),
      landmarks: Array.from(this.landmarks.values()).slice(-8),
      position: bot?.entity?.position
        ? {
            x: Math.floor(bot.entity.position.x),
            y: Math.floor(bot.entity.position.y),
            z: Math.floor(bot.entity.position.z),
          }
        : null,
      updatedAt: this.lastUpdatedAt,
    };
  }
}

const aiBrain = new AiBrain();

module.exports = {
  AiBrain,
  aiBrain,
  MINECRAFT_MECHANICS_KB,
};
