// Baritone-style CalculationContext:
// 1. BacktrackMemory - remembers stuck / failed nodes & edges with time decay so replanning
//    immediately detours around problem terrain instead of repeating the same broken move.
// 2. ToolSet - precomputes inventory tools, enchantments, and memoizes block break times
//    in ticks once per search instead of re-parsing NBT inside the A* inner loop.
// 3. BlockStateCache - caches per-coordinate processed block states for the active search.

const { Vec3 } = require("vec3");
const {
  BREAK_BLOCK_BASE_PENALTY,
  COST_INF,
} = require("./actionCosts");

let nbtModule = null;
function getNbt() {
  if (nbtModule !== null) return nbtModule;
  try {
    nbtModule = require("prismarine-nbt");
  } catch (_) {
    nbtModule = false;
  }
  return nbtModule;
}

function posKey(x, y, z) {
  return `${x},${y},${z}`;
}

function edgeKey(x1, y1, z1, x2, y2, z2) {
  return `${x1},${y1},${z1}>${x2},${y2},${z2}`;
}

class BacktrackMemory {
  constructor({ defaultTtlMs = 25000, maxPenalty = 240 } = {}) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxPenalty = maxPenalty;
    this.nodePenalties = new Map(); // key -> { penalty, expiresAt, hits }
    this.edgePenalties = new Map(); // key -> { penalty, expiresAt, hits }
  }

  penalizeNode(pos, amount = 45, ttlMs = this.defaultTtlMs) {
    if (!pos) return;
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const key = posKey(x, y, z);
    const now = Date.now();
    const prev = this.nodePenalties.get(key);
    const prevVal = prev && prev.expiresAt > now ? prev.penalty : 0;
    const prevHits = prev && prev.expiresAt > now ? prev.hits : 0;
    this.nodePenalties.set(key, {
      penalty: Math.min(this.maxPenalty, prevVal + amount),
      expiresAt: now + ttlMs,
      hits: prevHits + 1,
    });
  }

  penalizeEdge(fromPos, toPos, amount = 65, ttlMs = this.defaultTtlMs) {
    if (!fromPos || !toPos) return;
    const key = edgeKey(
      Math.floor(fromPos.x),
      Math.floor(fromPos.y),
      Math.floor(fromPos.z),
      Math.floor(toPos.x),
      Math.floor(toPos.y),
      Math.floor(toPos.z),
    );
    const now = Date.now();
    const prev = this.edgePenalties.get(key);
    const prevVal = prev && prev.expiresAt > now ? prev.penalty : 0;
    const prevHits = prev && prev.expiresAt > now ? prev.hits : 0;
    this.edgePenalties.set(key, {
      penalty: Math.min(this.maxPenalty * 1.5, prevVal + amount),
      expiresAt: now + ttlMs,
      hits: prevHits + 1,
    });
  }

  getNodePenalty(x, y, z, now = Date.now()) {
    const entry = this.nodePenalties.get(posKey(x, y, z));
    if (!entry) return 0;
    if (entry.expiresAt <= now) {
      this.nodePenalties.delete(posKey(x, y, z));
      return 0;
    }
    const remainingRatio = Math.max(
      0.2,
      (entry.expiresAt - now) / this.defaultTtlMs,
    );
    return entry.penalty * Math.min(1, remainingRatio);
  }

  getEdgePenalty(x1, y1, z1, x2, y2, z2, now = Date.now()) {
    const key = edgeKey(x1, y1, z1, x2, y2, z2);
    const entry = this.edgePenalties.get(key);
    if (!entry) return 0;
    if (entry.expiresAt <= now) {
      this.edgePenalties.delete(key);
      return 0;
    }
    const remainingRatio = Math.max(
      0.25,
      (entry.expiresAt - now) / this.defaultTtlMs,
    );
    return entry.penalty * Math.min(1, remainingRatio);
  }

  prune(now = Date.now()) {
    for (const [k, v] of this.nodePenalties) {
      if (v.expiresAt <= now) this.nodePenalties.delete(k);
    }
    for (const [k, v] of this.edgePenalties) {
      if (v.expiresAt <= now) this.edgePenalties.delete(k);
    }
  }

  clear() {
    this.nodePenalties.clear();
    this.edgePenalties.clear();
  }
}

class ToolSet {
  constructor(bot) {
    this.bot = bot;
    this.effects = bot?.entity?.effects || {};
    this.tools = [];
    this.digCache = new Map(); // blockType -> { ticks, tool }
    this.refresh();
  }

  refresh() {
    this.digCache.clear();
    this.tools = [];
    this.effects = this.bot?.entity?.effects || {};
    const items =
      typeof this.bot?.inventory?.items === "function"
        ? this.bot.inventory.items()
        : [];
    const nbt = getNbt();
    const seenTypes = new Set();

    for (const item of items) {
      if (!item) continue;
      let enchants = [];
      if (item.nbt && nbt && typeof nbt.simplify === "function") {
        try {
          const simp = nbt.simplify(item.nbt);
          enchants = simp?.Enchantments || simp?.enchantments || [];
        } catch (_) {}
      }
      // Deduplicate identical unenchanted items (e.g., 64 dirt stacks) so dig lookup stays tiny
      const sig = `${item.type}:${Array.isArray(enchants) ? enchants.length : 0}`;
      if (seenTypes.has(sig) && (!Array.isArray(enchants) || enchants.length === 0)) {
        continue;
      }
      seenTypes.add(sig);
      this.tools.push({ item, type: item.type, enchants });
    }
  }

  // Returns { ticks, tool } for breaking `block`. Memoized by block.type for O(1) A* speed.
  getBreakInfo(block) {
    if (!block || typeof block.type !== "number") {
      return { ticks: COST_INF, tool: null };
    }
    const cached = this.digCache.get(block.type);
    if (cached !== undefined) return cached;

    if (typeof block.digTime !== "function") {
      const res = { ticks: 20, tool: null };
      this.digCache.set(block.type, res);
      return res;
    }

    let bestMs = Number.MAX_VALUE;
    let bestTool = null;

    // Evaluate bare hand first
    try {
      const handMs = block.digTime(null, false, false, false, [], this.effects);
      if (Number.isFinite(handMs) && handMs < bestMs) {
        bestMs = handMs;
        bestTool = null;
      }
    } catch (_) {}

    for (const t of this.tools) {
      try {
        const ms = block.digTime(
          t.type,
          false,
          false,
          false,
          t.enchants,
          this.effects,
        );
        if (Number.isFinite(ms) && ms < bestMs) {
          bestMs = ms;
          bestTool = t.item;
        }
      } catch (_) {}
    }

    const ticks =
      bestMs === Number.MAX_VALUE || !Number.isFinite(bestMs)
        ? COST_INF
        : Math.max(1, bestMs / 50) + BREAK_BLOCK_BASE_PENALTY;
    const res = { ticks, tool: bestTool };
    this.digCache.set(block.type, res);
    return res;
  }

  bestHarvestTool(block) {
    return this.getBreakInfo(block).tool;
  }
}

class CalculationContext {
  constructor(bot, movements, { backtrackMemory = null } = {}) {
    this.bot = bot;
    this.movements = movements;
    this.backtrackMemory = backtrackMemory || new BacktrackMemory();
    this.toolSet = new ToolSet(bot);
    this.blockCache = new Map();
    this.now = Date.now();
    this._scratchVec = new Vec3(0, 0, 0);
  }

  resetForSearch() {
    this.blockCache.clear();
    this.toolSet.refresh();
    this.now = Date.now();
    this.backtrackMemory.prune(this.now);
  }

  getCachedBlock(x, y, z, classifyFn) {
    const key = posKey(x, y, z);
    const hit = this.blockCache.get(key);
    if (hit !== undefined) return hit;

    this._scratchVec.set(x, y, z);
    const raw =
      typeof this.bot?.blockAt === "function"
        ? this.bot.blockAt(this._scratchVec, false)
        : null;
    const info = classifyFn(raw, x, y, z);
    this.blockCache.set(key, info);
    return info;
  }
}

module.exports = {
  BacktrackMemory,
  ToolSet,
  CalculationContext,
  posKey,
  edgeKey,
};
